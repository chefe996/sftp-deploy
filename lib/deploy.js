/**
 * Ядро SFTP-деплоя.
 * Может использоваться как CLI (через bin/cli.js) или программно.
 */

import SftpClient from 'ssh2-sftp-client';
import { resolve, posix } from 'path';
import { readdirSync, statSync } from 'fs';

/**
 * Проверяет, нужно ли сохранить файл/папку при очистке.
 */
function shouldKeep(name, keepFiles) {
  if (!keepFiles || !Array.isArray(keepFiles) || keepFiles.length === 0) return false;
  const normalized = name.replace(/\/$/, '');
  return keepFiles.some((entry) => {
    const e = String(entry).replace(/\/$/, '');
    return e === normalized || e === name || name === entry;
  });
}

/**
 * Удаляет всё на сервере, кроме keepFiles.
 */
async function clearRemoteExcept(sftp, remotePath, keepFiles) {
  let listing;
  try {
    listing = await sftp.list(remotePath);
  } catch {
    // Папка не существует — нечего чистить
    return;
  }

  for (const item of listing) {
    if (item.name === '.' || item.name === '..') continue;
    const fullPath = posix.join(remotePath, item.name);
    if (shouldKeep(item.name, keepFiles)) {
      console.log('  сохраняем:', item.name);
      continue;
    }
    if (item.type === 'd') {
      console.log('  удаляем папку:', item.name);
      await sftp.rmdir(fullPath, true);
    } else {
      console.log('  удаляем файл:', item.name);
      await sftp.delete(fullPath, true);
    }
  }
}

/**
 * Проверяет, нужно ли исключить файл/папку из загрузки.
 */
function shouldExclude(name, excludeList) {
  if (!excludeList || !Array.isArray(excludeList) || excludeList.length === 0) return false;
  const normalized = name.replace(/\/$/, '');
  return excludeList.some((entry) => {
    const e = String(entry).replace(/\/$/, '');
    return e === normalized || e === name || name === entry || name.startsWith(e + '/');
  });
}

/**
 * Рекурсивно собирает список файлов для dry-run.
 */
function listFilesRecursive(dir, prefix = '', excludeList = []) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (shouldExclude(entry, excludeList) || shouldExclude(rel, excludeList)) continue;
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listFilesRecursive(full, rel, excludeList));
    } else {
      files.push(rel);
    }
  }
  return files;
}

/**
 * Рекурсивно загружает папку на сервер с поддержкой exclude.
 */
async function uploadDirFiltered(sftp, localDir, remoteDir, excludeList = [], localBase = '') {
  const entries = readdirSync(localDir);
  for (const entry of entries) {
    const rel = localBase ? `${localBase}/${entry}` : entry;
    if (shouldExclude(entry, excludeList) || shouldExclude(rel, excludeList)) {
      console.log('  пропускаем:', rel);
      continue;
    }
    const localPath = resolve(localDir, entry);
    const remotePath = posix.join(remoteDir, entry);
    if (statSync(localPath).isDirectory()) {
      try { await sftp.mkdir(remotePath, true); } catch {}
      await uploadDirFiltered(sftp, localPath, remotePath, excludeList, rel);
    } else {
      await sftp.put(localPath, remotePath);
      console.log('  ', rel);
    }
  }
}

/**
 * Основная функция деплоя.
 *
 * @param {Object} config — конфигурация (host, port, username, password/privateKey, remotePath, localPath, keepFiles)
 * @param {Object} options — { dryRun: boolean, cwd: string }
 */
export async function deploy(config, options = {}) {
  const { host, port = 22, username, password, privateKey, remotePath, localPath = './dist', keepFiles, exclude = [] } = config;
  const { dryRun = false, cwd = process.cwd() } = options;

  // Валидация
  if (!host || !username || !remotePath) {
    throw new Error('В конфиге не заданы обязательные поля: host, username, remotePath.');
  }
  if (!password && !privateKey) {
    throw new Error('В конфиге укажите password или privateKey.');
  }

  const localAbs = resolve(cwd, localPath);

  // Dry-run: показываем файлы и выходим
  if (dryRun) {
    console.log(`[dry-run] Локальная папка: ${localAbs}`);
    console.log(`[dry-run] Сервер: ${host}:${port} -> ${remotePath}`);
    console.log(`[dry-run] Файлы для загрузки:`);
    const files = listFilesRecursive(localAbs, '', exclude);
    files.forEach((f) => console.log(`  ${f}`));
    console.log(`[dry-run] Всего: ${files.length} файлов`);
    if (exclude.length) {
      console.log(`[dry-run] Исключены: ${exclude.join(', ')}`);
    }
    if (keepFiles?.length) {
      console.log(`[dry-run] Сохраняемые на сервере: ${keepFiles.join(', ')}`);
    }
    return { uploaded: files.length, dryRun: true };
  }

  // Реальный деплой
  const sftp = new SftpClient();
  let uploadedCount = 0;

  try {
    console.log(`Подключение к ${host}:${port}...`);
    await sftp.connect({
      host,
      port,
      username,
      password: password || undefined,
      privateKey: privateKey || undefined,
    });

    console.log('Очистка удалённой папки (кроме keepFiles)...');
    await clearRemoteExcept(sftp, remotePath, keepFiles);

    console.log(`Загрузка ${localPath} -> ${remotePath}...`);
    if (exclude.length > 0) {
      await uploadDirFiltered(sftp, localAbs, remotePath, exclude);
      // Подсчёт загруженных
      uploadedCount = listFilesRecursive(localAbs, '', exclude).length;
    } else {
      sftp.on('upload', (info) => {
        uploadedCount++;
        console.log('  ', info.source.replace(localAbs, '').replace(/^[/\\]/, ''));
      });
      await sftp.uploadDir(localAbs, remotePath);
    }

    console.log(`Деплой завершён. Загружено файлов: ${uploadedCount}`);
    return { uploaded: uploadedCount, dryRun: false };
  } finally {
    sftp.end();
  }
}

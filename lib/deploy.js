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
 * Рекурсивно собирает список файлов для dry-run.
 */
function listFilesRecursive(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      files.push(...listFilesRecursive(full, rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

/**
 * Основная функция деплоя.
 *
 * @param {Object} config — конфигурация (host, port, username, password/privateKey, remotePath, localPath, keepFiles)
 * @param {Object} options — { dryRun: boolean, cwd: string }
 */
export async function deploy(config, options = {}) {
  const { host, port = 22, username, password, privateKey, remotePath, localPath = './dist', keepFiles } = config;
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
    const files = listFilesRecursive(localAbs);
    files.forEach((f) => console.log(`  ${f}`));
    console.log(`[dry-run] Всего: ${files.length} файлов`);
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
    sftp.on('upload', (info) => {
      uploadedCount++;
      console.log('  ', info.source.replace(localAbs, '').replace(/^[/\\]/, ''));
    });
    await sftp.uploadDir(localAbs, remotePath);

    console.log(`Деплой завершён. Загружено файлов: ${uploadedCount}`);
    return { uploaded: uploadedCount, dryRun: false };
  } finally {
    sftp.end();
  }
}

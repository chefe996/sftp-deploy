/**
 * Точка входа для деплоя.
 * Маршрутизирует по полю config.protocol: 'sftp' (по умолчанию) или 'ftp'.
 *
 * Может использоваться как CLI (через bin/cli.js) или программно.
 */

import SftpClient from 'ssh2-sftp-client';
import { resolve, posix } from 'path';
import { readdirSync, statSync } from 'fs';
import { deployFtp } from './ftp.js';
import { createBackup } from './backup.js';

// ─── Общие утилиты ────────────────────────────────────────────────────────────

function shouldKeep(name, keepFiles) {
  if (!keepFiles || !Array.isArray(keepFiles) || keepFiles.length === 0) return false;
  const normalized = name.replace(/\/$/, '');
  return keepFiles.some((entry) => {
    const e = String(entry).replace(/\/$/, '');
    return e === normalized || e === name || name === entry;
  });
}

function shouldExclude(name, excludeList) {
  if (!excludeList || !Array.isArray(excludeList) || excludeList.length === 0) return false;
  const normalized = name.replace(/\/$/, '');
  return excludeList.some((entry) => {
    const e = String(entry).replace(/\/$/, '');
    return e === normalized || e === name || name === entry || name.startsWith(e + '/');
  });
}

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

// ─── SFTP ─────────────────────────────────────────────────────────────────────

async function clearRemoteExceptSftp(sftp, remotePath, keepFiles) {
  let listing;
  try {
    listing = await sftp.list(remotePath);
  } catch {
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

async function uploadDirFilteredSftp(sftp, localDir, remoteDir, excludeList = [], localBase = '') {
  const entries = readdirSync(localDir);
  for (const entry of entries) {
    const rel = localBase ? `${localBase}/${entry}` : entry;
    if (shouldExclude(entry, excludeList) || shouldExclude(rel, excludeList)) {
      console.log('  пропускаем:', rel);
      continue;
    }
    const localFull = resolve(localDir, entry);
    const remoteFull = posix.join(remoteDir, entry);
    if (statSync(localFull).isDirectory()) {
      try { await sftp.mkdir(remoteFull, true); } catch {}
      await uploadDirFilteredSftp(sftp, localFull, remoteFull, excludeList, rel);
    } else {
      await sftp.put(localFull, remoteFull);
      console.log('  ', rel);
    }
  }
}

async function deploySftp(config, options = {}) {
  const { host, port = 22, username, password, privateKey, remotePath, localPath = './dist', keepFiles, exclude = [], backup } = config;
  const { cwd = process.cwd() } = options;

  if (!password && !privateKey) {
    throw new Error('В конфиге укажите password или privateKey.');
  }

  const localAbs = resolve(cwd, localPath);
  const sftp = new SftpClient();
  let uploadedCount = 0;

  try {
    console.log(`Подключение к ${host}:${port} (SFTP)...`);
    await sftp.connect({
      host,
      port,
      username,
      password: password || undefined,
      privateKey: privateKey || undefined,
    });

    if (backup?.enabled) {
      await createBackup('sftp', sftp, remotePath, backup, cwd);
    }

    console.log('Очистка удалённой папки (кроме keepFiles)...');
    await clearRemoteExceptSftp(sftp, remotePath, keepFiles);

    console.log(`Загрузка ${localPath} -> ${remotePath}...`);
    if (exclude.length > 0) {
      await uploadDirFilteredSftp(sftp, localAbs, remotePath, exclude);
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

// ─── Главная функция ──────────────────────────────────────────────────────────

/**
 * Запускает деплой. Протокол выбирается по config.protocol ('sftp' по умолчанию, 'ftp').
 *
 * @param {Object} config
 * @param {Object} options — { dryRun: boolean, cwd: string }
 */
export async function deploy(config, options = {}) {
  const { protocol = 'sftp', host, username, remotePath, localPath = './dist', keepFiles, exclude = [] } = config;
  const { dryRun = false, cwd = process.cwd() } = options;

  // Общая валидация
  if (!host || !username || !remotePath) {
    throw new Error('В конфиге не заданы обязательные поля: host, username, remotePath.');
  }
  if (!['sftp', 'ftp'].includes(protocol)) {
    throw new Error(`Неизвестный протокол "${protocol}". Допустимые значения: sftp, ftp.`);
  }

  const localAbs = resolve(cwd, localPath);
  const port = config.port ?? (protocol === 'ftp' ? 21 : 22);

  // Dry-run — одинаков для обоих протоколов
  if (dryRun) {
    console.log(`[dry-run] Протокол: ${protocol.toUpperCase()}`);
    console.log(`[dry-run] Локальная папка: ${localAbs}`);
    console.log(`[dry-run] Сервер: ${host}:${port} -> ${remotePath}`);
    console.log(`[dry-run] Файлы для загрузки:`);
    const files = listFilesRecursive(localAbs, '', exclude);
    files.forEach((f) => console.log(`  ${f}`));
    console.log(`[dry-run] Всего: ${files.length} файлов`);
    if (exclude.length) console.log(`[dry-run] Исключены: ${exclude.join(', ')}`);
    if (keepFiles?.length) console.log(`[dry-run] Сохраняемые на сервере: ${keepFiles.join(', ')}`);
    return { uploaded: files.length, dryRun: true };
  }

  // Реальный деплой
  if (protocol === 'ftp') {
    return deployFtp({ ...config, port }, options);
  } else {
    return deploySftp({ ...config, port }, options);
  }
}

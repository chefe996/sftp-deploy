/**
 * FTP-деплой через basic-ftp.
 * Поддерживает plain FTP и FTPS (explicit/implicit TLS).
 */

import * as ftp from 'basic-ftp';
import { resolve, posix } from 'path';
import { readdirSync, statSync } from 'fs';
import { createBackup } from './backup.js';

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

async function clearRemoteExcept(client, remotePath, keepFiles) {
  let listing;
  try {
    listing = await client.list(remotePath);
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
    if (item.isDirectory) {
      console.log('  удаляем папку:', item.name);
      await client.removeDir(fullPath);
    } else {
      console.log('  удаляем файл:', item.name);
      await client.remove(fullPath);
    }
  }
}

async function uploadDirFiltered(client, localDir, remoteDir, excludeList = [], localBase = '') {
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
      try { await client.ensureDir(remoteFull); } catch {}
      await uploadDirFiltered(client, localFull, remoteFull, excludeList, rel);
    } else {
      await client.uploadFrom(localFull, remoteFull);
      console.log('  ', rel);
    }
  }
}

export function listFilesRecursive(dir, prefix = '', excludeList = []) {
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

export async function deployFtp(config, options = {}) {
  const {
    host,
    port = 21,
    username,
    password,
    remotePath,
    localPath = './dist',
    keepFiles,
    exclude = [],
    backup,
    secure = false,       // false | true | 'implicit'
    secureOptions = {},   // дополнительные опции TLS
  } = config;
  const { cwd = process.cwd() } = options;

  const localAbs = resolve(cwd, localPath);
  const client = new ftp.Client();
  // client.ftp.verbose = true; // раскомментировать для отладки

  let uploadedCount = 0;

  try {
    console.log(`Подключение к ${host}:${port} (FTP)...`);
    await client.access({
      host,
      port,
      user: username,
      password,
      secure,
      secureOptions,
    });

    if (backup?.enabled) {
      await createBackup('ftp', client, remotePath, backup, cwd);
    }

    console.log('Очистка удалённой папки (кроме keepFiles)...');
    await clearRemoteExcept(client, remotePath, keepFiles);

    console.log(`Загрузка ${localPath} -> ${remotePath}...`);
    if (exclude.length > 0) {
      await uploadDirFiltered(client, localAbs, remotePath, exclude);
      uploadedCount = listFilesRecursive(localAbs, '', exclude).length;
    } else {
      client.trackProgress((info) => {
        if (info.type === 'upload' && info.bytesOverall > 0) {
          // basic-ftp не даёт имя файла в trackProgress — логируем через uploadDirFiltered ниже
        }
      });
      await uploadDirFiltered(client, localAbs, remotePath, []);
      uploadedCount = listFilesRecursive(localAbs, '', []).length;
    }

    console.log(`Деплой завершён. Загружено файлов: ${uploadedCount}`);
    return { uploaded: uploadedCount, dryRun: false };
  } finally {
    client.close();
  }
}

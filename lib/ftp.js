/**
 * FTP-деплой через basic-ftp.
 * Поддерживает plain FTP и FTPS (explicit/implicit TLS).
 */

import * as ftp from 'basic-ftp';
import { resolve, posix } from 'path';
import { readdirSync, statSync } from 'fs';
import { createBackup } from './backup.js';
import { listFilesRecursive } from './deploy.js';

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

  const toDelete = listing.filter(
    (item) => item.name !== '.' && item.name !== '..' && !shouldKeep(item.name, keepFiles)
  );
  const toKeep = listing.filter(
    (item) => item.name !== '.' && item.name !== '..' && shouldKeep(item.name, keepFiles)
  );

  toKeep.forEach((item) => console.log(`  сохраняем: ${item.name}`));

  if (toDelete.length === 0) {
    console.log('  нечего удалять');
    return;
  }

  let n = 0;
  for (const item of toDelete) {
    n++;
    const fullPath = posix.join(remotePath, item.name);
    const label = item.isDirectory ? `[папка] ${item.name}` : item.name;
    console.log(`  [${n}/${toDelete.length}] удаляем: ${label}`);
    if (item.isDirectory) {
      await client.removeDir(fullPath);
    } else {
      await client.remove(fullPath);
    }
  }
}

async function uploadDirFiltered(client, localDir, remoteDir, excludeList, counter, localBase = '') {
  for (const entry of readdirSync(localDir)) {
    const rel = localBase ? `${localBase}/${entry}` : entry;
    if (shouldExclude(entry, excludeList) || shouldExclude(rel, excludeList)) {
      console.log(`  пропускаем: ${rel}`);
      continue;
    }
    const localFull = resolve(localDir, entry);
    const remoteFull = posix.join(remoteDir, entry);
    if (statSync(localFull).isDirectory()) {
      try { await client.ensureDir(remoteFull); } catch {}
      await uploadDirFiltered(client, localFull, remoteFull, excludeList, counter, rel);
    } else {
      counter.current++;
      console.log(`  [${counter.current}/${counter.total}] ${rel}`);
      await client.uploadFrom(localFull, remoteFull);
    }
  }
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
    secure = false,
    secureOptions = {},
  } = config;
  const { cwd = process.cwd() } = options;

  const localAbs = resolve(cwd, localPath);
  const client = new ftp.Client();
  // client.ftp.verbose = true; // раскомментировать для отладки

  try {
    console.log(`Подключение к ${host}:${port} (FTP)...`);
    await client.access({ host, port, user: username, password, secure, secureOptions });

    if (backup?.enabled) {
      await createBackup('ftp', client, remotePath, backup, cwd);
    }

    console.log('Очистка удалённой папки (кроме keepFiles)...');
    await clearRemoteExcept(client, remotePath, keepFiles);

    console.log(`Загрузка ${localPath} -> ${remotePath}...`);
    const files = listFilesRecursive(localAbs, '', exclude);
    console.log(`  всего файлов: ${files.length}`);
    const counter = { current: 0, total: files.length };
    await uploadDirFiltered(client, localAbs, remotePath, exclude, counter);

    console.log(`Деплой завершён. Загружено файлов: ${counter.current}`);
    return { uploaded: counter.current, dryRun: false };
  } finally {
    client.close();
  }
}

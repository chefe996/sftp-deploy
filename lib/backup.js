/**
 * Бекап удалённой папки перед деплоем.
 *
 * Алгоритм:
 *   1. Скачивает remotePath во временную папку
 *   2. Упаковывает во архив (zip или tar.gz)
 *   3. Сохраняет архив в backup.localPath
 *   4. Удаляет временную папку
 */

import { resolve, join } from 'path';
import { mkdirSync, rmSync, createWriteStream, existsSync } from 'fs';
import { tmpdir } from 'os';
import archiver from 'archiver';

// ─── Создание архива ──────────────────────────────────────────────────────────

function createArchive(sourceDir, destFile, format) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destFile);
    const arc = archiver(
      format === 'tar.gz' ? 'tar' : 'zip',
      format === 'tar.gz'
        ? { gzip: true, gzipOptions: { level: 9 } }
        : { zlib: { level: 9 } }
    );

    output.on('close', () => resolve(arc.pointer()));
    arc.on('error', reject);
    arc.pipe(output);
    arc.directory(sourceDir, false);
    arc.finalize();
  });
}

// ─── Форматирование имени файла ───────────────────────────────────────────────

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    '_' + pad(date.getHours()) +
    '-' + pad(date.getMinutes()) +
    '-' + pad(date.getSeconds())
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Главная функция ──────────────────────────────────────────────────────────

/**
 * Создаёт бекап удалённой папки.
 *
 * @param {'sftp'|'ftp'} protocol
 * @param {Object} connection — активное соединение (sftp-client или ftp-client)
 * @param {string} remotePath — папка на сервере
 * @param {Object} backupConfig — { localPath, format }
 * @param {string} cwd — рабочая директория проекта
 * @returns {Promise<string>} путь к созданному архиву
 */
export async function createBackup(protocol, connection, remotePath, backupConfig, cwd = process.cwd()) {
  const {
    localPath: backupDir = './backups',
    format = 'zip',
  } = backupConfig;

  const allowedFormats = ['zip', 'tar.gz'];
  if (!allowedFormats.includes(format)) {
    throw new Error(`Неизвестный формат бекапа "${format}". Допустимые: ${allowedFormats.join(', ')}.`);
  }

  const ext = format === 'tar.gz' ? 'tar.gz' : 'zip';
  const timestamp = formatTimestamp();
  const archiveName = `backup-${timestamp}.${ext}`;

  const backupDirAbs = resolve(cwd, backupDir);
  mkdirSync(backupDirAbs, { recursive: true });
  const archivePath = join(backupDirAbs, archiveName);

  // Временная папка для скачивания
  const tempDir = join(tmpdir(), `sftp-deploy-backup-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    console.log(`Бекап: скачиваем ${remotePath}...`);

    if (protocol === 'sftp') {
      await connection.downloadDir(remotePath, tempDir);
    } else {
      // basic-ftp: downloadToDir(local, remote)
      await connection.downloadToDir(tempDir, remotePath);
    }

    console.log(`Бекап: упаковываем в ${format}...`);
    const bytes = await createArchive(tempDir, archivePath, format);

    console.log(`Бекап сохранён: ${archiveName} (${formatBytes(bytes)})`);
    return archivePath;
  } finally {
    // Удаляем временную папку в любом случае
    rmSync(tempDir, { recursive: true, force: true });
  }
}

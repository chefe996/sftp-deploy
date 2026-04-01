/**
 * Бекап удалённой папки перед деплоем.
 *
 * Алгоритм:
 *   1. Скачивает remotePath во временную папку
 *   2. Упаковывает в архив (zip или tar.gz)
 *   3. Сохраняет архив в backup.localPath
 *   4. Удаляет временную папку
 */

import { resolve, join } from 'path';
import { mkdirSync, rmSync, createWriteStream } from 'fs';
import { tmpdir } from 'os';
import archiver from 'archiver';

// ─── Вспомогательные ─────────────────────────────────────────────────────────

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

/** Перезаписываемая строка прогресса — работает в TTY и в обычных логах. */
function writeProgress(msg) {
  if (process.stdout.isTTY) {
    process.stdout.write(`\r\x1b[2K  ${msg}`);
  } else {
    console.log(`  ${msg}`);
  }
}

function endProgress(msg) {
  if (process.stdout.isTTY) {
    process.stdout.write(`\r\x1b[2K  ${msg}\n`);
  } else {
    console.log(`  ${msg}`);
  }
}

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

    let entriesCount = 0;
    arc.on('entry', () => {
      entriesCount++;
      writeProgress(`упаковываем: ${entriesCount} файлов...`);
    });

    output.on('close', () => {
      endProgress(`упаковано: ${entriesCount} файлов (${formatBytes(arc.pointer())})`);
      resolve(arc.pointer());
    });
    arc.on('error', reject);
    arc.pipe(output);
    arc.directory(sourceDir, false);
    arc.finalize();
  });
}

// ─── Скачивание с прогрессом ──────────────────────────────────────────────────

async function downloadSftp(sftp, remotePath, tempDir) {
  let count = 0;
  const onDownload = (info) => {
    count++;
    const name = String(info.source || '').split(/[/\\]/).pop() || '';
    writeProgress(`скачиваем: ${count} файлов${name ? ' — ' + name : ''}`);
  };
  sftp.on('download', onDownload);
  try {
    await sftp.downloadDir(remotePath, tempDir);
  } finally {
    sftp.removeListener('download', onDownload);
  }
  endProgress(`скачано: ${count} файлов`);
}

async function downloadFtp(client, remotePath, tempDir) {
  let lastName = '';
  client.trackProgress((info) => {
    if (info.type === 'download' || info.name) {
      const name = info.name || '';
      if (name !== lastName) {
        lastName = name;
        writeProgress(`скачиваем: ${name} (${formatBytes(info.bytesOverall)})`);
      } else {
        writeProgress(`скачиваем: ${name} — ${formatBytes(info.bytes)} / ${formatBytes(info.bytesOverall)}`);
      }
    }
  });
  try {
    await client.downloadToDir(tempDir, remotePath);
  } finally {
    client.trackProgress(); // сбросить обработчик
  }
  endProgress(`скачивание завершено`);
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
  const { localPath: backupDir = './backups', format = 'zip' } = backupConfig;

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

  const tempDir = join(tmpdir(), `sftp-deploy-backup-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    console.log(`Бекап: скачиваем ${remotePath}...`);

    if (protocol === 'sftp') {
      await downloadSftp(connection, remotePath, tempDir);
    } else {
      await downloadFtp(connection, remotePath, tempDir);
    }

    console.log(`Бекап: упаковываем в ${format}...`);
    await createArchive(tempDir, archivePath, format);

    console.log(`Бекап сохранён: ${archiveName}`);
    return archivePath;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

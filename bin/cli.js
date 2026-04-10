#!/usr/bin/env node

/**
 * CLI для SFTP-деплоя.
 *
 * Использование:
 *   sftp-deploy          — деплой с конфигом deploy.config.js из текущей директории
 *   sftp-deploy init     — создать deploy.config.js из шаблона
 *   sftp-deploy --config path/to/config.js  — указать путь к конфигу
 *   sftp-deploy --dry-run — показать что будет загружено, без реальной отправки
 */

import { resolve, dirname } from 'path';
import { existsSync, copyFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { deploy } from '../lib/deploy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');

const args = process.argv.slice(2);

// --- Команда init ---
if (args.includes('init')) {
  const dest = resolve(process.cwd(), 'deploy.config.js');
  if (existsSync(dest)) {
    console.error('deploy.config.js уже существует. Удалите его, если хотите создать заново.');
    process.exit(1);
  }
  const example = resolve(packageRoot, 'deploy.config.example.js');
  copyFileSync(example, dest);
  console.log('Создан deploy.config.js — заполните данные сервера.');

  // Напоминание про .gitignore
  const gitignorePath = resolve(process.cwd(), '.gitignore');
  let needsWarning = true;
  if (existsSync(gitignorePath)) {
    const { readFileSync } = await import('fs');
    const text = readFileSync(gitignorePath, 'utf8');
    if (text.includes('deploy.config.js')) needsWarning = false;
  }
  if (needsWarning) {
    console.log('  Не забудьте добавить deploy.config.js в .gitignore (там пароли).');
  }
  process.exit(0);
}

// --- Парсинг аргументов ---
let configPath = null;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config' && args[i + 1]) {
    configPath = resolve(process.cwd(), args[i + 1]);
    i++;
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  }
}

// --- Автоопределение конфига (.mjs приоритетнее .js) ---
if (!configPath) {
  const mjsPath = resolve(process.cwd(), 'deploy.config.mjs');
  const jsPath = resolve(process.cwd(), 'deploy.config.js');
  if (existsSync(mjsPath)) {
    configPath = mjsPath;
  } else {
    configPath = jsPath;
  }
}

// --- Загрузка конфига ---
if (!existsSync(configPath)) {
  console.error(`Не найден конфиг: ${configPath}`);
  console.error('Запустите "sftp-deploy init" для создания шаблона.');
  process.exit(1);
}

let config;
try {
  const mod = await import(pathToFileURL(configPath).href);
  config = mod.default;
} catch (err) {
  console.error('Ошибка загрузки конфига:', err.message);
  process.exit(1);
}

// --- Запуск деплоя ---
try {
  await deploy(config, { dryRun, cwd: process.cwd() });
} catch (err) {
  console.error('Ошибка деплоя:', err.message);
  process.exit(1);
}

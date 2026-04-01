# sftp-deploy

Простой CLI для деплоя фронтенд-проектов через FTP или SFTP.

Загружает папку сборки (`dist/`) на удалённый сервер: очищает удалённую папку, сохраняя указанные файлы, и заливает новую версию.

## Установка

### Из GitHub-репозитория

```bash
npm i -D github:ВАШ_ЮЗЕРНЕЙМ/sftp-deploy
```

### Локально (из соседней папки)

```bash
npm i -D ../sftp-deploy
```

## Быстрый старт

**1. Создайте конфиг:**

```bash
npx sftp-deploy init
```

Команда создаст `deploy.config.js` в текущей папке. Заполните данные сервера.

**2. Добавьте `deploy.config.js` в `.gitignore`** (там пароли):

```gitignore
deploy.config.js
```

**3. Добавьте в `package.json`:**

```json
{
  "scripts": {
    "postbuild": "sftp-deploy"
  }
}
```

Теперь `npm run build` будет автоматически деплоить проект после сборки.

## Конфиг

### SFTP (по умолчанию)

```js
export default {
  protocol: 'sftp',              // можно не указывать — sftp по умолчанию
  host: 'example.com',
  port: 22,
  username: 'user',
  password: 'secret',            // или privateKey (см. ниже)
  remotePath: '/var/www/html/my-project',
  localPath: './dist',
  keepFiles: [
    '.htaccess',
    'robots.txt',
    'sitemap.xml',
    'uploads/',
  ],
};
```

### FTP

```js
export default {
  protocol: 'ftp',
  host: 'example.com',
  port: 21,
  username: 'user',
  password: 'secret',
  secure: false,                 // false = plain FTP, true = FTPS explicit, 'implicit' = FTPS implicit
  remotePath: '/public_html/my-project',
  localPath: './dist',
  keepFiles: ['.htaccess', 'robots.txt'],
};
```

### Аутентификация по SSH-ключу (только SFTP)

```js
export default {
  protocol: 'sftp',
  // ...
  privateKey: '/home/user/.ssh/id_rsa',
  // или содержимое ключа строкой
};
```

### Все параметры конфига

| Поле | Обязательный | По умолчанию | Описание |
| --- | --- | --- | --- |
| `protocol` | нет | `sftp` | Протокол: `sftp` или `ftp` |
| `host` | да | — | Хост сервера |
| `port` | нет | `22` (sftp) / `21` (ftp) | Порт |
| `username` | да | — | Логин |
| `password` | * | — | Пароль |
| `privateKey` | * | — | Путь или содержимое SSH-ключа (только SFTP) |
| `secure` | нет | `false` | Режим TLS для FTP: `false`, `true`, `'implicit'` |
| `remotePath` | да | — | Папка на сервере |
| `localPath` | нет | `./dist` | Локальная папка для загрузки |
| `keepFiles` | нет | `[]` | Файлы/папки на сервере, которые не удалять |
| `exclude` | нет | `[]` | Файлы из `localPath`, которые не загружать |
| `backup` | нет | — | Настройки бекапа (см. ниже) |

### Бекап перед деплоем

Перед очисткой сервера скачивает текущую версию и упаковывает в архив.

```js
backup: {
  enabled: true,           // включить бекап (по умолчанию false / не задано)
  localPath: './backups',  // куда сохранять (по умолчанию ./backups)
  format: 'zip',           // 'zip' (по умолчанию) или 'tar.gz'
}
```

Архив именуется по дате: `backup-2026-04-01_12-30-00.zip`.

*Требуется одно из двух: `password` или `privateKey`.

## CLI

```bash
# Деплой с конфигом из текущей папки
sftp-deploy

# Создать deploy.config.js из шаблона
sftp-deploy init

# Показать файлы для загрузки без реальной отправки
sftp-deploy --dry-run

# Указать путь к конфигу
sftp-deploy --config path/to/my-config.js

# Комбинации
sftp-deploy --config prod.config.js --dry-run
```

## Программное использование

```js
import { deploy } from 'sftp-deploy/lib/deploy.js';

// SFTP
await deploy({
  protocol: 'sftp',
  host: 'example.com',
  username: 'user',
  password: 'secret',
  remotePath: '/var/www/html/project',
  localPath: './dist',
  keepFiles: ['.htaccess'],
});

// FTP
await deploy({
  protocol: 'ftp',
  host: 'example.com',
  username: 'user',
  password: 'secret',
  remotePath: '/public_html/project',
});
```

## Как это работает

1. Подключается к серверу по выбранному протоколу (FTP или SFTP)
2. Читает список файлов в `remotePath`
3. Удаляет всё, кроме файлов из `keepFiles`
4. Загружает содержимое `localPath` в `remotePath`, пропуская файлы из `exclude`

## Обновление пакета в проектах

После изменений в репозитории пакета:

```bash
npm update sftp-deploy
```

# sftp-deploy

Простой CLI для деплоя фронтенд-проектов через SFTP.

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

```
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

Файл `deploy.config.js`:

```js
export default {
  host: 'example.com',
  port: 22,                        // по умолчанию 22
  username: 'user',
  password: 'secret',              // или privateKey (см. ниже)
  remotePath: '/var/www/html/my-project',
  localPath: './dist',             // по умолчанию ./dist
  keepFiles: [
    // Файлы и папки на сервере, которые НЕ удаляются при деплое
    '.htaccess',
    'robots.txt',
    'sitemap.xml',
    'uploads/',
  ],
  exclude: [
    // Файлы из localPath, которые НЕ загружаются на сервер (опционально)
    // 'sourcemaps/',
    // '*.map',
  ],
};
```

### Аутентификация по SSH-ключу

Вместо `password` укажите путь к приватному ключу:

```js
export default {
  // ...
  privateKey: '/home/user/.ssh/id_rsa',
  // или содержимое ключа строкой: privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----...'
};
```

### Параметры конфига

| Поле | Обязательный | По умолчанию | Описание |
|---|---|---|---|
| `host` | да | — | Хост сервера |
| `port` | нет | `22` | SSH-порт |
| `username` | да | — | Логин |
| `password` | * | — | Пароль |
| `privateKey` | * | — | Путь или содержимое SSH-ключа |
| `remotePath` | да | — | Папка на сервере |
| `localPath` | нет | `./dist` | Локальная папка для загрузки |
| `keepFiles` | нет | `[]` | Файлы/папки на сервере, которые не удалять |
| `exclude` | нет | `[]` | Файлы из localPath, которые не загружать |

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

await deploy({
  host: 'example.com',
  username: 'user',
  password: 'secret',
  remotePath: '/var/www/html/project',
  localPath: './dist',
  keepFiles: ['.htaccess'],
});
```

## Как это работает

1. Подключается к серверу по SFTP
2. Читает список файлов в `remotePath`
3. Удаляет всё, кроме файлов из `keepFiles`
4. Загружает содержимое `localPath` в `remotePath`

## Обновление пакета в проектах

После изменений в репозитории пакета:

```bash
npm update sftp-deploy
```

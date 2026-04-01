/**
 * Пример конфига деплоя.
 * Скопируйте в deploy.config.js и заполните данные.
 * Файл deploy.config.js НЕ коммитится в git (содержит пароли).
 */

// ─── Пример для SFTP (по умолчанию) ─────────────────────────────────────────
export default {
  protocol: 'sftp',              // 'sftp' (по умолчанию) | 'ftp'
  host: 'example.com',
  port: 22,
  username: 'user',
  password: 'secret',            // или privateKey: '/path/to/key'
  remotePath: '/var/www/html/my-project',
  localPath: './dist',           // по умолчанию ./dist
  keepFiles: [
    // Файлы и папки на сервере, которые НЕ удаляются при деплое
    '.htaccess',
    'robots.txt',
    'sitemap.xml',
    'uploads/',
  ],
  // exclude: [
  //   // Файлы из localPath, которые НЕ загружаются на сервер
  //   'sourcemaps/',
  // ],
};

// ─── Пример для FTP ──────────────────────────────────────────────────────────
// export default {
//   protocol: 'ftp',
//   host: 'example.com',
//   port: 21,
//   username: 'user',
//   password: 'secret',
//   secure: false,               // false = plain FTP, true = FTPS (explicit TLS), 'implicit' = FTPS implicit
//   remotePath: '/public_html/my-project',
//   localPath: './dist',
//   keepFiles: ['.htaccess', 'robots.txt'],
// };

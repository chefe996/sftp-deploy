/**
 * Пример конфига деплоя.
 * Скопируйте в deploy.config.js и заполните данные.
 * Файл deploy.config.js НЕ коммитится в git (содержит пароли).
 */
export default {
  host: 'example.com',
  port: 22,
  username: 'user',
  password: 'secret', // или privateKey: '/path/to/key'
  remotePath: '/var/www/html/my-project',
  localPath: './dist',
  keepFiles: [
    // Файлы и папки на сервере, которые НЕ удаляются при деплое
    '.htaccess',
    'robots.txt',
    'sitemap.xml',
    'uploads/',
  ],
};

// Копирует веб-файлы в www/ для Android-сборки и убирает скрипт Telegram (в APK он не нужен и тормозит запуск без сети).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of ['style.css', 'parser.js', 'storage.js', 'app.js']) {
  if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(out, f));
}
// ядро Capacitor (браузерный бандл) — через него приложение вызывает нативные плагины
fs.copyFileSync(path.join(root, 'node_modules/@capacitor/core/dist/capacitor.js'), path.join(out, 'capacitor.js'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/\s*<script src="https:\/\/telegram\.org[^>]*><\/script>/, '')
  .replace('<script src="parser.js"></script>', '<script src="capacitor.js"></script>\n  <script src="parser.js"></script>');
if (!html.includes('capacitor.js')) throw new Error('не удалось подключить capacitor.js');
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('www/ ready');

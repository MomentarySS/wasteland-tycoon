// 启动本地服务器并在就绪后打开浏览器（Sherpa 需要 COOP/COEP）
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8824);
const HOST = process.env.HOST || '127.0.0.1';
const URL = `http://${HOST}:${PORT}/`;

function portBusy(host, port) {
  return new Promise((resolve) => {
    const probe = net.createConnection({ host, port });
    probe.setTimeout(400);
    probe.on('connect', () => { probe.destroy(); resolve(true); });
    probe.on('timeout', () => { probe.destroy(); resolve(false); });
    probe.on('error', () => resolve(false));
  });
}

const busy = await portBusy(HOST, PORT);
if (busy) {
  console.error('');
  console.error('  [错误] 端口 ' + PORT + ' 已被占用（常见原因：之前开的 python -m http.server 窗口未关）');
  console.error('  请关闭旧的服务器黑窗口，再重新运行 npm start 或 启动游戏.bat');
  console.error('');
  process.exit(1);
}

const child = spawn(process.execPath, [path.join(HERE, 'serve.mjs')], {
  stdio: 'inherit',
  env: process.env,
  cwd: path.resolve(HERE, '..'),
});

let opened = false;
function openBrowser() {
  if (opened) return;
  opened = true;
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = isWin ? ['/c', 'start', '', URL] : [URL];
  const child = spawn(cmd, args, {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
}

const deadline = Date.now() + 8000;
(function waitReady() {
  portBusy(HOST, PORT).then((up) => {
    if (up) { openBrowser(); return; }
    if (Date.now() < deadline) setTimeout(waitReady, 120);
  });
})();

child.on('exit', (code) => process.exit(code ?? 0));

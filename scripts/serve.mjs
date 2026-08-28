// 本地静态服务器：注入 COOP/COEP，使 Sherpa WASM 可用 SharedArrayBuffer（crossOriginIsolated）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.PORT || 8824);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  // 与 sherpa-onnx 官方 wasm/serve.py 一致；credentialless 便于阶跃 API 等跨域请求
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cache-Control': 'no-cache',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded.replace(/^\/+/, '') || 'index.html';
  const abs = path.resolve(ROOT, rel);
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

function send(res, code, body, type) {
  res.writeHead(code, { ...ISOLATION, 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed');
    return;
  }
  const filePath = safePath(req.url || '/');
  if (!filePath) {
    send(res, 403, 'Forbidden');
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err) {
      const fallback = path.join(ROOT, 'index.html');
      fs.readFile(fallback, (e2, data) => {
        if (e2) { send(res, 404, 'Not Found'); return; }
        if (req.method === 'HEAD') {
          res.writeHead(200, { ...ISOLATION, 'Content-Type': 'text/html; charset=utf-8' });
          res.end();
          return;
        }
        send(res, 200, data, 'text/html; charset=utf-8');
      });
      return;
    }
    if (st.isDirectory()) {
      const idx = path.join(filePath, 'index.html');
      fs.readFile(idx, (e2, data) => {
        if (e2) { send(res, 403, 'Directory listing disabled'); return; }
        if (req.method === 'HEAD') {
          res.writeHead(200, { ...ISOLATION, 'Content-Type': 'text/html; charset=utf-8' });
          res.end();
          return;
        }
        send(res, 200, data, 'text/html; charset=utf-8');
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...ISOLATION, 'Content-Type': type });
      res.end();
      return;
    }
    fs.readFile(filePath, (e2, data) => {
      if (e2) { send(res, 500, 'Read error'); return; }
      send(res, 200, data, type);
    });
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('');
    console.error('  [错误] 端口 ' + PORT + ' 已被占用');
    console.error('  若之前用过 python -m http.server，请先关闭那个黑窗口');
    console.error('  然后重新运行: npm start');
    console.error('');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ☢ 废土大亨本地服务器');
  console.log('  地址: http://' + HOST + ':' + PORT + '/');
  console.log('  crossOriginIsolated: 已启用（Sherpa 离线语音需要）');
  console.log('');
});

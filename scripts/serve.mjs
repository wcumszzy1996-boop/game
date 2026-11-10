/**
 * scripts/serve.mjs — 开发用静态服务器（支持 WASM/模块的 MIME）
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p === '') p = '/index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const st = await stat(full);
    if (st.isDirectory()) {
      res.writeHead(302, { Location: p.replace(/\/?$/, '/') + 'index.html' }).end();
      return;
    }
    const buf = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  星锋突击 · 开发服务器\n  → http://127.0.0.1:${PORT}/\n  （Ctrl+C 停止）\n`);
});

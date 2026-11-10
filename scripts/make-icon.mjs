/**
 * scripts/make-icon.mjs — 生成应用图标（PNG + ICO），零第三方依赖
 *
 * 思路：把「星锋突击」的徽标画成 SVG，交给一个运行中的 Chrome
 * （--remote-debugging-port）渲染成 1:1 像素的 PNG，然后按 ICO 规范
 * 打包成多尺寸 .ico（Vista+ 允许 ICO 内直接放 PNG 负载）。
 *
 * 用法：
 *   node scripts/make-icon.mjs [--port 9222] [--out assets]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const PORT = arg('port', '9222');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, arg('out', 'assets'));

const SIZES = [256, 128, 64, 48, 32, 16];

/* ------------------------------------------------------------------ *
 * 徽标：深空底 + 六边形蜂巢框 + 三角翼战机剪影 + 主星
 * ------------------------------------------------------------------ */
function logoSvg(size) {
  // 以 256 为设计基准，等比缩放到目标尺寸
  const s = size / 256;
  const pad = Math.round(6 * s);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="78%">
      <stop offset="0%" stop-color="#241a4d"/>
      <stop offset="52%" stop-color="#0c0a24"/>
      <stop offset="100%" stop-color="#03020a"/>
    </radialGradient>
    <linearGradient id="hull" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f4f7ff"/>
      <stop offset="46%" stop-color="#b7c6dd"/>
      <stop offset="100%" stop-color="#6b7c99"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8ff4ff"/>
      <stop offset="55%" stop-color="#5fe8ff"/>
      <stop offset="100%" stop-color="#2fa8d8"/>
    </linearGradient>
    <linearGradient id="flame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#9ff0ff"/>
      <stop offset="100%" stop-color="#2f8ad8" stop-opacity="0"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="${(3.2 * s).toFixed(2)}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="256" height="256" rx="${(56 * s).toFixed(1)}" fill="url(#bg)"/>
  <rect x="${pad}" y="${pad}" width="${256 - pad * 2}" height="${256 - pad * 2}"
        rx="${(50 * s).toFixed(1)}" fill="none" stroke="#5fe8ff" stroke-opacity="0.32"
        stroke-width="${(2.5 * s).toFixed(2)}"/>

  <!-- 星群 -->
  <g fill="#ffffff">
    <circle cx="46" cy="52" r="${(2.1 * s).toFixed(2)}" opacity="0.85"/>
    <circle cx="212" cy="66" r="${(1.6 * s).toFixed(2)}" opacity="0.7"/>
    <circle cx="66" cy="196" r="${(1.4 * s).toFixed(2)}" opacity="0.5"/>
    <circle cx="196" cy="188" r="${(2.0 * s).toFixed(2)}" opacity="0.62"/>
    <circle cx="128" cy="30" r="${(1.5 * s).toFixed(2)}" opacity="0.6"/>
  </g>

  <!-- 蜂巢六边形 -->
  <g fill="none" stroke="url(#edge)" stroke-opacity="0.55"
     stroke-width="${(2.6 * s).toFixed(2)}" stroke-linejoin="round">
    <path d="M128 44 L200 85 L200 167 L128 208 L56 167 L56 85 Z"/>
  </g>
  <g fill="none" stroke="#ff4d9e" stroke-opacity="0.42"
     stroke-width="${(1.5 * s).toFixed(2)}" stroke-linejoin="round">
    <path d="M128 66 L181 96 L181 156 L128 186 L75 156 L75 96 Z"/>
  </g>

  <!-- 引擎尾焰 -->
  <g filter="url(#glow)">
    <path d="M128 150 L139 150 L136 214 L128 232 L120 214 L117 150 Z" fill="url(#flame)" opacity="0.85"/>
  </g>

  <!-- 三角翼战机（俯视） -->
  <g filter="url(#glow)">
    <path d="M128 62
             L136 96 L152 100 L176 116 L178 128 L148 121
             L142 150 L128 168 L114 150
             L108 121 L78 128 L80 116 L104 100 L120 96 Z"
          fill="url(#hull)" stroke="#e8f6ff" stroke-width="${(1.2 * s).toFixed(2)}"
          stroke-linejoin="round"/>
    <!-- 座舱 -->
    <path d="M128 84 L136 104 L128 116 L120 104 Z" fill="#1b2340" stroke="#5fe8ff"
          stroke-width="${(1.6 * s).toFixed(2)}"/>
    <!-- 翼尖航行灯 -->
    <circle cx="79" cy="120" r="${(4.0 * s).toFixed(2)}" fill="#5fe8ff"/>
    <circle cx="177" cy="120" r="${(4.0 * s).toFixed(2)}" fill="#ff4d9e"/>
  </g>

  <!-- 引擎光点 -->
  <g filter="url(#glow)">
    <circle cx="128" cy="166" r="${(9 * s).toFixed(2)}" fill="#cdf6ff" opacity="0.9"/>
  </g>
</svg>`;
}

/* ------------------------------------------------------------------ *
 * CDP 最小客户端
 * ------------------------------------------------------------------ */
class CDP {
  constructor() { this.id = 0; this.pend = new Map(); this.sid = null; }
  static async connect(port) {
    const c = new CDP();
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    await new Promise((res, rej) => {
      const ws = new WebSocket(info.webSocketDebuggerUrl);
      c.ws = ws;
      ws.addEventListener('open', res);
      ws.addEventListener('error', () => rej(new Error('无法连接 Chrome 调试端口 ' + port)));
      ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && c.pend.has(m.id)) {
          const p = c.pend.get(m.id);
          c.pend.delete(m.id);
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
      });
    });
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
    const r = await c.send('Target.attachToTarget', { targetId, flatten: true });
    c.sid = r.sessionId;
    await c.send('Page.enable', {}, c.sid);
    return c;
  }
  send(method, params = {}, sid) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pend.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
      setTimeout(() => { if (this.pend.has(id)) { this.pend.delete(id); rej(new Error('CDP 超时 ' + method)); } }, 20000);
    });
  }
  /** 渲染 SVG 并截取 1:1 PNG */
  async renderPng(svg, size) {
    const url = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
    const html = `<!DOCTYPE html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
img{display:block;width:${size}px;height:${size}px}</style>
<img src="${url}">`;
    await this.send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html, 'utf8').toString('base64') }, this.sid);
    await new Promise((r) => setTimeout(r, 320));
    const shot = await this.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
      captureBeyondViewport: true,
      omitBackground: true,
    }, this.sid);
    return Buffer.from(shot.data, 'base64');
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

/* ------------------------------------------------------------------ *
 * ICO 打包（Vista+ 支持内嵌 PNG）
 * ------------------------------------------------------------------ */
function buildIco(images) {
  const n = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);   // reserved
  header.writeUInt16LE(1, 2);   // type = icon
  header.writeUInt16LE(n, 4);   // count
  const dir = Buffer.alloc(16 * n);
  let offset = 6 + 16 * n;
  images.forEach((img, i) => {
    const o = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o + 0);     // width（0 表示 256）
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o + 1);     // height
    dir.writeUInt8(0, o + 2);                                  // 调色板数
    dir.writeUInt8(0, o + 3);                                  // reserved
    dir.writeUInt16LE(1, o + 4);                               // planes
    dir.writeUInt16LE(32, o + 6);                              // bpp
    dir.writeUInt32LE(img.data.length, o + 8);                 // 数据长度
    dir.writeUInt32LE(offset, o + 12);                          // 数据偏移
    offset += img.data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

/* ------------------------------------------------------------------ */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await CDP.connect(PORT);
  const images = [];
  try {
    for (const size of SIZES) {
      const png = await cdp.renderPng(logoSvg(size), size);
      images.push({ size, data: png });
      fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png);
      console.log(`  · icon-${size}.png  ${(png.length / 1024).toFixed(1)} KB`);
    }
  } finally {
    cdp.close();
  }
  const ico = buildIco(images);
  const icoPath = path.join(OUT, 'icon.ico');
  fs.writeFileSync(icoPath, ico);
  // 主 PNG（Electron BrowserWindow / 网页 favicon 用）
  fs.copyFileSync(path.join(OUT, 'icon-256.png'), path.join(OUT, 'icon.png'));
  console.log(`\n✓ 图标已生成：${icoPath}  (${(ico.length / 1024).toFixed(1)} KB, ${SIZES.length} 个尺寸)`);
}

main().catch((e) => {
  console.error('\n✖ 生成图标失败：', e.message);
  process.exit(1);
});

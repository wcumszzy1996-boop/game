/**
 * probe-layers.mjs — 逐层像素差分定位工具
 *
 * 用途：当画面出现来源不明的元素（过大光斑、异常亮块）时，
 *       逐一隐藏场景中的候选图层并截图，在页面内做像素差分，
 *       按贡献度排序，快速定位"凶手"。
 *
 * 关键点：每次修改可见性后必须等待若干帧再截图，
 *        Page.captureScreenshot 可能取到修改前的帧，否则会得出错误结论。
 *
 * 用法：node tools/probe-layers.mjs --port 9222 --out .tmp-probe
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PORT = getArg('--port', '9222');
const OUT = getArg('--out', '.tmp-probe');
const URL_ = getArg('--url', 'http://127.0.0.1:8123/');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(info.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
let sid = null;
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', () => rej(new Error('无法连接调试端口')));
});
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const r = await send('Target.attachToTarget', { targetId, flatten: true });
sid = r.sessionId;
for (const d of ['Page', 'Runtime', 'Network']) await send(`${d}.enable`, {}, sid);
await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
await send('Page.navigate', { url: URL_ }, sid);
await wait(4000);

const ev = async (expression) => {
  const q = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
  if (q.exceptionDetails) throw new Error(q.exceptionDetails.exception?.description || q.exceptionDetails.text);
  return q.result.value;
};
const snap = async () => (await send('Page.captureScreenshot', { format: 'png' }, sid)).data;

await ev('window.__strike.startRun("normal", 0)');
await wait(2600);
/* 冻结模拟但保持渲染：sdt 归零后所有实体停止推进，
   画面完全静止，像素统计才不会被运动噪声淹没 */
await ev('window.__strike.game.paused = true; 1');
await wait(600);

/* 每轮开始时恢复全部图层（务必包含玩家与灯光，
   否则上一轮的隐藏会污染下一轮的测量结果） */
const RESTORE = `(() => {
  const g = window.__strike.game, w = g.world;
  w.root.visible = true;
  w.starLayers.forEach(l => l.points.visible = true);
  w.root.children.forEach(c => c.visible = true);
  if (w.scenery && w.scenery.items) w.scenery.items.forEach(i => { if (i && i.obj) i.obj.visible = true; });
  g.effects.glowLayer.points.visible = true;
  g.effects.streakLayer.points.visible = true;
  g.effects.smokeLayer.points.visible = true;
  g.player.group.visible = true;
  g.scene.children.forEach(c => {
    if (c.isMesh && c.isInstancedMesh) c.visible = true;
    if (c.isLight) c.visible = true;
    if (c.isSprite) c.visible = true;
  });
  return 1;
})()`;

const CASES = [
  ['baseline', '1'],
  ['no-stars', 'window.__strike.game.world.starLayers.forEach(l => l.points.visible = false); 1'],
  ['no-backdrop', 'window.__strike.game.world.root.children.filter(c => c.isMesh).forEach(c => c.visible = false); 1'],
  ['no-scenery', 'window.__strike.game.world.scenery.items.forEach(i => { if (i && i.obj) i.obj.visible = false; }); 1'],
  ['no-world', 'window.__strike.game.world.root.visible = false; 1'],
  ['no-effects', `window.__strike.game.effects.glowLayer.points.visible = false;
    window.__strike.game.effects.streakLayer.points.visible = false;
    window.__strike.game.effects.smokeLayer.points.visible = false; 1`],
  ['no-bullets', `window.__strike.game.scene.children.forEach(c => { if (c.isMesh && c.isInstancedMesh) c.visible = false; }); 1`],
  ['no-player', 'window.__strike.game.player.group.visible = false; 1'],
  ['no-sprites', 'window.__strike.game.scene.traverse(o => { if (o.isSprite) o.visible = false; }); 1'],
  ['no-lights', 'window.__strike.game.scene.children.forEach(c => { if (c.isLight) c.visible = false; }); 1'],
  ['all-off', `(() => { const g = window.__strike.game, w = g.world;
    w.root.visible = false; g.player.group.visible = false;
    g.effects.glowLayer.points.visible = false;
    g.effects.streakLayer.points.visible = false;
    g.effects.smokeLayer.points.visible = false;
    if (g.boss && g.boss.group) g.boss.group.visible = false;
    g.scene.children.forEach(c => { if ((c.isMesh && c.isInstancedMesh) || c.isSprite) c.visible = false; });
    return 1; })()`],
];

const shots = {};
for (const [name, js] of CASES) {
  await ev(RESTORE);
  await wait(150);
  await ev(js);
  await wait(800);
  shots[name] = await snap();
  fs.writeFileSync(path.join(OUT, `layers-${name}.png`), Buffer.from(shots[name], 'base64'));
}

/* 在页面内做像素统计（避免引入图像库依赖）
   注意：HUD 是 DOM 层，白字/横幅会产生大量近白像素，
        会淹没真正的 WebGL 信号，因此统计限定在中央带（避开 HUD 与横幅）。
   指标：
     bandBright — 中央带内亮度 > 170 的像素数
     bandMean   — 中央带平均亮度
     diffVsBase — 与基准帧的平均绝对差（冻结后即为该层的真实贡献） */
const names = Object.keys(shots);
const result = await ev(`(async () => {
  const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + src; });
  const toBuf = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const baseIm = await load(${JSON.stringify(shots.baseline)});
  const W = baseIm.width, H = baseIm.height;
  const x0 = (W * 0.05) | 0, x1 = (W * 0.95) | 0, y0 = (H * 0.30) | 0, y1 = (H * 0.74) | 0;
  const base = toBuf(baseIm);
  const list = ${JSON.stringify(names.map((n) => [n, shots[n]]))};
  const out = [];
  for (const pair of list) {
    const d = toBuf(await load(pair[1]));
    let sum = 0, bright = 0, n = 0, diffs = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum += lum; n++;
        if (lum > 170) bright++;
        diffs += Math.abs(base[i] - d[i]) + Math.abs(base[i + 1] - d[i + 1]) + Math.abs(base[i + 2] - d[i + 2]);
      }
    }
    out.push({ name: pair[0], bandMean: +(sum / n).toFixed(2), bandBright: bright, diffVsBase: +(diffs / n).toFixed(2) });
  }
  return { W, H, out };
})()`);

console.log(`=== 中央带逐层贡献度 (${result.W}x${result.H}) ===`);
console.log('  带内统计：x 5%–95%，y 30%–74%（避开 DOM 横幅与 HUD）');
console.log('  (bandBright = 亮度>170 像素数；diffVsBase = 移除该层后与基准帧的平均绝对差)');
for (const x of result.out.sort((a, b) => b.bandBright - a.bandBright)) {
  console.log(
    '  ',
    String(x.name).padEnd(14),
    'bandBright=', String(x.bandBright).padStart(7),
    ' diffVsBase=', String(x.diffVsBase).padStart(7),
    ' bandMean=', String(x.bandMean).padStart(6)
  );
}
console.log('\n截图已保存到:', OUT);
ws.close();

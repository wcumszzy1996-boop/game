/**
 * app-check.mjs — 验收「打包后的桌面 APP」
 *
 * 与 cdp-verify.mjs 的区别：cdp-verify 面向浏览器里的源码/单文件产物；
 * 本工具面向 electron-packager 打出来的 exe，验证的是
 * 「asar 打包后的资源是否能被正确加载、WebGL 是否可用、真跑一局是否崩」。
 *
 * 用法：
 *   node tools/app-check.mjs --exe dist-app/StarStrike-win32-x64/StarStrike.exe
 *
 * 注意：必须 unset ELECTRON_RUN_AS_NODE，否则 exe 会退化成 Node 解释器。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const EXE = path.resolve(getArg('--exe', 'dist-app/StarStrike-win32-x64/StarStrike.exe'));
const PORT = getArg('--port', '9333');
const OUT = getArg('--out', '.verify-app');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(EXE)) throw new Error(`找不到可执行文件: ${EXE}`);
fs.mkdirSync(OUT, { recursive: true });

/* ---------- 1. 启动应用（去掉 ELECTRON_RUN_AS_NODE） ---------- */
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*'], {
  env,
  stdio: 'ignore',
  detached: false,
});
let exited = null;
child.on('exit', (code) => (exited = code));

/* ---------- 2. 等待调试端口 ---------- */
let version = null;
for (let i = 0; i < 40; i++) {
  if (exited !== null) throw new Error(`应用提前退出（code=${exited}）`);
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) {
      version = await r.json();
      break;
    }
  } catch {
    /* 还没起来 */
  }
  await wait(500);
}
if (!version) throw new Error('调试端口未就绪，应用可能启动失败');
console.log('应用已启动:', version.Browser);
console.log('User-Agent:', String(version['User-Agent']).slice(0, 90));

/* ---------- 3. 连上页面 ---------- */
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`未找到页面目标: ${JSON.stringify(list.map((t) => t.type))}`);
console.log('页面:', page.title, '|', page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const errs = [];
const warns = [];
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')));
});
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (m.params.type === 'error' || m.params.type === 'assert') errs.push(`console.${m.params.type}: ${text}`);
    if (m.params.type === 'warning') warns.push(text);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pend.has(i)) {
        pend.delete(i);
        rej(new Error('超时: ' + method));
      }
    }, 30000);
  });
await send('Runtime.enable');
await send('Page.enable');

const ev = async (expression) => {
  const q = await send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true });
  if (q.exceptionDetails) throw new Error(q.exceptionDetails.exception?.description || q.exceptionDetails.text);
  return q.result.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const f = path.join(OUT, `${name}.png`);
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  return f;
};

/* ---------- 4. 逐项检查 ---------- */
console.log('\n--- 打包应用内运行检查 ---');
const ready = await ev('!!(window.__strike && window.__strike.ready)');
console.log('引擎就绪            :', ready);
console.log('WebGL2              :', await ev(`!!document.createElement('canvas').getContext('webgl2')`));
console.log(
  '渲染器              :',
  await ev(`(() => { const g = window.__strike.game; const gl = g.renderer.getContext();
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; })()`)
);
console.log(
  '初始状态            :',
  JSON.stringify(await ev(`(() => { const g = window.__strike.game;
    const r = g.canvas.getBoundingClientRect();
    return { state: g.state, level: g.levelIndex, box: [Math.round(r.width), Math.round(r.height)],
             ratio: +(r.width / r.height).toFixed(4),
             buffer: [g.postfx.width, g.postfx.height], asar: location.protocol }; })()`))
);
console.log('菜单截图            :', await shot('app-01-menu'));

await ev('window.__strike.startRun("normal", 0)');
await wait(4000);
await ev('window.__strike.grant("power",10); window.__strike.grant("spread",4); window.__strike.grant("missile",4); window.__strike.grant("drone",3); window.__strike.grant("laser",10); 1');
await wait(4000);
console.log(
  '战斗中              :',
  JSON.stringify(await ev(`(() => { const g = window.__strike.game;
    return { state: g.state, levelT: +g.levelT.toFixed(1), score: Math.round(g.score),
             dps: Math.round(g.player.dps), fps: Math.round(g.fps), hp: Math.round(g.player.hp),
             lives: g.player.lives, enemies: g.enemies.count, pbul: g.pbul.count,
             lasers: g.lasers.beams.length, laserActive: g.lasers.active,
             drawCalls: g.drawCalls }; })()`))
);
console.log('战斗截图            :', await shot('app-02-combat'));

await ev('window.__strike.skipToBoss()');
/* 2D 版：BOSS 用 transT（阶段切换无敌）与 !alive 表示不可打 */
for (let i = 0; i < 40; i++) {
  const st = await ev('(() => { const b = window.__strike.game.boss; return b.alive && b.transT <= 0; })()');
  if (st) break;
  await wait(250);
}
await wait(600);
console.log(
  'BOSS                :',
  JSON.stringify(await ev(`(() => { const g = window.__strike.game; const b = g.boss;
    return { key: b.def.key, maxHp: Math.round(b.maxHp), hp: Math.round(b.hp),
             atkMul: b.atkMul, phase: b.phase, busy: b.busy, last: b.lastPattern,
             hitboxes: b.def.hitboxes.length, hpFrac: +b.hpFrac.toFixed(2), fps: Math.round(g.fps) }; })()`))
);
console.log('BOSS 截图           :', await shot('app-03-boss'));

console.log(`\n告警 ${warns.length} 条，异常 ${errs.length} 条`);
for (const w of warns.slice(0, 6)) console.log('   warn:', w.slice(0, 160));
for (const e of errs.slice(0, 8)) console.log('   ERR :', String(e).slice(0, 220));
console.log(errs.length === 0 ? '\n✔ 打包应用内无运行时错误' : '\n✖ 存在运行时错误');

/* ---------- 5. 收尾 ---------- */
ws.close();
child.kill();
await wait(1200);
console.log('截图目录:', OUT);
process.exit(errs.length === 0 ? 0 : 1);

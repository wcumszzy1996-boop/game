/**
 * tools/debug-fire.mjs — 定位敌弹 / BOSS 攻击是否真的在生成
 */
import fs from 'node:fs';
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const URL_ = arg('url', 'http://127.0.0.1:8123/');
const PORT = arg('port', '9222');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined) { const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } }
});
const send = (method, params = {}, sid) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify(sid ? { id: i, method, params, sessionId: sid } : { id: i, method, params })); });

const t = await send('Target.createTarget', { url: 'about:blank' });
const a = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
const sid = a.result.sessionId;
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
await send('Page.navigate', { url: URL_ }, sid);
await sleep(3000);
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, userGesture: true }, sid);
  if (r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description?.split('\n')[0] };
  return r.result.result.value;
};

console.log('ready:', await ev('!!(window.__strike&&window.__strike.ready)'));
console.log('startRun:', await ev('window.__strike.startRun("normal",0)'));

// 只召一架敌机，观察它是否开火
console.log('\n--- 单机开火观察 ---');
await ev(`(function(){
  var g = window.__strike.game;
  g.enemies.clear(false);
  g.ebul.clearAll();
  var e = g.enemies.spawn('turret', { x: 0, y: 12, move: 'straight', speed: 0.6, fireOffset: 0.4 });
  window.__dbgE = e;
  return true;
})()`);
for (let i = 0; i < 8; i++) {
  await sleep(600);
  const s = await ev(`(function(){
    var g = window.__strike.game, e = window.__dbgE;
    return {
      t: +g.levelT.toFixed(1),
      ebul: g.ebul.count,
      bullets: g.ebul.bullets.length,
      eAlive: e.alive, ey: +e.y.toFixed(1), fireT: +e.fireT.toFixed(2), windup: +e.windup.toFixed(2), shots: e.shots,
      Efire: e.T.fire, fireMul: +e.fireMul.toFixed(2),
    };
  })()`);
  console.log(JSON.stringify(s));
}

console.log('\n--- BOSS 攻击调度 ---');
await ev('window.__strike.skipToBoss()');
for (let i = 0; i < 14; i++) {
  await sleep(700);
  const s = await ev(`(function(){
    var g = window.__strike.game, b = g.boss;
    return {
      t: +b.t.toFixed(1),
      entering: b.entering, transT: +b.transT.toFixed(2),
      attackT: +b.attackT.toFixed(2), windup: +b.windup.toFixed(2),
      busy: !!b.busy, state: b.state ? b.state.kind : null, queue: b.queue.length,
      last: b.lastPattern, phase: b.phase,
      ebul: g.ebul.count,
    };
  })()`);
  console.log(JSON.stringify(s));
}
ws.close();

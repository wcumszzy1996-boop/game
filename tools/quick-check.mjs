/**
 * tools/quick-check.mjs — 快速诊断：打开页面，输出 console / 异常 / 关键 DOM 状态
 * 用法：node tools/quick-check.mjs [--url ...] [--port 9222] [--wait 3000]
 */
import fs from 'node:fs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const URL_ = arg('url', 'http://127.0.0.1:8123/');
const PORT = arg('port', '9222');
const WAIT = +arg('wait', 4000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const errs = [];
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined) { const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`[${m.params.type}] ` + (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push((d.text || '') + ' :: ' + ((d.exception && d.exception.description) || ''));
  }
  if (m.method === 'Log.entryAdded') logs.push(`[log:${m.params.entry.level}] ` + m.params.entry.text);
});
const send = (method, params = {}, sid) => new Promise((res) => {
  const i = ++id;
  pending.set(i, res);
  ws.send(JSON.stringify(sid ? { id: i, method, params, sessionId: sid } : { id: i, method, params }));
});

const t = await send('Target.createTarget', { url: 'about:blank' });
const a = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
const sid = a.result.sessionId;

await send('Runtime.enable', {}, sid);
await send('Log.enable', {}, sid);
await send('Page.enable', {}, sid);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: URL_ }, sid);
await sleep(WAIT);

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true }, sid);
  if (r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result.result.value;
};

console.log('--- console ---');
for (const l of logs) console.log(l.slice(0, 500));
console.log('--- exceptions ---');
for (const e of errs) console.log(e.slice(0, 1200));
console.log('--- state ---');
console.log(JSON.stringify(await evaluate(`(function(){
  var c = document.getElementById('gl');
  return {
    errShown: (document.getElementById('err')||{}).style ? document.getElementById('err').style.display : '?',
    errHtml: (document.getElementById('err').innerHTML || '').slice(0,400),
    hasStrike: !!window.__strike,
    ready: window.__strike ? window.__strike.ready : null,
    canvasRect: c ? { w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height } : null,
    glSize: c ? { w: c.width, h: c.height } : null,
    stageW: document.getElementById('stage').style.width,
    hudFont: getComputedStyle(document.getElementById('hud')).fontSize,
    powers: document.getElementById('hud-powers').children.length,
    cards: document.getElementById('diff-cards').children.length,
  };
})()`), null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
fs.writeFileSync('.verify/quick.png', Buffer.from(shot.result.data, 'base64'));
console.log('screenshot -> .verify/quick.png');
ws.close();

/**
 * tools/probe-fixes.mjs — 本轮 5 项改动的实机验证
 *
 *   1) 孤儿敌机（"空间中不会变化的战机"）已消除
 *   2) 敌机生命值上调
 *   3) 敌机弹丸伤害按机型生效
 *   4) 陨石撞击消耗装甲值（第 2 关）
 *   5) 关卡时长 160 秒（2:40）
 */
import fs from 'node:fs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const URL_ = arg('url', 'http://127.0.0.1:8123/');
const PORT = arg('port', '9222');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (ok, text) => { console.log((ok ? '  ✓ ' : '  ✗ ') + text); if (!ok) fails.push(text); };

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined) { const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } return; }
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
await send('Page.enable', {}, sid);
// 必须禁用缓存：否则浏览器会拿 .browser-profile 里的磁盘缓存跑旧模块
await send('Network.enable', {}, sid);
await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: URL_ }, sid);

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true }, sid);
  if (r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result.result.value;
};

for (let i = 0; i < 60; i++) {
  if (await evaluate('!!(window.__strike && window.__strike.ready)')) break;
  await sleep(250);
}
console.log('engine ready\n');

/* ---------- 1. 孤儿敌机 ---------- */
console.log('▶ 1. 孤儿敌机（空间中不会变化的战机）');
await sleep(9000);                                    // 让菜单装饰敌机充分生成
const menuN = await evaluate('window.__strike.game.enemies.list.length');
await evaluate(`window.__strike.startRun('normal')`);
await sleep(1500);
const ghost = await evaluate(`(function(){
  var g = window.__strike.game;
  var inList = new Set();
  for (var i = 0; i < g.enemies.list.length; i++) {
    var e = g.enemies.list[i];
    if (e.mesh) inList.add(e.mesh.uuid);
    if (e.aura) inList.add(e.aura.uuid);
  }
  var orphan = 0;
  for (var i = 0; i < g.enemies.group.children.length; i++) {
    if (!inList.has(g.enemies.group.children[i].uuid)) orphan++;
  }
  return { menuDebris: ${menuN}, listLen: g.enemies.list.length, orphans: orphan,
           groupChildren: g.enemies.group.children.length, pool: g.enemies.pool.length };
})()`);
console.log('  ' + JSON.stringify(ghost));
check(ghost.orphans === 0, `切进游戏后孤儿网格为 0（实际 ${ghost.orphans}）`);
check(ghost.menuDebris > 0, `切关前菜单确实有装饰敌机（${ghost.menuDebris} 架）`);

/* ---------- 5. 关卡时长 ---------- */
console.log('\n▶ 5. 关卡时长');
const dur = await evaluate(`(function(){
  var g = window.__strike.game;
  var txt = g.snap ? g.snap.timerText : '0:00';
  var m = /^(\\d+):(\\d\\d)$/.exec(txt);
  var total = m ? (+m[1]) * 60 + (+m[2]) + g.levelT : -1;
  return { timerText: txt, levelT: +g.levelT.toFixed(1), inferredTotal: +total.toFixed(1) };
})()`);
console.log('  ' + JSON.stringify(dur));
check(dur.inferredTotal > 158 && dur.inferredTotal < 162,
  `由倒计时反推关卡总时长 ${dur.inferredTotal}s（期望 160，旧版为 180）`);

/* ---------- 2 / 3. 敌机生命值与攻击力 ---------- */
console.log('\n▶ 2/3. 敌机生命值与弹丸伤害');
// 主动生成全类型样本，直接读图鉴数值（不依赖波次随机到哪种）
const stats = await evaluate(`(function(){
  var g = window.__strike.game;
  var out = {};
  ['scout','fighter','gunship','bomber','turret','elite','drone'].forEach(function(k){
    var e = g.enemies.spawn(k, { x: 0, y: 40, move: 'straight' });
    out[k] = { maxHp: Math.round(e.maxHp), dmg: e.T.dmg };
    e.alive = false;                       // 下一帧自动回收
  });
  return out;
})()`);
console.log('  ' + JSON.stringify(stats));
const expectHp = { scout: 34, fighter: 74, gunship: 260, bomber: 440, turret: 195, elite: 345, drone: 26 };
const oldHp = { scout: 20, fighter: 44, gunship: 155, bomber: 265, turret: 115, elite: 205, drone: 16 };
for (const k of Object.keys(expectHp)) {
  const got = stats[k] && stats[k].maxHp;
  check(got === expectHp[k], `${k} 生命值 ${got}（旧 ${oldHp[k]} → 新 ${expectHp[k]}）`);
  if (k !== 'drone') check(stats[k].dmg > 10, `${k} 弹丸伤害 ${stats[k].dmg}（按机型区分且 > 旧值 10）`);
}

/* ---------- 4. 陨石撞击 ---------- */
console.log('\n▶ 4. 陨石撞击消耗装甲值');
await evaluate('window.__strike.nextLevel()');        // → 第 2 关「陨石带」
await sleep(1400);
const rockInfo = await evaluate(`(function(){
  var g = window.__strike.game;
  var r = g.world.rocks[0];
  return { level: g.levelIndex, state: g.state, visible: r.visible, count: g.world.rocks.length,
           hitR: +r.userData.hitR.toFixed(2), dmg: r.userData.dmg, size: +r.userData.s.toFixed(2) };
})()`);
console.log('  ' + JSON.stringify(rockInfo));
check(rockInfo.level === 1, '已进入第 2 关');
check(rockInfo.visible && rockInfo.count > 0, `陨石在场（${rockInfo.count} 颗）`);
check(rockInfo.dmg > 0 && rockInfo.hitR > 0, '陨石带碰撞半径与撞击伤害');

const impact = await evaluate(`(function(){
  var g = window.__strike.game;
  g.player.invuln = 0;
  g.player.shields = 0;
  var r = g.world.rocks[0];
  var y0 = r.position.y;
  g.player.pos.x = r.position.x;
  g.player.pos.y = r.position.y;
  var hp0 = g.player.hp;
  g._collideAsteroids(g.ctx);
  var hp1 = g.player.hp;
  return { hp0: Math.round(hp0), hp1: Math.round(hp1), lost: Math.round(hp0 - hp1),
           dmg: r.userData.dmg, rockRespawned: r.position.y > y0 + 5, newY: +r.position.y.toFixed(1) };
})()`);
console.log('  ' + JSON.stringify(impact));
check(impact.lost > 0, `撞击后装甲值下降 ${impact.lost}（=${impact.dmg} 应相符）`);
check(impact.lost === impact.dmg, `实际扣血量与配置一致（${impact.lost} vs ${impact.dmg}）`);
check(impact.rockRespawned, '撞击后陨石碎裂并回到上方重生');

/* ---------- 截图 ---------- */
await evaluate(`(function(){
  var g = window.__strike.game;
  g.player.invuln = 4;   // 截图期间免伤，避免连续撞击
  return 1;
})()`);
await sleep(1500);
const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
fs.writeFileSync('.verify/asteroid.png', Buffer.from(shot.result.data, 'base64'));
console.log('\nscreenshot -> .verify/asteroid.png');

console.log('\n' + (fails.length ? `失败 ${fails.length} 项:\n  - ` + fails.join('\n  - ') : '全部通过 ✓'));
ws.close();
process.exit(fails.length ? 1 : 0);

/**
 * tools/probe-fixes2.mjs — 第二批 5 项改动的实机验证（约 40s）
 *
 *   1) 射击音效改为柔和：合成链路无高频锐击，末尾挂总低通
 *   2) 第二关陨石可击破：子弹通道扣血 → 打空即碎裂 + 积分 + 重生
 *   3) 掉落强化道具封顶 Lv.5（护盾/核弹/生命不受限）
 *   4) 第一关敌机射速 −20%（关卡级倍率 1.25），第 2/3 关为 1.0
 *   5) 第二、三关 BOSS 生命 +50%、攻击 +20%（第 1 关保持基准）
 *
 * 用法（先起好静态服务器与调试浏览器，见 README 第七节）：
 *   node tools/probe-fixes2.mjs --url http://127.0.0.1:8123/ --port 9222
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

await evaluate(`window.__strike.startRun('normal', 0)`);
await sleep(1200);

/* ================================================================== *
 * 1. 射击音效柔和化
 * ================================================================== */
console.log('▶ 1. 射击音效（柔和版）');
/*
 * 音色没法在无头环境"听"，但可以**拦截 createBiquadFilter**，
 * 把一次开火真正创建的滤波器全部记录下来 —— 这就等于看到了音色配方：
 *   · 旧版有一个 3.4kHz 的高通瞬态（"咔"的锐度来源）
 *   · 新版不应存在高通，且链路末端有一个 ≈3.6kHz 的总低通把毛刺磨掉
 */
const audio = await evaluate(`(function(){
  var a = window.__strike.audio;
  a.init();
  var c = a.ctx;
  var orig = c.createBiquadFilter.bind(c);
  var log = [];
  c.createBiquadFilter = function(){ var f = orig(); log.push(f); return f; };
  var err = null;
  try {
    // 只测自机开火（不含激光噪声，那是有意保留的低量高通）
    a._lastSfx.clear(); a.shoot(5);
    a._lastSfx.clear(); a.shoot(1);
  } catch (e) { err = String((e && e.message) || e); }
  var shootLog = log.slice();
  log.length = 0;
  try {
    a._lastSfx.clear(); a.enemyShoot(1);
    a.laserStart(); a.laserSet(0.8); a.laserStop();
  } catch (e) { err = err || String((e && e.message) || e); }
  c.createBiquadFilter = orig;
  var types = {}, lpf = [];
  for (var i = 0; i < shootLog.length; i++) {
    types[shootLog[i].type] = (types[shootLog[i].type] || 0) + 1;
    if (shootLog[i].type === 'lowpass') lpf.push(Math.round(shootLog[i].frequency.value));
  }
  return { err: err, ready: a.ready, ctxState: c.state, filterCount: shootLog.length,
           types: types, lowpass: lpf, maxLowpass: lpf.length ? Math.max.apply(null, lpf) : 0 };
})()`);
console.log('  ' + JSON.stringify(audio));
check(!audio.err, '合成链路无异常（含敌机开火与激光起停）');
check(audio.ready, '音频系统就绪');
check(audio.filterCount >= 8, `单轮开火创建了 ${audio.filterCount} 个滤波器（多层叠加）`);
check(!audio.types.highpass, `开火链路已无任何高通滤波（旧版为 3.4kHz 高通瞬态 = "咔"的锐度来源）`);
check(audio.maxLowpass > 2000 && audio.maxLowpass <= 4200,
  `链路末端总低通 ${audio.maxLowpass}Hz（磨掉毛刺的关键，旧版最高仅 2.8kHz 且无总低通）`);

/* ================================================================== *
 * 3. 强化封顶
 * ================================================================== */
console.log('\n▶ 3. 掉落强化道具封顶 Lv.5');
const cap = await evaluate(`(function(){
  var g = window.__strike.game;
  var out = {};
  // 5 项武器强化：连给 12 个，应停在 5
  ['power','spread','missile','drone','laser'].forEach(function(k){
    window.__strike.setLevel(k, 0);
    for (var i = 0; i < 12; i++) g.player.applyPowerup(k);
    out[k] = g.player.levels[k];
  });
  // 消耗品：护盾 / 核弹 不应被封顶
  window.__strike.setLevel('shield', 0);
  window.__strike.setLevel('bomb', 0);
  for (var i = 0; i < 9; i++) { g.player.applyPowerup('shield'); g.player.applyPowerup('bomb'); }
  out.shield = g.player.levels.shield;
  out.bomb = g.player.levels.bomb;
  // 满级后再吃同类道具：等级不变，但折算积分
  window.__strike.setLevel('power', 5);
  var s0 = g.score;
  var res = g.player.applyPowerup('power');
  out.maxedFlag = !!(res && res.maxed);
  out.afterMaxed = g.player.levels.power;
  out.scoreDelta = g.score - s0;   // 直接调 applyPowerup 不加分，仅确认等级不动
  return out;
})()`);
console.log('  ' + JSON.stringify(cap));
for (const k of ['power', 'spread', 'missile', 'drone', 'laser']) {
  check(cap[k] === 5, `${k} 连给 12 个后停在 Lv.${cap[k]}（期望 5）`);
}
check(cap.maxedFlag === true, '满级后再拾取会返回 maxed 标记（上层据此提示"已满级"）');
check(cap.afterMaxed === 5, `满级后再拾取不再递增（仍为 ${cap.afterMaxed}）`);
check(cap.shield === 9, `护盾不受封顶约束（累计 ${cap.shield} 层）`);
check(cap.bomb === 9, `核弹不受封顶约束（累计 ${cap.bomb} 枚）`);

/* ================================================================== *
 * 4a. 第一关射速
 * ================================================================== */
console.log('\n▶ 4a. 第一关敌机射速 −20%');
const fire1 = await evaluate(`(function(){
  var g = window.__strike.game;
  var e = g.enemies.spawn('scout', { x: 0, y: 40, move: 'straight' });
  var r = { level: g.levelIndex, levelFireMul: g.enemies.fireLevelMul, diffFireMul: g.diff.enemyFireMul,
            base: e.T.fire, fireMul: +e.fireMul.toFixed(3),
            effective: +(e.T.fire * e.fireMul).toFixed(2) };
  e.alive = false;
  return r;
})()`);
console.log('  ' + JSON.stringify(fire1));
check(fire1.level === 0, '当前在第 1 关');
check(Math.abs(fire1.levelFireMul - 1.25) < 1e-6,
  `第 1 关关卡射速倍率 ${fire1.levelFireMul}（= 射速削弱 20%）`);
check(Math.abs(fire1.fireMul - 1.24 * 1.15 * 1.25) < 0.01,
  `侦察机综合开火倍率 ${fire1.fireMul}（难度 1.24 × 保险 1.15 × 关卡 1.25）`);
check(fire1.effective > 3.5, `侦察机有效开火间隔 ${fire1.effective}s（旧版 2.92s）`);

/* ================================================================== *
 * 4b / 2. 第二关：关卡射速恢复 + 陨石可击破
 * ================================================================== */
console.log('\n▶ 4b/2. 第二关：射速恢复基准 + 陨石可击破');
await evaluate('window.__strike.nextLevel()');
await sleep(1600);
const l2 = await evaluate(`(function(){
  var g = window.__strike.game;
  var e = g.enemies.spawn('scout', { x: 0, y: 40, move: 'straight' });
  var r = { level: g.levelIndex, levelFireMul: g.enemies.fireLevelMul, rocksOn: g.world.rocksOn,
            rockCount: g.world.rocks.length };
  e.alive = false;
  return r;
})()`);
console.log('  ' + JSON.stringify(l2));
check(l2.level === 1, '已进入第 2 关');
check(Math.abs(l2.levelFireMul - 1.0) < 1e-6, `第 2 关关卡射速倍率恢复基准 ${l2.levelFireMul}`);
check(l2.rocksOn, `第 2 关陨石带启用（${l2.rockCount} 颗）`);

/* --- 陨石：子弹通道扣血 ---
 * 注意：必须先把它设回满血。第 2 关实战中陨石一直在挨打，
 * 直接抽一颗"还活着"的石头很可能残血，一发就打碎了（hp 会被重置成上限），
 * 于是"扣血"读数会变成负数 —— 第一版就是这么误报的。 */
const rockHit = await evaluate(`(function(){
  var g = window.__strike.game;
  g.pbul.clearAll();
  var r = null;
  for (var i = 0; i < g.world.rocks.length; i++) {
    if (g.world.rocks[i].userData.respawnT <= 0) { r = g.world.rocks[i]; break; }
  }
  var u = r.userData;
  u.hp = u.maxHp;                 // 复位到满血，隔离出"一发子弹的真实扣血"
  u.flash = 0;
  // 打一发 30 伤害的子弹到石头正中，然后跑一帧陨石判定
  g.pbul.fire({ x: r.position.x, y: r.position.y, vx: 0, vy: 0, r: 0.3, dmg: 30, life: 0.5,
                w: 0.3, h: 0.3, gw: 0.6, gh: 0.6, cr: 1, cg: 1, cb: 1, gr: 1, gg: 1, gb: 1 });
  var before = u.hp;
  g._hitAsteroids(0.016, g.ctx);
  return { shootR: +u.shootR.toFixed(2), hitR: +u.hitR.toFixed(2), maxHp: Math.round(u.maxHp),
           before: Math.round(before), after: Math.round(u.hp), lost: Math.round(before - u.hp),
           flash: +u.flash.toFixed(2), pbulLeft: g.pbul.count };
})()`);
console.log('  ' + JSON.stringify(rockHit));
check(rockHit.lost === 30, `子弹命中陨石扣血 ${rockHit.lost}（= 弹丸伤害 30）`);
check(rockHit.shootR > rockHit.hitR,
  `被射击判定 ${rockHit.shootR} > 撞击判定 ${rockHit.hitR}（想打碎它比躲开它更容易命中）`);
check(rockHit.flash > 0, '命中时陨石整体闪白（让"在掉血"看得见）');
check(rockHit.pbulLeft === 0, '子弹命中后即被消耗');

/* --- 陨石：打空 → 碎裂 + 积分 + 重生延迟 --- */
const rockBreak = await evaluate(`(function(){
  var g = window.__strike.game;
  g.pbul.clearAll();
  var r = null;
  for (var i = 0; i < g.world.rocks.length; i++) {
    if (g.world.rocks[i].userData.respawnT <= 0) { r = g.world.rocks[i]; break; }
  }
  var u = r.userData;
  var s0 = g.score;
  g.pbul.fire({ x: r.position.x, y: r.position.y, vx: 0, vy: 0, r: 0.3, dmg: u.hp + 5, life: 0.5,
                w: 0.3, h: 0.3, gw: 0.6, gh: 0.6, cr: 1, cg: 1, cb: 1, gr: 1, gg: 1, gb: 1 });
  g._hitAsteroids(0.016, g.ctx);
  var broke = { respawnT: +u.respawnT.toFixed(2), visible: r.visible, hpReset: Math.round(u.hp),
                maxHp: u.maxHp, scoreDelta: g.score - s0, particles: g.effects.count };
  // 推进世界 2 秒，应完成重生
  g.world.update(2.0);
  broke.visibleAfter = r.visible;
  broke.hpAfter = Math.round(u.hp);
  broke.yAfter = +r.position.y.toFixed(1);
  return broke;
})()`);
console.log('  ' + JSON.stringify(rockBreak));
check(rockBreak.respawnT > 0, `打空后进入重生倒计时 ${rockBreak.respawnT}s`);
check(rockBreak.visible === false, '碎裂期间不可见（同时也不参与碰撞）');
check(rockBreak.scoreDelta > 0, `击破得分 +${rockBreak.scoreDelta}`);
check(rockBreak.particles > 0, `击破有爆炸/碎屑粒子（${rockBreak.particles} 个）`);
check(rockBreak.visibleAfter === true && rockBreak.hpAfter === rockBreak.maxHp,
  `重生后恢复满血（${rockBreak.hpAfter}/${rockBreak.maxHp}）并回到屏幕上方 y=${rockBreak.yAfter}`);

/* ================================================================== *
 * 5. BOSS 血量 / 攻击力
 * ================================================================== */
const readBoss = async () => evaluate(`(function(){
  var b = window.__strike.game.boss;
  return { key: b.def.key, max: Math.round(b.maxHp), atkMul: b.atkMul };
})()`);

console.log('\n▶ 5. BOSS 血量 / 攻击力');
/*
 * 逐关显式导航：用 startRun(diff, level) 直接落在目标关，再 skipToBoss。
 * 不能靠 nextLevel() —— killBoss 之后游戏自己会推进关卡，
 * 再叠一次 nextLevel() 就会跳过一整关（第一版就是这么把 NOVA 测成了 CASTOR）。
 */
const bossCases = [
  { idx: 0, key: 'vesper', hp: 40000, atk: 1.0, label: '第 1 关 VESPER（保持基准）' },
  { idx: 1, key: 'castor', hp: Math.round(56000 * 1.5), atk: 1.2, label: '第 2 关 CASTOR（+50% / +20%）' },
  { idx: 2, key: 'nova', hp: Math.round(76000 * 1.5), atk: 1.2, label: '第 3 关 NOVA（+50% / +20%）' },
];
let boss3Info = null;
for (const c of bossCases) {
  await evaluate(`window.__strike.startRun('normal', ${c.idx})`);
  await sleep(900);
  await evaluate('window.__strike.skipToBoss()');
  await sleep(2400);
  const b = await readBoss();
  if (c.idx === 2) boss3Info = b;
  console.log(`  ${c.label} → ` + JSON.stringify(b));
  check(b.key === c.key, `${c.label}：BOSS 确认为 ${c.key}（实际 ${b.key}）`);
  check(b.max === c.hp, `${c.label}：生命 ${b.max}（期望 ${c.hp}）`);
  check(Math.abs(b.atkMul - c.atk) < 1e-6, `${c.label}：攻击倍率 ${b.atkMul}（期望 ${c.atk}）`);
}

/* --- BOSS 弹幕与光束确实吃到 atkMul ---
 * 注意：Boss._shot() 走的是 this.ctx（由攻击调度器注入），
 * 直接调用前必须自己补上，否则会抛 "Cannot read properties of undefined"。 */
const atk = await evaluate(`(function(){
  var g = window.__strike.game;
  var b = g.boss;
  b.ctx = g.ctx;
  g.ebul.clearAll();
  b._shot(b.x, b.y, Math.PI * 0.5, 5, 'teal');
  var out = { bulletDmg: g.ebul.bullets.length ? g.ebul.bullets[0].dmg : null, atkMul: b.atkMul };
  b._beamSweep(g.ctx, { count: 1, dur: 1.0, from: -0.5, to: 0.5, width: 1.0, dps: 20, color: 'teal' });
  out.beamDps = b.beams[0].dps;
  out.beamDpsRaw = 20;
  out.diff = g.diff.id;
  g.ebul.clearAll();
  b.state = null; b.queue.length = 0; b.attackT = 99;
  return out;
})()`);
console.log('  ' + JSON.stringify(atk));
check(Math.abs(atk.bulletDmg - 10 * 1.2) < 1e-6,
  `BOSS 单发弹幕伤害 ${atk.bulletDmg}（基准 10 × 1.2）`);
check(Math.abs(atk.beamDps - 20 * 1.2) < 1e-6,
  `BOSS 扫射光束 dps ${atk.beamDps}（配置 20 × 1.2）—— 攻击力倍率同时覆盖弹幕与光束`);
void boss3Info;

/* ---------- 截图 ---------- */
await sleep(1200);
const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
fs.writeFileSync('.verify/probe2-boss3.png', Buffer.from(shot.result.data, 'base64'));
console.log('\nscreenshot -> .verify/probe2-boss3.png');

console.log('\n' + (fails.length ? `失败 ${fails.length} 项:\n  - ` + fails.join('\n  - ') : '全部通过 ✓'));
ws.close();
process.exit(fails.length ? 1 : 0);

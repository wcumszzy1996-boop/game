/**
 * tools/cdp-verify.mjs — 零依赖 Chrome DevTools Protocol 实机验收（2D 竖版）
 *
 * 依赖：Node 22 内置全局 WebSocket / fetch（不需要 puppeteer）
 * 用法：node tools/cdp-verify.mjs --url http://127.0.0.1:8123/ --port 9222 --out .verify
 *
 * 剧本：
 *   菜单 → 出击 → 实战射击（含枪口光效/弹幕）
 *   → 拾取激光 / 护盾 / 生命 → 激光武器特写
 *   → 跳 BOSS → 三个阶段 → 击破 → 进第 2 关 → 第 3 关 BOSS → 结算
 * 每步截图 + 收集 console / 未捕获异常 / 网络失败，输出 JSON 报告。
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const URL_ = arg('url', 'http://127.0.0.1:8123/');
const PORT = arg('port', '9222');
const OUT = path.resolve(arg('out', '.verify'));
const FAST = argv.includes('--fast');

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================== *
 * 极简 CDP 客户端
 * ================================================================== */
class CDP {
  constructor() {
    this.ws = null; this.msgId = 0; this.pending = new Map(); this.handlers = new Map(); this.sessionId = null;
  }
  static async connect(port) {
    const c = new CDP();
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    const info = await res.json();
    await c._open(info.webSocketDebuggerUrl);
    c.browser = info.Browser;
    return c;
  }
  _open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const to = setTimeout(() => reject(new Error('WS 连接超时')), 15000);
      ws.addEventListener('open', () => { clearTimeout(to); resolve(); });
      ws.addEventListener('error', () => { clearTimeout(to); reject(new Error('WS 连接失败')); });
      ws.addEventListener('message', (ev) => this._onMessage(ev));
    });
  }
  _onMessage(ev) {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) for (const fn of this.handlers.get(msg.method) || []) {
      try { fn(msg.params || {}, msg.sessionId); } catch (e) { console.error('[handler]', e); }
    }
  }
  on(m, fn) { if (!this.handlers.has(m)) this.handlers.set(m, []); this.handlers.get(m).push(fn); return this; }
  send(method, params = {}, sessionId, timeoutMs = 30000) {
    const id = ++this.msgId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); } }, timeoutMs);
    });
  }
  async newPage() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    return sessionId;
  }
  async evaluate(expression, { awaitPromise = false } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise, userGesture: true,
      allowUnsafeEvalBlockedByCSP: true,
    }, this.sessionId);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text || 'eval 异常');
    }
    return r.result.value;
  }
  async screenshot(name) {
    let clip;
    try {
      const m = await this.send('Page.getLayoutMetrics', {}, this.sessionId);
      const vp = m.cssLayoutViewport || m.layoutViewport;
      clip = { x: 0, y: 0, width: Math.ceil(vp.clientWidth), height: Math.ceil(vp.clientHeight), scale: 1 };
    } catch { clip = undefined; }
    const r = await this.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false }, this.sessionId);
    const buf = Buffer.from(r.data, 'base64');
    const file = path.join(OUT, name.endsWith('.png') ? name : name + '.png');
    fs.writeFileSync(file, buf);
    return { file: path.basename(file), bytes: buf.length };
  }
  async screenshotRegion(name, x, y, w, h, scale = 1) {
    const clip = {
      x: Math.max(0, Math.round(x - w / 2)), y: Math.max(0, Math.round(y - h / 2)),
      width: Math.round(w), height: Math.round(h), scale,
    };
    const r = await this.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false }, this.sessionId);
    const buf = Buffer.from(r.data, 'base64');
    const file = path.join(OUT, name.endsWith('.png') ? name : name + '.png');
    fs.writeFileSync(file, buf);
    return { file: path.basename(file), bytes: buf.length };
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

/* ================================================================== */
const report = {
  url: URL_, browser: null, webgl2: null, glRenderer: null,
  console: [], errors: [], failedRequests: [], steps: [], shots: [], ok: false, fatal: null,
};
const shots = [];
function note(label, value) {
  report.steps.push({ label, value });
  const v = typeof value === 'object' ? JSON.stringify(value) : value;
  console.log(`  · ${label}: ${v}`);
}

/** 世界坐标(18×32) → 视口像素 */
const PROJ = `(function(x,y){var c=document.getElementById('gl');var r=c.getBoundingClientRect();
  return {x: r.left + (x/18+0.5)*r.width, y: r.top + (0.5-y/32)*r.height};})`;

async function shot(cdp, name, lvl = 1) {
  const s = await cdp.screenshot(name);
  shots.push(s);
  if (lvl) console.log(`    📷 ${s.file} (${(s.bytes / 1024).toFixed(0)} KB)`);
  return s;
}

async function waitUntil(cdp, expr, label, timeout = 12000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await cdp.evaluate(`!!(${expr})`); } catch { v = false; }
    if (v) return true;
    if (Date.now() - t0 > timeout) throw new Error(`等待超时: ${label} (${expr})`);
    await sleep(150);
  }
}

async function main() {
  const cdp = await CDP.connect(PORT);
  report.browser = cdp.browser;
  await cdp.newPage();

  cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    report.console.push({ type: p.type, text: String(text).slice(0, 600) });
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    report.errors.push({ kind: 'uncaught', text: d.text || '', desc: (d.exception?.description || '').slice(0, 1200) });
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry || {};
    if (e.level === 'error') report.errors.push({ kind: 'log:error', text: String(e.text || '').slice(0, 600), url: e.url || '' });
    else if (e.level === 'warning') report.console.push({ type: 'warning', text: String(e.text || '').slice(0, 600) });
  });
  cdp.on('Network.loadingFailed', (p) => report.failedRequests.push({ errorText: p.errorText, type: p.type }));
  cdp.on('Network.responseReceived', (p) => {
    const r = p.response || {};
    if (r.status >= 400) report.failedRequests.push({ errorText: 'HTTP ' + r.status, url: r.url });
  });

  await cdp.send('Runtime.enable', {}, cdp.sessionId);
  await cdp.send('Log.enable', {}, cdp.sessionId);
  await cdp.send('Network.enable', {}, cdp.sessionId);
  await cdp.send('Page.enable', {}, cdp.sessionId);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, cdp.sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
  }, cdp.sessionId);

  console.log(`\n▶ 打开 ${URL_}`);
  await cdp.send('Page.navigate', { url: URL_ }, cdp.sessionId);
  await waitUntil(cdp, 'window.__strike && window.__strike.ready', '引擎就绪');

  /* WebGL 环境 */
  const gl = await cdp.evaluate(`(function(){
    var c = document.createElement('canvas');
    var g = c.getContext('webgl2');
    if (!g) return { webgl2: false };
    var dbg = g.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: true, renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER) };
  })()`);
  report.webgl2 = gl.webgl2;
  report.glRenderer = gl.renderer;
  note('WebGL2', gl.webgl2);
  note('GPU', gl.renderer);

  const stage = await cdp.evaluate(`(function(){
    var r = document.getElementById('gl').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), ratio: +(r.width/r.height).toFixed(4) };
  })()`);
  note('竖版画框 (CSS px)', stage);
  if (stage.ratio < 0.55 || stage.ratio > 0.575) report.errors.push({ kind: 'layout', text: '画框宽高比不是 9:16: ' + stage.ratio });

  const vp = await cdp.evaluate(`(function(){
    var g = window.__strike.game;
    return { pw: g.postfx.width, ph: g.postfx.height, programs: g.renderer.info.programs.length };
  })()`);
  note('渲染缓冲', vp);

  /* ---------- 菜单 ---------- */
  await sleep(900);
  await shot(cdp, '00-menu');
  note('菜单状态', await cdp.evaluate('window.__strike.state'));

  /* ---------- 出击 ---------- */
  console.log('\n▶ 出击（普通难度 · 第 1 关）');
  await cdp.evaluate('window.__strike.startRun("normal", 0)');
  await sleep(1200);
  await shot(cdp, '01-intro');
  note('开场', await cdp.evaluate('window.__strike.info()'));

  await sleep(6000);
  await shot(cdp, '02-level1-combat');
  const c1 = await cdp.evaluate('window.__strike.info()');
  note('实战 6s', c1);
  if (c1.state !== 'playing') report.errors.push({ kind: 'flow', text: '出击后状态不是 playing: ' + c1.state });
  if (c1.levelT < 4) report.errors.push({ kind: 'flow', text: '关卡时间未推进: ' + c1.levelT });

  /* ---------- 强化：满配（5 项武器强化封顶 Lv.5） ---------- */
  console.log('\n▶ 强化叠加（火力/散射/导弹/僚机/激光 各封顶 Lv.5）+ 激光武器');
  const g0 = await cdp.evaluate('window.__strike.grantAll(8)');
  note('满配状态（各强化已封顶 Lv.5）', g0);
  const CAP = 5;
  for (const k of ['power', 'spread', 'missile', 'drone', 'laser']) {
    if (g0[k] !== CAP) report.errors.push({ kind: 'feature', text: `强化 ${k} 未封顶 Lv.${CAP}，实际 ${g0[k]}` });
  }
  await sleep(1800);
  await shot(cdp, '03-maxpower');
  const c2 = await cdp.evaluate('window.__strike.info()');
  note('满配实战', c2);
  if (!c2.laserActive) report.errors.push({ kind: 'feature', text: '激光武器未激活（laserActive=false）' });
  if (c2.lasers < 2) report.errors.push({ kind: 'feature', text: '激光叠加未生效，光束数=' + c2.lasers });

  /* 上限不可被突破：把火力降回 4 级，再连给 10 个火力道具，应停在 5 */
  {
    const capT = await cdp.evaluate('(function(){ window.__strike.setLevel("power", 4); return window.__strike.grant("power", 10); })()');
    note('封顶验证（火力 4 级 + 10 个火力道具）', { power: capT.power });
    if (capT.power !== CAP) report.errors.push({ kind: 'feature', text: '强化上限被突破，power=' + capT.power });
  }

  /* ---------- 射击音效（柔和版）结构自检 ----------
   * 音色本身没法在无头环境"听"，但可以真的把整条合成链路跑一遍：
   * 清掉节流记录后连续开火 30 次（覆盖各火力等级）+ 敌机开火 + 激光开关，
   * 任何一处节点写错都会在这里抛异常。 */
  console.log('\n▶ 射击音效结构自检（柔和版合成链路）');
  const audio = await cdp.evaluate(`(function(){
    var a = window.__strike.audio;
    a.init();
    var err = null;
    try {
      for (var i = 0; i < 30; i++) { a._lastSfx.clear(); a.shoot(1 + (i % 6)); }
      a._lastSfx.clear(); a.enemyShoot(1);
      a.laserStart(); a.laserSet(0.8); a.laserStop();
    } catch (e) { err = String((e && e.message) || e); }
    return { ready: a.ready, ctxState: a.ctx ? a.ctx.state : null, err: err };
  })()`);
  note('射击音效', audio);
  if (audio.err) report.errors.push({ kind: 'feature', text: '射击音效构建异常：' + audio.err });
  if (!audio.ready) report.errors.push({ kind: 'feature', text: '音频系统未就绪（ready=false）' });

  /* 自机特写（看枪口光效与激光束） */
  {
    const p = await cdp.evaluate('({x: window.__strike.game.player.pos.x, y: window.__strike.game.player.pos.y})');
    const c = await cdp.evaluate(`${PROJ}(${p.x},${p.y + 2.4})`);
    const s = await cdp.screenshotRegion('04-laser-closeup', c.x, c.y, 380, 460, 2);
    shots.push(s);
    console.log(`    📷 ${s.file} (${(s.bytes / 1024).toFixed(0)} KB，2× 特写)`);
  }

  /* ---------- 掉落：护盾 / 生命 / 激光 ---------- */
  console.log('\n▶ 掉落验证：护盾 / 生命 / 激光');
  /*
   * 激光在上一步已被顶到封顶 Lv.5，必须先降回 3 级 ——
   * 否则「再吃一个激光应该升级」这条断言永远不可能成立（满级不再递增）。
   * 关键：这一步必须在读取 before 基线**之前**做，否则基线仍停在 5，
   * 拾取后只到 4，断言 4 > 5 会一直等到超时（第一版就是这么误报的）。
   */
  await cdp.evaluate('window.__strike.setLevel("laser", 3)');
  await sleep(150);
  const before = await cdp.evaluate('window.__strike.info()');
  note('掉落前基线', { lives: before.lives, shieldLv: before.levels.shield, laserLv: before.levels.laser });
  /*
   * 注意：掉落物不是「瞬间拾取」，它要从上方落下、进入磁吸半径后才被吸走。
   * 因此投放点取在自机正上方 5~7 个世界单位处（约 1.2~1.8s 落到磁吸圈），
   * 再用轮询等待状态变化，而不是固定 sleep —— 固定 sleep 是最初误判
   * 「生命/激光掉落未生效」的原因。
   */
  const pp = await cdp.evaluate('({ x: window.__strike.game.player.pos.x, y: window.__strike.game.player.pos.y })');
  const dy = 6.0;
  await cdp.evaluate(`window.__strike.drop("shield", ${(pp.x - 2.0).toFixed(2)}, ${(pp.y + dy).toFixed(2)})`);
  await cdp.evaluate(`window.__strike.drop("life",   ${pp.x.toFixed(2)}, ${(pp.y + dy + 1.4).toFixed(2)})`);
  await cdp.evaluate(`window.__strike.drop("laser",  ${(pp.x + 2.0).toFixed(2)}, ${(pp.y + dy).toFixed(2)})`);
  await sleep(240);
  const dropped = await cdp.evaluate('window.__strike.game.pickups.count');
  note('场上掉落物数量', dropped);
  if (dropped < 3) report.errors.push({ kind: 'feature', text: '掉落物未生成，count=' + dropped });
  await shot(cdp, '05-pickups');

  /*
   * 断言用「强化等级 levels.*」（单调递增）而不是「当前护盾数 shields」：
   * shields 会被敌弹消耗掉，用它会因为中途挨打而误判。
   */
  try {
    await waitUntil(cdp,
      `(function(){var i=window.__strike.info();
        return i.lives > ${before.lives}
            && i.levels.laser > ${before.levels.laser}
            && i.levels.shield > ${before.levels.shield};})()`,
      '三件掉落物被拾取', 9000);
  } catch (e) {
    report.errors.push({ kind: 'feature', text: e.message });
  }
  const after = await cdp.evaluate('window.__strike.info()');
  note('拾取后', {
    lives: after.lives, shieldLv: after.levels.shield, shields: after.shields,
    laserLv: after.levels.laser, lasers: after.lasers,
  });
  if (after.lives <= before.lives) report.errors.push({ kind: 'feature', text: '生命掉落未生效' });
  if (after.levels.laser <= before.levels.laser) report.errors.push({ kind: 'feature', text: '激光掉落未生效' });
  if (after.levels.shield <= before.levels.shield) report.errors.push({ kind: 'feature', text: '护盾掉落未生效' });
  await shot(cdp, '05b-picked');

  /* ---------- 敌机开火节奏 ---------- */
  console.log('\n▶ 敌机开火节奏（应为放缓后的间隔）');
  const rate = await cdp.evaluate(`(function(){
    var g = window.__strike.game;
    var T = g.__proto__ ? null : null;
    void T;
    return null;
  })()`);
  void rate;
  const fireInfo = await cdp.evaluate(`(function(){
    var g = window.__strike.game;
    var d = g.diff;
    var out = {};
    var E = g.enemies.list;
    if (E.length) {
      var e = E[0];
      out.sample = { type: e.type, base: e.T.fire, fireMul: +e.fireMul.toFixed(3), effectiveInterval: +(e.T.fire * e.fireMul).toFixed(2) };
    }
    out.level = g.levelIndex;
    out.levelFireMul = g.enemies.fireLevelMul;
    out.diffFireMul = d.enemyFireMul;
    out.bulletSpeedMul = d.enemyBulletSpeedMul;
    return out;
  })()`);
  note('开火参数', fireInfo);
  /* 第 1 关：关卡级倍率 1.25（= 射速削弱 20%） */
  if (fireInfo.level === 0 && Math.abs(fireInfo.levelFireMul - 1.25) > 1e-6) {
    report.errors.push({ kind: 'feature', text: '第 1 关敌机射速未削弱 20%，levelFireMul=' + fireInfo.levelFireMul });
  }

  /* ---------- BOSS ---------- */
  console.log('\n▶ 跳至 BOSS');
  await cdp.evaluate('window.__strike.skipToBoss()');
  await sleep(2600);
  await shot(cdp, '06-boss-enter');
  let b = await cdp.evaluate('window.__strike.info()');
  note('BOSS 入场', b.boss);
  if (!b.boss) report.errors.push({ kind: 'flow', text: 'BOSS 未生成' });
  /* 第 1 关 BOSS 是基准：40000 × hpMul 1.0 × 普通难度 1.0 */
  if (b.boss && b.boss.max !== 40000) {
    report.errors.push({ kind: 'feature', text: `第 1 关 BOSS 生命应保持基准 40000，实际 ${b.boss.max}` });
  }

  /* 阶段推进 */
  await cdp.evaluate('window.__strike.hurtBoss(window.__strike.game.boss.hp - window.__strike.game.boss.maxHp*0.60)');
  await sleep(2600);
  await shot(cdp, '07-boss-phase2');
  b = await cdp.evaluate('window.__strike.info()');
  note('阶段 2', b.boss);
  if (!b.boss || b.boss.phase < 1) report.errors.push({ kind: 'flow', text: 'BOSS 未进入阶段 2' });

  await cdp.evaluate('window.__strike.hurtBoss(window.__strike.game.boss.hp - window.__strike.game.boss.maxHp*0.26)');
  await sleep(3400);
  await shot(cdp, '08-boss-phase3');
  b = await cdp.evaluate('window.__strike.info()');
  note('阶段 3', b.boss);
  if (!b.boss || b.boss.phase < 2) report.errors.push({ kind: 'flow', text: 'BOSS 未进入阶段 3' });

  /* 让 BOSS 打一会儿，检查弹幕与光束不报错。
   * 注意：此时自机是满配（面板 DPS ≈ 3600），BOSS 剩余血量撑不过几秒，
   * 所以必须先停火，否则根本没有机会观察到 BOSS 的弹幕（上一版就是因此
   * 采样到 ebul=0，误以为"BOSS 不会开火"）。 */
  await cdp.evaluate('window.__strike.setFiring(false)');
  await sleep(1400);
  let maxEbul = 0;
  for (let i = 0; i < 13; i++) {
    await sleep(430);
    const n = await cdp.evaluate('window.__strike.game.ebul.count');
    if (typeof n === 'number') maxEbul = Math.max(maxEbul, n);
  }
  await shot(cdp, '09-boss-barrage');
  const barrage = await cdp.evaluate('window.__strike.info()');
  note('BOSS 弹幕中', {
    bossAlive: !!barrage.boss && !barrage.boss.dying,
    maxEbul, ebul: barrage.ebul, particles: barrage.particles, fps: barrage.fps,
    drawCalls: barrage.drawCalls, triangles: barrage.triangles, programs: barrage.programs,
  });
  if (maxEbul < 4) report.errors.push({ kind: 'feature', text: 'BOSS 未产生弹幕（峰值 ebul=' + maxEbul + '）' });
  await cdp.evaluate('window.__strike.setFiring(true)');

  console.log('\n▶ 击破 BOSS');
  await cdp.evaluate('window.__strike.killBoss()');
  await sleep(4200);
  await shot(cdp, '10-boss-down');
  const dead = await cdp.evaluate('window.__strike.info()');
  note('击破后', { state: dead.state, level: dead.level, score: dead.score });
  if (dead.state !== 'levelclear' && dead.level === 0) {
    report.errors.push({ kind: 'flow', text: 'BOSS 击破后未进入过场，state=' + dead.state });
  }

  /* ---------- 第 2 关 ---------- */
  console.log('\n▶ 进入第 2 关');
  await waitUntil(cdp, 'window.__strike.game.levelIndex === 1', '进入第 2 关', 15000);
  await sleep(2500);
  await shot(cdp, '11-level2');
  const l2 = await cdp.evaluate('window.__strike.info()');
  note('第 2 关', { level: l2.level, state: l2.state, levelT: l2.levelT });

  /* ---------- 第 2 关：陨石可击破 ---------- */
  console.log('\n▶ 第 2 关陨石（应可被自机子弹 / 激光击破）');
  let rockOn = false, rockBroken = 0, rockDamaged = 0, rockMaxHp = 0;
  for (let i = 0; i < 12; i++) {
    await sleep(420);
    const r = await cdp.evaluate('window.__strike.rocks()');
    if (!r) break;
    rockOn = r.on;
    rockBroken = Math.max(rockBroken, r.broken);
    rockMaxHp = Math.max(rockMaxHp, ...r.maxHp);
    const dmgd = r.hp.filter((h, k) => h < r.maxHp[k]).length;
    rockDamaged = Math.max(rockDamaged, dmgd);
  }
  note('陨石带', { rocksOn: rockOn, brokenMax: rockBroken, damagedMax: rockDamaged, maxHp: rockMaxHp });
  if (!rockOn) report.errors.push({ kind: 'feature', text: '第 2 关陨石带未启用（rocksOn=false）' });
  if (rockBroken + rockDamaged < 1) {
    report.errors.push({ kind: 'feature', text: '陨石无法被击伤/击破（观察 5s 内生命值全程未变化）' });
  }
  await shot(cdp, '11b-asteroid-hit');

  await cdp.evaluate('window.__strike.skipToBoss()');
  await sleep(3200);
  await shot(cdp, '12-level2-boss');
  const b2 = await cdp.evaluate('window.__strike.info()');
  note('第 2 关 BOSS', b2.boss);
  /* 第 2 关 BOSS（CASTOR）：56000 × 1.5 = 84000，攻击 ×1.2 */
  if (b2.boss) {
    if (b2.boss.max !== 84000) {
      report.errors.push({ kind: 'feature', text: `第 2 关 BOSS 生命未 +50%：${b2.boss.max}（期望 84000）` });
    }
    const a2 = await cdp.evaluate('window.__strike.game.boss.atkMul');
    if (Math.abs(a2 - 1.2) > 1e-6) {
      report.errors.push({ kind: 'feature', text: '第 2 关 BOSS 攻击倍率不是 1.2，实际 ' + a2 });
    }
  }

  /* ---------- 第 3 关 ---------- */
  console.log('\n▶ 进入第 3 关（精英）');
  await cdp.evaluate('window.__strike.killBoss()');
  await waitUntil(cdp, 'window.__strike.game.levelIndex === 2', '进入第 3 关', 15000);
  await cdp.evaluate('window.__strike.startRun("elite", 2)');
  await sleep(2600);
  await shot(cdp, '13-level3-elite');
  const l3 = await cdp.evaluate('window.__strike.info()');
  note('第 3 关 · 精英', { level: l3.level, state: l3.state });
  await cdp.evaluate('window.__strike.skipToBoss()');
  await sleep(3500);
  await shot(cdp, '14-level3-boss');
  const b3 = await cdp.evaluate('window.__strike.info()');
  note('第 3 关 BOSS', b3.boss);
  /* 第 3 关 BOSS（NOVA）：76000 × 1.5 × 1.9(精英) = 216600，攻击 ×1.2 */
  if (b3.boss) {
    const want3 = Math.round(76000 * 1.5 * 1.9);
    if (b3.boss.max !== want3) {
      report.errors.push({ kind: 'feature', text: `第 3 关 BOSS 生命不对：${b3.boss.max}（期望 ${want3} = 76000×1.5×1.9）` });
    }
    const a3 = await cdp.evaluate('window.__strike.game.boss.atkMul');
    if (Math.abs(a3 - 1.2) > 1e-6) {
      report.errors.push({ kind: 'feature', text: '第 3 关 BOSS 攻击倍率不是 1.2，实际 ' + a3 });
    }
  }

  /* ---------- 通关 ---------- */
  console.log('\n▶ 通关');
  await cdp.evaluate('window.__strike.killBoss()');
  await waitUntil(cdp, 'window.__strike.state === "victory"', '通关结算', 20000);
  await sleep(1200);
  await shot(cdp, '15-victory');
  const win = await cdp.evaluate('window.__strike.info()');
  note('通关', { state: win.state, score: win.score });

  /* ---------- 回菜单 ---------- */
  await cdp.evaluate('document.getElementById("btn-menu").click()');
  await sleep(1400);
  await shot(cdp, '16-back-to-menu');
  note('回菜单', await cdp.evaluate('window.__strike.state'));

  /* ---------- 稳定性：长时间运行 ---------- */
  console.log('\n▶ 稳定性巡检（10s 连续战斗）');
  await cdp.evaluate('window.__strike.startRun("elite", 0)');
  await cdp.evaluate('window.__strike.grantAll(5)');
  const t0 = Date.now();
  let minFps = 999, maxDraw = 0, sample = null;
  while (Date.now() - t0 < 10000) {
    await sleep(900);
    const i = await cdp.evaluate('window.__strike.info()');
    sample = i;
    minFps = Math.min(minFps, i.fps);
    maxDraw = Math.max(maxDraw, i.drawCalls);
  }
  note('稳定性', { minFps: +minFps.toFixed(1), maxDrawCalls: maxDraw, last: { ebul: sample.ebul, pbul: sample.pbul, particles: sample.particles, enemies: sample.enemies, triangles: sample.triangles } });
  if (maxDraw < 3) report.errors.push({ kind: 'perf', text: 'drawCalls 统计异常（恒为 ' + maxDraw + '），说明采样点被后处理重置' });
  await shot(cdp, '17-stable');

  /* ---------- 汇总 ---------- */
  report.shots = shots;
  report.webgl2 = gl.webgl2;
  report.ok = report.errors.length === 0;
  const errs = report.errors.filter((e) => e.kind !== 'log:error' || !/favicon/.test(e.text || ''));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log('\n' + '='.repeat(62));
  console.log(`未捕获异常 / 错误：${errs.length}`);
  if (errs.length) for (const e of errs.slice(0, 12)) console.log('  ✗', e.kind, '|', e.text || e.desc);
  const warns = report.console.filter((c) => c.type === 'warning');
  console.log(`控制台告警：${warns.length}`);
  for (const w of warns.slice(0, 8)) console.log('  ! ', w.text.slice(0, 200));
  console.log(`网络失败：${report.failedRequests.length}`);
  console.log(`截图：${shots.length} 张 → ${OUT}`);
  console.log('='.repeat(62) + '\n');
  cdp.close();
  if (errs.length) process.exitCode = 1;
}

main().catch((e) => {
  report.fatal = String(e && e.stack ? e.stack : e);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.error('\n✗ 验收失败：', e.message || e);
  process.exit(1);
});

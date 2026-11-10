/**
 * audio.js — 全程序化音频（WebAudio 合成，零音频资源）
 *
 * 本版本聚焦「射击手感」，音色取向为**柔和圆润**（本轮由"锐利"改为"柔和"）：
 *   · 主炮 = 5 层合成，全部走中低频：低通软音头 + 三角/半量锯齿下扫 +
 *     正弦低频垫底 + 极轻 FM 泛音 + 小音量尾音气声，末尾再挂 3.6kHz 总低通
 *   · 每次开火只有 ±2.3% 的轻微音高偏移，连射不再刺耳
 *   · 激光持续音（双失谐锯齿 + 带通 + LFO 扫频 + 轻噪声），音量与音色随强度变化
 *   · 敌机开火声刻意保持更低沉，与自机音色区分，不抢戏
 * 另含每关自适应 BGM（低音/琶音/打击乐/铺底）。
 */

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.volumes = { master: 0.78, sfx: 0.95, music: 0.46 };
    this.voices = 0;
    this.voiceCap = 34;
    this._music = null;
    this._step = 0;
    this._nextNoteTime = 0;
    this._lastSfx = new Map();
    this._laser = null;
    this._intensity = 0.6;
  }

  /** 必须在用户手势中调用 */
  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;

    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.volumes.master;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -13;
    comp.knee.value = 24;
    comp.ratio.value = 3.4;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    // 轻微高通，去掉低频轰隆造成的浑浊
    const dc = c.createBiquadFilter();
    dc.type = 'highpass';
    dc.frequency.value = 28;
    this.master.connect(dc);
    dc.connect(comp);
    comp.connect(c.destination);

    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);

    /* ---- 射击专用短延迟总线：给开火声一层"空间厚度" ----
     * 本轮把反馈量与延迟低通都明显压低（0.26→0.15 / 2800→1500），
     * 并新增一个 0.35 的湿声增益 —— 旧版反馈太强会让连射糊成一片轰鸣，
     * 与"柔和"的方向相反。
     */
    this.shotBus = c.createGain();
    this.shotBus.gain.value = 1.0;
    this.shotBus.connect(this.sfxBus);
    const dl = c.createDelay(0.4);
    dl.delayTime.value = 0.085;
    const fb = c.createGain();
    fb.gain.value = 0.15;
    const dlp = c.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 1500;
    dlp.Q.value = 0.5;
    const wet = c.createGain();
    wet.gain.value = 0.35;
    this.shotBus.connect(dl);
    dl.connect(dlp);
    dlp.connect(fb);
    fb.connect(dl);
    dl.connect(wet);
    wet.connect(this.sfxBus);
    this._shotDelay = dl;

    /* ---- 噪声缓冲 ---- */
    const len = Math.floor(c.sampleRate * 1.4);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    /* ---- 共享波形表（周期波，比采样更省） ---- */
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volumes.master;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  _ok(kind, minGap = 0.02) {
    if (!this.ready || this.muted) return false;
    if (this.voices > this.voiceCap) return false;
    const t = this.now;
    const last = this._lastSfx.get(kind) || -1;
    if (t - last < minGap) return false;
    this._lastSfx.set(kind, t);
    return true;
  }

  _env(node, t, a, d, peak = 1) {
    const g = node.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _voice(dur) {
    this.voices++;
    setTimeout(() => (this.voices = Math.max(0, this.voices - 1)), dur * 1000 + 30);
  }

  _noiseSrc(rate = 1, t, dur) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rate;
    s.start(t, Math.random() * 0.9, dur + 0.05);
    return s;
  }

  /* ================================================================== *
   * SFX
   * ================================================================== */

  /**
   * 主炮开火 —— **柔和版**（本轮调整：由"锐利"改为"圆润"）
   *
   * 旧版靠「高频瞬态噪声 + 方波 + FM 金属泛音」堆出锐度，单发很带劲，
   * 但射速拉满时连射会显得刺耳、发"炸"。现在改为以**中低频圆润音头**为主：
   *   ① 软音头：低通噪声"呼"的一下（不再是高通"咔"）
   *   ② 主体：三角波 + 半量锯齿缓慢下扫，低通 Q 从 5.2 降到 2.1（无共振尖峰）
   *   ③ 低频垫底：正弦下扫更短更收敛，给厚度但不轰头
   *   ④ 极轻泛音：FM 深度大幅收小，只保留一点"能量武器"的嗡
   *   ⑤ 尾音气声：带通中心从 5.2k 压到 2.6k、音量降到 0.028
   * 整条链路末尾再挂一个 3.6kHz 总低通，把残余毛刺磨掉。
   *
   * @param {number} power 火力等级（只轻微影响音高，不再越打越尖）
   */
  shoot(power = 1) {
    if (!this._ok('shoot', 0.026) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    const p = Math.min(power, 16);
    const det = 1 + (Math.random() - 0.5) * 0.045;     // 音高抖动比旧版更小，更"稳"
    const base = (620 + p * 20) * det;

    const out = c.createGain();
    out.gain.value = 1;
    // 总低通：磨掉高频毛刺 —— 这是"柔和"最关键的一步
    const soften = c.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 3600;
    soften.Q.value = 0.55;
    out.connect(soften);
    soften.connect(this.shotBus);

    // ① 软音头：极短低通噪声，像"呼"而不是"咔"
    {
      const s = this._noiseSrc(1.15, t, 0.05);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1500 + Math.random() * 400;
      f.Q.value = 0.8;
      const g = c.createGain();
      this._env(g, t, 0.004, 0.045, 0.16);
      s.connect(f); f.connect(g); g.connect(out);
    }
    // ② 主体：三角 + 锯齿，缓慢下扫，低 Q 无共振
    {
      const o1 = c.createOscillator(), o2 = c.createOscillator();
      o1.type = 'triangle'; o2.type = 'sawtooth';
      o1.frequency.setValueAtTime(base * 1.30, t);
      o1.frequency.exponentialRampToValueAtTime(base * 0.46, t + 0.13);
      o2.frequency.setValueAtTime(base * 1.72, t);
      o2.frequency.exponentialRampToValueAtTime(base * 0.58, t + 0.11);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 2.1;
      f.frequency.setValueAtTime(1250 + base * 0.9, t);
      f.frequency.exponentialRampToValueAtTime(430, t + 0.14);
      const g = c.createGain();
      const saw = c.createGain();
      saw.gain.value = 0.5;                 // 锯齿只占一半，进一步降低锋利感
      this._env(g, t, 0.008, 0.135, 0.22);
      o1.connect(f); o2.connect(saw); saw.connect(f);
      f.connect(g); g.connect(out);
      o1.start(t); o2.start(t);
      o1.stop(t + 0.20); o2.stop(t + 0.20);
    }
    // ③ 低频垫底：给厚度，但幅度收敛、尾巴更短
    {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(175 * det, t);
      o.frequency.exponentialRampToValueAtTime(62, t + 0.08);
      this._env(g, t, 0.006, 0.095, 0.20);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.15);
    }
    // ④ 极轻泛音：保留一点"能量武器"的嗡，不再有金属尖啸
    {
      const mod = c.createOscillator(), mg = c.createGain();
      const car = c.createOscillator(), cg = c.createGain();
      mod.type = 'sine';
      mod.frequency.value = base * 1.55;
      mg.gain.setValueAtTime(base * 1.1, t);
      mg.gain.exponentialRampToValueAtTime(base * 0.10, t + 0.07);
      car.type = 'sine';
      car.frequency.setValueAtTime(base * 1.05, t);
      car.frequency.exponentialRampToValueAtTime(base * 0.55, t + 0.10);
      mod.connect(mg); mg.connect(car.frequency);
      this._env(cg, t, 0.008, 0.085, 0.045);
      car.connect(cg); cg.connect(out);
      mod.start(t); car.start(t);
      mod.stop(t + 0.14); car.stop(t + 0.14);
    }
    // ⑤ 尾音气声：音量很小，只让连射有一点点"扫射"的黏连感
    {
      const s = this._noiseSrc(1.8, t, 0.08);
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(2600, t);
      f.frequency.exponentialRampToValueAtTime(1100, t + 0.08);
      f.Q.value = 0.9;
      const g = c.createGain();
      this._env(g, t, 0.008, 0.07, 0.028);
      s.connect(f); f.connect(g); g.connect(out);
    }
    this._voice(0.24);
  }

  /** 敌机开火：音色明显低于自机，避免混音糊在一起 */
  enemyShoot(kind = 0) {
    if (!this._ok('eshoot', 0.035) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    const o = c.createOscillator(), o2 = c.createOscillator();
    const f = c.createBiquadFilter(), g = c.createGain();
    const base = kind ? 200 : 152;
    o.type = 'square'; o2.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.42, t + 0.11);
    o2.frequency.setValueAtTime(base * 1.5, t);
    o2.frequency.exponentialRampToValueAtTime(base * 0.6, t + 0.11);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1300, t);
    f.frequency.exponentialRampToValueAtTime(320, t + 0.12);
    f.Q.value = 3.4;
    this._env(g, t, 0.003, 0.115, 0.11);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfxBus);
    o.start(t); o2.start(t);
    o.stop(t + 0.17); o2.stop(t + 0.17);
    this._voice(0.2);
  }

  /* ---------------- 激光 ---------------- */

  /** 开启激光持续音（幂等）—— 本轮把噪声嘶声与带通 Q 值都下调，音色更"厚"不"尖" */
  laserStart() {
    if (!this.ready || this._laser) return;
    const c = this.ctx, t = this.now;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.connect(this.sfxBus);

    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.6;
    bp.frequency.value = 980;
    bp.connect(out);

    const oscs = [];
    const defs = [['sawtooth', 1.0, 0], ['triangle', 1.0, 6], ['sine', 0.5, -4]];
    for (const [type, mul, cents] of defs) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = 196 * mul;
      o.detune.value = cents;
      const g = c.createGain();
      g.gain.value = mul === 0.5 ? 0.26 : 0.34;
      o.connect(g); g.connect(bp);
      o.start(t);
      oscs.push({ o, g });
    }

    // LFO 扫频 —— 激光"呼吸"的关键
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 5.4;
    lg.gain.value = 300;
    lfo.connect(lg); lg.connect(bp.frequency);
    lfo.start(t);

    // 噪声嘶嘶（音量压得很低，只作为"能量流动"的质感）
    const ns = c.createBufferSource();
    ns.buffer = this.noise;
    ns.loop = true;
    const nf = c.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 2200;
    const ng = c.createGain();
    ng.gain.value = 0.022;
    ns.connect(nf); nf.connect(ng); ng.connect(out);
    ns.start(t);

    this._laser = { out, bp, oscs, lfo, lg, ns, ng };
    out.gain.linearRampToValueAtTime(0.10, t + 0.12);
  }

  /** 强度 0..1（随激光叠加强度变化） */
  laserSet(v) {
    const L = this._laser;
    if (!L || !this.ctx) return;
    const t = this.now;
    const k = Math.max(0, Math.min(1, v));
    L.out.gain.setTargetAtTime(0.055 + k * 0.080, t, 0.12);
    L.bp.frequency.setTargetAtTime(760 + k * 720, t, 0.14);
    L.lg.gain.setTargetAtTime(220 + k * 360, t, 0.16);
    L.ng.gain.setTargetAtTime(0.014 + k * 0.022, t, 0.14);
    for (let i = 0; i < L.oscs.length; i++) {
      const base = i === 2 ? 98 : 196;
      L.oscs[i].o.frequency.setTargetAtTime(base * (1 + k * 0.20), t, 0.16);
    }
  }

  laserStop() {
    const L = this._laser;
    if (!L || !this.ctx) return;
    const t = this.now;
    L.out.gain.cancelScheduledValues(t);
    L.out.gain.setValueAtTime(Math.max(0.0002, L.out.gain.value), t);
    L.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    const stopAt = t + 0.22;
    for (const { o } of L.oscs) o.stop(stopAt);
    L.lfo.stop(stopAt);
    try { L.ns.stop(stopAt); } catch (e) { /* 已停止 */ }
    this._laser = null;
  }

  /** 激光命中灼烧（很轻的一点嘶声） */
  laserHit() {
    if (!this._ok('lhit', 0.055) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    const s = this._noiseSrc(3.2, t, 0.05);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 4600 + Math.random() * 1400;
    f.Q.value = 2.2;
    const g = c.createGain();
    this._env(g, t, 0.002, 0.045, 0.055);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    this._voice(0.1);
  }

  hit() {
    if (!this._ok('hit', 0.016) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    const s = this._noiseSrc(1.7, t, 0.05);
    const f = c.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 2900;
    const g = c.createGain();
    this._env(g, t, 0.0015, 0.050, 0.11);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    this._voice(0.09);
  }

  explode(size = 1) {
    if (!this._ok('explode', 0.012) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    const dur = 0.34 + size * 0.5;
    const s = this._noiseSrc(0.65 - size * 0.2, t, dur);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1900 / (0.6 + size * 0.5), t);
    f.frequency.exponentialRampToValueAtTime(85, t + dur * 0.9);
    f.Q.value = 0.7;
    const g = c.createGain();
    this._env(g, t, 0.005, dur, 0.36 + size * 0.16);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);

    const o = c.createOscillator(), og = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(155 / (0.7 + size * 0.4), t);
    o.frequency.exponentialRampToValueAtTime(26, t + dur * 0.8);
    this._env(og, t, 0.007, dur * 0.9, 0.45 + size * 0.22);
    o.connect(og); og.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.1);
    this._voice(dur + 0.15);
  }

  playerHit() {
    if (!this._ok('phit', 0.06) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    const o = c.createOscillator(), g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1400;
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(340, t);
    o.frequency.exponentialRampToValueAtTime(56, t + 0.44);
    this._env(g, t, 0.005, 0.44, 0.34);
    o.connect(f); f.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.52);
    this.explode(0.9);
    this._voice(0.55);
  }

  /** 护盾吸收一次攻击 */
  shieldAbsorb() {
    if (!this._ok('absorb', 0.06) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 3.6;
    f.frequency.setValueAtTime(1500, t);
    f.frequency.exponentialRampToValueAtTime(420, t + 0.28);
    o.type = 'triangle'; o2.type = 'sine';
    o.frequency.setValueAtTime(680, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.28);
    o2.frequency.setValueAtTime(1360, t);
    o2.frequency.exponentialRampToValueAtTime(600, t + 0.28);
    this._env(g, t, 0.004, 0.28, 0.20);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfxBus);
    o.start(t); o2.start(t);
    o.stop(t + 0.34); o2.stop(t + 0.34);
    this._voice(0.4);
  }

  pickup() {
    if (!this._ok('pickup', 0.025) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    [880, 1174, 1568].forEach((fr, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(fr, t + i * 0.035);
      this._env(g, t + i * 0.035, 0.003, 0.10, 0.10);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t + i * 0.035); o.stop(t + i * 0.035 + 0.14);
    });
    this._voice(0.3);
  }

  /** 护盾道具 */
  pickShield() {
    if (!this._ok('pshield', 0.05) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    [523, 784, 1047, 1568].forEach((fr, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(fr, t + i * 0.04);
      this._env(g, t + i * 0.04, 0.004, 0.22, 0.11);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t + i * 0.04); o.stop(t + i * 0.04 + 0.3);
    });
    this._voice(0.5);
  }

  /** 生命（1UP）道具 */
  pickLife() {
    if (!this._ok('plife', 0.2) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    const seq = [659, 784, 988, 1319, 1568, 2093];
    seq.forEach((fr, i) => {
      const o = c.createOscillator(), g = c.createGain();
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 5200;
      o.type = 'square';
      o.frequency.setValueAtTime(fr, t + i * 0.072);
      this._env(g, t + i * 0.072, 0.004, 0.20, 0.085);
      o.connect(f); f.connect(g); g.connect(this.sfxBus);
      o.start(t + i * 0.072); o.stop(t + i * 0.072 + 0.28);
    });
    this._voice(0.9);
  }

  powerUp() {
    if (!this._ok('powerup', 0.045) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    [523, 659, 784, 1047, 1319].forEach((fr, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(fr, t + i * 0.036);
      this._env(g, t + i * 0.036, 0.003, 0.13, 0.070);
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 4200;
      o.connect(f); f.connect(g); g.connect(this.sfxBus);
      o.start(t + i * 0.036); o.stop(t + i * 0.036 + 0.2);
    });
    this._voice(0.4);
  }

  bomb() {
    if (!this._ok('bomb', 0.2) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(20, t + 1.15);
    this._env(g, t, 0.009, 1.15, 0.52);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 1.25);

    const s = this._noiseSrc(0.5, t, 1.05);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3400, t);
    f.frequency.exponentialRampToValueAtTime(110, t + 1.0);
    const sg = c.createGain();
    this._env(sg, t, 0.004, 1.02, 0.42);
    s.connect(f); f.connect(sg); sg.connect(this.sfxBus);
    this._voice(1.3);
  }

  alarm() {
    if (!this._ok('alarm', 0.4) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    for (let k = 0; k < 3; k++) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth';
      const t0 = t + k * 0.42;
      o.frequency.setValueAtTime(320, t0);
      o.frequency.linearRampToValueAtTime(620, t0 + 0.18);
      o.frequency.linearRampToValueAtTime(320, t0 + 0.36);
      this._env(g, t0, 0.02, 0.36, 0.15);
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 2000;
      o.connect(f); f.connect(g); g.connect(this.sfxBus);
      o.start(t0); o.stop(t0 + 0.42);
    }
    this._voice(1.5);
  }

  /** 获得激光武器 / 激光升级 */
  laserCharge(dur = 0.7) {
    if (!this._ok('charge', 0.3) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(1700, t + dur);
    this._env(g, t, 0.04, dur, 0.15);
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 3.2;
    f.frequency.setValueAtTime(340, t);
    f.frequency.exponentialRampToValueAtTime(3400, t + dur);
    o.connect(f); f.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.1);
    this._voice(dur + 0.2);
  }

  ui(kind = 'click') {
    if (!this._ok('ui', 0.04) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(kind === 'back' ? 320 : 780, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'back' ? 200 : 1200, t + 0.08);
    this._env(g, t, 0.003, 0.09, 0.12);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.12);
    this._voice(0.12);
  }

  levelClear() {
    if (!this._ok('clear', 0.5) || !this.ctx) return;
    const c = this.ctx, t = this.now;
    [523, 659, 784, 1047].forEach((fr, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(fr, t + i * 0.11);
      this._env(g, t + i * 0.11, 0.01, 0.5, 0.16);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.6);
    });
    this._voice(1.2);
  }

  /* ================================================================== *
   * BGM
   * ================================================================== */

  startMusic(cfg) {
    if (!this.ready) return;
    this._music = {
      root: cfg.root,
      scale: cfg.scale,
      bpm: cfg.bpm,
      prog: [0, 4, 2, 5, 3, 4, 1, 5],
    };
    this._step = 0;
    this._nextNoteTime = this.now + 0.08;
    this.musicBus.gain.cancelScheduledValues(this.now);
    this.musicBus.gain.setValueAtTime(0.0001, this.now);
    this.musicBus.gain.exponentialRampToValueAtTime(this.volumes.music, this.now + 1.2);
  }

  stopMusic(fade = 1.0) {
    if (!this.ready || !this._music) return;
    const t = this.now;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(Math.max(0.0002, this.musicBus.gain.value), t);
    this.musicBus.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    this._music = null;
  }

  /** 0=平静 1=激战：影响打击乐密度 */
  setIntensity(v) {
    this._intensity = v;
  }

  update() {
    if (!this.ready || !this._music) return;
    const m = this._music;
    const stepDur = 60 / m.bpm / 4;
    const ahead = 0.25;
    let guard = 0;
    while (this._nextNoteTime < this.now + ahead && guard++ < 32) {
      this._scheduleStep(this._step, this._nextNoteTime, m, stepDur);
      this._nextNoteTime += stepDur;
      this._step++;
    }
  }

  _scheduleStep(step, t, m, stepDur) {
    const c = this.ctx;
    const bar = Math.floor(step / 16);
    const s16 = step % 16;
    const deg = m.prog[bar % m.prog.length];
    const semi = (n) => m.root * Math.pow(2, n / 12);
    const scaleNote = (i) => {
      const oct = Math.floor(i / m.scale.length);
      return m.scale[((i % m.scale.length) + m.scale.length) % m.scale.length] + 12 * oct;
    };
    const inten = this._intensity == null ? 0.6 : this._intensity;

    if (s16 % 4 === 0) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      this._env(g, t, 0.004, 0.16, 0.6);
      o.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + 0.22);
    }
    if (s16 === 4 || s16 === 12) {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.playbackRate.value = 1.1;
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
      const g = c.createGain();
      this._env(g, t, 0.002, 0.11, 0.13 + inten * 0.09);
      s.connect(f); f.connect(g); g.connect(this.musicBus);
      s.start(t, Math.random() * 0.5); s.stop(t + 0.16);
    }
    if (inten > 0.35 && s16 % 2 === 1) {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.playbackRate.value = 2.4;
      const f = c.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 8200;
      const g = c.createGain();
      this._env(g, t, 0.001, 0.035, 0.045 + inten * 0.03);
      s.connect(f); f.connect(g); g.connect(this.musicBus);
      s.start(t, Math.random() * 0.5); s.stop(t + 0.06);
    }
    if (s16 % 2 === 0) {
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(340 + inten * 900, t);
      f.frequency.exponentialRampToValueAtTime(150, t + stepDur * 1.8);
      f.Q.value = 6;
      o.type = 'sawtooth'; o2.type = 'square';
      const n = semi(scaleNote(deg) - 24);
      o.frequency.value = n;
      o2.frequency.value = n * 0.5;
      this._env(g, t, 0.006, stepDur * 1.75, 0.19);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(this.musicBus);
      o.start(t); o2.start(t);
      o.stop(t + stepDur * 2); o2.stop(t + stepDur * 2);
    }
    const arpPat = [0, 2, 4, 7, 4, 2, 5, 9];
    if (inten > 0.2 || s16 % 4 === 0) {
      const idx = arpPat[s16 % arpPat.length];
      const n = semi(scaleNote(deg + idx) + 12);
      const o = c.createOscillator(), g = c.createGain();
      o.type = s16 % 4 === 0 ? 'triangle' : 'square';
      o.frequency.value = n;
      this._env(g, t, 0.003, stepDur * 1.4, s16 % 4 === 0 ? 0.085 : 0.05);
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 5200;
      o.connect(f); f.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + stepDur * 1.6);
    }
    if (s16 === 0) {
      const barLen = stepDur * 16;
      for (let k = 0; k < 3; k++) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sawtooth';
        const n = semi(scaleNote(deg + k * 2) - 12);
        o.frequency.value = n * (1 + (k - 1) * 0.0035);
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(480, t);
        f.frequency.linearRampToValueAtTime(1500, t + barLen * 0.6);
        f.frequency.linearRampToValueAtTime(600, t + barLen);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.028, t + barLen * 0.35);
        g.gain.linearRampToValueAtTime(0.0001, t + barLen);
        o.connect(f); f.connect(g); g.connect(this.musicBus);
        o.start(t); o.stop(t + barLen + 0.05);
      }
    }
  }
}

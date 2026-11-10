/**
 * audio.js — 全程序化音频（WebAudio 合成，零音频资源）
 * 包含：战斗音效 + 每关自适应 BGM（低音/琶音/打击乐/铺底）
 */

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.volumes = { master: 0.75, sfx: 0.85, music: 0.5 };
    this.voices = 0;
    this.voiceCap = 26;
    this._music = null;
    this._musicTimer = 0;
    this._step = 0;
    this._nextNoteTime = 0;
    this._lastSfx = new Map();
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
    // 轻度压缩，避免爆炸叠爆削波
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.004;
    comp.release.value = 0.24;
    this.master.connect(comp);
    comp.connect(c.destination);

    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);

    // 噪声缓冲
    const len = Math.floor(c.sampleRate * 1.2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
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

  /* ---------------- SFX ---------------- */

  shoot(power = 1) {
    if (!this._ok('shoot', 0.028)) return;
    const c = this.ctx, t = this.now;
    const o = c.createOscillator();
    const g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900 + Math.min(power, 12) * 90;
    f.Q.value = 1.1;
    o.type = 'square';
    const base = 780 + Math.min(power, 12) * 34;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.34, t + 0.085);
    this._env(g, t, 0.004, 0.085, 0.16);
    o.connect(f); f.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.13);
    this._voice(0.13);
  }

  plasma(power = 1) {
    if (!this._ok('plasma', 0.03)) return;
    const c = this.ctx, t = this.now;
    const o = c.createOscillator(), o2 = c.createOscillator();
    const g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.14);
    o.type = 'sawtooth'; o2.type = 'sine';
    o.frequency.setValueAtTime(420 + power * 22, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.15);
    o2.frequency.setValueAtTime(1400 + power * 30, t);
    o2.frequency.exponentialRampToValueAtTime(320, t + 0.15);
    this._env(g, t, 0.005, 0.15, 0.13);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfxBus);
    o.start(t); o2.start(t);
    o.stop(t + 0.2); o2.stop(t + 0.2);
    this._voice(0.2);
  }

  hit() {
    if (!this._ok('hit', 0.018)) return;
    const c = this.ctx, t = this.now;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 1.6;
    const f = c.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 2600;
    const g = c.createGain();
    this._env(g, t, 0.002, 0.055, 0.1);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    s.start(t, Math.random() * 0.4); s.stop(t + 0.09);
    this._voice(0.09);
  }

  explode(size = 1) {
    if (!this._ok('explode', 0.012)) return;
    const c = this.ctx, t = this.now;
    const dur = 0.35 + size * 0.5;
    // 噪声体
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.65 - size * 0.2;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800 / (0.6 + size * 0.5), t);
    f.frequency.exponentialRampToValueAtTime(90, t + dur * 0.9);
    f.Q.value = 0.7;
    const g = c.createGain();
    this._env(g, t, 0.006, dur, 0.34 + size * 0.14);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    s.start(t, Math.random() * 0.2); s.stop(t + dur + 0.1);
    // 低频冲击
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150 / (0.7 + size * 0.4), t);
    o.frequency.exponentialRampToValueAtTime(28, t + dur * 0.8);
    this._env(og, t, 0.008, dur * 0.9, 0.42 + size * 0.2);
    o.connect(og); og.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.1);
    this._voice(dur + 0.15);
  }

  playerHit() {
    if (!this._ok('phit', 0.05)) return;
    const c = this.ctx, t = this.now;
    const o = c.createOscillator(), g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1400;
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(340, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.42);
    this._env(g, t, 0.006, 0.42, 0.3);
    o.connect(f); f.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.5);
    this.explode(0.9);
    this._voice(0.5);
  }

  pickup() {
    if (!this._ok('pickup', 0.03)) return;
    const c = this.ctx, t = this.now;
    const notes = [660, 880, 1320];
    notes.forEach((fr, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(fr, t + i * 0.045);
      this._env(g, t + i * 0.045, 0.004, 0.12, 0.12);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t + i * 0.045); o.stop(t + i * 0.045 + 0.16);
    });
    this._voice(0.3);
  }

  powerUp() {
    if (!this._ok('powerup', 0.05)) return;
    const c = this.ctx, t = this.now;
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((fr, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(fr, t + i * 0.038);
      this._env(g, t + i * 0.038, 0.003, 0.14, 0.075);
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 4200;
      o.connect(f); f.connect(g); g.connect(this.sfxBus);
      o.start(t + i * 0.038); o.stop(t + i * 0.038 + 0.2);
    });
    this._voice(0.4);
  }

  bomb() {
    if (!this._ok('bomb', 0.2)) return;
    const c = this.ctx, t = this.now;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(22, t + 1.1);
    this._env(g, t, 0.01, 1.1, 0.5);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 1.2);
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.5;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 1.0);
    const sg = c.createGain();
    this._env(sg, t, 0.005, 1.0, 0.4);
    s.connect(f); f.connect(sg); sg.connect(this.sfxBus);
    s.start(t); s.stop(t + 1.1);
    this._voice(1.3);
  }

  alarm() {
    if (!this._ok('alarm', 0.4)) return;
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

  laserCharge(dur = 1.1) {
    if (!this._ok('charge', 0.5)) return;
    const c = this.ctx, t = this.now;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + dur);
    this._env(g, t, 0.05, dur, 0.16);
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + dur);
    o.connect(f); f.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.1);
    this._voice(dur + 0.2);
  }

  ui(kind = 'click') {
    if (!this._ok('ui', 0.04)) return;
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
    if (!this._ok('clear', 0.5)) return;
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

  /* ---------------- BGM ---------------- */

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
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    this._music = null;
  }

  setIntensity(v) {
    // 0=平静 1=激战：影响打击乐密度
    this._intensity = v;
  }

  /** 每帧调用：向前调度音乐事件 */
  update() {
    if (!this.ready || !this._music) return;
    const m = this._music;
    const spb = 60 / m.bpm;
    const stepDur = spb / 4; // 16 分音符
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

    // --- 底鼓（4/4）
    if (s16 % 4 === 0) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      this._env(g, t, 0.004, 0.16, 0.6);
      o.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + 0.22);
    }
    // --- 军鼓
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
    // --- 踩镲
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
    // --- 低音线
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
    // --- 琶音
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
    // --- 铺底 pad（每小节）
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

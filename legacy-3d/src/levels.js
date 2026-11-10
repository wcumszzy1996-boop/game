/**
 * levels.js — 关卡波次编排
 * 每关波次阶段 0 ~ 138s（2:18），随后 BOSS 登场；单关总设计时长 180s（3 分钟）。
 */
import { LEVELS, BOSS_AT, LEVEL_DURATION } from './config.js';
import { rand, randInt, clamp } from './util.js';

/** 关卡波次表 —— 每一项 t 为秒 */
function buildSchedule(levelIndex) {
  const E = [];
  const add = (t, fn) => E.push({ t, fn });

  if (levelIndex === 0) {
    /* ---------------- 关卡 1：星云边境 ---------------- */
    add(3, (g, d, a) => g.line('scout', 3, { y: 8.5, spread: 9, behavior: 'dive' }));
    add(9, (g, d, a) => g.vFormation('scout', 5, { x: 0, y: 6.5, behavior: 'dive' }));
    add(16, (g, d, a) => g.line('interceptor', 2, { y: 7, spread: 12, behavior: 'hold' }));
    add(22, (g, d, a) => g.swarm('scout', 6, { behavior: 'sweep' }));
    add(29, (g, d, a) => g.line('interceptor', 3, { y: 6, spread: 14, behavior: 'hold' }));
    add(36, (g, d, a) => {
      g.spawn('bomber', { x: 0, y: 7 });
      g.line('interceptor', 2, { y: 4, spread: 15, behavior: 'hold', delay: 1.2 });
    });
    add(44, (g, d, a) => {
      g.line('scout', 5, { y: 9, spread: 17, behavior: 'dive' });
      g.line('scout', 4, { y: 6, spread: 14, behavior: 'dive', delay: 1.1 });
    });
    add(52, (g, d, a) => g.line('interceptor', 4, { y: 6.5, spread: 17, behavior: 'hold' }));
    add(60, (g, d, a) => {
      g.spawn('bomber', { x: -7, y: 6 });
      g.spawn('bomber', { x: 7, y: 6 });
    });
    add(68, (g, d, a) => {
      g.line('turret', 2, { y: 8, spread: 13 });
      g.line('scout', 4, { y: 4, spread: 12, behavior: 'dive', delay: 1.6 });
    });
    add(76, (g, d, a) => {
      g.line('interceptor', 5, { y: 6, spread: 18, behavior: 'hold' });
      g.line('scout', 3, { y: 3, spread: 10, behavior: 'dive', delay: 1.4 });
    });
    add(84, (g, d, a) => {
      g.spawn('bomber', { x: 0, y: 8 });
      g.line('turret', 2, { y: 6, spread: 15 });
    });
    add(92, (g, d, a) => g.stream('scout', 10, { interval: 0.32, behavior: 'dive' }));
    add(101, (g, d, a) => {
      g.line('bomber', 2, { y: 7, spread: 12 });
      g.line('interceptor', 4, { y: 3.5, spread: 16, behavior: 'hold', delay: 1.5 });
    });
    add(110, (g, d, a) => {
      g.line('turret', 3, { y: 8, spread: 16 });
      g.swarm('mine', 4, {});
    });
    add(119, (g, d, a) => g.line('interceptor', 6, { y: 6, spread: 20, behavior: 'hold' }));
    add(127, (g, d, a) => {
      g.line('bomber', 2, { y: 8, spread: 14 });
      g.line('scout', 6, { y: 4, spread: 18, behavior: 'dive', delay: 1.2 });
    });
    add(134, (g, d, a) => g.line('scout', 4, { y: 8, spread: 14, behavior: 'dive' }));
  } else if (levelIndex === 1) {
    /* ---------------- 关卡 2：陨石带 ---------------- */
    add(2, (g, d, a) => g.line('asteroid', 2, { y: 9, spread: 16 }));
    add(7, (g, d, a) => g.line('scout', 4, { y: 9, spread: 13, behavior: 'dive' }));
    add(13, (g, d, a) => g.line('asteroid', 3, { y: 8, spread: 18 }));
    add(18, (g, d, a) => g.line('interceptor', 3, { y: 6.5, spread: 15, behavior: 'hold' }));
    add(25, (g, d, a) => g.swarm('mine', 6, {}));
    add(31, (g, d, a) => {
      g.line('asteroid', 2, { y: 9, spread: 14 });
      g.line('scout', 4, { y: 4, spread: 14, behavior: 'dive', delay: 1.3 });
    });
    add(39, (g, d, a) => {
      g.spawn('bomber', { x: -6, y: 7 });
      g.spawn('bomber', { x: 6, y: 7 });
      g.line('interceptor', 2, { y: 3, spread: 12, behavior: 'hold', delay: 1.6 });
    });
    add(48, (g, d, a) => g.line('asteroid', 3, { y: 8.5, spread: 20 }));
    add(55, (g, d, a) => {
      g.line('interceptor', 5, { y: 6, spread: 19, behavior: 'hold' });
      g.swarm('mine', 3, {});
    });
    add(63, (g, d, a) => {
      g.line('turret', 2, { y: 8, spread: 14 });
      g.line('scout', 5, { y: 4, spread: 16, behavior: 'dive', delay: 1.2 });
    });
    add(71, (g, d, a) => {
      g.line('asteroid', 4, { y: 9, spread: 22 });
    });
    add(79, (g, d, a) => {
      g.spawn('bomber', { x: 0, y: 8 });
      g.line('interceptor', 4, { y: 5, spread: 18, behavior: 'hold', delay: 1.0 });
      g.swarm('mine', 4, {});
    });
    add(88, (g, d, a) => g.stream('scout', 12, { interval: 0.28, behavior: 'dive' }));
    add(97, (g, d, a) => {
      g.line('asteroid', 3, { y: 7, spread: 18 });
      g.line('turret', 3, { y: 9, spread: 17 });
    });
    add(106, (g, d, a) => {
      g.line('bomber', 2, { y: 8, spread: 13 });
      g.line('interceptor', 5, { y: 4, spread: 20, behavior: 'hold', delay: 1.4 });
    });
    add(115, (g, d, a) => {
      g.line('asteroid', 4, { y: 8.5, spread: 24 });
      g.swarm('mine', 5, {});
    });
    add(124, (g, d, a) => {
      g.line('interceptor', 6, { y: 6, spread: 21, behavior: 'hold' });
      g.line('scout', 6, { y: 3, spread: 18, behavior: 'dive', delay: 1.2 });
    });
    add(133, (g, d, a) => g.line('asteroid', 3, { y: 9, spread: 16 }));
  } else {
    /* ---------------- 关卡 3：母舰核心 ---------------- */
    add(2, (g, d, a) => g.line('turret', 3, { y: 8.5, spread: 16 }));
    add(8, (g, d, a) => g.line('scout', 6, { y: 9, spread: 16, behavior: 'dive' }));
    add(15, (g, d, a) => g.line('interceptor', 4, { y: 7, spread: 18, behavior: 'hold' }));
    add(22, (g, d, a) => {
      g.line('turret', 2, { y: 9, spread: 12 });
      g.swarm('mine', 5, {});
    });
    add(30, (g, d, a) => {
      g.spawn('bomber', { x: -8, y: 7 });
      g.spawn('bomber', { x: 8, y: 7 });
    });
    add(38, (g, d, a) => g.line('interceptor', 6, { y: 6, spread: 22, behavior: 'hold' }));
    add(46, (g, d, a) => {
      g.line('turret', 4, { y: 8.5, spread: 20 });
      g.line('scout', 5, { y: 3.5, spread: 16, behavior: 'dive', delay: 1.2 });
    });
    add(55, (g, d, a) => g.stream('scout', 14, { interval: 0.24, behavior: 'dive' }));
    add(64, (g, d, a) => {
      g.line('asteroid', 3, { y: 8, spread: 20 });
      g.line('interceptor', 4, { y: 4, spread: 18, behavior: 'hold', delay: 1.3 });
    });
    add(73, (g, d, a) => {
      g.spawn('bomber', { x: 0, y: 8.5 });
      g.line('turret', 3, { y: 6, spread: 16 });
      g.swarm('mine', 4, {});
    });
    add(82, (g, d, a) => g.line('interceptor', 7, { y: 6.5, spread: 24, behavior: 'hold' }));
    add(91, (g, d, a) => {
      g.line('turret', 4, { y: 9, spread: 22 });
      g.line('bomber', 2, { y: 4.5, spread: 14, delay: 1.5 });
    });
    add(100, (g, d, a) => {
      g.line('asteroid', 4, { y: 8.5, spread: 24 });
      g.swarm('mine', 6, {});
    });
    add(109, (g, d, a) => {
      g.line('interceptor', 6, { y: 6, spread: 22, behavior: 'hold' });
      g.line('scout', 8, { y: 3, spread: 22, behavior: 'dive', delay: 1.1 });
    });
    add(118, (g, d, a) => {
      g.line('bomber', 3, { y: 8, spread: 17 });
      g.line('turret', 3, { y: 4, spread: 18, delay: 1.6 });
    });
    add(127, (g, d, a) => {
      g.line('interceptor', 8, { y: 7, spread: 26, behavior: 'hold' });
      g.swarm('mine', 5, {});
    });
    add(134, (g, d, a) => {
      g.line('scout', 10, { y: 9, spread: 24, behavior: 'dive' });
    });
  }
  return E;
}

/* ================================================================== *
 * 编队生成器
 * ================================================================== */
class Spawner {
  constructor(game) {
    this.game = game;
    this.diff = null;
  }
  _ramp() {
    const t = this.game.director ? this.game.director.t : 0;
    return { aggression: 1 + clamp(t / 180, 0, 1) * 0.8 };
  }
  _count(base) {
    return Math.max(1, Math.round(base * (this.diff ? this.diff.spawnMul : 1)));
  }
  _defer(delay, fn) {
    if (!delay) {
      fn();
      return;
    }
    const d = this.game.director;
    if (d) d.pending.push({ delay, fn });
    else fn();
  }

  spawn(type, opts = {}) {
    const o = { ...opts, ...this._ramp(), diff: this.diff };
    this.game.spawnEnemy(type, o);
  }

  /** 横排 */
  line(type, count, opts = {}) {
    const n = this._count(count);
    const spread = opts.spread ?? 18;
    const y = opts.y ?? 8;
    const cb = () => {
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const x = -spread / 2 + spread * t;
        this.spawn(type, { ...opts, x, y, behavior: opts.behavior });
      }
    };
    this._defer(opts.delay, cb);
  }

  /** V 字编队 */
  vFormation(type, count, opts = {}) {
    const n = this._count(count);
    const cx = opts.x ?? 0;
    const cy = opts.y ?? 7;
    const spacing = opts.spacing ?? 4.4;
    const cb = () => {
      const half = (n - 1) / 2;
      for (let i = 0; i < n; i++) {
        const k = i - half;
        this.spawn(type, {
          ...opts,
          x: cx + k * spacing,
          y: cy - Math.abs(k) * 1.35,
          behavior: opts.behavior,
        });
      }
    };
    this._defer(opts.delay, cb);
  }

  /** 散兵群 */
  swarm(type, count, opts = {}) {
    const n = this._count(count);
    const cb = () => {
      for (let i = 0; i < n; i++) {
        this.spawn(type, {
          ...opts,
          x: rand(-17, 17),
          y: rand(3, 10),
          behavior: opts.behavior,
        });
      }
    };
    this._defer(opts.delay, cb);
  }

  /** 连续流（一列） */
  stream(type, count, opts = {}) {
    const n = this._count(count);
    const interval = opts.interval ?? 0.3;
    for (let i = 0; i < n; i++) {
      this._defer(i * interval, () => {
        this.spawn(type, { ...opts, x: rand(-15, 15), y: rand(7, 11), behavior: opts.behavior });
      });
    }
  }
}

/* ================================================================== *
 * 关卡导演
 * ================================================================== */
export class LevelDirector {
  constructor(game) {
    this.game = game;
    this.schedules = [buildSchedule(0), buildSchedule(1), buildSchedule(2)];
    this.spawner = new Spawner(game);
  }

  start(levelIndex, diff) {
    this.levelIndex = levelIndex;
    this.level = LEVELS[levelIndex];
    this.diff = diff;
    this.t = 0;
    this.cursor = 0;
    this.schedule = this.schedules[levelIndex];
    this.bossTriggered = false;
    this.finished = false;
    this.pending = [];
    this.spawner.diff = diff;
  }

  update(dt) {
    if (this.finished) return;
    this.t += dt;

    // 延迟队列
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        p.fn();
        this.pending.splice(i, 1);
      }
    }

    while (this.cursor < this.schedule.length && this.schedule[this.cursor].t <= this.t) {
      const ev = this.schedule[this.cursor++];
      ev.fn(this.spawner, this.diff, this.t);
    }

    if (!this.bossTriggered && this.t >= BOSS_AT) {
      this.bossTriggered = true;
      this.game.triggerBoss();
    }
  }

  stop() {
    this.finished = true;
    this.pending.length = 0;
  }

  get progress() {
    return clamp(this.t / LEVEL_DURATION, 0, 1);
  }
  get timeLeft() {
    return Math.max(0, LEVEL_DURATION - this.t);
  }
}

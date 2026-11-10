/**
 * util.js — 数学 / 随机 / 对象池 / 时间 工具
 * 《星锋突击 STARSTRIKE》 底层工具库（零依赖）
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
/** 帧率无关的指数逼近 */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);

export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

/** 确定性伪随机数发生器（用于星空等需要稳定布局的场合） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 角度插值（走最短弧） */
export function shortestAngle(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const dampAngle = (a, b, lambda, dt) => a + shortestAngle(a, b) * (1 - Math.exp(-lambda * dt));

export function formatTime(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function formatScore(n) {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 通用对象池。避免战斗中频繁 GC 造成卡顿。
 */
export class Pool {
  /**
   * @param {() => any} factory 创建对象
   * @param {(o:any)=>void} [onRelease] 回收时清理
   */
  constructor(factory, onRelease = null) {
    this.factory = factory;
    this.onRelease = onRelease;
    this.free = [];
    this.size = 0;
  }
  obtain() {
    let o;
    if (this.free.length) o = this.free.pop();
    else {
      o = this.factory();
      this.size++;
    }
    return o;
  }
  release(o) {
    if (this.onRelease) this.onRelease(o);
    this.free.push(o);
  }
  prewarm(n) {
    for (let i = 0; i < n; i++) this.free.push(this.factory());
  }
}

/**
 * 带"存活标记"的数组容器：update 中原地压缩，零分配。
 * 对象需带 `alive` 字段。
 */
export class ActiveList {
  constructor() {
    this.items = [];
  }
  get length() {
    return this.items.length;
  }
  add(o) {
    o.alive = true;
    this.items.push(o);
    return o;
  }
  /** 返回被移除的对象数组（调用方负责回收） */
  sweep(deadOut) {
    const it = this.items;
    let k = 0;
    for (let i = 0; i < it.length; i++) {
      if (it[i].alive) it[k++] = it[i];
      else deadOut && deadOut.push(it[i]);
    }
    it.length = k;
  }
  clear(cb) {
    if (cb) for (const o of this.items) cb(o);
    this.items.length = 0;
  }
}

/** 屏幕震动叠加器 */
export class Trauma {
  constructor() {
    this.trauma = 0;
    this.time = 0;
    this.offset = { x: 0, y: 0, r: 0 };
  }
  add(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }
  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.15);
    const s = this.trauma * this.trauma;
    const t = this.time;
    this.offset.x = s * 0.85 * (Math.sin(t * 61.3) * 0.6 + Math.sin(t * 27.7) * 0.4);
    this.offset.y = s * 0.85 * (Math.sin(t * 53.1 + 1.7) * 0.6 + Math.sin(t * 31.3) * 0.4);
    this.offset.r = s * 0.05 * Math.sin(t * 43.7);
    return this.offset;
  }
}

/** 简易计时器 */
export class Cooldown {
  constructor(interval = 1) {
    this.interval = interval;
    this.t = 0;
  }
  reset(v = 0) {
    this.t = v;
  }
  get ready() {
    return this.t <= 0;
  }
  /** 返回本帧触发次数 */
  tick(dt) {
    this.t -= dt;
    if (this.t <= 0) {
      const n = Math.floor(-this.t / this.interval) + 1;
      this.t += n * this.interval;
      return n;
    }
    return 0;
  }
}

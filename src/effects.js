/**
 * effects.js — 2D 粒子与打击感特效
 *
 * 组成：
 *   · ParticleLayer  单个 Points 绘制调用，自定义着色器支持「逐粒子尺寸/颜色/透明」
 *                    颜色可 > 1.0（HDR），因此火花/爆炸会真实参与 Bloom
 *   · PlanePool      平面池，用于爆心闪光(flare)、冲击波(ring)、枪口闪光
 *   · Effects        统一入口，负责 spawn 语义与每帧推进
 *
 * 所有粒子尺寸以「世界单位」给出，uScale 把世界单位换算为设备像素，
 * 因此分辨率变化时视觉大小完全一致。
 */
import * as THREE from '../vendor/three/three.module.js';
import { LAYER } from './config.js';
import { rand, randSign, TAU, clamp } from './util.js';

const PVERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale);
  gl_Position = projectionMatrix * mv;
}
`;

const PFRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float m = texture2D(uMap, gl_PointCoord).a;
  float a = m * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

/** 单贴图的粒子层（SoA + swap-remove，零分配） */
class ParticleLayer {
  constructor(map, max, z, renderOrder) {
    this.max = max;
    this.n = 0;
    this.map = map;

    this.px = new Float32Array(max);
    this.py = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.t = new Float32Array(max);
    this.life = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.a1 = new Float32Array(max);
    this.cr = new Float32Array(max);
    this.cg = new Float32Array(max);
    this.cb = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gy = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVERT,
      fragmentShader: PFRAG,
      uniforms: {
        uMap: { value: map },
        uScale: { value: 40 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.position.z = z;
    this.points.renderOrder = renderOrder;
    this.points.frustumCulled = false;
    this.geo = geo;
  }

  spawn(o) {
    let i;
    if (this.n < this.max) i = this.n++;
    else i = (Math.random() * this.max) | 0;      // 溢出时随机顶替（视觉上几乎无感）
    this.px[i] = o.x; this.py[i] = o.y;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0;
    this.t[i] = 0;
    this.life[i] = o.life;
    this.s0[i] = o.s0; this.s1[i] = o.s1;
    this.a0[i] = o.a0 != null ? o.a0 : 1; this.a1[i] = o.a1 != null ? o.a1 : 0;
    this.cr[i] = o.r; this.cg[i] = o.g; this.cb[i] = o.b;
    this.drag[i] = o.drag != null ? o.drag : 1.6;
    this.gy[i] = o.gy || 0;
    return i;
  }

  clear() {
    this.n = 0;
  }

  update(dt) {
    const pos = this.aPos.array, col = this.aCol.array, sz = this.aSize.array, al = this.aAlpha.array;
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      const t = this.t[i] + dt;
      if (t >= this.life[i]) continue;
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d + this.gy[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.t[i] = t;

      if (k !== i) {
        this.px[k] = this.px[i]; this.py[k] = this.py[i];
        this.vx[k] = this.vx[i]; this.vy[k] = this.vy[i];
        this.t[k] = this.t[i]; this.life[k] = this.life[i];
        this.s0[k] = this.s0[i]; this.s1[k] = this.s1[i];
        this.a0[k] = this.a0[i]; this.a1[k] = this.a1[i];
        this.cr[k] = this.cr[i]; this.cg[k] = this.cg[i]; this.cb[k] = this.cb[i];
        this.drag[k] = this.drag[i]; this.gy[k] = this.gy[i];
      }
      const u = this.t[k] / this.life[k];
      pos[k * 3] = this.px[k];
      pos[k * 3 + 1] = this.py[k];
      pos[k * 3 + 2] = 0;
      col[k * 3] = this.cr[k]; col[k * 3 + 1] = this.cg[k]; col[k * 3 + 2] = this.cb[k];
      sz[k] = this.s0[k] + (this.s1[k] - this.s0[k]) * u;
      al[k] = this.a0[k] + (this.a1[k] - this.a0[k]) * u;
      k++;
    }
    this.n = k;
    this.geo.setDrawRange(0, k);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** 平面池：爆心闪光 / 冲击波 / 枪口闪光 */
class PlanePool {
  constructor(map, max, z, renderOrder, blending = THREE.AdditiveBlending) {
    this.max = max;
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    this.geo = geo;
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        depthWrite: false,
        blending,
        opacity: 0,
        color: new THREE.Color(1, 1, 1),
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.position.z = z;
      m.renderOrder = renderOrder;
      m.userData = { alive: false, t: 0, life: 1, s0: 1, s1: 1, a0: 1, a1: 0, spin: 0, sx: 1, sy: 1 };
      this.items.push(m);
    }
  }
  obtain() {
    for (const m of this.items) if (!m.userData.alive) return m;
    let best = this.items[0];
    for (const m of this.items) if (m.userData.t / m.userData.life > best.userData.t / best.userData.life) best = m;
    return best;
  }
  spawn(o) {
    const m = this.obtain();
    const u = m.userData;
    u.alive = true; u.t = 0; u.life = o.life;
    u.s0 = o.s0; u.s1 = o.s1;
    u.a0 = o.a0 != null ? o.a0 : 1; u.a1 = o.a1 != null ? o.a1 : 0;
    u.spin = o.spin || 0;
    u.sx = o.sx || 1; u.sy = o.sy || 1;
    u.rot0 = o.rot || 0;
    m.position.set(o.x, o.y, m.position.z);
    m.rotation.z = u.rot0;
    m.material.color.setRGB(o.r, o.g, o.b);
    m.material.opacity = u.a0;
    m.scale.set(o.s0 * u.sx, o.s0 * u.sy, 1);
    m.visible = true;
    return m;
  }
  update(dt) {
    for (const m of this.items) {
      const u = m.userData;
      if (!u.alive) continue;
      u.t += dt;
      const k = u.t / u.life;
      if (k >= 1) { u.alive = false; m.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 2.2);
      const s = u.s0 + (u.s1 - u.s0) * e;
      m.scale.set(s * u.sx, s * u.sy, 1);
      m.rotation.z = u.rot0 + u.spin * u.t;
      m.material.opacity = u.a0 + (u.a1 - u.a0) * k;
    }
  }
  clear() {
    for (const m of this.items) { m.userData.alive = false; m.visible = false; }
  }
  dispose() {
    this.geo.dispose();
    for (const m of this.items) m.material.dispose();
  }
}

export class Effects {
  constructor(scene, SPR) {
    this.SPR = SPR;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.sparkL = new ParticleLayer(SPR.spark, 1100, LAYER.particle + 0.4, LAYER.particle + 4);
    this.glowL = new ParticleLayer(SPR.glow, 1500, LAYER.particle + 0.3, LAYER.particle + 3);
    this.smokeL = new ParticleLayer(SPR.smoke, 700, LAYER.particle + 0.2, LAYER.particle + 2);
    this.streakL = new ParticleLayer(SPR.streak, 500, LAYER.particle + 0.1, LAYER.particle + 1);
    this.layers = [this.smokeL, this.glowL, this.sparkL, this.streakL];
    for (const L of this.layers) this.group.add(L.points);

    this.flares = new PlanePool(SPR.flare, 30, LAYER.muzzle, LAYER.muzzle + 2);
    this.rings = new PlanePool(SPR.ring, 26, LAYER.impact - 0.5, LAYER.impact);
    for (const p of [this.flares, this.rings]) for (const m of p.items) this.group.add(m);

    this.pixelScale = 40;
    this._flash = 0;
    this._hitStop = 0;
  }

  /** 由 game 每帧同步：设备像素 / 世界单位 */
  setPixelScale(v) {
    for (const L of this.layers) L.mat.uniforms.uScale.value = v;
  }

  get count() {
    let n = 0;
    for (const L of this.layers) n += L.n;
    return n;
  }

  /** 普通粒子 */
  puff(kind, x, y, opts) {
    const L = kind === 'spark' ? this.sparkL
      : kind === 'smoke' ? this.smokeL
        : kind === 'streak' ? this.streakL
          : this.glowL;
    return L.spawn({ x, y, ...opts });
  }

  /** 命中火花：沿受击方向的反方向溅射 */
  hitSpark(x, y, dirX, dirY, color, scale = 1) {
    const r = color.r, g = color.g, b = color.b;
    const n = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dirY, dirX) + rand(-0.9, 0.9);
      const sp = rand(3.5, 11) * scale;
      this.sparkL.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.12, 0.28), s0: rand(0.05, 0.11) * scale, s1: 0.01,
        r: r * 1.8, g: g * 1.8, b: b * 1.8, a0: 1, a1: 0, drag: 4.0,
      });
    }
    this.glowL.spawn({
      x, y, vx: 0, vy: 0, life: 0.12, s0: 0.28 * scale, s1: 0.06,
      r: r * 2.1, g: g * 2.1, b: b * 2.1, a0: 0.85, a1: 0, drag: 1,
    });
  }

  /** 子弹命中硬质装甲（小火星） */
  deflect(x, y, dirX, dirY, color) {
    this.hitSpark(x, y, dirX, dirY, color, 0.62);
  }

  /** 爆炸：核心闪光 + 火球 + 碎屑火花 + 烟 + 冲击波 */
  explosion(x, y, opts = {}) {
    const size = opts.size || 1;
    const col = opts.color || new THREE.Color(1, 0.62, 0.24);
    const r = col.r, g = col.g, b = col.b;

    this.flares.spawn({
      x, y, life: 0.16 + size * 0.10, s0: 0.9 * size, s1: 2.6 * size,
      r: r * 2.8, g: g * 2.8, b: b * 2.8, a0: 1, a1: 0, spin: rand(-2, 2),
    });

    // 火球
    const nGlow = Math.min(46, 8 + size * 12) | 0;
    for (let i = 0; i < nGlow; i++) {
      const a = rand(0, TAU);
      const sp = rand(0.6, 6.4) * size;
      const hot = Math.random() < 0.42;
      this.glowL.spawn({
        x: x + Math.cos(a) * rand(0, 0.35) * size,
        y: y + Math.sin(a) * rand(0, 0.35) * size,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.26, 0.68) * (0.7 + size * 0.5),
        s0: rand(0.22, 0.62) * size, s1: rand(0.02, 0.12) * size,
        r: hot ? 3.0 : r * 2.0, g: hot ? 2.4 : g * 1.5, b: hot ? 1.3 : b * 1.0,
        a0: 1, a1: 0, drag: 2.6,
      });
    }
    // 碎屑火花
    const nSpark = Math.min(34, 6 + size * 9) | 0;
    for (let i = 0; i < nSpark; i++) {
      const a = rand(0, TAU);
      const sp = rand(5, 17) * size;
      this.sparkL.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.18, 0.5), s0: rand(0.05, 0.14) * size, s1: 0.008,
        r: 2.8, g: 2.1, b: 1.2, a0: 1, a1: 0, drag: 3.2,
      });
    }
    // 烟
    if (size > 0.55) {
      const nSmoke = Math.min(16, 3 + size * 5) | 0;
      for (let i = 0; i < nSmoke; i++) {
        const a = rand(0, TAU);
        const sp = rand(0.4, 2.6) * size;
        this.smokeL.spawn({
          x: x + Math.cos(a) * size * 0.3, y: y + Math.sin(a) * size * 0.3,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.4,
          life: rand(0.7, 1.6) * (0.7 + size * 0.5),
          s0: rand(0.4, 0.95) * size, s1: rand(1.1, 2.1) * size,
          r: 0.55, g: 0.50, b: 0.55, a0: 0.34, a1: 0, drag: 1.5,
        });
      }
    }
    // 冲击波
    if (size > 0.45) {
      this.rings.spawn({
        x, y, life: 0.26 + size * 0.16, s0: 0.5 * size, s1: 4.6 * size,
        r: r * 2.3, g: g * 2.3, b: b * 2.3, a0: 0.85, a1: 0, spin: rand(-0.5, 0.5),
      });
    }
  }

  /** BOSS 击破的多段大爆炸 */
  bigExplosion(x, y, color, scale = 2.4) {
    this.explosion(x, y, { size: scale, color });
    for (let i = 0; i < 7; i++) {
      const a = rand(0, TAU), d = rand(0.3, 1.5) * scale;
      const delayX = Math.cos(a) * d, delayY = Math.sin(a) * d;
      this.explosion(x + delayX, y + delayY, { size: scale * rand(0.35, 0.7), color });
    }
  }

  /** 枪口闪光（可横向拉伸以贴合炮口方向） */
  muzzle(x, y, opts = {}) {
    const s = opts.size || 0.55;
    this.flares.spawn({
      x, y, life: opts.life || 0.075,
      s0: s * 0.55, s1: s * 1.5, sx: opts.sx || 1, sy: opts.sy || 1,
      r: opts.r ?? 3.2, g: opts.g ?? 2.8, b: opts.b ?? 3.2,
      a0: 0.95, a1: 0, rot: opts.rot || 0, spin: 0,
    });
  }

  /** 冲击波（无爆炸，BOSS 技能 / 核弹用） */
  shockwave(x, y, opts = {}) {
    this.rings.spawn({
      x, y, life: opts.life || 0.5,
      s0: opts.s0 || 0.4, s1: opts.s1 || 12,
      r: opts.r ?? 2.6, g: opts.g ?? 2.6, b: opts.b ?? 2.6,
      a0: opts.a0 ?? 0.9, a1: 0, sx: opts.sx || 1, sy: opts.sy || 1,
    });
  }

  /** 击败敌机时向上飘散的碎光 */
  debris(x, y, vy, color, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * 0.9, -Math.PI * 0.1);
      const sp = rand(2, 8);
      this.glowL.spawn({
        x, y, vx: Math.cos(a) * sp * 0.5, vy: Math.sin(a) * sp + vy,
        life: rand(0.3, 0.7), s0: rand(0.1, 0.26), s1: 0.02,
        r: color.r * 2.2, g: color.g * 2.2, b: color.b * 2.2, a0: 0.9, a1: 0, drag: 1.8,
      });
    }
  }

  /** 拾取道具的放射光 */
  pickupBurst(x, y, color) {
    this.rings.spawn({
      x, y, life: 0.34, s0: 0.3, s1: 2.6,
      r: color.r * 2.4, g: color.g * 2.4, b: color.b * 2.4, a0: 0.9, a1: 0,
    });
    for (let i = 0; i < 12; i++) {
      const a = rand(0, TAU), sp = rand(3, 8);
      this.sparkL.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.2, 0.42), s0: 0.09, s1: 0.01,
        r: color.r * 3, g: color.g * 3, b: color.b * 3, a0: 1, a1: 0, drag: 3.4,
      });
    }
  }

  /** 玩家死亡的碎裂 */
  playerBurst(x, y) {
    this.explosion(x, y, { size: 1.9, color: new THREE.Color(0.4, 0.85, 1.0) });
    this.shockwave(x, y, { life: 0.6, s0: 0.5, s1: 14, r: 1.6, g: 3.0, b: 3.6 });
  }

  update(dt) {
    for (const L of this.layers) L.update(dt);
    this.flares.update(dt);
    this.rings.update(dt);
  }

  clear() {
    for (const L of this.layers) { L.clear(); L.geo.setDrawRange(0, 0); }
    this.flares.clear();
    this.rings.clear();
  }

  dispose() {
    for (const L of this.layers) L.dispose();
    this.flares.dispose();
    this.rings.dispose();
  }
}

export { ParticleLayer, PlanePool, clamp, randSign };

/**
 * combat.js — 弹幕池 / 激光光束 / 碰撞判定
 *
 * 设计：
 *   · BulletField  自机弹与敌弹各一套对象池，视觉用两层 InstancedMesh
 *     （加性「外辉光」+ 加性「高亮弹芯」），每层一次绘制调用。
 *     弹芯颜色刻意 > 1.0（HDR），因此子弹天然带 Bloom —— 这是"射击光效增强"的主体。
 *   · LaserSystem  新增的激光武器：持续光束，可无限叠加（最多 maxBeams 道），
 *     叠加提升宽度与 DPS；命中判定为"竖直线段 vs 圆"。
 *   · 碰撞统一用平方距离，避免开方；弹幕规模在数百级别，暴力遍历足够。
 */
import * as THREE from '../vendor/three/three.module.js';
import { LAYER, WORLD } from './config.js';
import { rand, clamp, TAU } from './util.js';

const HALF_W = WORLD.VIEW_W / 2;
const HALF_H = WORLD.VIEW_H / 2;

const _c = new THREE.Color();
const _obj = new THREE.Object3D();

/* ================================================================== *
 * 弹幕池
 * ================================================================== */
export class BulletField {
  /**
   * @param {THREE.Scene} scene
   * @param {object} SPR
   * @param {object} opt {max, layer, coreBoost, glowBoost}
   */
  constructor(scene, SPR, opt) {
    this.max = opt.max;
    this.bullets = [];
    this.free = [];
    this.layer = opt.layer;
    this.coreBoost = opt.coreBoost ?? 1;
    this.glowBoost = opt.glowBoost ?? 1;

    const geo = new THREE.PlaneGeometry(1, 1);
    this.geo = geo;

    const mkMat = (map, opacity) => new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity,
      color: new THREE.Color(1, 1, 1),
    });

    this.core = new THREE.InstancedMesh(geo, mkMat(SPR.bulletCore, 1.0), opt.max);
    this.glow = new THREE.InstancedMesh(geo, mkMat(SPR.bulletGlow, 1.0), opt.max);
    for (const m of [this.core, this.glow]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.position.z = this.layer;
      m.renderOrder = opt.renderOrder ?? 100;
      scene.add(m);
    }
    this.glow.position.z = this.layer - 0.15;
    this.glow.renderOrder = (opt.renderOrder ?? 100) - 1;

    // 预分配颜色属性
    this.core.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(opt.max * 3), 3);
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(opt.max * 3), 3);
    this.core.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.glow.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  get count() {
    return this.bullets.length;
  }

  /**
   * 发射一发
   * @param {object} o x,y,vx,vy,... 
   */
  fire(o) {
    if (this.bullets.length >= this.max) return null;
    const b = this.free.pop() || {};
    b.x = o.x; b.y = o.y;
    b.vx = o.vx; b.vy = o.vy;
    b.px = o.x; b.py = o.y;
    b.r = o.r ?? 0.22;
    b.dmg = o.dmg ?? 10;
    b.life = o.life ?? 4;
    b.t = 0;
    b.w = o.w ?? 0.34;
    b.h = o.h ?? 0.34;
    b.gw = o.gw ?? (b.w * 3.4);
    b.gh = o.gh ?? (b.h * 3.4);
    b.cr = o.cr ?? 2.4; b.cg = o.cg ?? 2.6; b.cb = o.cb ?? 3.2;
    b.gr = o.gr ?? 0.35; b.gg = o.gg ?? 0.9; b.gb = o.gb ?? 1.5;
    b.aim = o.aim !== false;       // 视觉上是否让弹体朝向速度方向
    b.pierce = o.pierce ?? 0;
    b.graze = o.graze ?? 0;
    b.kind = o.kind ?? 0;
    b.alive = true;
    this.bullets.push(b);
    return b;
  }

  _kill(i) {
    const b = this.bullets[i];
    const last = this.bullets.pop();
    if (i < this.bullets.length) this.bullets[i] = last;
    b.alive = false;
    this.free.push(b);
  }

  update(dt, onCull, targets) {
    const arr = this.bullets;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      b.t += dt;
      b.px = b.x; b.py = b.y;

      /* --- 追踪（导弹） --- */
      if (b.homing && targets && targets.length) {
        let best = null, bestD = 1e9;
        for (let k = 0; k < targets.length; k++) {
          const t = targets[k];
          if (!t.alive || t.y < b.y - 0.5) continue;
          const dx = t.x - b.x, dy = t.y - b.y;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = t; }
        }
        const cur = Math.atan2(b.vy, b.vx);
        let want = cur;
        if (best) want = Math.atan2(best.y - b.y, best.x - b.x);
        else if (b.vy < 0) want = -Math.PI * 0.5;
        let diff = (want - cur) % TAU;
        if (diff > Math.PI) diff -= TAU;
        if (diff < -Math.PI) diff += TAU;
        const turn = b.homing * dt * 3.2;
        const na = cur + clamp(diff, -turn, turn);
        const sp = Math.min(b.hspeed, Math.hypot(b.vx, b.vy) + (b.hspeed * 0.55) * dt);
        b.vx = Math.cos(na) * sp;
        b.vy = Math.sin(na) * sp;
        b.smokeT = (b.smokeT || 0) - dt;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.t >= b.life || b.y > HALF_H + 4 || b.y < -HALF_H - 4 || b.x < -HALF_W - 3 || b.x > HALF_W + 3) {
        onCull && onCull(b);
        this._kill(i);
      }
    }
    this._draw();
  }

  _draw() {
    const arr = this.bullets;
    const n = arr.length;
    const cm = this.core.instanceMatrix.array;
    const gm = this.glow.instanceMatrix.array;
    const cc = this.core.instanceColor.array;
    const gc = this.glow.instanceColor.array;

    for (let i = 0; i < n; i++) {
      const b = arr[i];
      const ang = b.aim ? Math.atan2(b.vy, b.vx) - Math.PI * 0.5 : 0;

      _obj.position.set(b.x, b.y, 0);
      _obj.rotation.set(0, 0, ang);
      _obj.scale.set(b.w, b.h, 1);
      _obj.updateMatrix();
      _obj.matrix.toArray(cm, i * 16);

      _obj.scale.set(b.gw, b.gh, 1);
      _obj.updateMatrix();
      _obj.matrix.toArray(gm, i * 16);

      cc[i * 3] = b.cr; cc[i * 3 + 1] = b.cg; cc[i * 3 + 2] = b.cb;
      gc[i * 3] = b.gr; gc[i * 3 + 1] = b.gg; gc[i * 3 + 2] = b.gb;
    }
    this.core.count = n;
    this.glow.count = n;
    this.core.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    this.core.instanceColor.needsUpdate = true;
    this.glow.instanceColor.needsUpdate = true;
  }

  /**
   * 与圆形目标做碰撞。命中即扣血并移除子弹（pierce 可穿透）。
   * @returns {number} 本次造成的总伤害
   */
  hitCircle(x, y, r, cb) {
    const arr = this.bullets;
    let dmg = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      const dx = b.x - x, dy = b.y - y;
      const rr = r + b.r;
      if (dx * dx + dy * dy <= rr * rr) {
        dmg += b.dmg;
        if (cb) cb(b, x, y);
        if (b.pierce > 0) b.pierce--;
        else this._kill(i);
      }
    }
    return dmg;
  }

  /**
   * 与矩形目标（BOSS 用多边形近似为若干圆，这里给出矩形版）
   * @returns {number}
   */
  hitRect(x, y, hw, hh, cb) {
    const arr = this.bullets;
    let dmg = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      if (b.x >= x - hw - b.r && b.x <= x + hw + b.r && b.y >= y - hh - b.r && b.y <= y + hh + b.r) {
        dmg += b.dmg;
        if (cb) cb(b, x, y);
        if (b.pierce > 0) b.pierce--;
        else this._kill(i);
      }
    }
    return dmg;
  }

  /** 清屏（玩家阵亡 / 核弹），只清除距离内的 */
  clearNear(x, y, r) {
    const arr = this.bullets;
    const r2 = r * r;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      const dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy <= r2) this._kill(i);
    }
  }

  clearAll() {
    while (this.bullets.length) this._kill(this.bullets.length - 1);
  }

  dispose() {
    this.geo.dispose();
    this.core.material.dispose();
    this.glow.material.dispose();
  }
}

/* ================================================================== *
 * 激光
 * ================================================================== */
export class LaserSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} SPR
   */
  constructor(scene, SPR, maxBeams = 5) {
    this.maxBeams = maxBeams;
    this.beams = [];
    this.active = false;
    this.time = 0;

    this.coreMap = SPR.beam.clone();
    this.coreMap.needsUpdate = true;
    this.coreMap.wrapS = this.coreMap.wrapT = THREE.RepeatWrapping;
    this.coreMap.repeat.set(1, 1);
    this.coreMap.colorSpace = THREE.SRGBColorSpace;

    const haloMap = SPR.beamHalo.clone();
    haloMap.needsUpdate = true;
    haloMap.wrapS = haloMap.wrapT = THREE.RepeatWrapping;
    haloMap.colorSpace = THREE.SRGBColorSpace;

    this.group = new THREE.Group();
    scene.add(this.group);

    const geo = new THREE.PlaneGeometry(1, 1);
    this.geo = geo;

    this.coreMat = new THREE.MeshBasicMaterial({
      map: this.coreMap, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: new THREE.Color(1, 1, 1), opacity: 1,
    });
    this.haloMat = new THREE.MeshBasicMaterial({
      map: haloMap, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: new THREE.Color(1, 1, 1), opacity: 0.48,
    });
    /* 发射点用"软圆光"而不是四芒星闪光 —— 星芒横向的两条臂在多道激光并排时
     * 会连成一根横贯自机的白杆，看起来像机翼而不是光效。 */
    this.emitMat = new THREE.MeshBasicMaterial({
      map: SPR.glow, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: new THREE.Color(1, 1, 1), opacity: 0.62,
    });

    this.parts = [];
    for (let i = 0; i < maxBeams; i++) {
      const core = new THREE.Mesh(geo, this.coreMat);
      const halo = new THREE.Mesh(geo, this.haloMat);
      const emit = new THREE.Mesh(geo, this.emitMat);
      core.position.z = LAYER.laser + 0.2;
      halo.position.z = LAYER.laser + 0.1;
      emit.position.z = LAYER.laser + 0.3;
      core.renderOrder = LAYER.laser + 20;
      halo.renderOrder = LAYER.laser + 19;
      emit.renderOrder = LAYER.laser + 21;
      for (const m of [core, halo, emit]) { m.visible = false; this.group.add(m); }
      this.parts.push({ core, halo, emit });
    }
  }

  /**
   * 配置光束（由 player 每帧调用）
   * @param {Array<{x:number, width:number, dps:number, tint:THREE.Color}>} list
   */
  set(list) {
    this.time += 0;
    const n = Math.min(list.length, this.maxBeams);
    this.active = n > 0;
    const H = WORLD.VIEW_H + 24;
    for (let i = 0; i < this.maxBeams; i++) {
      const p = this.parts[i];
      if (i >= n) {
        p.core.visible = p.halo.visible = p.emit.visible = false;
        continue;
      }
      const b = list[i];
      const cy = b.y + H * 0.5 - 1.0;
      p.core.visible = p.halo.visible = p.emit.visible = true;
      /* 层次设计：亮芯窄 → 外晕中 → 发射点小。
       * 三者都放大就会在自机上方糊成一片白，机体与弹道都看不清；
       * 「光效增强」靠的是亮度与 Bloom，不是覆盖面积。 */
      p.core.position.set(b.x, cy, p.core.position.z);
      p.core.scale.set(Math.max(0.06, b.width * 0.40), H, 1);
      p.halo.position.set(b.x, cy, p.halo.position.z);
      p.halo.scale.set(b.width * 1.55, H * 1.005, 1);
      p.emit.position.set(b.x, b.y + 0.35, p.emit.position.z);
      p.emit.scale.set(b.width * 1.20, b.width * 0.95, 1);
    }
    this.beams = list.slice(0, n);
    // 颜色取第一道（同为青色系激光，视觉统一）
    if (n > 0) {
      const c = list[0].tint;
      this.coreMat.color.setRGB(c.r * 1.0, c.g * 2.05, c.b * 2.10);
      this.haloMat.color.setRGB(c.r * 0.75, c.g * 1.15, c.b * 1.20);
      this.emitMat.color.setRGB(c.r * 1.30, c.g * 2.20, c.b * 2.30);
    }
  }

  update(dt) {
    this.time += dt;
    // 光束沿长度方向高速流动 + 呼吸
    this.coreMap.offset.y -= dt * 3.4;
    if (this.coreMap.offset.y < -1) this.coreMap.offset.y += 1;
    if (this.active) {
      const pulse = 0.90 + 0.10 * Math.sin(this.time * 34) + 0.05 * Math.sin(this.time * 71);
      this.coreMat.opacity = clamp(pulse, 0, 1.2);
      this.haloMat.opacity = 0.40 + 0.12 * Math.sin(this.time * 21);
      this.emitMat.opacity = 0.58 + 0.12 * Math.sin(this.time * 44);
    }
  }

  hide() {
    this.active = false;
    this.beams = [];
    for (const p of this.parts) p.core.visible = p.halo.visible = p.emit.visible = false;
  }

  /**
   * 激光命中判定：竖直线段（宽度 width，顶端一直延伸到屏幕上沿）与圆
   * @returns {number} 总伤害
   */
  hitCircle(x, y, r, dpsToDamage, cb) {
    if (!this.active) return 0;
    let dmg = 0;
    for (const b of this.beams) {
      if (y > b.y) continue;                              // 目标在光束起点之上
      const half = b.width * 0.5;
      if (Math.abs(x - b.x) <= half + r) {
        const d = b.dps * dpsToDamage;
        dmg += d;
        cb && cb(b, x, y, d);
      }
    }
    return dmg;
  }

  dispose() {
    this.geo.dispose();
    this.coreMat.dispose();
    this.haloMat.dispose();
    this.emitMat.dispose();
  }
}

/* ================================================================== *
 * 工具
 * ================================================================== */
export const C = {
  /** 圆-圆 */
  circle: (ax, ay, ar, bx, by, br) => {
    const dx = ax - bx, dy = ay - by;
    const r = ar + br;
    return dx * dx + dy * dy <= r * r;
  },
};

/** 由角度与速度构造速度分量 */
export function polar(speed, angle) {
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

/** 朝玩家瞄准的角度（自机在上方时用 -PI/2 为直上） */
export function aimAt(x, y, tx, ty) {
  return Math.atan2(ty - y, tx - x);
}

export { _c as tmpColor, rand };

/**
 * powerups.js — 掉落物
 *
 * 掉落表由 config.POWERUPS 的权重决定，新增武器/资源：
 *   laser  激光   shield 护盾   life 生命
 * 护盾与生命除随机掉落外，还有「保底」投放（见 config.GUARANTEED_DROPS）：
 * 每关开局送一次护盾，BOSS 前送修复，BOSS 后送一命，保证这两种资源稳定出现。
 *
 * 手感：靠近时会被自机吸过来（磁吸半径 MAGNET_R），因此不需要精确走位去捡。
 *       掉落物从上方落下、进入磁吸圈后被快速拉向自机 —— 护盾/生命这类关键资源
 *       不会因为"刚好没接住"而白掉，这是「护盾、生命掉落」能真正产生作用的保证。
 */
import * as THREE from '../vendor/three/three.module.js';
import { POWERUPS, LAYER, WORLD } from './config.js';
import { rand, clamp, TAU } from './util.js';

const _c = new THREE.Color();
const HALF_H = WORLD.VIEW_H / 2;

/** 磁吸半径（世界单位）/ 磁吸加速度 */
const MAGNET_R = 4.2;
const MAGNET_ACC = 58;

/** 可随机掉落的类型 + 权重 */
const DROP_TABLE = Object.values(POWERUPS)
  .filter((p) => p.weight > 0)
  .map((p) => ({ id: p.id, w: p.weight }));
const TOTAL_W = DROP_TABLE.reduce((s, d) => s + d.w, 0);

export function rollDropType() {
  let r = Math.random() * TOTAL_W;
  for (const d of DROP_TABLE) {
    r -= d.w;
    if (r <= 0) return d.id;
  }
  return 'power';
}

class Pickup {
  constructor() {
    this.alive = false;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.t = 0;
    this.life = 15;
    this.type = 'power';
    this.magnet = false;
  }
}

export class PickupManager {
  constructor(scene, SPR, effects) {
    this.SPR = SPR;
    this.effects = effects;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.list = [];
    this.pool = [];
    this.geo = new THREE.PlaneGeometry(1, 1);
  }

  get count() {
    return this.list.length;
  }

  /**
   * @param {string} type POWERUPS 的键
   */
  spawn(type, x, y, opts = {}) {
    const def = POWERUPS[type] || POWERUPS.score;
    const p = this.pool.pop() || new Pickup();
    p.alive = true;
    p.type = type;
    p.def = def;
    p.x = clamp(x, -WORLD.boundX - 1, WORLD.boundX + 1);
    p.y = clamp(y, -HALF_H + 1, HALF_H + 1);
    p.vx = opts.vx ?? rand(-0.9, 0.9);
    p.vy = opts.vy ?? rand(-2.6, -1.3);
    p.t = 0;
    p.life = def.id === 'life' ? 20 : 15;
    p.magnet = false;
    p.collected = false;

    const col = _c.setHex(def.color);
    p.color = col.clone();

    const g = new THREE.Group();
    g.position.set(p.x, p.y, LAYER.pickup);

    /* 底色 = 类型色的实心胶囊（NormalBlending）。
     * 之前底色是纯白，叠加层再把颜色加进去，结果整体被冲成灰白 ——
     * 弹幕游戏里"一眼看出这是什么道具"是硬需求，所以让底色直接承担色相，
     * 辉光层负责亮度，字符层用近白色保证可读性。 */
    const capsule = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      map: this.SPR.capsule, transparent: true, depthWrite: false,
      color: new THREE.Color(col.r, col.g, col.b),
    }));
    capsule.scale.set(1.36, 1.36, 1);
    capsule.renderOrder = LAYER.pickup + 30;

    const tint = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      map: this.SPR.capsule, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.70,
      color: new THREE.Color(col.r * 1.15, col.g * 1.15, col.b * 1.15),
    }));
    tint.scale.set(1.36, 1.36, 1);
    tint.renderOrder = LAYER.pickup + 29;

    const glyph = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      map: this.SPR.glyphs[type] || this.SPR.glyphs.score,
      transparent: true, depthWrite: false,
      color: new THREE.Color(1.25, 1.25, 1.25),
    }));
    glyph.scale.set(0.92, 0.92, 1);
    glyph.position.z = 0.12;
    glyph.renderOrder = LAYER.pickup + 32;

    const aura = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      map: this.SPR.glow, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.55,
      color: new THREE.Color(col.r * 1.7, col.g * 1.7, col.b * 1.7),
    }));
    aura.position.z = -0.1;
    aura.scale.set(3.0, 3.0, 1);
    aura.renderOrder = LAYER.pickup + 28;

    g.add(aura); g.add(tint); g.add(capsule); g.add(glyph);
    p.group = g;
    p.aura = aura;
    p.glyph = glyph;
    p.spin = def.id === 'score' ? 2.4 : 1.5;
    this.group.add(g);
    this.list.push(p);
    return p;
  }

  /** 当前场上是否有某类型（用于保底不重复投放） */
  hasType(type) {
    for (const p of this.list) if (p.alive && p.type === type) return true;
    return false;
  }

  _kill(i, collected) {
    const p = this.list[i];
    const last = this.list.pop();
    if (i < this.list.length) this.list[i] = last;
    p.alive = false;
    this.group.remove(p.group);
    for (const m of p.group.children) m.material.dispose();
    p.group = null;
    this.pool.push(p);
    p.collected = collected;
  }

  update(dt, ctx) {
    const px = ctx.player.pos.x, py = ctx.player.pos.y;
    const canCollect = !ctx.player.dead;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      const dx = px - p.x, dy = py - p.y;
      const d = Math.hypot(dx, dy);

      /* 磁吸 */
      if (canCollect && d < MAGNET_R) {
        p.magnet = true;
        const k = clamp((MAGNET_R - d) / MAGNET_R, 0, 1);
        p.vx += (dx / Math.max(d, 1e-4)) * MAGNET_ACC * (0.35 + k * 0.65) * dt;
        p.vy += (dy / Math.max(d, 1e-4)) * MAGNET_ACC * (0.35 + k * 0.65) * dt;
      } else {
        // 自然下落 + 阻尼
        p.vx *= Math.exp(-1.4 * dt);
        p.vy = Math.max(-5.0, p.vy - 3.2 * dt);
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < -WORLD.boundX - 1.6) { p.x = -WORLD.boundX - 1.6; p.vx = Math.abs(p.vx); }
      if (p.x > WORLD.boundX + 1.6) { p.x = WORLD.boundX + 1.6; p.vx = -Math.abs(p.vx); }

      /* 拾取判定 */
      const pr = 0.85 + ctx.player.hitRadius;
      if (canCollect && d <= pr) {
        ctx.onPickup && ctx.onPickup(p);
        this._kill(i, true);
        continue;
      }

      /* 超时消失 */
      if (p.t >= p.life || p.y < -HALF_H - 2.5) {
        this._kill(i, false);
        continue;
      }

      /* 视觉 */
      p.group.position.set(p.x, p.y, LAYER.pickup);
      p.group.rotation.z = Math.sin(p.t * 1.9) * 0.22;
      const blink = p.t > p.life - 3.2 ? ((p.t * 7) % 2 < 1 ? 1 : 0.25) : 1;
      const pulse = 1 + Math.sin(p.t * 5.2) * 0.07;
      p.aura.scale.setScalar((p.magnet ? 3.6 : 3.0) * pulse);
      p.glyph.rotation.z = p.t * p.spin;
      p.group.children.forEach((m) => { m.material.opacity = m.material.blending === THREE.AdditiveBlending ? 0.62 * blink : blink; });
      p.aura.material.opacity = (p.magnet ? 0.85 : 0.55) * blink;
    }
  }

  clear() {
    while (this.list.length) this._kill(this.list.length - 1, false);
  }

  dispose() {
    this.clear();
    this.geo.dispose();
  }
}

export { TAU, rand };

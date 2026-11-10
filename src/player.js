/**
 * player.js — 自机 / 武器系统
 *
 * 武器（全部可无限叠加）：
 *   power   主炮     —— 提升射速 / 伤害 / 炮口数
 *   spread  散射     —— 增加分叉角的多发弹
 *   missile 导弹     —— 自动跟踪的齐射
 *   drone   僚机     —— 环绕射击
 *   laser   激光     —— 【新增】持续光束，每 3 级 +1 道光束，宽度与 DPS 随叠加提升
 *   shield  护盾     —— 每一层抵挡一次伤害
 *   life    生命     —— 【新增】+1 机体
 *   repair  修复     —— 回复装甲
 *   bomb    核弹     —— 清屏
 *
 * 手感：小判定点（0.30）、聚焦模式（半速 + 显示判定点）、开火带轻微后坐震屏。
 */
import * as THREE from '../vendor/three/three.module.js';
import { WEAPON, WORLD, LAYER, POWERUPS } from './config.js';
import { clamp, damp, TAU, rand } from './util.js';

const BX = WORLD.boundX;
const BY = WORLD.boundY;

const _col = new THREE.Color();

export class Player {
  constructor(scene, SPR, effects) {
    this.SPR = SPR;
    this.effects = effects;

    this.group = new THREE.Group();
    this.group.position.set(0, WORLD.playerY, LAYER.player);
    scene.add(this.group);

    const mkPlane = (tex, w, h, z, color, blending, opacity = 1) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          map: tex, transparent: true, depthWrite: false, opacity,
          blending: blending || THREE.NormalBlending, color: new THREE.Color(color || 1),
        })
      );
      m.position.z = z;
      m.renderOrder = 60;
      this.group.add(m);
      return m;
    };

    /* ---------- 机体 ---------- */
    this.hull = mkPlane(SPR.player, 1.74, 1.74, 0, 0xffffff, THREE.NormalBlending);

    /* ---------- 舱盖 / 翼灯发光层（轻微 HDR，带一点点 Bloom） ---------- */
    this.hullGlow = mkPlane(SPR.soft, 1.20, 1.20, 0.06, 0x6fe8ff, THREE.AdditiveBlending, 0.20);

    /* ---------- 引擎尾焰 ---------- */
    this.flames = [];
    for (const sx of [-1, 1]) {
      const f = mkPlane(SPR.flame, 0.40, 1.02, -0.30, 0x7fe8ff, THREE.AdditiveBlending, 0.95);
      f.position.x = sx * 0.235;
      f.position.y = -0.90;
      f.material.color.setRGB(0.42, 1.10, 1.55);
      this.flames.push(f);
    }
    this.flameGlow = mkPlane(SPR.glow, 0.85, 0.85, -0.34, 0x54d8ff, THREE.AdditiveBlending, 0.42);
    this.flameGlow.position.y = -1.02;
    this.flameGlow.material.color.setRGB(0.38, 1.10, 1.62);

    /* ---------- 护盾泡 ---------- */
    this.shieldMesh = mkPlane(SPR.shield, 3.05, 3.05, 0.5, 0x4dffa0, THREE.AdditiveBlending, 0);
    this.shieldMesh.material.color.setRGB(0.34, 1.32, 0.88);

    /* ---------- 判定点（聚焦时可见） ---------- */
    this.hitDot = mkPlane(SPR.glow, 0.30, 0.30, 0.6, 0xffe0a0, THREE.AdditiveBlending, 0);
    this.hitDot.material.color.setRGB(2.8, 2.1, 1.05);
    this.hitRing = mkPlane(SPR.ring, 0.60, 0.60, 0.58, 0xff5a7a, THREE.AdditiveBlending, 0);
    this.hitRing.material.color.setRGB(2.4, 0.65, 0.85);

    /* ---------- 僚机 ---------- */
    this.drones = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.PlaneGeometry(0.44, 0.44),
        new THREE.MeshBasicMaterial({
          map: SPR.glyphs.drone, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, color: new THREE.Color(0.75, 0.45, 1.7),
        })
      );
      core.renderOrder = 61;
      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.9),
        new THREE.MeshBasicMaterial({
          map: SPR.glow, transparent: true, depthWrite: false, opacity: 0.85,
          blending: THREE.AdditiveBlending, color: new THREE.Color(0.5, 0.32, 1.3),
        })
      );
      halo.renderOrder = 60;
      g.add(halo); g.add(core);
      g.visible = false;
      g.userData = { fireT: rand(0, 0.3), ang: (i / 6) * TAU };
      this.group.add(g);
      this.drones.push(g);
    }

    /* ---------- 状态 ---------- */
    this.vel = new THREE.Vector2();
    this.pos = new THREE.Vector2(0, WORLD.playerY);
    this.levels = { power: 1, spread: 0, missile: 0, drone: 0, laser: 0, shield: 0, bomb: 2 };
    this.hp = 100;
    this.maxHp = 100;
    this.shields = 0;
    this.lives = 3;
    this.invuln = 0;
    this.dead = false;
    this.bombs = 2;
    this.dps = 0;
    this.hitRadius = 0.30;
    this.focus = false;
    this.firing = true;
    this.recoil = 0;
    this.shakeT = 0;
    this.flashT = 0;
    this._t = 0;
    this._laserWasOn = false;
    this._beamList = [];
    this.muzzleT = 0;
    this.alive = true;
    this.bombFlashT = 0;
    this.recalc();
  }

  /* ------------------------------------------------------------------ */
  get position() {
    return this.group.position;
  }

  reset(diff) {
    this.diff = diff;
    this.maxHp = diff.playerHp;
    this.hp = diff.playerHp;
    this.lives = diff.playerLives;
    this.shields = 0;
    this.bombs = 2;
    this.levels = { power: 1, spread: 0, missile: 0, drone: 0, laser: 0, shield: 0, bomb: 2 };
    this.invuln = 1.2;
    this.dead = false;
    this.alive = true;
    this.group.position.set(0, WORLD.playerY, LAYER.player);
    this.pos.set(0, WORLD.playerY);
    this.vel.set(0, 0);
    this.group.visible = true;
    this._laserWasOn = false;
    this.recalc();
  }

  /** 把机体移出视野（保留在场景中，避免可见性切换带来的开销） */
  park() {
    this.group.position.set(0, -400, LAYER.player);
    this.vel.set(0, 0);
    this.dead = true;
  }

  unpark() {
    this.group.position.set(0, WORLD.playerY, LAYER.player);
    this.pos.set(0, WORLD.playerY);
    this.dead = false;
  }

  /* ------------------------------------------------------------------ *
   * 强化
   * ------------------------------------------------------------------ */
  /** 重新计算所有派生数值 */
  recalc() {
    const L = this.levels;
    const p = L.power;
    this.cannonInterval = Math.max(WEAPON.minInterval, WEAPON.baseInterval - WEAPON.intervalPerPower * (p - 1));
    this.cannonDamage = WEAPON.baseDamage * (1 + WEAPON.damageScalePerPower * (p - 1));
    this.barrels = Math.min(WEAPON.maxVisualBarrels, 1 + Math.floor(p / WEAPON.barrelsPerTwoPower));

    // 散射
    this.spreadShots = Math.min(10, L.spread);
    this.spreadAngle = Math.min(WEAPON.spreadMaxAngle, WEAPON.spreadAngle * Math.max(1, L.spread));
    this.spreadBonus = L.spread > 10 ? 1 + (L.spread - 10) * 0.06 : 1;

    // 导弹
    this.missileCount = L.missile > 0 ? Math.min(8, 1 + Math.floor((L.missile - 1) / 2)) : 0;
    this.missileDamage = WEAPON.missileDamage * (1 + Math.max(0, L.missile - 1) * 0.14);

    // 僚机
    this.droneCount = Math.min(6, L.drone);
    this.droneDamage = WEAPON.droneDamage * (1 + Math.max(0, L.drone - 1) * 0.12);

    // 激光
    const n = L.laser;
    this.laserBeams = n > 0 ? Math.min(WEAPON.laser.maxBeams, 1 + Math.floor((n - 1) / WEAPON.laser.stacksPerBeam)) : 0;
    this.laserWidth = Math.min(WEAPON.laser.widthMax, WEAPON.laser.widthBase + WEAPON.laser.widthPerStack * Math.max(0, n - 1));
    this.laserDps = n > 0 ? WEAPON.laser.dpsBase + WEAPON.laser.dpsPerStack * (n - 1) : 0;

    // 综合 DPS 估算（HUD 显示）
    const cannon = this.barrels * (this.cannonDamage * this.spreadBonus) / this.cannonInterval;
    const spread = this.spreadShots * this.cannonDamage * 0.75 / this.cannonInterval;
    const mis = this.missileCount * this.missileDamage / WEAPON.missileInterval;
    const drone = this.droneCount * this.droneDamage / WEAPON.droneFireInterval;
    this.dps = cannon + spread + mis + drone + this.laserDps * this.laserBeams;

    // 护盾视觉
    const sh = Math.min(4, L.shield);
    this.shieldMesh.visible = sh > 0;
    this.shieldTargetOp = sh > 0 ? 0.18 + sh * 0.10 : 0;
  }

  /**
   * 拾取一个强化模块
   *
   * 5 项武器强化（火力/散射/导弹/僚机/激光）受 POWERUPS[].maxLevel 约束，
   * 已达上限时**不再递增**，并通过返回值的 maxed 标记让上层给出"已满级"提示。
   * 护盾 / 核弹 / 生命属于消耗品，无上限。
   *
   * @returns {{def:object, maxed:boolean}|null}
   */
  applyPowerup(type) {
    const def = POWERUPS[type];
    if (!def) return null;
    const L = this.levels;
    const cap = def.maxLevel;
    // 已达上限：什么都不加，但照样返回 def 供上层提示
    const capped = cap != null && (L[type] ?? 0) >= cap;
    if (capped) return { def, maxed: true };

    switch (type) {
      case 'power': L.power++; break;
      case 'spread': L.spread++; break;
      case 'missile': L.missile++; break;
      case 'drone': L.drone++; break;
      case 'laser': L.laser++; break;
      case 'shield': L.shield++; this.shields = L.shield; break;
      case 'repair': this.hp = Math.min(this.maxHp, this.hp + 26); break;
      case 'life': this.lives++; break;
      case 'bomb': L.bomb++; this.bombs = L.bomb; break;
      case 'score': break;
      default: break;
    }
    this.recalc();
    return { def, maxed: false };
  }

  /** 该强化是否已达叠加上限 */
  isMaxed(type) {
    const def = POWERUPS[type];
    if (!def || def.maxLevel == null) return false;
    return (this.levels[type] ?? 0) >= def.maxLevel;
  }

  /* ------------------------------------------------------------------ *
   * 受伤 / 阵亡
   * ------------------------------------------------------------------ */
  /**
   * @returns {'none'|'shield'|'hit'|'dead'}
   */
  damage(amount) {
    if (this.dead || this.invuln > 0) return 'none';
    if (this.shields > 0) {
      this.shields--;
      this.levels.shield = Math.max(0, this.levels.shield - 1);
      this.invuln = 0.85;
      this.recalc();
      this.effects.shockwave(this.group.position.x, this.group.position.y, {
        life: 0.42, s0: 0.5, s1: 6.4, r: 0.5, g: 2.4, b: 1.5,
      });
      return 'shield';
    }
    this.hp -= amount;
    this.invuln = 0.55;
    if (this.hp <= 0) {
      this.hp = 0;
      return 'dead';
    }
    return 'hit';
  }

  /** 阵亡：返回是否彻底失败（机体耗尽） */
  kill() {
    this.lives--;
    this.dead = true;
    this.vel.set(0, 0);
    if (this.lives <= 0) {
      this.group.visible = false;
      return true;
    }
    return false;
  }

  /**
   * 光束类持续伤害：不吃无敌帧（否则扫射光束几乎无效），
   * 但护盾仍然会抵挡（抵挡时给一段无敌，避免同一道光束连续吃盾）。
   */
  beamDamage(amount) {
    if (this.dead || this.invuln > 0) return 'none';
    if (this.shields > 0) return this.damage(amount);
    this.hp -= amount;
    this.flashT = 0.14;
    if (this.hp <= 0) { this.hp = 0; return 'dead'; }
    return 'hit';
  }

  respawn(diff) {
    this.hp = this.maxHp;
    this.dead = false;
    this.invuln = diff.invulnTime;
    this.group.visible = true;
    this.group.position.set(0, WORLD.playerY, LAYER.player);
    this.pos.set(0, WORLD.playerY);
    this.vel.set(0, 0);
  }

  /**
   * 核弹：返回本次的爆炸半径以清屏
   */
  useBomb() {
    if (this.bombs <= 0 || this.dead) return false;
    this.bombs--;
    this.levels.bomb = Math.max(0, this.levels.bomb - 1);
    this.invuln = Math.max(this.invuln, 1.4);
    this.bombFlashT = 0.9;
    const x = this.group.position.x, y = this.group.position.y + 3;
    this.effects.shockwave(x, y, { life: 1.05, s0: 0.8, s1: 44, r: 3.4, g: 3.4, b: 3.4, a0: 1 });
    this.effects.shockwave(x, y, { life: 0.8, s0: 0.4, s1: 30, r: 1.4, g: 2.6, b: 3.4, a0: 1 });
    for (let i = 0; i < 22; i++) {
      const a = rand(0, TAU), d = rand(1, 9);
      this.effects.explosion(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, {
        size: rand(0.8, 1.8), color: _col.setRGB(0.7, 0.9, 1.0),
      });
    }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 每帧
   * ------------------------------------------------------------------ */
  update(dt, ctx) {
    this._t += dt;
    const g = this.group;

    if (this.dead) {
      this._updateVisual(dt, true);
      if (this._laserWasOn) { ctx.audio.laserStop(); this._laserWasOn = false; }
      return;
    }

    /* ---------- 移动 ---------- */
    this.focus = ctx.input.focus;
    const spd = (this.focus ? 6.4 : 13.2);
    let ax = 0, ay = 0;

    if (ctx.input.mode === 'pointer' && ctx.input.pointer.active && ctx.pointerControl) {
      // 指针跟随：目标点抬高，避免手指遮住机体
      const t = ctx.pointerTarget;
      const k = this.focus ? 12 : 20;
      const nx = damp(this.pos.x, t.x, k, dt);
      const ny = damp(this.pos.y, t.y, k, dt);
      this.pos.set(nx, ny);
      this.vel.set((nx - g.position.x) / Math.max(dt, 1e-4), (ny - g.position.y) / Math.max(dt, 1e-4));
    } else {
      ax = ctx.input.move.x;
      ay = ctx.input.move.y;
      const len = Math.hypot(ax, ay);
      if (len > 1) { ax /= len; ay /= len; }
      const accel = 92;
      this.vel.x = damp(this.vel.x, ax * spd, accel / spd * 0.9, dt);
      this.vel.y = damp(this.vel.y, ay * spd, accel / spd * 0.9, dt);
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;
    }

    this.pos.x = clamp(this.pos.x, -BX, BX);
    this.pos.y = clamp(this.pos.y, -BY + 1.0, BY * 0.30);

    g.position.x = this.pos.x;
    g.position.y = this.pos.y;
    g.rotation.z = damp(g.rotation.z, -this.vel.x * 0.018, 9, dt);
    // 轻微倾斜/侧滑让机体"有重量"
    this.hull.position.x = damp(this.hull.position.x, -this.vel.x * 0.012, 8, dt);

    /* ---------- 无敌闪烁 ---------- */
    if (this.invuln > 0) {
      this.invuln -= dt;
      const on = (this.invuln * 22) % 2 < 1;
      this.hull.material.opacity = on ? 1 : 0.32;
      this.hullGlow.material.opacity = on ? 0.20 : 0.05;
    } else {
      this.hull.material.opacity = 1;
      this.hullGlow.material.opacity = 0.20;
    }

    /* ---------- 开火 ---------- */
    this._warmup = Math.min(1, (this._warmup || 0) + dt * 3);
    if (this.firing) {
      this._fireGuns(dt, ctx);
      this._fireMissiles(dt, ctx);
      this._fireDrones(dt, ctx);
      this._updateLaser(dt, ctx);
    } else {
      this._updateLaser(dt, ctx, true);
    }

    /* ---------- 拾取半径内的轻微牵引（手感） ---------- */
    this._updateVisual(dt, false);
  }

  /* ------------------------------------------------------------------ */
  _fireGuns(dt, ctx) {
    this._cannonT = (this._cannonT || 0) - dt;
    if (this._cannonT > 0) return;
    const interval = this.cannonInterval;
    this._cannonT += interval;
    if (this._cannonT < -interval * 2) this._cannonT = 0;

    const bulletSpeed = WEAPON.bulletSpeed;
    const dmg = this.cannonDamage * this.spreadBonus;
    const barrels = this.barrels;
    const spreadN = this.spreadShots;
    const sh = ctx.shake;

    for (let i = 0; i < barrels; i++) {
      /* 炮口间距：太窄会让 5~7 路弹道的辉光互相重叠，在自机上方拼成一整条
       * 白色光柱（满配时尤其明显，会把机体完全糊住）。留出间隔后每条弹道才
       * 是"一束独立的光弹"，视觉上更利落，也更容易看清弹幕。 */
      const off = (i - (barrels - 1) / 2) * 0.40 * (1 + barrels * 0.06);
      const x = this.pos.x + off * 1.5;
      const y = this.pos.y + 0.80;
      ctx.pbul.fire({
        x, y, vx: 0, vy: bulletSpeed, r: WEAPON.bulletRadius,
        dmg: dmg / 1.0, life: 1.4,
        w: 0.22, h: 0.68, gw: 0.52, gh: 1.55,
        cr: 1.85, cg: 2.15, cb: 2.80,
        gr: 0.26, gg: 0.85, gb: 1.55,
        aim: false,
      });
    }
    // 分叉弹（避免每发都分配数组）
    if (spreadN > 0) {
      const sides = Math.ceil(spreadN / 2);
      const twoSided = spreadN >= 2;
      for (let s = 1; s <= sides; s++) {
        const ang = Math.min(WEAPON.spreadMaxAngle, this.spreadAngle * (s / sides));
        const aL = -Math.PI / 2 - ang;
        const aR = -Math.PI / 2 + ang;
        const vxL = Math.cos(aL) * bulletSpeed * 0.94, vyL = Math.sin(aL) * bulletSpeed * 0.94;
        const vxR = Math.cos(aR) * bulletSpeed * 0.94, vyR = Math.sin(aR) * bulletSpeed * 0.94;
        const sd = this.cannonDamage * 0.72;
        if (twoSided) {
          ctx.pbul.fire({
            x: this.pos.x - 0.55, y: this.pos.y + 0.45, vx: vxL, vy: vyL,
            r: WEAPON.bulletRadius * 0.95, dmg: sd, life: 1.4,
            w: 0.20, h: 0.56, gw: 0.46, gh: 1.30,
            cr: 1.70, cg: 2.15, cb: 2.70, gr: 0.26, gg: 0.85, gb: 1.55, aim: true,
          });
        }
        ctx.pbul.fire({
          x: this.pos.x + 0.55, y: this.pos.y + 0.45, vx: vxR, vy: vyR,
          r: WEAPON.bulletRadius * 0.95, dmg: sd, life: 1.4,
          w: 0.20, h: 0.56, gw: 0.46, gh: 1.30,
          cr: 1.70, cg: 2.15, cb: 2.70, gr: 0.26, gg: 0.85, gb: 1.55, aim: true,
        });
      }
    }

    /* ---- 枪口光效（射击光效增强的关键） ----
     * 沿炮口方向（竖直）拉伸：横向拉长会变成两块"白色机翼"，反而干扰对机体的识别。 */
    this.muzzleT -= dt;
    const heavy = Math.min(1, barrels / 7);
    this.effects.muzzle(this.pos.x, this.pos.y + 0.92, {
      size: 0.42 + heavy * 0.24,
      sx: 0.68 + heavy * 0.16, sy: 1.45 + heavy * 0.60,
      r: 2.40, g: 2.30, b: 2.90, life: 0.070,
    });
    if (this.levels.laser > 0) {
      this.effects.puff('glow', this.pos.x, this.pos.y + 0.7, {
        life: 0.13, s0: 0.42, s1: 0.72, r: 0.35, g: 1.35, b: 1.50, a0: 0.35, a1: 0, drag: 3,
      });
    }
    sh.add(0.0035 + heavy * 0.003);
    ctx.audio.shoot(this.levels.power);
    // 炮口后坐
    this.recoil = Math.min(0.14, this.recoil + 0.05);
  }

  _fireMissiles(dt, ctx) {
    if (this.missileCount <= 0) return;
    this._misT = (this._misT || 0) - dt;
    if (this._misT > 0) return;
    this._misT += WEAPON.missileInterval;
    const n = this.missileCount;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const tier = Math.floor(i / 2);
      const a = -Math.PI / 2 + side * (0.55 + tier * 0.34);
      const b = ctx.pbul.fire({
        x: this.pos.x + side * (0.85 + tier * 0.18),
        y: this.pos.y - 0.25,
        vx: Math.cos(a) * WEAPON.missileSpeed * 0.62,
        vy: Math.sin(a) * WEAPON.missileSpeed * 0.62,
        r: 0.30, dmg: this.missileDamage, life: 2.6,
        w: 0.44, h: 0.56, gw: 1.30, gh: 1.50,
        cr: 2.30, cg: 1.50, cb: 1.30,
        gr: 1.50, gg: 0.35, gb: 0.45,
        aim: true, kind: 1,
      });
      if (b) { b.homing = WEAPON.missileTurn; b.hspeed = WEAPON.missileSpeed; b.smokeT = 0; }
    }
    this.effects.puff('glow', this.pos.x, this.pos.y - 0.3, {
      life: 0.18, s0: 0.5, s1: 0.2, r: 2.2, g: 0.7, b: 0.8, a0: 0.8, a1: 0, drag: 3,
    });
  }

  _fireDrones(dt, ctx) {
    const n = this.droneCount;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (i >= n) { d.visible = false; continue; }
      d.visible = true;
      const u = d.userData;
      u.ang += dt * 1.35;
      const R = WEAPON.droneOrbitR;
      d.position.set(Math.cos(u.ang + (i / Math.max(1, n)) * TAU) * R * 1.05,
        Math.sin(u.ang + (i / Math.max(1, n)) * TAU) * R * 0.52 + 0.15, 0.2);
      d.rotation.z = -u.ang * 1.6;
      const sc = 1 + Math.sin(this._t * 6 + i) * 0.08;
      d.scale.set(sc, sc, 1);

      u.fireT -= dt;
      if (u.fireT <= 0) {
        u.fireT += WEAPON.droneFireInterval;
        const wx = this.pos.x + d.position.x;
        const wy = this.pos.y + d.position.y;
        ctx.pbul.fire({
          x: wx, y: wy, vx: 0, vy: WEAPON.bulletSpeed * 0.9, r: 0.20,
          dmg: this.droneDamage, life: 1.3,
          w: 0.20, h: 0.52, gw: 0.56, gh: 1.70,
          cr: 1.90, cg: 1.45, cb: 2.50,
          gr: 0.72, gg: 0.44, gb: 1.55, aim: false,
        });
      }
    }
  }

  /** 每帧重建激光束列表并驱动音效 */
  _updateLaser(dt, ctx, forceOff) {
    const n = forceOff ? 0 : this.laserBeams;
    if (n <= 0) {
      if (this._laserWasOn) { ctx.audio.laserStop(); this._laserWasOn = false; }
      ctx.lasers.hide();
      return;
    }
    const list = this._beamList;
    list.length = 0;
    const tint = _col.setRGB(0.24, 1.0, 0.95);
    if (n === 1) {
      list.push({ x: this.pos.x, y: this.pos.y + 1.0, width: this.laserWidth, dps: this.laserDps, tint });
    } else {
      // 多道激光：均匀铺开。间距要略大于光束宽度，否则多道会糊成一片，
      // 叠加强化的"更多道光束"就看不出来了。
      const span = Math.min(BX * 1.35, 1.15 + n * 0.85);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        list.push({
          x: this.pos.x + (t - 0.5) * span,
          y: this.pos.y + 1.0,
          width: this.laserWidth,
          dps: this.laserDps,
          tint,
        });
      }
    }
    ctx.lasers.set(list);
    if (!this._laserWasOn) {
      ctx.audio.laserStart();
      ctx.audio.laserCharge(0.5);
      this._laserWasOn = true;
    }
    ctx.audio.laserSet(Math.min(1, (this.levels.laser - 1) / 12 + 0.25));
    // 光束起点的额外光效
    if (Math.random() < 0.5) {
      const b = list[(Math.random() * list.length) | 0];
      this.effects.puff('spark', b.x + rand(-0.2, 0.2), this.pos.y + 1.2, {
        life: 0.14, s0: 0.14, s1: 0.02, r: 1.20, g: 2.40, b: 2.30, a0: 0.70, a1: 0, drag: 2,
      });
    }
  }

  /* ------------------------------------------------------------------ */
  _updateVisual(dt, dying) {
    // 尾焰
    const thrust = clamp(Math.hypot(this.vel.x, this.vel.y) / 13, 0, 1);
    const flick = 0.82 + 0.18 * Math.sin(this._t * 47) + 0.08 * Math.sin(this._t * 113);
    const len = (0.78 + thrust * 0.30) * flick;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const s = dying ? 0 : 1;
      f.scale.set(0.40 * (0.9 + flick * 0.2), 1.18 * len * s, 1);
      f.material.opacity = (0.75 + thrust * 0.25) * flick * s;
    }
    this.flameGlow.scale.setScalar((0.75 + thrust * 0.45) * flick * (dying ? 0 : 1));
    this.flameGlow.material.opacity = 0.5 * flick * (dying ? 0 : 1);

    // 护盾泡
    const op = this.dead ? 0 : (this.shieldTargetOp || 0);
    const cur = damp(this.shieldMesh.material.opacity, op, 8, dt);
    this.shieldMesh.material.opacity = cur;
    this.shieldMesh.visible = cur > 0.01;
    if (this.shieldMesh.visible) {
      const s = 1 + Math.sin(this._t * 3.1) * 0.012;
      this.shieldMesh.scale.set(s, s, 1);
      this.shieldMesh.rotation.z = this._t * 0.35;
    }

    // 判定点（聚焦）
    const dotOp = (!dying && this.focus) ? 0.95 : 0;
    this.hitDot.material.opacity = damp(this.hitDot.material.opacity, dotOp, 14, dt);
    this.hitRing.material.opacity = damp(this.hitRing.material.opacity, dotOp * 0.85, 14, dt);
    this.hitRing.rotation.z = this._t * 1.6;

    // 后坐
    this.recoil = damp(this.recoil, 0, 12, dt);
    this.hull.position.y = -this.recoil * 0.5;
    this.hullGlow.position.y = -this.recoil * 0.5;

    // 受击闪白（光束类伤害用）
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT / 0.14;
      this.hull.material.color.setRGB(1 + k * 2.2, 1 + k * 1.2, 1 + k * 1.2);
    } else if (this.hull.material.color.r !== 1) {
      this.hull.material.color.setRGB(1, 1, 1);
    }
  }

  /** 供 HUD 使用的快照 */
  snapshot() {
    return {
      hp: this.hp, maxHp: this.maxHp, lives: this.lives,
      shields: this.shields, bombs: this.bombs,
      levels: this.levels, dps: this.dps,
    };
  }

  dispose() {
    // 场景销毁时统一由 game 处理
  }
}

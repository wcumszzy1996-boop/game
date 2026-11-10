/**
 * boss.js — 三关关底 BOSS
 *
 * VESPER  蜂巢驱逐舰 —— 扇形齐射 / 螺旋蜂群 / 召唤僚机
 * CASTOR  双子战列舰 —— 双列弹幕 / 交叉扫射光束 / 带缺口弹墙
 * NOVA    星核泰坦   —— 环形脉冲 / 旋转弹幕臂 / 天罚激光 + 追踪火球
 *
 * 每个 BOSS 三阶段（血量 62% / 30% 为分界）。
 * 阶段切换：短暂无敌 + 冲击波 + 清空附近弹幕 + 屏幕闪白。
 * 所有攻击都有「蓄能预警」（枪口亮起 ~0.75s），配合整体放缓的射速让弹幕可读。
 */
import * as THREE from '../vendor/three/three.module.js';
import { LAYER, WORLD, WEAPON } from './config.js';
import { rand, randInt, clamp, damp, TAU, chance, easeOutCubic, shortestAngle } from './util.js';

const HALF_H = WORLD.VIEW_H / 2;
const _c = new THREE.Color();

/**
 * BOSS 图鉴
 *
 * hp / atk 双重倍率（本轮新增）：
 *   · hpMul  —— 在难度 bossHpMul 之上再乘一次，用于「单只 BOSS 单独加血」
 *   · atkMul —— 攻击力倍率，同时作用于**弹幕伤害**与**扫射光束 dps**
 * 第 1 关 VESPER 作为教学 BOSS 保持基准；第 2 关 CASTOR 与第 3 关 NOVA
 * 生命 +50%、攻击 +20%。
 *
 * 最终血量 = def.hp × def.hpMul × diff.bossHpMul
 *   （普通难度：VESPER 40,000 / CASTOR 84,000 / NOVA 114,000）
 */
export const BOSS_DEFS = {
  vesper: {
    key: 'vesper',
    name: '蜂巢驱逐舰「VESPER」',
    short: 'VESPER',
    tex: 'bossVesper',
    hp: 40000,
    hpMul: 1.0,
    atkMul: 1.0,
    size: 12.4,
    hoverY: 7.6,
    color: 0xff5fa2,
    accent: 0xffd0ea,
    hitboxes: [{ dx: 0, dy: -0.6, r: 3.0 }, { dx: -3.5, dy: 0.2, r: 1.9 }, { dx: 3.5, dy: 0.2, r: 1.9 }],
    beams: 1,
  },
  castor: {
    key: 'castor',
    name: '双子战列舰「CASTOR / POLLUX」',
    short: 'CASTOR',
    tex: 'bossCastor',
    hp: 56000,
    hpMul: 1.5,     // 生命 +50% → 84,000（普通难度）
    atkMul: 1.2,    // 攻击 +20%
    size: 13.6,
    hoverY: 7.2,
    color: 0xffa22e,
    accent: 0xffe9b8,
    hitboxes: [{ dx: 0, dy: 0.1, r: 3.1 }, { dx: -4.3, dy: -0.2, r: 2.9 }, { dx: 4.3, dy: -0.2, r: 2.9 }],
    beams: 2,
  },
  nova: {
    key: 'nova',
    name: '星核泰坦「NOVA CORE」',
    short: 'NOVA',
    tex: 'bossNova',
    hp: 76000,
    hpMul: 1.5,     // 生命 +50% → 114,000（普通难度）
    atkMul: 1.2,    // 攻击 +20%
    size: 14.8,
    hoverY: 7.0,
    color: 0x2fe6d0,
    accent: 0xd6fff8,
    hitboxes: [{ dx: 0, dy: 0, r: 3.5 }, { dx: 0, dy: -5.0, r: 2.0 }, { dx: 0, dy: 5.0, r: 2.0 }, { dx: -5.2, dy: 0, r: 2.0 }, { dx: 5.2, dy: 0, r: 2.0 }],
    beams: 2,
  },
};

/** BOSS 单发弹幕的基准伤害（再乘 def.atkMul） */
const BOSS_BULLET_DMG = 10;

/** 弹幕色 */
const BC = {
  pink: [1.00, 0.30, 0.62],
  rose: [1.00, 0.18, 0.42],
  gold: [1.00, 0.72, 0.20],
  ember: [1.00, 0.44, 0.10],
  teal: [0.20, 1.00, 0.86],
  aqua: [0.40, 0.86, 1.00],
  violet: [0.74, 0.36, 1.00],
  white: [1.00, 0.92, 0.72],
};

/* ================================================================== *
 * 扫射光束
 * ================================================================== */
class SweepBeam {
  constructor(parent, SPR, idx) {
    this.idx = idx;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.geo = geo;
    const map = SPR.beam.clone();
    map.needsUpdate = true;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    this.map = map;
    this.coreMat = new THREE.MeshBasicMaterial({
      map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      color: new THREE.Color(1, 1, 1), opacity: 1,
    });
    this.haloMat = new THREE.MeshBasicMaterial({
      map: SPR.beamHalo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      color: new THREE.Color(1, 1, 1), opacity: 0.8,
    });
    this.warnMat = new THREE.MeshBasicMaterial({
      map: SPR.warnLine, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      color: new THREE.Color(4, 1.4, 1.6), opacity: 0.9,
    });
    this.core = new THREE.Mesh(geo, this.coreMat);
    this.halo = new THREE.Mesh(geo, this.haloMat);
    this.warn = new THREE.Mesh(geo, this.warnMat);
    this.core.renderOrder = LAYER.laser + 30;
    this.halo.renderOrder = LAYER.laser + 29;
    this.warn.renderOrder = LAYER.warn + 10;
    this.core.position.z = LAYER.laser + 0.4;
    this.halo.position.z = LAYER.laser + 0.3;
    this.warn.position.z = LAYER.warn;
    for (const m of [this.core, this.halo, this.warn]) { m.visible = false; parent.add(m); }
    this.active = false;
    this.warnOnly = false;
    this.angle = Math.PI * 0.5;
    this.width = 1.1;
    this.len = WORLD.VIEW_H * 1.3;
    this.dps = 0;
    this.ox = 0; this.oy = 0;
    this.time = 0;
    this.dmgMul = 1;
  }

  /**
   * @param {object} o {x,y,angle,width,len,dps,warnOnly,color}
   *   注意：x/y 为「世界绝对坐标」（用于命中判定）；
   *   网格本身是本光束所挂载 Group 的子节点，因此局部位置只按角度算半长。
   */
  set(o) {
    this.ox = o.x; this.oy = o.y;
    this.angle = o.angle ?? this.angle;
    this.width = o.width ?? this.width;
    this.len = o.len ?? this.len;
    this.dps = o.dps ?? 0;
    this.warnOnly = !!o.warnOnly;
    this.color = o.color || BC.teal;
    this.active = true;

    const c = this.color;
    const cx = Math.cos(this.angle) * this.len * 0.5;
    const cy = Math.sin(this.angle) * this.len * 0.5;
    const rot = this.angle - Math.PI * 0.5;

    this.core.visible = this.halo.visible = !this.warnOnly;
    this.warn.visible = true;
    this.core.position.set(cx, cy, this.core.position.z);
    this.halo.position.set(cx, cy, this.halo.position.z);
    this.warn.position.set(cx, cy, this.warn.position.z);
    for (const m of [this.core, this.halo]) m.rotation.z = rot;
    this.warn.rotation.z = rot;
    this.core.scale.set(this.width * 0.46, this.len, 1);
    this.halo.scale.set(this.width * 2.5, this.len, 1);
    this.warn.scale.set(this.width * 0.18, this.len, 1);

    this.coreMat.color.setRGB(c[0] * 1.6, c[1] * 2.6, c[2] * 2.6);
    this.haloMat.color.setRGB(c[0] * 1.0, c[1] * 1.6, c[2] * 1.7);
  }

  hide() {
    this.active = false;
    this.core.visible = this.halo.visible = this.warn.visible = false;
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this.map.offset.y -= dt * 2.6;
    if (this.map.offset.y < -1) this.map.offset.y += 1;
    if (this.warnOnly) {
      this.warnMat.opacity = 0.35 + 0.55 * Math.abs(Math.sin(this.time * 22));
      return;
    }
    const pulse = 0.88 + 0.12 * Math.sin(this.time * 40);
    this.coreMat.opacity = pulse;
    this.haloMat.opacity = 0.6 + 0.2 * Math.sin(this.time * 27);
    this.warn.visible = false;
  }

  /** 点到线段的距离是否在 halfWidth 内 */
  hits(x, y, r) {
    if (!this.active || this.warnOnly || this.dps <= 0) return 0;
    const dx = Math.cos(this.angle), dy = Math.sin(this.angle);
    const vx = x - this.ox, vy = y - this.oy;
    const proj = vx * dx + vy * dy;
    if (proj < 0 || proj > this.len) return 0;
    const perp = Math.abs(-vx * dy + vy * dx);
    if (perp <= this.width * 0.5 + r) return this.dps;
    return 0;
  }
}

/* ================================================================== *
 * BOSS 主体
 * ================================================================== */
export class Boss {
  constructor(scene, SPR, effects, enemies) {
    this.SPR = SPR;
    this.effects = effects;
    this.enemies = enemies;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.geo = new THREE.PlaneGeometry(1, 1);

    this.def = null;
    this.alive = false;
    this.hp = 0;
    this.maxHp = 1;
    this.phase = 0;
    this.t = 0;
    this.x = 0;
    this.y = HALF_H + 8;
    this.entering = false;
    this.hitFlash = 0;
    this.transT = 0;
    this.attackT = 2.0;
    this.windup = 0;
    this.state = null;
    this.lastPattern = '';
    this.queue = [];
    this.beams = [new SweepBeam(this.group, SPR, 0), new SweepBeam(this.group, SPR, 1)];
    this.deathT = 0;
    this.dying = false;
    this.bossRush = 0;
    this.glowPulse = 0;
  }

  /* ------------------------------------------------------------------ */
  get hpFrac() {
    return clamp(this.hp / this.maxHp, 0, 1);
  }

  get name() {
    return this.def ? this.def.name : '';
  }

  get short() {
    return this.def ? this.def.short : '';
  }

  get hitR() {
    return this.def ? this.def.hitboxes[0].r : 3;
  }

  start(key, diff) {
    const D = BOSS_DEFS[key] || BOSS_DEFS.vesper;
    this.def = D;
    /** 攻击力倍率（弹幕与光束共用），第 2/3 关为 1.2 */
    this.atkMul = D.atkMul || 1;
    this.hp = D.hp * (D.hpMul || 1) * (diff ? diff.bossHpMul : 1);
    this.maxHp = this.hp;
    this.alive = true;
    this.dying = false;
    this.deathT = 0;
    this._finalBlast = false;
    this.busy = false;
    this.nextGap = 1.2;
    this.phase = 0;
    this.t = 0;
    this.bossRush = 0;
    this.group.visible = true;
    this.x = 0;
    this.y = HALF_H + D.size * 0.7;
    this.entering = true;
    this.transT = 0;
    this.attackT = 2.6;
    this.windup = 0;
    this.state = null;
    this.queue.length = 0;
    this.lastPattern = '';
    this.hitFlash = 0;
    for (const b of this.beams) b.hide();

    /* --- 视觉 --- */
    this.group.position.set(this.x, this.y, LAYER.boss);
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.material.dispose(); }
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      map: this.SPR[D.tex], transparent: true, depthWrite: false, color: new THREE.Color(1, 1, 1),
    }));
    this.mesh.scale.set(D.size, D.size, 1);
    this.mesh.rotation.z = Math.PI;
    this.mesh.renderOrder = LAYER.boss + 20;
    this.group.add(this.mesh);

    const col = _c.setHex(D.color);
    if (this.aura) { this.group.remove(this.aura); this.aura.material.dispose(); }
    this.aura = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      map: this.SPR.glow, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.42,
      color: new THREE.Color(col.r * 1.5, col.g * 1.5, col.b * 1.5),
    }));
    this.aura.scale.set(D.size * 1.9, D.size * 1.9, 1);
    this.aura.position.z = LAYER.bossGlow;
    this.aura.renderOrder = LAYER.boss + 10;
    this.group.add(this.aura);

    if (this.shield) { this.group.remove(this.shield); this.shield.material.dispose(); }
    this.shield = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      map: this.SPR.shield, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0,
      color: new THREE.Color(col.r * 1.4, col.g * 1.4, col.b * 1.4),
    }));
    this.shield.scale.set(D.size * 1.5, D.size * 1.5, 1);
    this.shield.position.z = LAYER.boss + 0.6;
    this.shield.renderOrder = LAYER.boss + 40;
    this.group.add(this.shield);
  }

  /* ------------------------------------------------------------------ */
  /** @returns {'hit'|'phase'|'dead'|'none'} */
  hurt(dmg, hx, hy) {
    if (!this.alive || this.dying || this.transT > 0) return 'none';
    this.hp -= dmg;
    this.hitFlash = Math.min(1, this.hitFlash + dmg * 0.0022 + 0.16);
    if (hx != null && Math.random() < 0.42) {
      this.effects.hitSpark(hx, hy, 0, -1, _c.setRGB(1, 0.9, 0.6), 0.85);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dying = true;
      this.deathT = 0;
      for (const b of this.beams) b.hide();
      this.state = null;
      this.queue.length = 0;
      return 'dead';
    }
    const frac = this.hpFrac;
    if (this.phase === 0 && frac <= 0.62) return 'phase';
    if (this.phase === 1 && frac <= 0.30) return 'phase';
    return 'hit';
  }

  /** 进入下一阶段 */
  nextPhase() {
    this.phase++;
    this.transT = 1.5;
    this.attackT = 1.6;
    this.state = null;
    this.queue.length = 0;
    for (const b of this.beams) b.hide();
    this.effects.shockwave(this.x, this.y, { life: 0.7, s0: 1.0, s1: 26, r: 2.6, g: 2.6, b: 2.6 });
    for (let i = 0; i < 10; i++) {
      this.effects.explosion(this.x + rand(-5, 5), this.y + rand(-4, 4), {
        size: rand(0.9, 1.9), color: _c.setRGB(1, 0.6, 0.4),
      });
    }
  }

  /* ------------------------------------------------------------------ */
  update(dt, ctx) {
    if (!this.alive) return;
    this.t += dt;

    if (this.dying) {
      this._updateDeath(dt, ctx);
      return;
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt * 3.2);
    this.glowPulse += dt;

    /* ---------- 入场 ---------- */
    if (this.entering) {
      this.y = damp(this.y, this.def.hoverY, 2.4, dt);
      if (Math.abs(this.y - this.def.hoverY) < 0.25) { this.entering = false; this.y = this.def.hoverY; }
    } else {
      /* ---------- 悬停巡航 ---------- */
      const sp = 1 + this.phase * 0.55;
      this.x = Math.sin(this.t * 0.42 * sp) * (4.2 + this.phase * 0.5);
      this.y = this.def.hoverY + Math.sin(this.t * 0.75 * sp + 0.8) * 0.75;
    }
    this.group.position.set(this.x, this.y, LAYER.boss);

    /* ---------- 阶段切换无敌 ---------- */
    if (this.transT > 0) {
      this.transT -= dt;
      if (this.beams) for (const b of this.beams) b.hide();
    }

    /* ---------- 战斗时长递增伤害（防僵持） ---------- */
    if (this.t > WEAPON.bossRushStart) {
      this.bossRush = 1 + (this.t - WEAPON.bossRushStart) * WEAPON.bossRushRate;
    }

    /* ---------- 攻击调度 ---------- */
    if (!this.entering && this.transT <= 0) {
      const busy = !!this.state || this.queue.length > 0;
      if (busy) {
        this.busy = true;
        if (this.state) this._runState(dt, ctx);
        if (this.queue.length) this._runQueue(dt, ctx);
      } else {
        if (this.busy) {
          this.busy = false;
          this.attackT = this.nextGap != null ? this.nextGap : 1.2;
        }
        this.attackT -= dt;
        if (this.attackT <= 0) {
          if (this.windup <= 0) {
            this.windup = 0.75;
            this._telegraph();
          } else {
            this.windup -= dt;
            if (this.windup <= 0) this._pickAttack(ctx);
          }
        }
      }
    }

    /* ---------- 光束 ---------- */
    for (const b of this.beams) {
      b.update(dt);
      if (b.active && !b.warnOnly && b.dps > 0 && !ctx.player.dead) {
        const d = b.hits(ctx.player.pos.x, ctx.player.pos.y, ctx.player.hitRadius);
        if (d > 0) ctx.onPlayerBeam && ctx.onPlayerBeam(d * dt);
      }
    }

    /* ---------- 视觉 ---------- */
    const D = this.def;
    const f = this.hitFlash;
    this.mesh.material.color.setRGB(1 + f * 1.6, 1 + f * 1.2, 1 + f * 1.4);
    if (this.transT > 0) {
      const k = Math.sin(this.t * 44) * 0.5 + 0.5;
      this.mesh.material.color.setRGB(1 + k * 1.4, 1 + k * 1.0, 1 + k * 1.2);
    }
    const enrage = this.phase / 2;
    const auraOp = 0.34 + enrage * 0.22 + Math.sin(this.glowPulse * (2.2 + enrage * 2.4)) * 0.08 + f * 0.5;
    this.aura.material.opacity = auraOp;
    const asz = D.size * (1.75 + enrage * 0.22 + f * 0.10 + Math.sin(this.glowPulse * 3.1) * 0.03);
    this.aura.scale.set(asz, asz, 1);

    const shOp = this.transT > 0 ? 0.62 : 0.16 + enrage * 0.14 + (this.windup > 0 ? 0.22 : 0);
    this.shield.material.opacity = damp(this.shield.material.opacity, shOp, 8, dt);
    this.shield.rotation.z = this.glowPulse * 0.5;
    this.shield.visible = this.shield.material.opacity > 0.02;

    // 蓄能预警：口部亮起
    if (this.windup > 0) {
      const k = 1 - this.windup / 0.75;
      this.effects.puff('glow', this.x + rand(-D.size * 0.2, D.size * 0.2), this.y - D.size * 0.16, {
        life: 0.18, s0: 0.5 + k * 1.1, s1: 0.1,
        r: 2.4 + k * 2.0, g: 1.0 + k * 1.6, b: 1.6 + k * 1.4, a0: 0.5 + k * 0.5, a1: 0, drag: 3,
      });
    }
  }

  _telegraph() {
    this.effects.shockwave(this.x, this.y, { life: 0.42, s0: 1.2, s1: this.def.size * 1.4, r: 2.2, g: 1.0, b: 1.6, a0: 0.7 });
  }

  _updateDeath(dt, ctx) {
    this.deathT += dt;
    const dur = 3.0;
    const k = this.deathT / dur;
    this.y = damp(this.y, this.def.hoverY - 1.5, 1.2, dt);
    this.group.position.set(this.x, this.y, LAYER.boss);
    this.mesh.material.color.setRGB(1 + Math.sin(this.deathT * 60) * 0.5, 1, 1);

    if (this.deathT < dur) {
      if (Math.random() < 0.55) {
        const a = rand(0, TAU), d = rand(0, this.def.size * 0.48);
        this.effects.explosion(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, {
          size: rand(1.0, 2.4), color: _c.setRGB(1, rand(0.55, 0.85), 0.35),
        });
        ctx.shake.add(0.035);
        ctx.audio.explode(rand(0.7, 1.3));
      }
      this.mesh.material.opacity = 1;
      this.aura.material.opacity = 0.4 + Math.sin(this.deathT * 30) * 0.3;
      this.shield.material.opacity = Math.max(0, 0.5 - k);
      return;
    }

    // 终爆
    if (!this._finalBlast) {
      this._finalBlast = true;
      _c.setRGB(1, 0.85, 0.6);
      this.effects.bigExplosion(this.x, this.y, _c, 3.4);
      this.effects.shockwave(this.x, this.y, { life: 1.1, s0: 1.2, s1: 46, r: 3.6, g: 3.6, b: 3.6, a0: 1 });
      this.effects.shockwave(this.x, this.y, { life: 0.8, s0: 0.6, s1: 30, r: 1.6, g: 2.6, b: 3.6, a0: 1 });
      ctx.postfx.flash = 1.15;
      ctx.shake.add(0.95);
      ctx.audio.bomb();
    }
    this.mesh.material.opacity = Math.max(0, 1 - (this.deathT - dur) * 3);
    this.aura.material.opacity = Math.max(0, 0.6 - (this.deathT - dur) * 2);
    if (this.deathT > dur + 0.5) {
      this.alive = false;
      this.group.visible = false;
      ctx.onBossDefeated && ctx.onBossDefeated();
    }
  }

  _clearNearBullets(ctx, r) {
    ctx.ebul.clearNear(this.x, this.y, r);
  }

  /* ------------------------------------------------------------------ *
   * 攻击模式
   * ------------------------------------------------------------------ */
  _pickAttack(ctx) {
    const pool = this._patternPool();
    let name = pool[(Math.random() * pool.length) | 0];
    let guard = 0;
    while (name === this.lastPattern && guard++ < 6) name = pool[(Math.random() * pool.length) | 0];
    this.lastPattern = name;
    this[name](ctx);
  }

  _patternPool() {
    const k = this.def.key;
    if (k === 'vesper') {
      if (this.phase === 0) return ['patFan', 'patSpiral'];
      if (this.phase === 1) return ['patFan', 'patSpiral', 'patPetals', 'patLance'];
      return ['patSpiral', 'patPetals', 'patLance', 'patSwarm', 'patFan'];
    }
    if (k === 'castor') {
      if (this.phase === 0) return ['patColumns', 'patWall'];
      if (this.phase === 1) return ['patColumns', 'patWall', 'patCrossBeam', 'patOrbRing'];
      return ['patWall', 'patCrossBeam', 'patOrbRing', 'patBarrage', 'patColumns'];
    }
    if (this.phase === 0) return ['patPulse', 'patArms'];
    if (this.phase === 1) return ['patPulse', 'patArms', 'patHoming', 'patFlower'];
    return ['patArms', 'patFlower', 'patHoming', 'patJudgement', 'patPulse'];
  }

  /** 发射辅助（弹幕伤害 = 基准 × 本 BOSS 的攻击力倍率） */
  _shot(x, y, ang, speed, col, opt = {}) {
    const c = BC[col] || BC.pink;
    return this.ctx.ebul.fire({
      x, y,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      w: 0.36, h: 0.36, gw: 1.02, gh: 1.02, r: 0.24,
      dmg: BOSS_BULLET_DMG * (this.atkMul || 1),
      cr: 3.8, cg: 3.8, cb: 3.8,
      gr: c[0] * 2.1, gg: c[1] * 2.1, gb: c[2] * 2.1,
      life: 12, aim: false,
      ...opt,
    });
  }

  _aimAtPlayer(off = 0) {
    const p = this.ctx.player.pos;
    return Math.atan2(p.y - this.y, p.x - this.x) + off;
  }

  /* --- VESPER --- */
  patFan(ctx) {
    this.ctx = ctx;
    const n = 7 + this.phase * 2;
    for (let v = 0; v < 3; v++) {
      this.queue.push({
        t: v * 0.26,
        fn: () => {
          const base = this._aimAtPlayer();
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.125;
            this._shot(this.x, this.y - 2.4, a, 9.6 + v * 0.7, 'pink');
          }
          this.effects.muzzle(this.x, this.y - 2.6, { size: 1.2, r: 4, g: 2, b: 3.4, life: 0.1 });
          ctx.audio.enemyShoot(1);
        },
      });
    }
    this._endWith(1.35);
  }

  patSpiral(ctx) {
    this.ctx = ctx;
    const arms = 3 + this.phase;
    this.state = {
      kind: 'spiral', t: 0, dur: 2.6, acc: 0,
      rate: 0.085, ang: rand(0, TAU), spin: (this.phase === 2 ? 2.5 : 1.7) * (chance(0.5) ? 1 : -1),
    };
    this._endWith(3.1);
    void arms;
  }

  patPetals(ctx) {
    this.ctx = ctx;
    const n = 20 + this.phase * 4;
    for (let r = 0; r < 4; r++) {
      this.queue.push({
        t: r * 0.30,
        fn: () => {
          const off = (r % 2) * (Math.PI / n);
          for (let i = 0; i < n; i++) {
            this._shot(this.x, this.y - 1.4, (i / n) * TAU + off + this.t * 0.3, 7.4, 'rose');
          }
          ctx.audio.enemyShoot(1);
          this.effects.shockwave(this.x, this.y, { life: 0.3, s0: 1, s1: 9, r: 2.4, g: 0.8, b: 1.8, a0: 0.5 });
        },
      });
    }
    this._endWith(1.6);
  }

  patLance(ctx) {
    this.ctx = ctx;
    const n = 5 + this.phase * 3;
    for (let v = 0; v < 2; v++) {
      this.queue.push({
        t: v * 0.5,
        fn: () => {
          const base = this._aimAtPlayer();
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.075;
            this._shot(this.x, this.y - 3.0, a, 16.5, 'white', { w: 0.26, h: 0.66, gw: 0.8, gh: 1.7, r: 0.2, aim: true });
          }
          ctx.audio.laserHit();
        },
      });
    }
    this._endWith(1.4);
  }

  patSwarm(ctx) {
    this.ctx = ctx;
    for (let i = 0; i < 3; i++) {
      const x = -5 + i * 5;
      this.enemies.spawn('scout', { x, y: this.y + 1.5, move: 'swoop', dir: x < 0 ? -1 : 1, speed: 4.4 });
    }
    this.effects.shockwave(this.x, this.y, { life: 0.5, s0: 2, s1: this.def.size * 1.6, r: 2, g: 1, b: 2, a0: 0.7 });
    this._endWith(1.5);
  }

  /* --- CASTOR --- */
  _pods() {
    return [
      { x: this.x - this.def.size * 0.22, y: this.y - this.def.size * 0.30 },
      { x: this.x + this.def.size * 0.22, y: this.y - this.def.size * 0.30 },
    ];
  }

  patColumns(ctx) {
    this.ctx = ctx;
    this.state = { kind: 'columns', t: 0, dur: 2.8, acc: 0, rate: 0.155, flip: false, bx: rand(-4, 4) };
    this._endWith(3.2);
  }

  patWall(ctx) {
    this.ctx = ctx;
    const rows = 3 + this.phase;
    const gapAt = rand(-5.5, 5.5);
    for (let r = 0; r < rows; r++) {
      this.queue.push({
        t: r * 0.34,
        fn: () => {
          const n = 17;
          for (let i = 0; i < n; i++) {
            const x = -8 + (i / (n - 1)) * 16;
            if (Math.abs(x - gapAt) < 1.75) continue;     // 留出安全缺口
            this._shot(x, this.y - this.def.size * 0.30, Math.PI * 0.5, 8.2, 'gold');
          }
          ctx.audio.enemyShoot(1);
          this.effects.shockwave(this.x, this.y, { life: 0.28, s0: 2, s1: 14, r: 2.6, g: 1.8, b: 0.6, a0: 0.4, sy: 0.5 });
        },
      });
    }
    this._endWith(1.9);
  }

  patCrossBeam(ctx) {
    this.ctx = ctx;
    this._beamSweep(ctx, { count: 2, dur: 2.6, from: -0.62, to: 0.62, width: 1.05, dps: 26, color: BC.gold });
    this._endWith(3.5);
  }

  patOrbRing(ctx) {
    this.ctx = ctx;
    const n = 14;
    const pods = this._pods();
    for (let v = 0; v < 2; v++) {
      this.queue.push({
        t: v * 0.55,
        fn: () => {
          for (const p of pods) {
            for (let i = 0; i < n; i++) {
              this._shot(p.x, p.y, (i / n) * TAU + v * 0.2, 6.6, 'ember', { w: 0.5, h: 0.5, gw: 1.5, gh: 1.5, r: 0.3 });
            }
          }
          ctx.audio.enemyShoot(1);
        },
      });
    }
    this._endWith(1.8);
  }

  patBarrage(ctx) {
    this.ctx = ctx;
    const pods = this._pods();
    for (let v = 0; v < 4; v++) {
      this.queue.push({
        t: v * 0.28,
        fn: () => {
          const base = this._aimAtPlayer();
          for (const p of pods) {
            for (let i = -3; i <= 3; i++) {
              this._shot(p.x, p.y, base + i * 0.14 + (v % 2 ? 0.07 : -0.07), 10.5, 'ember');
            }
          }
          ctx.audio.enemyShoot(1);
        },
      });
    }
    this._endWith(2.0);
  }

  /* --- NOVA --- */
  patPulse(ctx) {
    this.ctx = ctx;
    const rings = 3 + this.phase;
    for (let r = 0; r < rings; r++) {
      this.queue.push({
        t: r * 0.44,
        fn: () => {
          const n = 22;
          for (let i = 0; i < n; i++) {
            this._shot(this.x, this.y, (i / n) * TAU + r * 0.14, 7.0 + r * 0.5, r % 2 ? 'teal' : 'aqua');
          }
          ctx.audio.enemyShoot(1);
          this.effects.shockwave(this.x, this.y, {
            life: 0.42, s0: 1.4, s1: this.def.size * 1.5, r: 1.4, g: 3.0, b: 2.8, a0: 0.75,
          });
        },
      });
    }
    this._endWith(2.4);
  }

  patArms(ctx) {
    this.ctx = ctx;
    this.state = {
      kind: 'arms', t: 0, dur: 3.2, acc: 0, rate: 0.095,
      ang: rand(0, TAU), spin: (this.phase === 2 ? 1.9 : 1.3) * (chance(0.5) ? 1 : -1),
      arms: 4 + this.phase * 2,
    };
    this._endWith(3.7);
  }

  patHoming(ctx) {
    this.ctx = ctx;
    for (let v = 0; v < 3; v++) {
      this.queue.push({
        t: v * 0.45,
        fn: () => {
          const n = 5;
          const base = this._aimAtPlayer();
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.55;
            const b = this._shot(this.x, this.y, a, 4.6, 'violet', {
              w: 0.6, h: 0.6, gw: 1.9, gh: 1.9, r: 0.34, life: 9,
            });
            if (b) { b.homing = 1.5; b.hspeed = 7.4; }
          }
          ctx.audio.enemyShoot(1);
        },
      });
    }
    this._endWith(2.0);
  }

  patFlower(ctx) {
    this.ctx = ctx;
    const arms = 5;
    for (let r = 0; r < 5; r++) {
      this.queue.push({
        t: r * 0.26,
        fn: () => {
          const n = 6 + r;
          for (let a = 0; a < arms; a++) {
            const base = (a / arms) * TAU + r * 0.22 + this.t * 0.4;
            for (let i = 0; i < n; i++) {
              const ang = base + (i - (n - 1) / 2) * 0.10;
              this._shot(this.x, this.y, ang, 8.4, 'teal', { w: 0.4, h: 0.4, gw: 1.2, gh: 1.2 });
            }
          }
          ctx.audio.enemyShoot(1);
        },
      });
    }
    this._endWith(2.2);
  }

  patJudgement(ctx) {
    this.ctx = ctx;
    // 先放环形，再用两道宽光束扫射
    for (let i = 0; i < 18; i++) {
      this._shot(this.x, this.y, (i / 18) * TAU + this.t, 6.4, 'aqua');
    }
    this._beamSweep(ctx, { count: 2, dur: 3.0, from: -0.95, to: 0.95, width: 1.5, dps: 34, color: BC.teal });
    this._endWith(4.2);
  }

  /* --- 通用：光束扫射 --- */
  _beamSweep(ctx, o) {
    const n = Math.min(o.count, this.beams.length);
    // 光束 dps 同样吃攻击力倍率（第 2/3 关为 1.2）
    const dps = o.dps * (this.atkMul || 1);
    for (let i = 0; i < n; i++) {
      this.beams[i].set({
        x: this.x, y: this.y,
        angle: Math.PI * 0.5 + o.from,
        width: o.width, dps, warnOnly: true, color: o.color,
      });
    }
    this.state = {
      kind: 'beams', t: 0, dur: o.dur, from: o.from, to: o.to, n,
      warn: 0.85, warnDone: false, width: o.width, dps, color: o.color,
    };
  }

  /* ------------------------------------------------------------------ *
   * 状态机 / 队列
   * ------------------------------------------------------------------ */
  /** 记录本次攻击结束后的间隔（在回到 idle 的那一刻才开始计时） */
  _endWith(gap) {
    this.nextGap = gap;
  }

  _runQueue(dt, ctx) {
    for (const q of this.queue) q.t -= dt;
    while (this.queue.length && this.queue[0].t <= 0) {
      const q = this.queue.shift();
      q.fn();
    }
    this.ctx = ctx;
  }

  _runState(dt, ctx) {
    this.ctx = ctx;
    const s = this.state;
    s.t += dt;

    if (s.kind === 'spiral' || s.kind === 'arms') {
      s.ang += s.spin * dt;
      s.acc -= dt;
      const arms = s.kind === 'arms' ? s.arms : 3 + this.phase;
      if (s.acc <= 0) {
        s.acc += s.rate;
        for (let a = 0; a < arms; a++) {
          const ang = s.ang + (a / arms) * TAU;
          this._shot(this.x, this.y, ang, s.kind === 'arms' ? 8.0 : 9.0,
            s.kind === 'arms' ? 'teal' : 'pink');
        }
        this.effects.puff('glow', this.x, this.y, {
          life: 0.16, s0: 1.2, s1: 0.4, r: 2.0, g: 1.2, b: 2.2, a0: 0.4, a1: 0, drag: 3,
        });
      }
    } else if (s.kind === 'columns') {
      s.acc -= dt;
      if (s.acc <= 0) {
        s.acc += s.rate;
        s.flip = !s.flip;
        const pods = this._pods();
        for (let i = 0; i < pods.length; i++) {
          const p = pods[i];
          const x = s.bx + (i === 0 ? -0.85 : 0.85);
          const gap = s.flip ? 0.85 : 1.35;
          this._shot(x, p.y, Math.PI * 0.5 - gap, 11.5, 'gold', { w: 0.30, h: 0.58, gw: 0.9, gh: 1.6, r: 0.2, aim: true });
        }
        if (Math.random() < 0.5) ctx.audio.enemyShoot(0);
      }
      if (s.t > s.dur * 0.6) s.bx = damp(s.bx, this.x, 1.2, dt);
    } else if (s.kind === 'beams') {
      s.warn -= dt;
      const k = clamp(s.t / s.dur, 0, 1);
      const ang = Math.PI * 0.5 + s.from + (s.to - s.from) * easeOutCubic(k);
      const active = s.warn <= 0;
      for (let i = 0; i < s.n; i++) {
        const off = s.n === 1 ? 0 : (i === 0 ? -0.16 : 0.16);
        this.beams[i].set({
          x: this.x, y: this.y, angle: ang + off,
          width: s.width, dps: s.dps, warnOnly: !active, color: s.color,
        });
      }
      if (active && !s.warnDone) {
        s.warnDone = true;
        ctx.audio.laserCharge(0.4);
        ctx.shake.add(0.25);
      }
      if (s.t >= s.dur) {
        for (const b of this.beams) b.hide();
      }
    }

    if (s.t >= s.dur + 0.05) {
      this.state = null;
    }
  }

  clear() {
    this.alive = false;
    this.dying = false;
    this._finalBlast = false;
    this.group.visible = false;
    for (const b of this.beams) b.hide();
    this.state = null;
    this.queue.length = 0;
  }

  dispose() {
    for (const b of this.beams) {
      b.geo.dispose();
      b.coreMat.dispose();
      b.haloMat.dispose();
      b.warnMat.dispose();
    }
    this.geo.dispose();
  }
}

export { SweepBeam, randInt, shortestAngle };

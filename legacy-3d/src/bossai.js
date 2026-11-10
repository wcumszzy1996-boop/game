/**
 * bossai.js — 关底 BOSS
 * 多阶段：入场 → 弹幕循环（随血量加速/换招） → 崩解演出
 * 可破坏部件：炮台被摧毁后永久削弱火力
 */
import * as THREE from '../vendor/three/three.module.js';
import { buildBoss } from './bossmesh.js';
import { applyFlash } from './meshlib.js';
import { clamp, damp, rand, randInt, chance, TAU, easeOutCubic } from './util.js';
import { WEAPON } from './config.js';

/* ------------------------------------------------------------------ *
 * 各族 BOSS 配置
 * ------------------------------------------------------------------ */
const BOSS_CONF = {
  vesper: {
    accent: 0xff4d9e,
    z: -32,
    modelScale: 1.9,
    maxHp: 26000,
    bodies: [{ x: 0, y: 0.6, z: 0, r: 6.0 }, { x: 0, y: 0.6, z: -3.2, r: 4.2 }],
    podRadius: 1.55,
    pods: 6,
    podHpFrac: 0.052,
    sway: { ax: 7.5, ay: 2.4, sx: 0.36, sy: 0.62 },
    spin: 0.10,
    phases: [0.67, 0.34],
  },
  castor: {
    accent: 0xffa22e,
    z: -30,
    modelScale: 1.5,
    maxHp: 34000,
    bodies: [{ x: 3.9, y: 0.4, z: 0, r: 5.4 }, { x: -3.9, y: 0.4, z: 0, r: 5.4 }],
    podRadius: 1.5,
    pods: 8,
    podHpFrac: 0.045,
    sway: { ax: 5.0, ay: 1.6, sx: 0.28, sy: 0.5 },
    spin: 0,
    phases: [0.7, 0.38],
  },
  nova: {
    accent: 0x2fe6d0,
    z: -33,
    modelScale: 2.0,
    maxHp: 46000,
    bodies: [{ x: 0, y: 0, z: 0, r: 5.6 }],
    podRadius: 1.7,
    pods: 6,
    podHpFrac: 0.05,
    sway: { ax: 6.0, ay: 3.0, sx: 0.32, sy: 0.5 },
    spin: 0.18,
    phases: [0.72, 0.45, 0.22],
  },
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/* ================================================================== *
 * Boss
 * ================================================================== */
export class Boss {
  constructor(scene, combat, effects, audio) {
    this.scene = scene;
    this.combat = combat;
    this.effects = effects;
    this.audio = audio;
    this.active = false;
    this.group = null;
    this.beam = effects.createBeam(0xff4d9e);
    this.beam2 = effects.createBeam(0x2fe6d0);
    this.beamCd = 0;
    this.beamDamageCd = 0;
  }

  start(type, diff, name) {
    this.stop();
    const conf = BOSS_CONF[type] || BOSS_CONF.vesper;
    this.type = type;
    this.conf = conf;
    this.diff = diff;
    this.name = name;

    this.group = buildBoss(type, conf.accent);
    this.group.scale.setScalar(conf.modelScale);
    this.group.position.set(0, 4, conf.z - 90);
    this.scene.add(this.group);

    this.maxHp = conf.maxHp * diff.bossHpMul;
    this.hp = this.maxHp;
    this.pos = this.group.position;

    // 可破坏炮台
    this.pods = [];
    const pods = this.group.userData.parts || [];
    for (let i = 0; i < pods.length; i++) {
      const p = pods[i];
      this.pods.push({
        obj: p,
        hp: this.maxHp * conf.podHpFrac,
        maxHp: this.maxHp * conf.podHpFrac,
        alive: true,
        world: new THREE.Vector3(),
        radius: conf.podRadius * conf.modelScale,
        flash: 0,
        idx: i,
      });
    }
    // 部件世界半径
    for (const p of this.pods) p.radius = conf.podRadius * conf.modelScale;

    this.bodies = conf.bodies.map((b) => ({
      local: new THREE.Vector3(b.x, b.y, b.z),
      r: b.r * conf.modelScale,
      world: new THREE.Vector3(),
    }));

    this.state = 'enter';
    this.t = 0;
    this.combatT = 0;
    this.phase = 0;
    this.hitFlash = 0;
    this.patternIdx = -1;
    this.patternT = 0;
    this.enrage = 1;
    this.deathT = 0;
    this.deathStage = 0;
    this.alive = true;
    this.active = true;
    this.plusGlow = null;
    this.lastDamageAt = 0;

    this.ctx = null;
    this._patterns = this._buildPatterns(type);
    this._nextPattern();
    return this;
  }

  stop() {
    if (this.group) {
      this.scene.remove(this.group);
      // 只释放每次新建的几何体；材质来自共享缓存，不能销毁
      this.group.traverse((o) => {
        if (o.isMesh && o.geometry) o.geometry.dispose();
      });
      this.group = null;
    }
    this.beam.stop();
    this.beam2.stop();
    this.active = false;
    this.alive = false;
    this.pods = [];
  }

  /* ---------------- 阶段 & 弹幕编排 ---------------- */
  _buildPatterns(type) {
    const C = this.combat;
    const self = this;
    const ac = this.conf.accent;

    const podFire = (count, color, opts) => {
      const live = self.pods.filter((p) => p.alive);
      if (!live.length) return;
      const chosen = [];
      const shuffled = live.slice().sort(() => Math.random() - 0.5);
      for (let i = 0; i < Math.min(count, shuffled.length); i++) chosen.push(shuffled[i]);
      for (const p of chosen) {
        const from = p.world;
        const pp = { x: cx(), y: cy(), z: cz() };
        const dx = pp.x - from.x, dy = pp.y - from.y, dz = pp.z - from.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const spd = clamp(d / 0.8, 30, 58) * self.diff.enemyBulletSpeedMul * self.enrage;
        C.spawnEnemyBullet(from.x, from.y, from.z, (dx / d) * spd, (dy / d) * spd, (dz / d) * spd, opts || { color, radius: 0.38, damage: 13, needle: true, life: 5 });
      }
    };
    const cx = () => self.ctx.playerPos.x;
    const cy = () => self.ctx.playerPos.y;
    const cz = () => self.ctx.playerPos.z;

    const common = [
      {
        name: 'podVolley', dur: 5.2,
        update: (dt) => {
          self.podTimer = (self.podTimer || 0) - dt;
          if (self.podTimer <= 0) {
            self.podTimer = 0.42 / self.enrage;
            podFire(2, ac);
            self.audio.plasma(1);
          }
        },
      },
      {
        name: 'ring', dur: 4.6,
        update: (dt, t) => {
          self.podTimer = (self.podTimer || 0) - dt;
          if (self.podTimer <= 0) {
            self.podTimer = 0.72 / self.enrage;
            C.spawnRing(self.pos.x, self.pos.y + 1, self.pos.z + 3, 12, 17, self.t * 1.2, { color: ac, radius: 0.38, damage: 12 });
            self.audio.plasma(2);
          }
        },
      },
      {
        name: 'spiral', dur: 6.0,
        update: (dt, t) => {
          self.spiralAcc = (self.spiralAcc || 0) + dt;
          if (self.spiralAcc > 0.11 / self.enrage) {
            self.spiralAcc = 0;
            C.spawnSpiral(self.pos.x, self.pos.y + 1, self.pos.z + 3, 3 + self.phase, t * 3.1, 22, { color: ac, radius: 0.34, damage: 11 });
          }
        },
      },
      {
        name: 'laser',
        dur: 6.4,
        enter: () => {
          self.laserT = 0;
          self.laserDir = Math.random() < 0.5 ? 1 : -1;
          self.beam.fire(
            new THREE.Vector3(self.pos.x, self.pos.y + 1, self.pos.z + 4),
            new THREE.Vector3(0, 0, 1),
            3.4, 2.6, 1.5
          );
          self.audio.laserCharge(1.5);
        },
        update: (dt, t) => {
          self.laserT += dt;
          if (self.laserT > 1.5) {
            const u = clamp((self.laserT - 1.5) / 3.2, 0, 1);
            const sweep = (u * 2 - 1) * self.laserDir * Math.min(20, 12 + self.enrage * 4);
            _v.set(sweep, self.ctx.playerPos.y, self.ctx.playerPos.z + 4).sub(self.beam.origin).normalize();
            self.beam.dir.copy(_v);
            self.beam.width = 2.6;
          }
        },
        exit: () => self.beam.stop(),
      },
      {
        name: 'minions', dur: 5.4,
        enter: () => {
          const n = 3 + self.phase;
          for (let i = 0; i < n; i++) {
            self.ctx.spawnEnemy('scout', {
              x: rand(-14, 14), y: rand(2, 9), z: self.pos.z - 6,
              behavior: 'dive', vx: rand(-8, 8),
            });
          }
          self.audio.alarm();
        },
        update: () => {},
      },
      {
        name: 'torpedo', dur: 5.6,
        update: (dt) => {
          self.podTimer = (self.podTimer || 0) - dt;
          if (self.podTimer <= 0) {
            self.podTimer = 1.15 / self.enrage;
            const live = self.pods.filter((p) => p.alive);
            const p = live.length ? live[(Math.random() * live.length) | 0] : null;
            const ox = p ? p.world.x : self.pos.x;
            const oy = p ? p.world.y : self.pos.y;
            const target = self.ctx.findNearestEnemy ? null : null;
            C.launchMissile(ox, oy, self.pos.z + 3, new THREE.Vector3(0, 0, 1), self.ctx.player, 18, 30);
          }
        },
      },
    ];

    // 各族专属招：重排顺序与权重
    if (type === 'vesper') {
      return [common[0], common[1], common[2], common[4], common[3], common[0], common[2]];
    }
    if (type === 'castor') {
      return [common[0], common[5], common[1], common[0], common[2], common[5], common[3]];
    }
    return [common[2], common[1], common[4], common[3], common[0], common[2], common[5]];
  }

  _nextPattern() {
    this.patternIdx = (this.patternIdx + 1) % this._patterns.length;
    this.patternT = 0;
    this._needEnter = true;
  }

  _runEnter() {
    const p = this._patterns[this.patternIdx];
    this._needEnter = false;
    if (p && p.enter) p.enter();
  }

  /* ---------------- 受击 ---------------- */
  hitTest(x, y, z, r) {
    for (const p of this.pods) {
      if (!p.alive) continue;
      const d = Math.hypot(x - p.world.x, y - p.world.y, z - p.world.z);
      if (d < p.radius + r) return { kind: 'pod', pod: p };
    }
    for (const b of this.bodies) {
      const d = Math.hypot(x - b.world.x, y - b.world.y, z - b.world.z);
      if (d < b.r + r) return { kind: 'body' };
    }
    return null;
  }

  damage(amount, ctx, isPod, pod) {
    if (this.state === 'enter' || this.state === 'transition' || this.state === 'dying') {
      return;
    }
    this.hitFlash = Math.min(1, this.hitFlash + 0.28);
    this.lastDamageAt = this.t;
    // 长时间僵持后伤害递增，保证节奏
    const rush = Math.max(0, this.combatT - WEAPON.bossRushStart) * WEAPON.bossRushRate;
    if (rush > 0) amount *= 1 + rush;
    if (isPod && pod && pod.alive) {
      pod.hp -= amount;
      pod.flash = 1;
      if (pod.hp <= 0) this._destroyPod(pod, ctx);
      // 打部件本体也掉血（少量）
      amount *= 0.25;
    }
    this.hp -= amount;
    if (this.hp <= 0 && this.state !== 'dying') {
      this.hp = 0;
      this.state = 'dying';
      this.deathT = 0;
      this.deathStage = 0;
      this.beam.stop();
      ctx.onBossDefeated(this);
    } else {
      // 阶段切换
      const frac = this.hp / this.maxHp;
      let idx = -1;
      for (let i = 0; i < this.conf.phases.length; i++) if (frac <= this.conf.phases[i]) idx = i;
      if (idx >= 0 && this.phase <= idx) {
        this.phase = idx + 1;
        this.enrage = 1 + this.phase * 0.28;
        this.state = 'transition';
        this.transT = 0;
        this.audio.alarm();
        ctx.trauma.add(0.6);
        this.effects.shockwave(this.pos.x, this.pos.y, this.pos.z, 3, 46, 1.0, 1, this.conf.accent);
        this.combat.clearEnemyBullets(24, this.pos);
      }
    }
  }

  _destroyPod(pod, ctx) {
    pod.alive = false;
    pod.obj.visible = false;
    this.effects.explosion(pod.world.x, pod.world.y, pod.world.z, 1.5, 0xffb060);
    this.audio.explode(1.1);
    ctx.trauma.add(0.32);
    ctx.addScore(500, pod.world);
    // 部件爆炸对身体造成额外伤害
    this.damage(this.maxHp * 0.02, ctx, false, null);
    this.effects.shockwave(pod.world.x, pod.world.y, pod.world.z, 1, 12, 0.5, 0.9, 0xffc060);
  }

  /* ---------------- 每帧 ---------------- */
  update(dt, ctx) {
    if (!this.active) return;
    this.ctx = ctx;
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3.6);
    this.beamDamageCd = Math.max(0, this.beamDamageCd - dt);
    const conf = this.conf;

    /* --- 位置与姿态 --- */
    if (this.state === 'enter') {
      const targetZ = conf.z;
      this.pos.z = damp(this.pos.z, targetZ, 1.5, dt);
      this.pos.y = damp(this.pos.y, 1.2, 1.6, dt);
      if (Math.abs(this.pos.z - targetZ) < 1.2) {
        this.state = 'combat';
        this.patternT = 0;
      }
    } else {
      const t = this.t;
      const swayX = Math.sin(t * conf.sway.sx) * conf.sway.ax;
      const swayY = Math.sin(t * conf.sway.sy) * conf.sway.ay + 1.2;
      this.pos.x = damp(this.pos.x, swayX, 1.4, dt);
      this.pos.y = damp(this.pos.y, swayY, 1.4, dt);
      this.pos.z = damp(this.pos.z, conf.z + Math.sin(t * 0.4) * 1.5, 1.2, dt);
    }
    if (conf.spin) this.group.rotation.y += conf.spin * dt;
    this.group.rotation.z = damp(this.group.rotation.z, Math.sin(this.t * 0.5) * 0.06, 1.5, dt);

    // 更新矩阵后读取部件世界坐标
    this.group.updateMatrixWorld(true);
    for (const p of this.pods) {
      p.obj.getWorldPosition(p.world);
      p.flash = Math.max(0, p.flash - dt * 4);
      applyFlash(p.obj, p.flash * 0.9);
      if (p.obj.userData.spinners) {
        for (const s of p.obj.userData.spinners) s.obj.rotation.z += s.speed * dt * 4;
      }
    }
    for (const b of this.bodies) {
      _v.copy(b.local).multiplyScalar(conf.modelScale).applyQuaternion(this.group.quaternion);
      b.world.copy(this.pos).add(_v);
    }

    applyFlash(this.group, this.hitFlash * 0.5);

    // 旋转部件
    const spinners = this.group.userData.spinners;
    if (spinners) for (const s of spinners) {
      if (s.axis === 'z') s.obj.rotation.z += s.speed * dt;
      else if (s.axis === 'y') s.obj.rotation.y += s.speed * dt;
      else s.obj.rotation.x += s.speed * dt;
    }
    const rings = this.group.userData.rings;
    if (rings) {
      for (let i = 0; i < rings.length; i++) {
        rings[i].rotation.z += dt * (0.3 + i * 0.2) * (i % 2 ? -1 : 1);
      }
    }
    const plasmaMat = this.group.userData.plasmaMat;
    if (plasmaMat) plasmaMat.uniforms.uTime.value = this.t;
    const shell = this.group.userData.shell;
    if (shell) shell.rotation.y += dt * 0.08;

    // 护盾
    const sm = this.group.userData.shieldMat;
    if (sm) {
      sm.uniforms.uTime.value = this.t;
      const inTrans = this.state === 'transition';
      const entering = this.state === 'enter';
      // 护盾材质已改为「只在掠射边缘显形」（见 meshlib.shieldMaterial），
      // 因此这里可以把不透明度给足，让球壳边缘清晰可辨，而不会盖住舰体。
      // 入场阶段刻意压到很低：BOSS 亮相时应该先看清建模，而不是先看一层球壳。
      const opTarget = entering ? 0.16 : (inTrans ? 0.75 : 0.34);
      const hitTarget = entering ? 0.0 : (inTrans ? 0.55 : this.hitFlash * 0.35);
      sm.uniforms.uOpacity.value = damp(sm.uniforms.uOpacity.value, opTarget, 5, dt);
      sm.uniforms.uHit.value = damp(sm.uniforms.uHit.value, hitTarget, 8, dt);
    }

    /* --- 状态机 --- */
    if (this.state === 'combat') {
      const p = this._patterns[this.patternIdx];
      if (this._needEnter) this._runEnter();
      this.combatT += dt;
      this.patternT += dt;
      if (p.update) p.update(dt, this.patternT);
      if (this.patternT > p.dur) {
        if (p.exit) p.exit();
        this._nextPattern();
      }
      // 停顿判定（长时间未受伤时略微加压）
      if (this.t - this.lastDamageAt > 14) this.enrage = Math.min(2.6, this.enrage + dt * 0.06);
    } else if (this.state === 'transition') {
      this.transT += dt;
      this.combat.spawnRing(this.pos.x, this.pos.y, this.pos.z + 3, 16, 16, this.t * 2.2, {
        color: this.conf.accent, radius: 0.36, damage: 12,
      });
      if (this.transT > 1.9) {
        this.state = 'combat';
        this.patternT = 0;
      }
    } else if (this.state === 'dying') {
      this._updateDeath(dt, ctx);
    }

    /* --- 激光伤害 --- */
    this._laserDamage(dt, ctx);

    /* --- 入场无敌判定结束 --- */
    if (this.state === 'enter') {
      // 入场期间清掉玩家打过来的弹（避免无效命中的错觉）
    }
  }

  _laserDamage(dt, ctx) {
    for (const beam of [this.beam, this.beam2]) {
      if (!beam.active || beam.phase !== 'fire') continue;
      // 点到射线距离
      _v.copy(ctx.playerPos).sub(beam.origin);
      const proj = _v.dot(beam.dir);
      if (proj < 0 || proj > 80) continue;
      _v2.copy(beam.origin).addScaledVector(beam.dir, proj);
      const dist = _v2.distanceTo(ctx.playerPos);
      if (dist < beam.width * 0.95 + 0.55 && this.beamDamageCd <= 0) {
        this.beamDamageCd = 0.42;
        ctx.onPlayerHitByBoss(9);
      }
    }
  }

  _updateDeath(dt, ctx) {
    this.deathT += dt;
    const stages = 16;
    const idx = Math.floor(this.deathT / 0.22);
    if (idx > this.deathStage && this.deathStage < stages) {
      this.deathStage = idx;
      const r = 5 * this.conf.modelScale;
      const x = this.pos.x + rand(-r, r);
      const y = this.pos.y + rand(-r * 0.4, r * 0.4);
      const z = this.pos.z + rand(-r * 0.5, r * 0.5);
      this.effects.explosion(x, y, z, rand(0.9, 2.4), chance(0.5) ? 0xffc060 : this.conf.accent);
      this.audio.explode(rand(0.6, 1.5));
      ctx.trauma.add(0.28);
    }
    this.group.rotation.z += dt * 0.35 * this.deathStage * 0.12;
    this.group.position.y -= dt * 1.2;
    if (this.deathT > 3.4 && this.state === 'dying') {
      this.state = 'dead';
      this.effects.explosion(this.pos.x, this.pos.y, this.pos.z, 5.5, 0xffffff, { smokeOpacity: 0.4 });
      this.effects.shockwave(this.pos.x, this.pos.y, this.pos.z, 4, 140, 1.4, 1, 0xffffff);
      this.audio.explode(2.6);
      ctx.trauma.add(1);
      this.group.visible = false;
      this.alive = false;
      this.active = false;
      ctx.onBossGone(this);
    }
  }

  get hpFrac() {
    return clamp(this.hp / this.maxHp, 0, 1);
  }
  /** 当前弹幕招式名（观测/HUD 用） */
  get patternName() {
    const p = this._patterns && this._patterns[this.patternIdx];
    return p ? p.name : null;
  }
  /** 阶段切换 / 登场 / 濒死期间 BOSS 免疫伤害，用于 HUD 提示 */
  get invulnerable() {
    return this.state === 'enter' || this.state === 'transition' || this.state === 'dying';
  }
  get isDying() {
    return this.state === 'dying' || this.state === 'dead';
  }
}

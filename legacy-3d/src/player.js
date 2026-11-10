/**
 * player.js — 玩家战机「SF-71」
 * 无限强化：火力 / 散射 / 导弹 / 僚机 / 护盾 / 核弹 全部可无限叠加
 */
import * as THREE from '../vendor/three/three.module.js';
import { WEAPON, POWERUPS } from './config.js';
import { clamp, damp, rand, TAU, mulberry32 } from './util.js';
import { buildPlayerShip } from './ship.js';
import { applyFlash, collectFlashables, glowSpriteObject } from './meshlib.js';

/** 机体显示缩放。模型本身约 7.5 单位长，配合 game.camDist 决定屏占比。 */
const SHIP_SCALE = 0.62;

export class Player {
  constructor(scene, combat, effects, audio) {
    this.scene = scene;
    this.combat = combat;
    this.effects = effects;
    this.audio = audio;

    this.group = new THREE.Group();
    this.model = buildPlayerShip();
    this.model.scale.setScalar(SHIP_SCALE);
    collectFlashables(this.model);
    this.group.add(this.model);
    this.group.position.set(0, -8, -6);
    scene.add(this.group);

    // 命中点提示（聚焦时可见）
    this.hitDot = glowSpriteObject(0xffffff, 0.9, 3.0, 0.0);
    this.group.add(this.hitDot);

    this.pos = this.group.position;
    this.vel = new THREE.Vector3();
    this.trailClock = 0;
    this.muzzleClock = 0;
    this.setup = null;
    this.reset({ playerHp: 100, playerLives: 3, invulnTime: 2.6 });
  }

  reset(diff) {
    this.diff = diff;
    this.maxHp = diff.playerHp;
    this.hp = this.maxHp;
    this.lives = diff.playerLives;
    this.shields = 0;         // 护盾层数（可无限叠加）
    this.bombs = 2;
    this.levels = { power: 1, spread: 0, missile: 0, drone: 0, shield: 0 };
    this.totalPowerups = 0;
    this.invuln = diff.invulnTime;
    this.alive = true;
    this.fireCd = 0;
    this.missileCd = 0;
    this.bombFlash = 0;
    this.hitPulse = 0;
    this.damageFlash = 0;
    this.time = 0;
    this.group.visible = true;
    this.group.position.set(0, -8, -6);
    this.group.rotation.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.combat.setDroneCount(0, this.pos);
    this.model.userData.shieldMat.uniforms.uOpacity.value = 0;
  }

  /* ---------------- 数值推导（无限成长） ---------------- */
  get power() { return this.levels.power; }
  get barrels() {
    const n = 1 + Math.floor((this.power - 1) / WEAPON.barrelsPerTwoPower);
    return Math.min(WEAPON.maxVisualBarrels, n);
  }
  get bulletDamage() {
    return WEAPON.baseDamage * (1 + WEAPON.damageScalePerPower * (this.power - 1));
  }
  get fireInterval() {
    return Math.max(WEAPON.minInterval, WEAPON.baseInterval - (this.power - 1) * WEAPON.intervalPerPower);
  }
  get spreadPairs() { return Math.min(5, this.levels.spread); }
  get spreadDamageBonus() { return 1 + Math.max(0, this.levels.spread - 5) * 0.09; }
  get missileVolley() { return Math.min(6, this.levels.missile); }
  get missileDamage() { return WEAPON.missileDamage * (1 + Math.max(0, this.levels.missile - 6) * 0.12); }
  get droneCount() { return this.levels.drone; }
  get magnetRange() { return 4.5 + Math.min(12, this.levels.power * 0.35 + this.levels.shield * 0.6); }

  /** 估算 DPS，用于 HUD 展示与 BOSS 伤害递增 */
  get dps() {
    const main = (this.barrels * this.bulletDamage) / this.fireInterval;
    const spread = (this.spreadPairs * 2 * this.bulletDamage * 0.62) / (this.fireInterval * 1.35);
    const missiles = this.missileVolley > 0 ? (this.missileVolley * this.missileDamage) / (WEAPON.missileInterval / (1 + Math.min(1.2, this.levels.missile * 0.08))) : 0;
    const drones = (this.droneCount * WEAPON.droneDamage) / WEAPON.droneFireInterval;
    return (main + spread + missiles + drones) * this.spreadDamageBonus;
  }

  /* ---------------- 掉落拾取 ---------------- */
  applyPowerup(type) {
    const L = this.levels;
    this.totalPowerups++;
    switch (type) {
      case 'power': L.power++; break;
      case 'spread': L.spread++; break;
      case 'missile': L.missile++; break;
      case 'drone':
        L.drone++;
        this.combat.setDroneCount(this.droneCount, this.pos);
        break;
      case 'shield':
        L.shield++;
        this.shields = Math.min(99, this.shields + 1);
        break;
      case 'bomb': this.bombs = Math.min(99, this.bombs + 1); break;
      case 'repair': this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.35); break;
      case 'score': break;
    }
    if (type !== 'score') this.audio.powerUp();
    this.hitPulse = Math.max(this.hitPulse, 0.6);
  }

  /* ---------------- 开火 ---------------- */
  fire(ctx) {
    const n = this.barrels;
    const dmg = this.bulletDamage * this.spreadDamageBonus;
    const speed = WEAPON.bulletSpeed;
    const z = this.pos.z - 2.6;
    const y = this.pos.y;
    const x0 = this.pos.x;

    // 炮口横向分布
    const span = n === 1 ? 0 : 1.05;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      const ox = t * span;
      // 外侧炮口略微外扩，形成扇形
      const ang = t * 0.045 * (1 + Math.min(2.2, this.power * 0.075));
      this.combat.spawnPlayerBullet(
        x0 + ox, y + 0.15, z,
        Math.sin(ang) * speed, Math.cos(ang) * speed * 0, -speed * Math.cos(ang),
        dmg,
        { radius: 0.28, vis: 1.05 + Math.min(0.55, this.power * 0.03), color: 0x9ff0ff }
      );
      if (i % 2 === 0) this.effects.muzzle(x0 + ox, y + 0.3, z + 0.4, 0x9fe8ff, 1.0);
    }

    // 散射副炮
    const pairs = this.spreadPairs;
    for (let i = 0; i < pairs; i++) {
      const a = 0.14 + i * 0.13;
      const d2 = dmg * 0.62;
      for (const s of [-1, 1]) {
        this.combat.spawnPlayerBullet(
          x0 + s * (0.8 + i * 0.22), y + 0.1, z + 0.4,
          Math.sin(a) * s * speed * 0.85, Math.sin(a) * 0.0, -speed * 0.86 * Math.cos(a),
          d2,
          { radius: 0.24, vis: 0.95, color: 0x66e0ff, life: 2.4 }
        );
      }
    }

    this.audio.shoot(this.power);
  }

  fireMissiles(ctx) {
    const n = this.missileVolley;
    if (n <= 0) return;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      const target = ctx.findNearestEnemy(this.pos, 160);
      this.combat.launchMissile(
        this.pos.x + t * 1.6, this.pos.y - 0.1, this.pos.z - 1.2,
        new THREE.Vector3(t * 0.6, 0.15, -1),
        target,
        this.missileDamage,
        42 + Math.min(30, this.levels.missile * 2)
      );
    }
    this.audio.plasma(3);
  }

  /* ---------------- 核弹 ---------------- */
  useBomb(ctx) {
    if (this.bombs <= 0) return false;
    this.bombs--;
    this.audio.bomb();
    this.effects.explosion(this.pos.x, this.pos.y, this.pos.z - 6, 4.2, 0xffe08a, { smokeOpacity: 0.6 });
    for (let i = 0; i < 5; i++) {
      this.effects.shockwave(this.pos.x, this.pos.y, this.pos.z - 10 - i * 6, 2 + i * 3, 90 + i * 12, 0.8 + i * 0.14, 0.9 - i * 0.13, i % 2 ? 0x9ff0ff : 0xffd070);
    }
    this.combat.clearEnemyBullets(0, null);
    ctx.onBomb(this.pos);
    this.bombFlash = 1;
    return true;
  }

  /* ---------------- 受击 ---------------- */
  /** @returns {'shield'|'damage'|'none'} */
  hit(amount, ctx) {
    if (this.invuln > 0 || !this.alive) return 'none';
    if (this.shields > 0) {
      this.shields--;
      this.audio.hit();
      this.invuln = 0.9;
      this.hitPulse = 1;
      this.effects.shockwave(this.pos.x, this.pos.y, this.pos.z, 1.2, 9, 0.42, 0.95, 0x7ff0ff);
      this.effects.hitSpark(this.pos.x, this.pos.y, this.pos.z, 0x8fe8ff, 2.2, 16);
      ctx.trauma.add(0.24);
      return 'shield';
    }
    this.hp -= amount;
    this.damageFlash = 1;
    this.audio.playerHit();
    this.effects.hitSpark(this.pos.x, this.pos.y, this.pos.z, 0xff8a5c, 2.0, 18);
    ctx.trauma.add(0.5);
    if (this.hp <= 0) {
      this.die(ctx);
      return 'damage';
    }
    this.invuln = Math.max(this.invuln, 0.75);
    return 'damage';
  }

  die(ctx) {
    this.alive = false;
    this.lives--;
    this.audio.explode(2.4);
    this.effects.explosion(this.pos.x, this.pos.y, this.pos.z, 3.4, 0x9fe8ff);
    this.effects.explosion(this.pos.x, this.pos.y, this.pos.z - 2, 2.2, 0xffc060);
    this.effects.shockwave(this.pos.x, this.pos.y, this.pos.z, 1, 26, 0.9, 1, 0xcfefff);
    ctx.trauma.add(1);
    this.group.visible = false;
    this.combat.setDroneCount(0, this.pos);
    ctx.onPlayerDeath(this);
  }

  respawn() {
    this.hp = this.maxHp;
    this.alive = true;
    this.group.visible = true;
    this.group.position.set(0, -8, -6);
    this.group.rotation.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.invuln = this.diff.invulnTime;
    this.shields = Math.max(this.shields, 0);
    // 损失一半强化等级（最低 1）
    this.levels.power = Math.max(1, Math.ceil(this.levels.power * 0.6));
    this.levels.spread = Math.floor(this.levels.spread * 0.5);
    this.levels.missile = Math.floor(this.levels.missile * 0.5);
    this.levels.drone = Math.floor(this.levels.drone * 0.5);
    this.combat.setDroneCount(this.droneCount, this.pos);
    this.effects.shockwave(this.pos.x, this.pos.y, this.pos.z, 0.5, 12, 0.5, 0.9, 0x7ff0ff);
  }

  /* ---------------- 每帧 ---------------- */
  update(dt, input, ctx) {
    this.time += dt;
    if (!this.alive) {
      this.invuln = Math.max(0, this.invuln - dt);
      return;
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.hitPulse = Math.max(0, this.hitPulse - dt * 2.6);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.2);
    this.bombFlash = Math.max(0, this.bombFlash - dt * 1.6);

    const b = ctx.bounds;
    const maxSpeed = input.focus ? 17 : 40;

    /* --- 移动：键盘速度制 / 指针直接跟随 --- */
    let ax = 0, ay = 0;
    if (input.usingKeyboard || ctx.forceKeyboard) {
      ax = input.move.x;
      ay = input.move.y;
    }
    if (ax !== 0 || ay !== 0) {
      this.vel.x = damp(this.vel.x, ax * maxSpeed, 11, dt);
      this.vel.y = damp(this.vel.y, ay * maxSpeed, 11, dt);
    } else {
      this.vel.x = damp(this.vel.x, 0, 9, dt);
      this.vel.y = damp(this.vel.y, 0, 9, dt);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    if (!input.usingKeyboard && input.pointer.active && ctx.pointerWorld) {
      // 指针 1:1 跟随（带平滑）
      const tx = ctx.pointerWorld.x;
      const ty = ctx.pointerWorld.y;
      const k = 1 - Math.exp(-(input.focus ? 13 : 22) * dt);
      const px = this.pos.x + (tx - this.pos.x) * k;
      const py = this.pos.y + (ty - this.pos.y) * k;
      this.vel.x = (px - this.pos.x) / Math.max(dt, 1e-4);
      this.vel.y = (py - this.pos.y) / Math.max(dt, 1e-4);
      this.pos.x = px;
      this.pos.y = py;
    }

    this.pos.x = clamp(this.pos.x, b.minX, b.maxX);
    this.pos.y = clamp(this.pos.y, b.minY, b.maxY);
    this.pos.z = ctx.playerZ;

    /* --- 姿态 --- */
    const vn = clamp(this.vel.x / 40, -1, 1);
    const vny = clamp(this.vel.y / 40, -1, 1);
    const m = this.model;
    m.rotation.z = damp(m.rotation.z, -vn * 0.62, 9, dt);
    m.rotation.x = damp(m.rotation.x, vny * 0.20, 9, dt);
    m.rotation.y = damp(m.rotation.y, -vn * 0.16, 9, dt);

    /* --- 引擎 --- */
    const spd = Math.hypot(this.vel.x, this.vel.y);
    const glow = 0.7 + spd / 40 * 0.9 + Math.sin(this.time * 22) * 0.05;
    for (const f of m.userData.flameMats) {
      f.uniforms.uPower.value = glow;
      f.uniforms.uTime.value = this.time;
    }
    for (let i = 0; i < m.userData.thrusters.length; i++) {
      const t = m.userData.thrusters[i];
      t.children.forEach((c) => {
        if (c.isSprite) c.material.opacity = 0.45 + glow * 0.4;
      });
    }

    // 引擎尾迹粒子
    this.trailClock += dt;
    if (this.trailClock > 0.022) {
      this.trailClock = 0;
      for (const e of m.userData.engineDefs) {
        const wp = e.x * SHIP_SCALE, wy = e.y * SHIP_SCALE, wz = e.z * SHIP_SCALE;
        this.effects.engineTrail(
          this.pos.x + wp, this.pos.y + wy, this.pos.z + wz + 1.2,
          -this.vel.x * 0.25 + rand(-2, 2) - vn * 6,
          -this.vel.y * 0.25 + rand(-2, 2),
          rand(16, 34),
          0x66d8ff, 0.55 + glow * 0.3
        );
      }
    }

    /* --- 航行灯闪烁 --- */
    const blink = (Math.sin(this.time * 4.2) > 0.4) ? 1 : 0.06;
    m.userData.navR.material.color.setScalar(blink * 3);
    m.userData.navL.material.color.setScalar(blink * 3);

    /* --- 护盾外壳 --- */
    const sm = m.userData.shieldMat;
    // 护盾材质只保留掠射边缘（见 meshlib.shieldMaterial），
    // 所以这里给足不透明度也只是让球壳边缘更清晰，不会糊住机体。
    const target = this.shields > 0 ? clamp(0.38 + this.shields * 0.10, 0, 0.95) : 0;
    sm.uniforms.uOpacity.value = damp(sm.uniforms.uOpacity.value, target, 8, dt);
    sm.uniforms.uTime.value = this.time;
    sm.uniforms.uHit.value = damp(sm.uniforms.uHit.value, this.hitPulse, 10, dt);
    m.userData.shield.visible = sm.uniforms.uOpacity.value > 0.01;

    /* --- 无敌闪烁：用整体缩放脉冲表现，避免污染共享材质 --- */
    const flick = this.invuln > 0 ? (Math.sin(this.time * 42) > -0.2 ? 1 : 0.12) : 1;
    m.scale.setScalar(SHIP_SCALE * (flick < 1 ? 0.965 : 1));

    /* --- 低血量冒烟 --- */
    if (this.hp / this.maxHp < 0.34 && Math.random() < 0.5) {
      this.effects.glowLayer.spawn(
        this.pos.x + rand(-1, 1), this.pos.y + rand(-0.6, 0.8), this.pos.z + 1,
        rand(-6, 6), rand(4, 14), rand(4, 12),
        { life: rand(0.35, 0.8), size0: rand(0.5, 1.0), size1: 2.0, drag: 1.4, color0: new THREE.Color(0xff7733), color1: new THREE.Color(0x33180c), alpha0: 0.7, alpha1: 0 }
      );
    }

    /* --- 命中点提示 --- */
    this.hitDot.material.opacity = damp(this.hitDot.material.opacity, input.focus ? 0.9 : 0, 10, dt);

    /* --- 开火（自动连射） --- */
    this.fireCd -= dt;
    this.missileCd -= dt;
    if (ctx.canFire && this.fireCd <= 0) {
      this.fireCd = this.fireInterval;
      this.fire(ctx);
    }
    if (ctx.canFire && this.missileCd <= 0 && this.missileVolley > 0) {
      this.missileCd = WEAPON.missileInterval / (1 + Math.min(1.2, this.levels.missile * 0.08));
      this.fireMissiles(ctx);
    }

    // 受击闪白
    const flash = Math.max(this.hitPulse * 0.35, this.damageFlash);
    applyFlash(this.model, flash);
  }
}

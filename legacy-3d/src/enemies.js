/**
 * enemies.js — 敌机行为系统
 * 行为：突进 / 蛇形 / 驻守扫射 / 横越 / 环绕 / 漂移诡雷
 */
import * as THREE from '../vendor/three/three.module.js';
import { makeEnemy, buildAsteroid } from './enemymesh.js';
import { applyFlash, cloneMaterials, collectFlashables } from './meshlib.js';
import { clamp, damp, rand, randInt, chance, pick, TAU } from './util.js';
import { POWERUPS } from './config.js';

/* ------------------------------------------------------------------ *
 * 基础属性表
 * ------------------------------------------------------------------ */
export const ENEMY_STATS = {
  scout: {
    hp: 24, speed: 30, radius: 1.0, scale: 1.05, score: 60,
    accent: 0xff7a3d, ramDamage: 16, contactDamage: 16,
    dropChance: 0.16, behavior: 'dive',
  },
  interceptor: {
    hp: 68, speed: 20, radius: 1.55, scale: 0.80, score: 140,
    accent: 0xff4d4d, ramDamage: 24, contactDamage: 22,
    dropChance: 0.26, behavior: 'hold',
  },
  bomber: {
    hp: 260, speed: 11, radius: 2.5, scale: 0.95, score: 340,
    accent: 0xffc23d, ramDamage: 34, contactDamage: 34,
    dropChance: 0.55, behavior: 'advance-hold',
  },
  turret: {
    hp: 130, speed: 6.5, radius: 1.6, scale: 1.0, score: 190,
    accent: 0xc06bff, ramDamage: 20, contactDamage: 20,
    dropChance: 0.34, behavior: 'drift',
  },
  mine: {
    hp: 40, speed: 10, radius: 1.25, scale: 1.0, score: 90,
    accent: 0x4dffd2, ramDamage: 26, contactDamage: 26,
    dropChance: 0.12, behavior: 'drift-mine',
  },
  asteroid: {
    hp: 240, speed: 15, radius: 2.8, scale: 1.0, score: 120,
    accent: 0xff9a4d, ramDamage: 30, contactDamage: 30,
    dropChance: 0.42, behavior: 'rock',
  },
};

const DROP_TABLE_NORMAL = [
  ['power', 26], ['spread', 12], ['missile', 10], ['drone', 8],
  ['shield', 14], ['bomb', 6], ['repair', 14], ['score', 10],
];
const DROP_TABLE_HEAVY = [
  ['power', 22], ['spread', 12], ['missile', 12], ['drone', 12],
  ['shield', 16], ['bomb', 10], ['repair', 8], ['score', 8],
];

function weightedPick(table) {
  let total = 0;
  for (const t of table) total += t[1];
  let r = Math.random() * total;
  for (const t of table) {
    r -= t[1];
    if (r <= 0) return t[0];
  }
  return table[0][0];
}

/* ------------------------------------------------------------------ *
 * 敌机实例
 * ------------------------------------------------------------------ */
class Enemy {
  constructor(type, accent) {
    this.type = type;
    if (type === 'asteroid') {
      this.obj = buildAsteroid(2.4, randInt(1, 999), 0x6a5a52).clone(true);
      this.obj.children[0].material = this.obj.children[0].material.clone();
      this.obj.scale.setScalar(1);
      collectFlashables(this.obj);
      this.rockMesh = this.obj.children[0];
    } else {
      this.obj = makeEnemy(type, accent);
    }
    this.obj.visible = false;
    this.pos = this.obj.position;
    this.vel = new THREE.Vector3();
    this.alive = false;
    this.isEnemy = true;
  }
  configure(stat, diff, opts) {
    this.stat = stat;
    this.radius = stat.radius * (opts.scaleMul || 1);
    this.maxHp = stat.hp * diff.enemyHpMul * (opts.hpMul || 1);
    this.hp = this.maxHp;
    this.score = Math.floor(stat.score * diff.scoreMul);
    this.contactDamage = stat.contactDamage;
    this.obj.scale.setScalar(stat.scale * (opts.scaleMul || 1));
    this.t = 0;
    this.hitFlash = 0;
    this.fireCd = rand(0.4, 1.6);
    this.burstLeft = 0;
    this.burstCd = 0;
    this.patternPhase = rand(0, TAU);
    this.spawnedBullets = 0;
    this.phase = 'enter';
    this.behavior = opts.behavior || stat.behavior;
    this.targetX = opts.x ?? 0;
    this.targetY = opts.y ?? 0;
    this.baseX = opts.x ?? 0;
    this.baseY = opts.y ?? 0;
    this.holdZ = opts.holdZ ?? rand(-34, -22);
    this.aggression = opts.aggression ?? 1;
    this.sweepDir = opts.sweepDir ?? (Math.random() < 0.5 ? -1 : 1);
    this.diff = diff;
    this.inList = false;
    this.phase = 'enter';
  }
}

/* ================================================================== *
 * 敌机管理器
 * ================================================================== */
export class Enemies {
  constructor(scene, combat, effects, audio) {
    this.scene = scene;
    this.combat = combat;
    this.effects = effects;
    this.audio = audio;
    this.pools = new Map();      // type -> Enemy[]
    this.list = [];
    this.bounds = { minX: -22, maxX: 22, minY: -16, maxY: 12 };
    this.onKill = null;
    this.time = 0;
  }

  obtain(type, accent) {
    let pool = this.pools.get(type);
    if (!pool) {
      pool = [];
      this.pools.set(type, pool);
    }
    let e = pool.find((o) => !o.alive);
    if (!e) {
      e = new Enemy(type, accent);
      this.scene.add(e.obj);
      pool.push(e);
    }
    return e;
  }

  spawn(type, opts = {}) {
    const stat = ENEMY_STATS[type];
    if (!stat) return null;
    const diff = opts.diff;
    const accent = opts.accent ?? stat.accent;
    const e = this.obtain(type, accent);
    e.alive = true;
    e.obj.visible = true;
    e.configure(stat, diff, opts);
    e.pos.set(opts.x ?? rand(-14, 14), opts.y ?? rand(4, 11), opts.z ?? -96);
    if (opts.vx != null) e.vel.x = opts.vx;
    e.vel.z = stat.speed * (opts.speedMul || 1);
    applyFlash(e.obj, 0);
    if (!e.inList) {
      e.inList = true;
      this.list.push(e);
    }
    return e;
  }

  setDifficulty(diff) {
    this.diff = diff;
    this.dropMul = diff.dropMul;
  }

  /* ---------------- 伤害 / 死亡 ---------------- */
  damage(e, amount, ctx) {
    if (!e.alive) return;
    e.hp -= amount;
    e.hitFlash = Math.min(1, e.hitFlash + amount / Math.max(20, e.maxHp * 0.22) + 0.18);
    if (e.hp <= 0) this.kill(e, ctx);
    else this.audio.hit();
  }

  kill(e, ctx) {
    e.alive = false;
    e.obj.visible = false;
    const power = clamp(0.55 + e.maxHp / 240, 0.6, 2.6);
    this.effects.explosion(e.pos.x, e.pos.y, e.pos.z, power, e.stat.accent);
    this.audio.explode(clamp(power * 0.45, 0.35, 1.6));
    ctx.trauma.add(clamp(power * 0.12, 0.05, 0.3));
    ctx.addScore(e.score, e.pos);

    // 诡雷死亡放环形弹
    if (e.type === 'mine') {
      this.combat.spawnRing(e.pos.x, e.pos.y, e.pos.z, 10, 22, rand(0, TAU), {
        color: 0x4dffd2, radius: 0.3, damage: 10, speed3d: true, vz: 20,
      });
    }
    // 掉落
    const dch = e.stat.dropChance * this.diffDropMul(e);
    if (chance(dch)) {
      const table = e.maxHp > 120 ? DROP_TABLE_HEAVY : DROP_TABLE_NORMAL;
      this.combat.spawnPickup(e.pos.x, e.pos.y, e.pos.z, weightedPick(table));
    }
    if (this.onKill) this.onKill(e, ctx);
  }

  diffDropMul(e) {
    return this.dropMul || 1;
  }

  /* ---------------- 每帧 ---------------- */
  update(dt, ctx) {
    this.time += dt;
    const player = ctx.playerPos;
    const b = this.bounds;

    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.alive) continue;
      e.t += dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt * 4.2);
      applyFlash(e.obj, e.hitFlash);

      // 旋转部件
      const spinners = e.obj.userData.spinners;
      if (spinners) {
        for (const sp of spinners) {
          if (sp.axis === 'z') sp.obj.rotation.z += sp.speed * dt;
          else if (sp.axis === 'y') sp.obj.rotation.y += sp.speed * dt;
          else sp.obj.rotation.x += sp.speed * dt;
        }
      }

      const speed = e.vel.z;
      switch (e.behavior) {
        case 'dive': this.behDive(e, dt, player); break;
        case 'hold': this.behHold(e, dt, player, b); break;
        case 'advance-hold': this.behAdvanceHold(e, dt, player, b); break;
        case 'drift': this.behDrift(e, dt, player, b); break;
        case 'drift-mine': this.behMine(e, dt, player, ctx); break;
        case 'sweep': this.behSweep(e, dt, player, b); break;
        case 'rock': this.behRock(e, dt, player); break;
        default: this.behDive(e, dt, player); break;
      }

      // 推进 z
      e.pos.z += speed * dt;
      e.pos.x += e.vel.x * dt;
      e.pos.y += e.vel.y * dt;

      // 侧倾动画
      if (e.behavior !== 'rock') {
        const bank = clamp(e.vel.x / 22, -1, 1);
        e.obj.rotation.z = damp(e.obj.rotation.z, -bank * 0.7, 6, dt);
        e.obj.rotation.y = damp(e.obj.rotation.y, clamp((player.x - e.pos.x) / 30, -1, 1) * 0.3, 4, dt);
      }

      // 引擎辉光呼吸
      const flames = e.obj.userData.refs?.flames;
      if (flames) {
        for (const f of flames) {
          f.visible = e.pos.z > -190;
          f.scale.setScalar(0.85 + Math.sin(this.time * 30 + e.patternPhase) * 0.12);
        }
      }

      // 越界销毁
      if (e.pos.z > 16) {
        e.alive = false;
        e.obj.visible = false;
        continue;
      }
      // 远距离未进入战斗时不出界
      if (Math.abs(e.pos.x) > 90 || Math.abs(e.pos.y) > 70) {
        e.alive = false;
        e.obj.visible = false;
      }
    }
  }

  /* ---------------- 行为实现 ---------------- */

  behDive(e, dt, player) {
    // 直扑玩家
    const tx = player.x;
    const ty = player.y;
    e.vel.x = damp(e.vel.x, clamp((tx - e.pos.x) * 0.9, -16, 16), 1.6, dt);
    e.vel.y = damp(e.vel.y, clamp((ty - e.pos.y) * 0.7, -13, 13), 1.4, dt);
  }

  behHold(e, dt, player, b) {
    // 前进到 holdZ 后驻守，横向游走并瞄准射击
    if (e.phase === 'enter') {
      e.vel.z = damp(e.vel.z, 0, 2.2, dt);
      if (e.pos.z > e.holdZ) e.phase = 'hold';
    } else {
      e.vel.z = damp(e.vel.z, 1.6, 2, dt);
      e.pos.z = Math.min(e.pos.z, e.holdZ + 6);
      const amp = 9.5;
      const tx = e.baseX + Math.sin(e.t * 0.72 + e.patternPhase) * amp;
      e.vel.x = damp(e.vel.x, clamp((tx - e.pos.x) * 1.7, -15, 15), 4, dt);
      e.vel.y = damp(e.vel.y, clamp((e.baseY + 2 - e.pos.y) * 1.2, -7, 7), 3, dt);
      this.tryFire(e, dt, player, 'aimed');
    }
  }

  behAdvanceHold(e, dt, player, b) {
    if (e.phase === 'enter') {
      if (e.pos.z > e.holdZ - 8) e.phase = 'hold';
      e.vel.x = damp(e.vel.x, (e.baseX - e.pos.x) * 0.7, 2, dt);
    } else {
      e.vel.z = damp(e.vel.z, 2.4, 2, dt);
      const tx = e.baseX + Math.sin(e.t * 0.35 + e.patternPhase) * 6.5;
      e.vel.x = damp(e.vel.x, clamp((tx - e.pos.x) * 0.8, -7, 7), 2.4, dt);
      e.vel.y = damp(e.vel.y, clamp((e.baseY - e.pos.y) * 0.8, -4, 4), 2, dt);
      this.tryFire(e, dt, player, 'spread');
    }
  }

  behDrift(e, dt, player, b) {
    e.vel.x = damp(e.vel.x, Math.sin(e.t * 0.5 + e.patternPhase) * 6, 1.6, dt);
    e.vel.y = damp(e.vel.y, Math.cos(e.t * 0.42 + e.patternPhase) * 4, 1.6, dt);
    const sp = e.obj.userData.spinners;
    if (sp) for (const s of sp) s.obj.rotation.z += dt * 1.6;
    this.tryFire(e, dt, player, 'ring');
  }

  behMine(e, dt, player, ctx) {
    e.vel.x = damp(e.vel.x, Math.sin(e.t * 0.4 + e.patternPhase) * 5, 1.4, dt);
    const d = Math.hypot(player.x - e.pos.x, player.y - e.pos.y, player.z - e.pos.z);
    if (d < 7.5 && e.phase !== 'burst' && ctx) {
      e.phase = 'burst';
      e.hp = 0;
      this.kill(e, ctx);
      return;
    }
    e.obj.rotation.y += dt * 0.9;
    e.obj.rotation.x += dt * 0.7;
  }

  behSweep(e, dt, player, b) {
    e.vel.x = damp(e.vel.x, e.sweepDir * 17, 1.4, dt);
    e.vel.y = damp(e.vel.y, Math.sin(e.t * 1.6 + e.patternPhase) * 3, 2, dt);
    if (Math.abs(e.pos.x) > b.maxX + 4) e.sweepDir *= -1;
    this.tryFire(e, dt, player, 'aimed');
  }

  behRock(e, dt, player) {
    // 陨石：缓慢漂移 + 自转，接触即伤
    e.vel.x = damp(e.vel.x, Math.sin(e.t * 0.3 + e.patternPhase) * 3.4, 1.0, dt);
    e.vel.y = damp(e.vel.y, Math.cos(e.t * 0.24 + e.patternPhase) * 2.4, 1.0, dt);
    e.obj.rotation.x += dt * 0.5;
    e.obj.rotation.y += dt * 0.35;
    e.obj.rotation.z += dt * 0.28;
  }

  /* ---------------- 射击 ---------------- */
  tryFire(e, dt, player, pattern) {
    e.fireCd -= dt * e.aggression;
    if (e.fireCd > 0) return;
    const diff = e.diff;
    const bspeed = diff.enemyBulletSpeedMul;
    const base = pattern === 'ring' ? 2.1 : pattern === 'spread' ? 2.4 : 1.5;
    e.fireCd = rand(base * 0.75, base * 1.35) * diff.enemyFireMul * (e.maxHp > 120 ? 1.25 : 1);

    const from = { x: e.pos.x, y: e.pos.y, z: e.pos.z - 1.4 };
    const dx = player.x - from.x;
    const dy = player.y - from.y;
    const dz = player.z - from.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    // 恒定飞行时间，保证不同距离的弹幕都好看
    const spd = clamp(dist / 0.78, 26, 62) * bspeed;
    const ux = dx / dist, uy = dy / dist, uz = dz / dist;

    if (pattern === 'aimed') {
      const n = e.type === 'interceptor' ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const jitter = (Math.random() - 0.5) * 0.06;
        this.combat.spawnEnemyBullet(
          from.x, from.y, from.z,
          (ux + jitter) * spd, (uy + jitter) * spd, uz * spd,
          { color: 0xff6a5c, radius: 0.32, damage: 11, needle: true, life: 4 }
        );
      }
    } else if (pattern === 'spread') {
      const count = 5 + (e.maxHp > 120 ? 2 : 0);
      const aim = Math.atan2(dy, dx);
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
        const a = aim + t * 0.66;
        this.combat.spawnEnemyBullet(
          from.x, from.y, from.z,
          Math.cos(a) * spd, Math.sin(a) * spd, uz * spd,
          { color: 0xffc23d, radius: 0.42, damage: 13, life: 5 }
        );
      }
      this.audio.plasma(1);
    } else if (pattern === 'ring') {
      const arms = 8;
      const phase = e.patternPhase + e.t * 1.5;
      this.combat.spawnSpiral(from.x, from.y, from.z, arms, phase, 20, {
        color: 0xc06bff, radius: 0.36, damage: 12, vz: 19 * bspeed, speed3d: true,
      });
      this.audio.plasma(1);
    }
  }

  /* ---------------- 查询 ---------------- */
  forEach(fn) {
    for (let i = 0; i < this.list.length; i++) if (this.list[i].alive) fn(this.list[i]);
  }
  count() {
    let n = 0;
    for (const e of this.list) if (e.alive) n++;
    return n;
  }
  clear() {
    for (const e of this.list) {
      e.alive = false;
      e.obj.visible = false;
    }
  }
  /** 全屏伤害（核弹） */
  damageAll(amount, ctx) {
    for (const e of this.list) {
      if (e.alive) this.damage(e, amount, ctx);
    }
  }
}

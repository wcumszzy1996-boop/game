/**
 * enemies.js — 敌机 / 运动模式 / 开火模式
 *
 * 关于「敌机射击速度」：每型敌机的 fire 基准间隔都刻意拉长，
 * 再乘上三层倍率：难度 diff.enemyFireMul（普通 1.24 / 精英 0.92）
 * × 全局保险系数 ENEMY_FIRE_SAFETY(1.15) × **关卡倍率 LEVELS[].enemyFireMul**。
 * 关卡倍率是本次新增的：第 1 关 1.25（射速再削弱 20%，作为教学关），第 2/3 关 1.0。
 * 因此普通难度第 1 关小型机的有效间隔约 3.65 秒，第 2/3 关约 2.92 秒。
 *
 * 所有敌机在开火前有短暂「蓄能」预警（枪口亮起），配合降低后的射速，
 * 让弹幕是可读、可躲的。
 *
 * 关于「敌机生命值与攻击力」（本轮上调）：
 *   - hp 整体上调约 70%（图鉴里即为真实基准值，再乘难度 enemyHpMul）
 *   - 每型新增 dmg 字段 = 单发弹丸伤害，在 _shoot() 里传给 BulletField；
 *     因此"打中一下有多疼"可以直接按机型分别调，而不是所有敌弹一个值。
 */
import * as THREE from '../vendor/three/three.module.js';
import { LAYER, ENEMY_FIRE_SAFETY, WORLD } from './config.js';
import { rand, chance, clamp, TAU, damp } from './util.js';

const HALF_H = WORLD.VIEW_H / 2;
const BY = WORLD.boundY;

const _c = new THREE.Color();

/**
 * 敌机图鉴
 * hp / r 会再乘难度倍率；fire 为基准开火间隔（秒）
 */
export const ENEMY_TYPES = {
  scout: {
    tex: 'scout', hp: 34, dmg: 12, r: 0.40, size: 1.42, score: 60, drop: 0.13,
    fire: 2.05, bulletSpeed: 10.0, windup: 0.30, tint: 0x9fb2c4, pattern: 'single',
  },
  fighter: {
    tex: 'fighter', hp: 74, dmg: 13, r: 0.52, size: 1.95, score: 110, drop: 0.22,
    fire: 1.80, bulletSpeed: 11.5, windup: 0.32, tint: 0xd8b08a, pattern: 'aim3',
  },
  gunship: {
    tex: 'gunship', hp: 260, dmg: 15, r: 0.76, size: 2.55, score: 280, drop: 0.44,
    fire: 2.35, bulletSpeed: 10.6, windup: 0.42, tint: 0xc8d4e0, pattern: 'spread5',
  },
  bomber: {
    tex: 'bomber', hp: 440, dmg: 17, r: 0.96, size: 3.15, score: 420, drop: 0.62,
    fire: 2.60, bulletSpeed: 9.4, windup: 0.50, tint: 0xc0a8d8, pattern: 'ring8',
  },
  turret: {
    tex: 'turret', hp: 195, dmg: 14, r: 0.58, size: 2.05, score: 220, drop: 0.38,
    fire: 1.55, bulletSpeed: 11.0, windup: 0.38, tint: 0xffd08a, pattern: 'radial4',
  },
  elite: {
    tex: 'elite', hp: 345, dmg: 16, r: 0.62, size: 2.25, score: 380, drop: 0.52,
    fire: 1.45, bulletSpeed: 15.0, windup: 0.26, tint: 0xff8ad8, pattern: 'aim5',
  },
  // 自杀式无人机（不射击，靠冲撞）
  drone: {
    tex: 'scout', hp: 26, dmg: 0, r: 0.34, size: 1.05, score: 50, drop: 0.10,
    fire: 0, bulletSpeed: 0, windup: 0, tint: 0xff9a6a, pattern: 'none',
  },
};

/** 弹幕颜色表 */
const BC = {
  red: [1.00, 0.16, 0.22],
  orange: [1.00, 0.52, 0.10],
  amber: [1.00, 0.76, 0.18],
  cyan: [0.22, 0.88, 1.00],
  violet: [0.72, 0.34, 1.00],
  magenta: [1.00, 0.26, 0.72],
  green: [0.34, 1.00, 0.48],
};

const _bc = (name) => {
  const c = BC[name] || BC.red;
  return c;
};

/* ================================================================== *
 * 敌机实例
 * ================================================================== */
class Enemy {
  constructor() {
    this.alive = false;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.mesh = null;
    this.aura = null;
    this.flash = 0;
    this.windup = 0;
    this.fireT = 0;
    this.bulletColor = 'red';
  }
}

/* ================================================================== *
 * 管理器
 * ================================================================== */
export class EnemyManager {
  constructor(scene, SPR, effects) {
    this.scene = scene;
    this.SPR = SPR;
    this.effects = effects;
    this.list = [];
    this.pool = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.diff = null;
    /** 关卡级开火间隔倍率（由 game.startLevel 按 LEVELS[].enemyFireMul 设置） */
    this.fireLevelMul = 1;
    this.geo = new THREE.PlaneGeometry(1, 1);
  }

  setDiff(d) {
    this.diff = d;
  }

  /**
   * 关卡级射速调整：倍率越大，开火间隔越长（射速越慢）。
   * 与难度倍率 diff.enemyFireMul、全局保险系数相乘后写入每架敌机。
   */
  setFireMul(v) {
    this.fireLevelMul = v > 0 ? v : 1;
  }

  get count() {
    return this.list.length;
  }

  /**
   * 生成一架敌机
   * @param {string} type
   * @param {object} o {x,y,move,speed,dir,phase,fireOffset,hpMul,patrolY,angle}
   */
  spawn(type, o = {}) {
    const T = ENEMY_TYPES[type] || ENEMY_TYPES.scout;
    const e = this.pool.pop() || new Enemy();
    e.type = type;
    e.T = T;
    e.alive = true;
    e.x = o.x ?? rand(-WORLD.boundX, WORLD.boundX);
    e.y = o.y ?? (HALF_H + 2.2);
    e.vx = 0; e.vy = 0;
    e.t = 0;
    e.flash = 0;
    e.windup = 0;
    e.hpMul = (this.diff ? this.diff.enemyHpMul : 1) * (o.hpMul ?? 1);
    e.maxHp = T.hp * e.hpMul;
    e.hp = e.maxHp;
    e.r = T.r;
    e.size = T.size;
    e.score = T.score;
    e.drop = T.drop;
    e.move = o.move || 'straight';
    e.speed = o.speed ?? 4.2;
    e.dir = o.dir ?? (chance(0.5) ? 1 : -1);
    e.ph = o.phase ?? rand(0, TAU);
    e.amp = o.amp ?? rand(1.4, 3.4);
    e.freq = o.freq ?? rand(0.8, 1.6);
    e.patrolY = o.patrolY ?? rand(2, 7);
    e.holdT = o.holdT ?? rand(3.5, 6.5);
    e.entered = false;
    e.dropDone = false;
    e.shots = 0;
    e.bulletColor = o.bulletColor || (type === 'elite' ? 'magenta' : type === 'bomber' ? 'violet'
      : type === 'gunship' ? 'cyan' : type === 'turret' ? 'amber' : type === 'fighter' ? 'orange' : 'red');
    e.fireMul = (this.diff ? this.diff.enemyFireMul : 1) * ENEMY_FIRE_SAFETY * this.fireLevelMul;
    e.bulletSpeed = T.bulletSpeed * (this.diff ? this.diff.enemyBulletSpeedMul : 1) * (o.bulletSpeedMul ?? 1);
    e.fireT = T.fire > 0
      ? T.fire * e.fireMul * (o.fireOffset ?? rand(0.55, 1.15))
      : Infinity;
    e.pattern = o.pattern || T.pattern;
    e.angle = o.angle ?? Math.PI * 0.5;
    e.spin = o.spin ?? 1.2;

    /* 视觉 */
    const mat = new THREE.MeshBasicMaterial({
      map: this.SPR[T.tex], transparent: true, depthWrite: false,
      color: _c.setHex(T.tint).clone(),
    });
    e.mesh = new THREE.Mesh(this.geo, mat);
    e.mesh.renderOrder = LAYER.enemy + 20;
    e.mesh.position.z = LAYER.enemy;
    e.mesh.scale.set(T.size, T.size, 1);
    e.mesh.rotation.z = Math.PI;              // 敌机机首朝下
    this.group.add(e.mesh);
    e.baseColor = mat.color.clone();

    // 命中/蓄能光晕
    const auraMat = new THREE.MeshBasicMaterial({
      map: this.SPR.glow, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0, color: new THREE.Color(1, 1, 1),
    });
    e.aura = new THREE.Mesh(this.geo, auraMat);
    e.aura.renderOrder = LAYER.enemy - 1;
    e.aura.position.z = LAYER.enemy - 0.2;
    e.aura.scale.set(T.size * 1.7, T.size * 1.7, 1);
    this.group.add(e.aura);

    e.mesh.userData.e = e;
    this.list.push(e);
    return e;
  }

  /** 伤害；返回是否击毁 */
  hurt(e, dmg, ctx, hitX, hitY) {
    if (!e.alive) return false;
    e.hp -= dmg;
    e.flash = Math.min(1, e.flash + 0.55);
    if (hitX != null) {
      this.effects.hitSpark(hitX, hitY, 0, -1, _c.setRGB(1.0, 0.85, 0.5), 0.7);
    }
    if (e.hp <= 0) {
      this.kill(e, ctx);
      return true;
    }
    return false;
  }

  kill(e, ctx) {
    if (!e.alive) return;
    e.alive = false;
    _c.setRGB(1.0, 0.72, 0.30);
    this.effects.explosion(e.x, e.y, { size: 0.9 + e.size * 0.34, color: _c });
    this.effects.debris(e.x, e.y, 1.2, _c, 6);
    if (ctx) {
      ctx.onEnemyKilled && ctx.onEnemyKilled(e);
      ctx.audio.explode(0.55 + e.size * 0.10);
      ctx.shake.add(0.035 + e.size * 0.012);
    }
  }

  /**
   * 清空（默认不放爆炸，用于换关 / 回菜单）
   *
   * 注意：必须走 _retire() 把 mesh 从 group 上摘掉。
   * 早期版本只写 `this.list.length = 0`，于是 list 空了但网格仍留在场景里，
   * 从菜单切进游戏时那些装饰性敌机就变成**永远冻结在画面上的孤儿网格**
   * （不再移动、不再参与碰撞、也永远不会消失）—— 表现为"空间里有几架不会
   * 变化的战机"。同时它们也回不了对象池。
   */
  clear(explode = false, ctx) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.alive = false;
      if (explode && ctx) this.effects.explosion(e.x, e.y, { size: 1.2, color: _c.setRGB(1, 0.7, 0.3) });
      this._retire(i, e);
    }
  }

  /* ------------------------------------------------------------------ */
  update(dt, ctx) {
    const arr = this.list;
    const px = ctx.player.pos.x, py = ctx.player.pos.y;
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i];
      if (!e.alive) {
        this._retire(i, e);
        continue;
      }
      e.t += dt;

      /* ---------- 运动 ---------- */
      let moved = true;
      switch (e.move) {
        case 'straight': {
          e.y -= e.speed * dt;
          break;
        }
        case 'sine': {
          e.y -= e.speed * dt;
          e.x = clamp(e.x + Math.cos(e.t * e.freq * TAU * 0.25 + e.ph) * e.amp * dt * 2.4, -BY, BY);
          break;
        }
        case 'swoop': {
          e.y -= e.speed * dt;
          e.x += e.dir * e.speed * 0.55 * dt;
          if (e.x > BY) { e.dir = -1; } else if (e.x < -BY) { e.dir = 1; }
          break;
        }
        case 'hover': {
          if (!e.entered) {
            e.y -= e.speed * dt;
            if (e.y <= e.patrolY) e.entered = true;
          } else {
            e.holdT -= dt;
            e.y = damp(e.y, e.patrolY + Math.sin(e.t * 1.1 + e.ph) * 0.22, 4, dt);
            e.x = clamp(e.x + Math.cos(e.t * 0.55 + e.ph) * e.amp * dt, -BY, BY);
            if (e.holdT <= 0) { e.move = 'straight'; e.speed = Math.max(e.speed, 5.5); }
          }
          break;
        }
        case 'kamikaze': {
          const want = Math.atan2(py - e.y, px - e.x);
          const cur = Math.atan2(e.vy || 0.001, e.vx);
          let d = (want - cur) % TAU;
          if (d > Math.PI) d -= TAU;
          if (d < -Math.PI) d += TAU;
          const na = cur + clamp(d, -2.4 * dt, 2.4 * dt);
          const spd = Math.min(e.speed, Math.hypot(e.vx, e.vy) + e.speed * 0.9 * dt);
          e.vx = Math.cos(na) * spd;
          e.vy = Math.sin(na) * spd;
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          e.mesh.rotation.z = na - Math.PI * 0.5;
          break;
        }
        case 'drift': {
          e.y -= e.speed * dt;
          e.x = clamp(e.x + Math.sin(e.t * e.freq + e.ph) * e.amp * dt * 1.6, -BY, BY);
          break;
        }
        default: {
          e.y -= e.speed * dt;
          break;
        }
      }
      if (moved) {
        e.mesh.position.x = e.x;
        e.mesh.position.y = e.y;
      }

      /* ---------- 出界回收 ---------- */
      if (e.y < -HALF_H - 3.5) {
        this._retire(i, e);
        continue;
      }

      /* ---------- 开火 ---------- */
      if (e.T.fire > 0 && e.alive) {
        e.fireT -= dt;
        if (e.windup > 0) {
          e.windup -= dt;
          if (e.windup <= 0) this._shoot(e, ctx);
        } else if (e.fireT <= 0 && e.y < HALF_H - 0.4 && e.y > -HALF_H + 1.0) {
          e.windup = e.T.windup;
          e.fireT = e.T.fire * e.fireMul;
        }
      }

      /* ---------- 视觉 ---------- */
      e.flash = Math.max(0, e.flash - dt * 5.5);
      const f = e.flash;
      e.mesh.material.color.copy(e.baseColor);
      if (f > 0) e.mesh.material.color.lerp(WHITE, Math.min(1, f * 1.3));
      // 蓄能光晕
      const warm = e.windup > 0 ? clamp(1 - e.windup / Math.max(0.001, e.T.windup), 0, 1) : 0;
      const ao = Math.max(f * 0.85, warm * 0.75);
      e.aura.material.opacity = ao;
      if (ao > 0.01) {
        const col = _bc(e.bulletColor);
        e.aura.material.color.setRGB(1 + warm * col[0] * 2.4, 1 + warm * col[1] * 2.4, 1 + warm * col[2] * 2.4);
        const s = e.size * (1.2 + warm * 0.9 + f * 0.4);
        e.aura.scale.set(s, s, 1);
      }
      // 旋转型敌人
      if (e.type === 'turret') e.mesh.rotation.z = Math.PI + e.t * e.spin;
    }
  }

  _retire(i, e) {
    const last = this.list.pop();
    if (i < this.list.length) this.list[i] = last;
    this.group.remove(e.mesh);
    this.group.remove(e.aura);
    e.mesh.material.dispose();
    e.aura.material.dispose();
    e.mesh = null; e.aura = null;
    this.pool.push(e);
  }

  /* ------------------------------------------------------------------ *
   * 开火模式
   * ------------------------------------------------------------------ */
  _shoot(e, ctx) {
    const px = ctx.player.pos.x, py = ctx.player.pos.y;
    const aim = Math.atan2(py - e.y, px - e.x);
    const sp = e.bulletSpeed;
    const col = _bc(e.bulletColor);
    const F = ctx.ebul;
    const mk = (ang, mul = 1, opt = {}) => F.fire({
      x: e.x + Math.cos(ang) * 0.3, y: e.y + Math.sin(ang) * 0.3,
      vx: Math.cos(ang) * sp * mul, vy: Math.sin(ang) * sp * mul,
      w: 0.34, h: 0.34, gw: 0.95, gh: 0.95,
      r: 0.235,
      dmg: e.T.dmg || 12,
      cr: 3.6, cg: 3.6, cb: 3.6,
      gr: col[0] * 2.0, gg: col[1] * 2.0, gb: col[2] * 2.0,
      life: 9,
      aim: false,
      ...opt,
    });

    switch (e.pattern) {
      case 'single':
        mk(aim, 1);
        break;
      case 'aim3':
        for (let k = -1; k <= 1; k++) mk(aim + k * 0.16, 1);
        break;
      case 'spread5':
        for (let k = -2; k <= 2; k++) mk(aim + k * 0.19, 0.95);
        break;
      case 'radial4':
        for (let k = 0; k < 4; k++) mk(aim + e.t * 1.1 + (k / 4) * TAU, 0.9);
        break;
      case 'ring8':
        for (let k = 0; k < 8; k++) mk((k / 8) * TAU + e.t * 0.7, 0.82, { w: 0.40, h: 0.40, gw: 1.1, gh: 1.1, r: 0.26 });
        break;
      case 'aim5':
        for (let k = -2; k <= 2; k++) mk(aim + k * 0.085, 1.05, { w: 0.26, h: 0.62, gw: 0.72, gh: 1.5, r: 0.2, aim: true });
        break;
      default:
        break;
    }
    e.shots++;

    // 枪口闪光
    this.effects.muzzle(e.x, e.y + e.size * 0.28, {
      size: 0.34 + e.size * 0.10, r: col[0] * 3.4, g: col[1] * 3.4, b: col[2] * 3.4, life: 0.07,
    });
    ctx.audio.enemyShoot(e.size > 2 ? 1 : 0);
  }

  dispose() {
    for (const e of this.list) {
      if (e.mesh) { this.group.remove(e.mesh); e.mesh.material.dispose(); }
      if (e.aura) { this.group.remove(e.aura); e.aura.material.dispose(); }
    }
    this.list.length = 0;
    this.geo.dispose();
  }
}

const WHITE = new THREE.Color(1, 1, 1);

/* ================================================================== *
 * 编队生成
 * ================================================================== */
export function formation(list, kind, opts = {}) {
  const out = [];
  const n = opts.count ?? 5;
  const cx = opts.x ?? 0;
  const y0 = opts.y ?? (HALF_H + 2.2);
  const gap = opts.gap ?? 1.9;
  const type = opts.type || 'scout';
  const base = { ...opts.base };
  switch (kind) {
    case 'line':
      for (let i = 0; i < n; i++) {
        out.push({ type, x: cx + (i - (n - 1) / 2) * gap, y: y0, ...base });
      }
      break;
    case 'column':
      for (let i = 0; i < n; i++) {
        out.push({ type, x: cx, y: y0 + i * gap, ...base });
      }
      break;
    case 'v':
      for (let i = 0; i < n; i++) {
        const k = i - (n - 1) / 2;
        out.push({ type, x: cx + k * gap, y: y0 + Math.abs(k) * gap * 0.7, ...base });
      }
      break;
    case 'arc':
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const a = Math.PI * (0.18 + t * 0.64);
        out.push({ type, x: Math.cos(a) * (opts.radius ?? 9), y: y0 + Math.sin(a) * 3.4, ...base });
      }
      break;
    case 'stream':
      for (let i = 0; i < n; i++) {
        out.push({ type, x: cx + rand(-5, 5), y: y0 + rand(0, 3.2), ...base });
      }
      break;
    default:
      for (let i = 0; i < n; i++) out.push({ type, x: cx + rand(-6, 6), y: y0 + rand(0, 4), ...base });
  }
  list.push(...out);
  return out;
}

export { Enemy };

/**
 * combat.js — 弹幕 / 导弹 / 僚机 / 掉落道具
 * 全部使用 InstancedMesh 或对象池，运行期零分配。
 */
import * as THREE from '../vendor/three/three.module.js';
import { WEAPON, POWERUPS } from './config.js';
import { rand, clamp, TAU, Pool } from './util.js';
import { iconTexture, glowSprite } from './textures.js';
import { energyMaterial, glowSpriteObject } from './meshlib.js';
import { getMissileProto, getDroneProto } from './ship.js';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP_Y = new THREE.Vector3(0, 1, 0);

/* ================================================================== *
 * 实例化弹丸池
 * ================================================================== */
class BulletPool {
  constructor(scene, opt) {
    this.max = opt.max;
    this.geo = opt.geo;
    this.mat = opt.mat;
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = opt.renderOrder || 4;
    // 实例颜色
    this.mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    const F = Float32Array;
    this.x = new F(this.max); this.y = new F(this.max); this.z = new F(this.max);
    this.px = new F(this.max); this.py = new F(this.max); this.pz = new F(this.max);
    this.vx = new F(this.max); this.vy = new F(this.max); this.vz = new F(this.max);
    this.r = new F(this.max);        // 碰撞半径
    this.vis = new F(this.max);      // 视觉缩放
    this.dmg = new F(this.max);
    this.life = new F(this.max);
    this.maxLife = new F(this.max);
    this.axis = new Uint8Array(this.max);   // 0=不朝向速度, 1=朝向速度
    this.glow = new Uint8Array(this.max);   // 是否留尾迹
    this.trailClock = 0;
    this.n = 0;
    this.scale = opt.scale || 1;
    this._tc0 = new THREE.Color(0xffffff);
    this._tc1 = new THREE.Color(0x88ddff);
  }

  spawn(x, y, z, vx, vy, vz, o) {
    let i;
    if (this.n < this.max) i = this.n++;
    else {
      // 池满：替换最老的
      i = (Math.random() * this.max) | 0;
    }
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.r[i] = o.radius;
    this.vis[i] = o.vis == null ? o.radius : o.vis;
    this.dmg[i] = o.damage;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.axis[i] = o.align ? 1 : 0;
    this.glow[i] = o.glow ? 1 : 0;
    this.mesh.setColorAt(i, _c.set(o.color || 0xffffff));
    this.mesh.instanceColor.needsUpdate = true;
    return i;
  }

  update(dt, effects) {
    const aPos = this.mesh.instanceMatrix.array;
    const aCol = this.mesh.instanceColor.array;
    this.trailClock++;
    let i = 0;
    while (i < this.n) {
      this.px[i] = this.x[i]; this.py[i] = this.y[i]; this.pz[i] = this.z[i];
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      this.life[i] -= dt;
      const oob = Math.abs(this.x[i]) > 220 || Math.abs(this.y[i]) > 160 || this.z[i] < -340 || this.z[i] > 70;
      if (this.life[i] <= 0 || oob) {
        const j = --this.n;
        if (i !== j) this._copy(j, i);
        continue;
      }
      if (this.glow[i] && effects && (this.trailClock & 1) === 0) {
        const k = i * 3;
        this._tc1.setRGB(aCol[k], aCol[k + 1], aCol[k + 2]);
        effects.glowLayer.spawn(this.x[i], this.y[i], this.z[i] + 0.5, 0, 0, 0, {
          life: 0.085,
          size0: this.vis[i] * 0.5,
          size1: 0.02,
          drag: 6,
          color0: this._tc0,
          color1: this._tc1,
        });
      }
      i++;
    }
    // 写矩阵
    for (let k = 0; k < this.n; k++) {
      _v.set(this.x[k], this.y[k], this.z[k]);
      if (this.axis[k]) {
        _s.set(this.vx[k], this.vy[k], this.vz[k]).normalize();
        _q.setFromUnitVectors(UP_Y, _s);
      } else {
        _q.identity();
      }
      const sc = this.vis[k] * this.scale;
      _s.set(sc, sc, sc);
      _m4.compose(_v, _q, _s);
      _m4.toArray(aPos, k * 16);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _copy(from, to) {
    this.x[to] = this.x[from]; this.y[to] = this.y[from]; this.z[to] = this.z[from];
    this.px[to] = this.px[from]; this.py[to] = this.py[from]; this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.r[to] = this.r[from]; this.vis[to] = this.vis[from]; this.dmg[to] = this.dmg[from];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.axis[to] = this.axis[from]; this.glow[to] = this.glow[from];
    const a = this.mesh.instanceColor.array;
    a[to * 3] = a[from * 3]; a[to * 3 + 1] = a[from * 3 + 1]; a[to * 3 + 2] = a[from * 3 + 2];
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.n = 0;
    this.mesh.count = 0;
  }
}

/* ================================================================== *
 * 导弹
 * ================================================================== */
class Missile {
  constructor(scene) {
    this.obj = getMissileProto().clone(true);
    this.obj.traverse((o) => { if (o.isMesh && o.material) o.material = o.material.clone(); });
    this.obj.visible = false;
    scene.add(this.obj);
    this.alive = false;
    this.vel = new THREE.Vector3();
    this.target = null;
  }
  fire(x, y, z, dir, target, damage, speed) {
    this.alive = true;
    this.obj.visible = true;
    this.obj.position.set(x, y, z);
    this.obj.scale.setScalar(1);
    this.vel.copy(dir).normalize().multiplyScalar(speed);
    this.target = target;
    this.damage = damage;
    this.t = 0;
    this.life = 4.2;
    this.trailT = 0;
  }
  update(dt, effects, findTarget) {
    if (!this.alive) return;
    this.t += dt;
    if (this.t > this.life) {
      this.explodeSmall(effects);
      return;
    }
    if (!this.target || !this.target.alive) {
      this.target = findTarget(this.obj.position);
    }
    if (this.target) {
      _v.set(this.target.pos.x - this.obj.position.x, this.target.pos.y - this.obj.position.y, this.target.pos.z - this.obj.position.z);
      const d = _v.length() || 1;
      _v.divideScalar(d);
      // 转向（限制转角速度）
      const cur = this.vel.clone().normalize();
      const maxTurn = 3.6 * dt;
      cur.lerp(_v, clamp(maxTurn * (1 + 12 / (d + 6)), 0, 1)).normalize();
      this.vel.copy(cur).multiplyScalar(this.vel.length());
      this.vel.z = Math.min(this.vel.z, -6);
    }
    this.obj.position.addScaledVector(this.vel, dt);
    this.obj.lookAt(_v.copy(this.obj.position).add(this.vel));
    this.trailT += dt;
    if (this.trailT > 0.016) {
      this.trailT = 0;
      effects.glowLayer.spawn(this.obj.position.x, this.obj.position.y, this.obj.position.z + 0.6, rand(-2, 2), rand(-2, 2), rand(4, 14), {
        life: 0.3, size0: 0.55, size1: 0.05, drag: 3,
        color0: new THREE.Color(0xffffff), color1: new THREE.Color(0xff9a3d),
      });
    }
    if (this.obj.position.z < -300) this.alive = false, (this.obj.visible = false);
  }
  explodeSmall(effects) {
    if (effects && this.obj.visible) effects.explosion(this.obj.position.x, this.obj.position.y, this.obj.position.z, 0.55, 0xffb060, { noDebris: true });
    this.alive = false;
    this.obj.visible = false;
  }
}

/* ================================================================== *
 * 僚机（无人机）
 * ================================================================== */
class Drone {
  constructor(scene) {
    this.obj = getDroneProto().clone(true);
    this.obj.traverse((o) => {
      if (o.isMesh && o.material) o.material = o.material.clone();
      if (o.name === 'droneCore') this.core = o;
      if (o.name === 'droneRing') this.ring = o;
    });
    this.obj.visible = false;
    scene.add(this.obj);
    this.alive = false;
    this.pos = new THREE.Vector3();
    this.angle = 0;
    this.cd = 0;
  }
  spawn(i, total, playerPos) {
    this.alive = true;
    this.obj.visible = true;
    this.slot = i;
    this.angle = (i / Math.max(1, total)) * TAU;
    this.pos.copy(playerPos);
    this.obj.position.copy(this.pos);
    this.cd = rand(0, 0.4);
  }
}

/* ================================================================== *
 * 掉落道具
 * ================================================================== */
class Pickup {
  constructor(scene) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), energyMaterial(0xffffff, 3.0));
    core.name = 'core';
    g.add(core);
    const cage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.72, 0),
      new THREE.MeshStandardMaterial({ color: 0x9fb0c4, metalness: 0.95, roughness: 0.25, wireframe: false, envMapIntensity: 2.0, transparent: true, opacity: 0.55 })
    );
    cage.name = 'cage';
    g.add(cage);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sprite.scale.setScalar(1.5);
    sprite.name = 'icon';
    g.add(sprite);
    const halo = glowSpriteObject(0xffffff, 3.2, 1.4, 0.55);
    halo.name = 'halo';
    g.add(halo);
    g.visible = false;
    scene.add(g);
    this.obj = g;
    this.core = core;
    this.cage = cage;
    this.icon = sprite;
    this.halo = halo;
    this.alive = false;
  }
  fire(x, y, z, type) {
    this.alive = true;
    this.obj.visible = true;
    this.obj.position.set(x, y, z);
    this.type = type;
    const def = POWERUPS[type];
    this.def = def;
    this.core.material.color.set(def.color).multiplyScalar(3.0);
    const tex = iconTexture(def.glyph, '#' + new THREE.Color(def.color).getHexString());
    if (this.icon.material.map !== tex) {
      this.icon.material.map = tex;
      this.icon.material.needsUpdate = true;
    }
    this.icon.material.color.set(0xffffff);
    this.halo.material.color.set(def.color).multiplyScalar(1.3);
    this.t = 0;
    this.spin = rand(1.2, 2.6);
    this.vx = rand(-2, 2);
    this.vy = rand(-1.5, 1.5);
    this.vz = 12;
    this.magnet = false;
  }
  update(dt, playerPos, magnetRange, effects) {
    if (!this.alive) return;
    this.t += dt;
    this.obj.rotation.y += this.spin * dt;
    this.obj.rotation.x += this.spin * 0.6 * dt;
    this.cage.rotation.z -= this.spin * 1.4 * dt;

    const dx = playerPos.x - this.obj.position.x;
    const dy = playerPos.y - this.obj.position.y;
    const dz = playerPos.z - this.obj.position.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < magnetRange) this.magnet = true;

    if (this.magnet) {
      const k = clamp(1 - dist / (magnetRange * 1.15), 0, 1);
      const sp = 26 + k * 90;
      const inv = 1 / (dist || 1);
      this.obj.position.x += dx * inv * sp * dt;
      this.obj.position.y += dy * inv * sp * dt;
      this.obj.position.z += dz * inv * sp * dt;
      this.obj.scale.setScalar(1 + k * 0.35);
    } else {
      this.vx *= Math.exp(-1.6 * dt);
      this.vy *= Math.exp(-1.6 * dt);
      this.vz += 6 * dt;
      this.obj.position.x += this.vx * dt;
      this.obj.position.y += this.vy * dt;
      this.obj.position.z += this.vz * dt;
    }
    if (this.obj.position.z > 24) this.despawn(effects);
  }
  despawn(effects) {
    this.alive = false;
    this.obj.visible = false;
  }
}

/* ================================================================== *
 * Combat 总控
 * ================================================================== */
export class Combat {
  constructor(scene, effects, quality) {
    this.scene = scene;
    this.effects = effects;
    this.quality = quality;

    /* --- 玩家弹 --- */
    const playerGeo = new THREE.CapsuleGeometry(0.085, 0.62, 3, 8);
    const playerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.pBullets = new BulletPool(scene, { geo: playerGeo, mat: playerMat, max: 420, scale: 1, renderOrder: 5 });

    /* --- 敌方弹：光球 --- */
    const orbGeo = new THREE.SphereGeometry(1, 10, 8);
    const orbMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.eBullets = new BulletPool(scene, { geo: orbGeo, mat: orbMat, max: 900, scale: 1, renderOrder: 5 });

    /* --- 敌方弹：高速针弹 --- */
    const needleGeo = new THREE.CapsuleGeometry(0.055, 0.62, 3, 6);
    const needleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.nBullets = new BulletPool(scene, { geo: needleGeo, mat: needleMat, max: 520, scale: 1, renderOrder: 5 });

    /* --- 导弹 --- */
    this.missiles = [];
    this.missilePool = new Pool(() => {
      const m = new Missile(scene);
      this.missiles.push(m);
      return m;
    });
    this.missilePool.prewarm(18);

    /* --- 僚机 --- */
    this.drones = [];
    this.dronePool = new Pool(() => {
      const d = new Drone(scene);
      this.drones.push(d);
      return d;
    });
    this.dronePool.prewarm(10);

    /* --- 道具 --- */
    this.pickups = [];
    this.pickupPool = new Pool(() => {
      const p = new Pickup(scene);
      this.pickups.push(p);
      return p;
    });
    this.pickupPool.prewarm(40);
  }

  /* ---------------- 玩家开火 ---------------- */
  spawnPlayerBullet(x, y, z, vx, vy, vz, damage, opts = {}) {
    return this.pBullets.spawn(x, y, z, vx, vy, vz, {
      radius: opts.radius || 0.26,
      vis: opts.vis == null ? 1.45 : opts.vis,
      damage,
      life: opts.life || 3.0,
      align: true,
      glow: true,
      color: opts.color || 0x9ff0ff,
    });
  }

  /** 敌方弹幕 */
  spawnEnemyBullet(x, y, z, vx, vy, vz, opts = {}) {
    const pool = opts.needle ? this.nBullets : this.eBullets;
    const radius = opts.radius || 0.34;
    return pool.spawn(x, y, z, vx, vy, vz, {
      radius,
      vis: opts.needle ? (opts.vis == null ? 1.15 : opts.vis) : radius,
      damage: opts.damage || 12,
      life: opts.life || 6,
      align: !!opts.needle,
      glow: false,
      color: opts.color || 0xff7a5c,
    });
  }

  /** 扇形弹幕 */
  spawnFan(x, y, z, count, spread, speed, aimAngle, opts = {}) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
      const a = aimAngle + t * spread * 0.5;
      this.spawnEnemyBullet(x, y, z, Math.cos(a) * speed, Math.sin(a) * speed, opts.vz ?? 26, opts);
    }
  }

  /** 环形弹幕 */
  spawnRing(x, y, z, count, speed, phase = 0, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * TAU;
      this.spawnEnemyBullet(x, y, z, Math.cos(a) * speed, Math.sin(a) * speed, opts.vz ?? 22, opts);
    }
  }

  /** 螺旋弹幕（连续调用形成旋臂） */
  spawnSpiral(x, y, z, arms, phase, speed, opts = {}) {
    for (let i = 0; i < arms; i++) {
      const a = phase + (i / arms) * TAU;
      this.spawnEnemyBullet(x, y, z, Math.cos(a) * speed, Math.sin(a) * speed, opts.vz ?? 20, opts);
    }
  }

  launchMissile(x, y, z, dir, target, damage, speed = 46) {
    const m = this.missilePool.obtain();
    m.fire(x, y, z, dir, target, damage, speed);
    return m;
  }

  spawnPickup(x, y, z, type) {
    const p = this.pickupPool.obtain();
    p.fire(x, y, z, type);
    return p;
  }

  /** 玩家被击中时清弹（受击保护） */
  clearEnemyBullets(radius = 26, center = null) {
    const pools = [this.eBullets, this.nBullets];
    for (const pool of pools) {
      let i = 0;
      while (i < pool.n) {
        const dx = pool.x[i] - (center ? center.x : 0);
        const dy = pool.y[i] - (center ? center.y : 0);
        if (!center || Math.hypot(dx, dy) < radius) {
          const j = --pool.n;
          if (i !== j) pool._copy(j, i);
          continue;
        }
        i++;
      }
    }
  }

  /* ---------------- 更新 ---------------- */
  update(dt, ctx) {
    this.pBullets.update(dt, this.effects);
    this.eBullets.update(dt, this.effects);
    this.nBullets.update(dt, this.effects);

    // 导弹
    for (const m of this.missiles) {
      if (m.alive) m.update(dt, this.effects, ctx.findMissileTarget);
    }
    // 僚机
    this.updateDrones(dt, ctx);
    // 道具
    for (const p of this.pickups) {
      if (p.alive) p.update(dt, ctx.playerPos, ctx.magnetRange, this.effects);
    }
  }

  /** 设置僚机数量（可无限叠加，但视觉上每 6 架一环） */
  setDroneCount(n, playerPos) {
    while (this.drones.length < n) this.drones.push(new Drone(this.scene));
    this.droneCount = n;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (i < n) {
        if (!d.alive) {
          d.alive = true;
          d.obj.visible = true;
          d.pos.copy(playerPos);
          d.obj.position.copy(playerPos);
          d.angle = (i / Math.max(1, n)) * TAU;
          d.cd = rand(0, 0.35);
        }
      } else if (d.alive) {
        d.alive = false;
        d.obj.visible = false;
      }
    }
  }

  updateDrones(dt, ctx) {
    const total = this.droneCount || 0;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (!d.alive) continue;
      d.angle += dt * 1.35;
      const ring = Math.floor(i / 6);
      const slotInRing = i % 6;
      const ringCount = Math.min(6, total - ring * 6);
      const a = d.angle + (slotInRing / Math.max(1, ringCount)) * TAU + ring * 0.4;
      const R = WEAPON.droneOrbitR + ring * 1.15;
      const target = _v.set(
        ctx.playerPos.x + Math.cos(a) * R,
        ctx.playerPos.y + Math.sin(a) * R,
        ctx.playerPos.z + 1.2
      );
      d.pos.lerp(target, 1 - Math.exp(-7 * dt));
      d.obj.position.copy(d.pos);
      d.obj.rotation.y += dt * 2.2;
      d.obj.rotation.x = Math.sin(ctx.time * 3 + i) * 0.12;
      if (d.core) d.core.rotation.x += dt * 3;
      if (d.ring) d.ring.rotation.z += dt * 1.8;

      d.cd -= dt;
      if (d.cd <= 0 && ctx.canFire) {
        d.cd = WEAPON.droneFireInterval / (1 + 0.02 * Math.min(20, ctx.droneCount || 0));
        const tgt = ctx.findNearestEnemy(d.pos, 130);
        let vx = 0, vy = 1, vz = -1;
        if (tgt) {
          const dx = tgt.x - d.pos.x, dy = tgt.y - d.pos.y, dz = tgt.z - d.pos.z;
          const l = Math.hypot(dx, dy, dz) || 1;
          vx = dx / l; vy = dy / l; vz = dz / l;
        }
        const sp = WEAPON.bulletSpeed * 0.85;
        this.spawnPlayerBullet(d.pos.x, d.pos.y, d.pos.z, vx * sp, vy * sp, vz * sp, WEAPON.droneDamage, { radius: 0.2, vis: 0.95, color: 0xc9a8ff, life: 2.2 });
      }
    }
  }

  /* ---------------- 清理 ---------------- */
  clear() {
    this.pBullets.clear();
    this.eBullets.clear();
    this.nBullets.clear();
    for (const m of this.missiles) {
      m.alive = false;
      m.obj.visible = false;
    }
    for (const d of this.drones) {
      d.alive = false;
      d.obj.visible = false;
    }
    for (const p of this.pickups) {
      p.alive = false;
      p.obj.visible = false;
    }
  }
}

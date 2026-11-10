/**
 * world.js — 2D 竖版视差背景
 *
 * 由远及近共 6 层：
 *   1. 天空渐变（每关一套配色，静态）
 *   2. 三层星云（贴图 offset 无缝滚动，速度递增）
 *   3. 网格底面（第 3 关「母舰核心」专有）
 *   4. 三层星点（Points，CPU 位移 + y 轴环绕，形成视差）
 *   5. 岩屑带（第 2 关专有）—— **不是装饰，且可击破**：
 *      撞到自机会消耗装甲值，也会被自机子弹/激光打碎（有生命值、积分与掉落）。
 *      判定与伤害见 game._collideAsteroids() / _hitAsteroids()，
 *      参数集中在 config.ASTEROID
 *   6. 前景能量尘（极淡，纯气氛）
 * 除岩屑外均使用叠加/半透明混合并置于负 z，不进 Bloom（亮度 ≤ 1.0），
 * 保证"亮的东西只有武器与爆炸"这一视觉层级。
 */
import * as THREE from '../vendor/three/three.module.js';
import { WORLD, LEVELS, LAYER, ASTEROID } from './config.js';
import { rand, TAU, mulberry32 } from './util.js';

const HALF_W = WORLD.VIEW_W / 2;
const HALF_H = WORLD.VIEW_H / 2;

function cvs(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function basic(opt = {}) {
  const m = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    ...opt,
  });
  return m;
}

/** 天空渐变贴图（竖直：上方最远、下方最近） */
function skyTexture(pal) {
  const [c, g] = cvs(8, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, pal.sky0);
  gr.addColorStop(0.42, pal.sky1);
  gr.addColorStop(0.72, pal.sky2);
  gr.addColorStop(1, pal.sky0);
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export class World {
  /**
   * @param {THREE.Scene} scene
   * @param {object} SPR createSprites() 的产物
   */
  constructor(scene, SPR) {
    this.scene = scene;
    this.SPR = SPR;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = true;
    scene.add(this.group);

    this.scrollSpeed = 12;
    this.time = 0;
    this.levelIndex = 0;

    /* ---------- 1. 天空 ---------- */
    this.skyTex = LEVELS.map((L) => skyTexture(L.palette));
    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.VIEW_W * 1.02, WORLD.VIEW_H * 1.02),
      basic({ map: this.skyTex[0], transparent: false, depthWrite: true })
    );
    this.sky.position.z = LAYER.sky;
    this.sky.renderOrder = 0;
    this.group.add(this.sky);

    // 天空下部的"地平辉光"，让画面底部更有纵深
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.VIEW_W * 1.1, 16),
      basic({ map: SPR.soft, color: new THREE.Color(1, 1, 1), opacity: 0.09, blending: THREE.AdditiveBlending })
    );
    this.glow.position.set(0, -HALF_H + 6, LAYER.nebulaFar);
    this.glow.renderOrder = 1;
    this.group.add(this.glow);

    /* ---------- 2. 星云（3 层） ----------
     * 叠加强度刻意压低：星云属于"背景气氛"，一旦压过子弹就会抢戏，
     * 也会抬高整体亮度导致 ACES 之后对比度塌陷（画面发灰、发白）。
     */
    this.clouds = [];
    const cloudDefs = [
      { tex: SPR.cloud0, layer: LAYER.nebulaFar, sx: 2.30, sy: 1.30, rep: 1, speed: 0.055, op: 0.30, key: 'nebulaA' },
      { tex: SPR.cloud1, layer: LAYER.nebulaMid, sx: 1.90, sy: 1.10, rep: 1.6, speed: 0.105, op: 0.24, key: 'nebulaB' },
      { tex: SPR.cloud2, layer: LAYER.nebulaNear, sx: 1.55, sy: 0.95, rep: 2.2, speed: 0.170, op: 0.18, key: 'nebulaC' },
    ];
    for (const d of cloudDefs) {
      const map = d.tex.clone();
      map.needsUpdate = true;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(d.rep, d.rep);
      map.colorSpace = THREE.SRGBColorSpace;
      const m = basic({
        map,
        opacity: d.op,
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(1, 1, 1),
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.VIEW_W * d.sx, WORLD.VIEW_H * d.sy), m);
      mesh.position.z = d.layer;
      mesh.renderOrder = 2;
      mesh.userData = d;
      this.group.add(mesh);
      this.clouds.push(mesh);
    }

    /* ---------- 3. 网格底面（第 3 关） ---------- */
    {
      const map = SPR.grid.clone();
      map.needsUpdate = true;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(4, 8);
      map.colorSpace = THREE.SRGBColorSpace;
      this.grid = new THREE.Mesh(
        new THREE.PlaneGeometry(WORLD.VIEW_W * 1.02, WORLD.VIEW_H * 1.02),
        basic({ map, opacity: 0.20, blending: THREE.AdditiveBlending, color: new THREE.Color(0.55, 1.0, 0.95) })
      );
      this.grid.position.z = LAYER.grid;
      this.grid.renderOrder = 3;
      this.grid.visible = false;
      this.group.add(this.grid);
    }

    /* ---------- 4. 星点（3 层视差） ---------- */
    this.starLayers = [];
    const starDefs = [
      { n: 900, size: 1.30, speed: 0.55, z: LAYER.starFar, bright: 0.46, span: 0.75 },
      { n: 460, size: 2.05, speed: 1.35, z: LAYER.starMid, bright: 0.62, span: 1.0 },
      { n: 190, size: 3.10, speed: 2.45, z: LAYER.starNear, bright: 0.78, span: 1.25 },
    ];
    const rng = mulberry32(20260927);
    for (const d of starDefs) {
      const pos = new Float32Array(d.n * 3);
      const col = new Float32Array(d.n * 3);
      const tint = new Float32Array(d.n);
      const bright = new Float32Array(d.n);
      for (let i = 0; i < d.n; i++) {
        pos[i * 3] = (rng() * 2 - 1) * HALF_W * 1.06;
        pos[i * 3 + 1] = (rng() * 2 - 1) * (HALF_H + 2);
        pos[i * 3 + 2] = 0;
        const b = (0.35 + rng() * 0.65) * d.bright;
        col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b;
        bright[i] = b;
        tint[i] = rng();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({
        size: d.size,
        map: SPR.soft,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
        sizeAttenuation: false,
        opacity: 1,
      });
      const pts = new THREE.Points(geo, mat);
      pts.position.z = d.z;
      pts.renderOrder = 4;
      pts.frustumCulled = false;
      this.group.add(pts);
      this.starLayers.push({ pts, geo, mat, speed: d.speed, n: d.n, tint, bright });
    }

    /* ---------- 5. 岩屑带（第 2 关，可碰撞 + 可击破的实体）----------
     * 数量 / 尺寸范围 / 判定半径 / 伤害 / 生命值 全部集中在 config.ASTEROID。
     * hitR（撞击判定）与 shootR（被射击判定）分开：后者更大，方便主动打碎。
     * hp / dmg 在生成时算好挂在 userData 上，game 的碰撞循环直接读取，
     * 避免每帧重复计算。
     */
    this.rocks = [];
    this.rocksOn = false;
    {
      const ruv = mulberry32(777);
      const span = ASTEROID.sizeMax - ASTEROID.sizeMin;
      for (let i = 0; i < ASTEROID.count; i++) {
        const s = ASTEROID.sizeMin + ruv() * span;
        const m = basic({ map: SPR.rock, opacity: 0.96, color: new THREE.Color(1, 1, 1) });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s, s), m);
        mesh.position.set((ruv() * 2 - 1) * HALF_W * 0.94, (ruv() * 2 - 1) * (HALF_H + 3), LAYER.asteroid + ruv() * 3);
        mesh.rotation.z = ruv() * TAU;
        mesh.renderOrder = 5;
        mesh.visible = false;
        const maxHp = Math.round(ASTEROID.hpBase + s * ASTEROID.hpPerSize);
        mesh.userData = {
          s,
          /** 撞击自机的判定半径（贴图轮廓不规则，取视觉尺寸的系数） */
          hitR: s * ASTEROID.hitScale,
          /** 被自机射击的判定半径（比撞击判定大，方便打断） */
          shootR: s * ASTEROID.shootScale,
          /** 撞击自机时消耗的装甲值 */
          dmg: Math.round(ASTEROID.damageBase + s * ASTEROID.damagePerSize),
          /** 可被击破：生命值 / 剩余生命值 */
          maxHp,
          hp: maxHp,
          /** 命中闪白（0..1） */
          flash: 0,
          /** 碎裂后的重生倒计时（>0 表示当前不可见、不可碰撞） */
          respawnT: 0,
          vy: -(1.4 + ruv() * 3.2),
          vx: (ruv() - 0.5) * 0.55,
          spin: (ruv() - 0.5) * 0.9,
          rot: mesh.rotation.z,
        };
        this.group.add(mesh);
        this.rocks.push(mesh);
      }
    }

    /* ---------- 6. 装饰性能量尘（前景，极淡） ---------- */
    this.dust = null;
    {
      const n = 120;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = rand(-HALF_W, HALF_W);
        pos[i * 3 + 1] = rand(-HALF_H, HALF_H);
        pos[i * 3 + 2] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        size: 9,
        map: SPR.smoke,
        transparent: true,
        opacity: 0.055,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: false,
      });
      this.dust = new THREE.Points(geo, mat);
      this.dust.position.z = 14;
      this.dust.renderOrder = LAYER.particle + 1;
      this.dust.frustumCulled = false;
      this.group.add(this.dust);
    }

    this.setLevel(0);
  }

  /* ------------------------------------------------------------------ */
  setLevel(index) {
    this.levelIndex = index % LEVELS.length;
    const pal = LEVELS[this.levelIndex].palette;

    this.sky.material.map = this.skyTex[this.levelIndex];
    this.sky.material.needsUpdate = true;

    const c = (k) => {
      const hex = pal[k];
      return new THREE.Color(hex);
    };
    this.clouds.forEach((mesh) => {
      const key = mesh.userData.key;
      // 星云颜色由 pal 中的 rgba 字符串解析（用临时 canvas 得到 rgb）
      mesh.material.color.copy(parseRGBA(pal[key]));
    });
    this.glow.material.color.copy(c('accent2')).multiplyScalar(0.7);

    const warm = new THREE.Color(pal.starWarm);
    const cool = new THREE.Color(pal.starCool);
    const neutral = new THREE.Color(pal.starTint);
    for (const L of this.starLayers) {
      const arr = L.geo.getAttribute('color').array;
      for (let i = 0; i < L.n; i++) {
        const t = L.tint[i];
        const src = t < 0.30 ? cool : t < 0.62 ? neutral : warm;
        const b = L.bright[i];
        arr[i * 3] = src.r * b;
        arr[i * 3 + 1] = src.g * b;
        arr[i * 3 + 2] = src.b * b;
      }
      L.geo.getAttribute('color').needsUpdate = true;
    }

    this.grid.visible = this.levelIndex === 2;
    const showRocks = this.levelIndex === 1;
    this.rocksOn = showRocks;
    for (const r of this.rocks) {
      const u = r.userData;
      u.respawnT = 0;
      u.hp = u.maxHp;
      u.flash = 0;
      r.material.color.setRGB(1, 1, 1);
      r.visible = showRocks;
    }

    this.dust.material.color.copy(c('accent2')).lerp(new THREE.Color(1, 1, 1), 0.35);
  }

  /**
   * 陨石碎裂：隐藏一段时间后送回屏幕上沿重新坠落，并恢复满血。
   *
   * 两种情况都会调用：
   *   · 撞击自机   → shatterRock(rock)         （默认 1.15s 后重生）
   *   · 被自机击破 → shatterRock(rock, 1.15)   （同上，演出由调用方负责）
   * 用"就地重生"而不是加对象池 —— 场上数量恒定，逻辑最简单。
   *
   * @param {THREE.Mesh} rock
   * @param {number} [delay] 重生等待秒数（缺省取 config.ASTEROID.respawnDelay）
   */
  shatterRock(rock, delay) {
    const u = rock.userData;
    u.respawnT = delay == null ? ASTEROID.respawnDelay : delay;
    u.hp = u.maxHp;
    u.flash = 0;
    rock.material.color.setRGB(1, 1, 1);
    rock.visible = false;
  }

  /**
   * 对陨石造成伤害（自机子弹 / 激光）。
   * @returns {boolean} 是否被打空生命值（击破）
   */
  hurtRock(rock, dmg) {
    const u = rock.userData;
    if (u.respawnT > 0) return false;
    u.hp -= dmg;
    u.flash = ASTEROID.hitFlash;
    return u.hp <= 0;
  }

  /** 基础滚动速度（世界单位/秒） */
  setScroll(v) {
    this.scrollSpeed = v;
  }

  update(dt) {
    this.time += dt;
    const sp = this.scrollSpeed;
    const H = HALF_H + 2;
    const W = HALF_W * 1.06;

    /* 星云 */
    for (const m of this.clouds) {
      const d = m.userData;
      m.material.map.offset.y -= d.speed * (sp / 12) * dt;
      m.material.opacity = d.op * (0.86 + 0.14 * Math.sin(this.time * 0.5 + d.layer));
    }

    /* 网格 */
    if (this.grid.visible) {
      this.grid.material.map.offset.y -= 0.055 * (sp / 12) * dt;
    }

    /* 星点 */
    for (let li = 0; li < this.starLayers.length; li++) {
      const L = this.starLayers[li];
      const arr = L.geo.getAttribute('position').array;
      const v = (L.speed * 0.85 + sp * 0.16) * dt;
      for (let i = 0; i < L.n; i++) {
        const iy = i * 3 + 1;
        arr[iy] -= v * (1 + (i % 7) * 0.06);
        if (arr[iy] < -H) {
          arr[iy] += H * 2;
          arr[i * 3] = rand(-W, W);
        }
      }
      L.geo.getAttribute('position').needsUpdate = true;
      L.mat.opacity = 0.80 + 0.20 * Math.sin(this.time * 1.7 + li * 2.1);
    }

    /* 岩屑 */
    if (this.rocksOn) {
      for (const r of this.rocks) {
        const u = r.userData;

        /* 碎裂中：等待重生 */
        if (u.respawnT > 0) {
          u.respawnT -= dt;
          if (u.respawnT <= 0) {
            u.respawnT = 0;
            r.position.y = HALF_H + 4 + u.s;
            r.position.x = rand(-HALF_W * 0.94, HALF_W * 0.94);
            u.rot = rand(0, TAU);
            r.rotation.z = u.rot;
            u.vy = -(1.4 + Math.random() * 3.2);
            u.hp = u.maxHp;
            u.flash = 0;
            r.material.color.setRGB(1, 1, 1);
            r.visible = true;
            r.material.needsUpdate = true;
          }
          continue;
        }

        r.position.y += u.vy * (0.6 + sp / 22) * dt;
        r.position.x += u.vx * dt;
        u.rot += u.spin * dt;
        r.rotation.z = u.rot;
        if (r.position.y < -H - u.s) {
          r.position.y = H + u.s;
          r.position.x = rand(-HALF_W * 0.94, HALF_W * 0.94);
          u.hp = u.maxHp;
        }
        if (r.position.x < -W) r.position.x = W;
        else if (r.position.x > W) r.position.x = -W;

        /* 命中闪白：受击瞬间整体提亮，快速衰减 */
        if (u.flash > 0.001) {
          u.flash = Math.max(0, u.flash - dt * 5.0);
          const f = u.flash;
          r.material.color.setRGB(1 + f * 1.6, 1 + f * 1.15, 1 + f * 0.7);
        } else if (u.flash !== 0) {
          u.flash = 0;
          r.material.color.setRGB(1, 1, 1);
        }
      }
    }

    /* 前景尘 */
    const darr = this.dust.geometry.getAttribute('position').array;
    for (let i = 0; i < 120; i++) {
      const iy = i * 3 + 1;
      darr[iy] -= (sp * 0.62 + 2.4) * dt;
      if (darr[iy] < -HALF_H - 1) { darr[iy] += HALF_H * 2 + 2; darr[i * 3] = rand(-HALF_W, HALF_W); }
    }
    this.dust.geometry.getAttribute('position').needsUpdate = true;
  }
}

/** 'rgba(150,60,190,0.55)' -> THREE.Color(150,60,190)/255 */
function parseRGBA(s) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s);
  if (!m) return new THREE.Color(1, 1, 1);
  return new THREE.Color(+m[1] / 255, +m[2] / 255, +m[3] / 255);
}

export { parseRGBA };

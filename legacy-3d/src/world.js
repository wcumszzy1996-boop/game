/**
 * world.js — 背景世界
 *  · 远景天幕（静态星云天球）
 *  · 3 层视差星空（驶向相机并循环）
 *  · 体积星云云团
 *  · 关卡专属场景道具（星云残骸 / 陨石带 / 母舰环形闸门）
 */
import * as THREE from '../vendor/three/three.module.js';
import { backdropTexture, glowSprite, puffSprite } from './textures.js';
import { buildAsteroid } from './enemymesh.js';
import { rand, randInt, TAU, mulberry32, ActiveList } from './util.js';

/* ------------------------------------------------------------------ *
 * 视差星空层
 * ------------------------------------------------------------------ */
class StarLayer {
  constructor(scene, opt) {
    this.count = opt.count;
    this.depth = opt.depth;
    this.speedMul = opt.speedMul;
    this.spreadX = opt.spreadX;
    this.spreadY = opt.spreadY;
    this.size = opt.size;

    const R = mulberry32(opt.seed);
    const pos = new Float32Array(this.count * 3);
    const col = new Float32Array(this.count * 3);
    const tint = new THREE.Color();
    this.baseX = new Float32Array(this.count);
    this.baseY = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const x = (R() * 2 - 1) * this.spreadX;
      const y = (R() * 2 - 1) * this.spreadY;
      const z = -R() * this.depth;
      this.baseX[i] = x;
      this.baseY[i] = y;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      // 恒星色温
      const t = R();
      if (t < 0.64) tint.setRGB(1, 1, 1);
      else if (t < 0.82) tint.setRGB(0.72, 0.84, 1);
      else if (t < 0.94) tint.setRGB(1, 0.86, 0.68);
      else tint.setRGB(1, 0.72, 0.62);
      const b = 0.25 + R() * 0.70;
      col[i * 3] = tint.r * b;
      col[i * 3 + 1] = tint.g * b;
      col[i * 3 + 2] = tint.b * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -this.depth / 2), this.depth);

    this.mat = new THREE.PointsMaterial({
      size: this.size,
      map: opt.map || glowSprite('#ffffff', 2.2, 64),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // 关键：星空不能用透视缩放。摄像机离 z=0 平面只有 ~40 单位，
      // 透视缩放下贴近镜头的星星会变成几十像素的大白斑，
      // 整屏看起来像糊了一层雾。改为固定像素尺寸，纯粹靠速度差做视差。
      sizeAttenuation: false,
      toneMapped: false,
      opacity: opt.opacity ?? 1,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.arr = pos;
    scene.add(this.points);
    this.geom = geo;
  }

  update(dt, speed) {
    const v = speed * this.speedMul;
    const d = v * dt;
    const a = this.arr;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const k = i * 3 + 2;
      a[k] += d;
      if (a[k] > 30) {
        a[k] -= this.depth;
        a[i * 3] = (Math.random() * 2 - 1) * this.spreadX;
        a[i * 3 + 1] = (Math.random() * 2 - 1) * this.spreadY;
      }
    }
    this.geom.attributes.position.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ *
 * 星云云团（体积感，缓慢漂移）
 * ------------------------------------------------------------------ */
class NebulaClouds {
  constructor(scene, palette, count = 26) {
    this.items = [];
    const R = mulberry32(7331);
    const hexes = [palette.nebulaA, palette.nebulaB, palette.nebulaC];
    for (let i = 0; i < count; i++) {
      const hex = hexes[i % hexes.length];
      const mat = new THREE.SpriteMaterial({
        map: puffSprite(i + 1, hex, 30),
        color: new THREE.Color(hex).multiplyScalar(0.30 + R() * 0.35),
        transparent: true,
        // 加性混合的云团很容易叠加成一片奶白，透明度必须压得很低
        opacity: 0.030 + R() * 0.075,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      });
      const s = new THREE.Sprite(mat);
      const sz = 60 + R() * 150;
      s.scale.set(sz, sz * (0.6 + R() * 0.6), 1);
      s.position.set((R() * 2 - 1) * 150, (R() * 2 - 1) * 100, -180 - R() * 420);
      const rotSpeed = (R() * 2 - 1) * 0.06;
      scene.add(s);
      this.items.push({ s, rotSpeed, baseOpacity: mat.opacity, drift: (0.4 + R()) * 3 });
    }
  }
  update(dt, speed) {
    for (const it of this.items) {
      it.s.position.z += speed * 0.12 * dt;
      it.s.material.rotation += it.rotSpeed * dt;
      if (it.s.position.z > 60) {
        it.s.position.z -= 620;
        it.s.position.x = (Math.random() * 2 - 1) * 150;
        it.s.position.y = (Math.random() * 2 - 1) * 100;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * 场景道具（按关卡主题）
 * ------------------------------------------------------------------ */
class SceneryItem {
  constructor(obj, kind) {
    this.obj = obj;
    this.kind = kind;
    this.alive = true;
    this.spin = new THREE.Vector3(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5));
    this.driftX = rand(-3, 3);
    this.driftY = rand(-3, 3);
  }
}

/* ------------------------------------------------------------------ *
 * World
 * ------------------------------------------------------------------ */
export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.backdrop = null;
    this.starLayers = [];
    this.clouds = null;
    this.scenery = new ActiveList();
    this.sceneryPool = new Map();     // kind -> []
    this.spawnTimer = 0;
    this.theme = 'nebula';
    this.speed = 26;
    this.warp = 0;
    this.time = 0;
    this.palette = null;
  }

  setTheme(palette, themeName) {
    this.palette = palette;
    // 天幕
    if (this.backdrop) {
      this.root.remove(this.backdrop);
      this.backdrop.material.dispose();
    }
    const tex = backdropTexture(palette, themeName.length + palette.nebulaA.length);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false });
    mat.color.setScalar(0.40);
    this.backdrop = new THREE.Mesh(new THREE.SphereGeometry(520, 32, 24), mat);
    this.backdrop.renderOrder = -10;
    this.root.add(this.backdrop);

    // 星空（size 单位现在为「像素」）
    if (!this.starLayers.length) {
      this.starLayers.push(new StarLayer(this.root, { count: 2200, depth: 900, speedMul: 0.35, spreadX: 220, spreadY: 150, size: 1.5, seed: 11 }));
      this.starLayers.push(new StarLayer(this.root, { count: 1500, depth: 480, speedMul: 0.85, spreadX: 130, spreadY: 90, size: 2.1, seed: 22 }));
      this.starLayers.push(new StarLayer(this.root, { count: 620, depth: 220, speedMul: 1.6, spreadX: 80, spreadY: 55, size: 2.8, seed: 33 }));
    }
    // 星云
    if (this.clouds) {
      for (const it of this.clouds.items) {
        this.root.remove(it.s);
        it.s.material.dispose();     // map 来自缓存，不能销毁
      }
    }
    this.clouds = new NebulaClouds(this.root, palette, themeName === 'core' ? 12 : 26);

    this.theme = themeName;
  }

  /* --------- 道具工厂 --------- */
  _makeScenery(kind) {
    const pool = this.sceneryPool.get(kind) || [];
    const found = pool.find((o) => !o.alive);
    if (found) {
      this.scenery.add(found);
      found.obj.visible = true;
      return found;
    }
    let obj;
    if (kind === 'rock') {
      obj = buildAsteroid(rand(3, 11), Math.floor(rand(1, 999)), 0x5a4d46).clone(true);
      obj.children[0].material = obj.children[0].material.clone();
    } else if (kind === 'wreck') {
      obj = this._makeWreck();
    } else if (kind === 'gate') {
      obj = this._makeGate();
    } else {
      obj = new THREE.Group();
    }
    const it = new SceneryItem(obj, kind);
    pool.push(it);
    this.sceneryPool.set(kind, pool);
    this.scenery.add(it);
    return it;
  }

  _makeWreck() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.9, roughness: 0.55, envMapIntensity: 1.2 });
    const n = randInt(2, 5);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(rand(1, 5), rand(0.6, 2.4), rand(1, 6)), mat);
      m.position.set(rand(-2, 2), rand(-1, 1), rand(-2, 2));
      m.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      g.add(m);
    }
    const ember = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite('#ff8844', 2.4, 64),
      color: new THREE.Color(0xff7733).multiplyScalar(1.6),
      transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    ember.scale.setScalar(6);
    ember.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
    g.add(ember);
    return g;
  }

  _makeGate() {
    const g = new THREE.Group();
    const R = 30;
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(R, 2.6, 8, 8, Math.PI), // 半环（下半）
      new THREE.MeshStandardMaterial({ color: 0x2d3a42, metalness: 0.94, roughness: 0.42, envMapIntensity: 1.8 })
    );
    torus.rotation.z = Math.PI;
    g.add(torus);
    const torus2 = new THREE.Mesh(
      new THREE.TorusGeometry(R, 2.6, 8, 8, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x2d3a42, metalness: 0.94, roughness: 0.42, envMapIntensity: 1.8 })
    );
    g.add(torus2);
    // 环上发光节点
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowSprite('#5ffbe0', 2.6, 64),
        color: new THREE.Color(0x5ffbe0).multiplyScalar(2.0),
        transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      s.scale.setScalar(5.5);
      s.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      g.add(s);
    }
    return g;
  }

  /* --------- 生成节奏 --------- */
  _spawn() {
    const x = (Math.random() * 2 - 1);
    const y = (Math.random() * 2 - 1);
    const zFar = -180 - Math.random() * 120;
    if (this.theme === 'core') {
      const it = this._makeScenery('gate');
      it.obj.position.set(0, 0, zFar);
      it.obj.rotation.set(0, 0, 0);
      it.spin.set(0, 0, rand(-0.12, 0.12));
      it.driftX = 0; it.driftY = 0;
      it.scaleZ = 1;
      it.obj.scale.setScalar(rand(0.85, 1.25));
    } else if (this.theme === 'belt') {
      const it = this._makeScenery('rock');
      const s = rand(0.7, 1.5);
      it.obj.position.set(x * 70, y * 48, zFar);
      it.obj.scale.setScalar(s);
      it.spin.set(rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.6, 0.6));
    } else {
      const kind = Math.random() < 0.6 ? 'rock' : 'wreck';
      const it = this._makeScenery(kind);
      it.obj.position.set(x * 80, y * 55, zFar);
      it.obj.scale.setScalar(rand(0.7, 1.6));
      it.spin.set(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4));
    }
  }

  /** 场景被清除（关卡切换） */
  reset() {
    for (const it of this.scenery.items) {
      it.alive = false;
      it.obj.visible = false;
    }
    this.scenery.items.length = 0;
    this.spawnTimer = 0;
  }

  update(dt, speed, warpAmount = 0) {
    this.time += dt;
    this.speed = speed;
    const eff = speed * (1 + warpAmount * 4.5);
    for (const l of this.starLayers) l.update(dt, eff);
    this.clouds.update(dt, eff);
    if (this.backdrop) this.backdrop.rotation.z += dt * 0.004;

    // 道具生成
    const interval = this.theme === 'core' ? 2.6 : this.theme === 'belt' ? 0.55 : 1.4;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = interval * rand(0.7, 1.3);
      this._spawn();
      if (this.theme === 'belt' && Math.random() < 0.6) this._spawn();
    }

    // 道具推进
    for (const it of this.scenery.items) {
      const o = it.obj;
      o.position.z += eff * dt;
      o.position.x += it.driftX * dt;
      o.position.y += it.driftY * dt;
      o.rotation.x += it.spin.x * dt;
      o.rotation.y += it.spin.y * dt;
      o.rotation.z += it.spin.z * dt;
      if (o.position.z > 70) {
        it.alive = false;
        o.visible = false;
      }
    }
    const removed = [];
    this.scenery.items = this.scenery.items.filter((i) => i.alive);
  }

  setVisible(v) {
    this.root.visible = v;
  }
}

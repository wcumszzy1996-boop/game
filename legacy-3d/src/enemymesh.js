/**
 * enemymesh.js — 敌机 / 陨石 程序化建模
 * 约定：敌机机头朝 +Z（正对玩家/屏幕下方）
 */
import * as THREE from '../vendor/three/three.module.js';
import {
  loftZ, prismXZ, hullMaterial, energyMaterial, addGreebles,
  mirrorGroup, mergeGeometries, collectFlashables, cloneMaterials, glowSpriteObject,
} from './meshlib.js';
import { mulberry32, TAU } from './util.js';

const protoCache = new Map();

/* ------------------------------------------------------------------ *
 * 实例化（供对象池使用）
 * ------------------------------------------------------------------ */
export function instantiate(proto) {
  const g = proto.clone(true);
  cloneMaterials(g);
  const refs = { thrusters: [], flames: [], accents: [], glowMats: [], spinners: [], parts: {} };
  g.traverse((o) => {
    if (o.name === 'flame') refs.flames.push(o);
    else if (o.name === 'thruster') refs.thrusters.push(o);
    else if (o.name.startsWith('part:')) refs.parts[o.name.slice(5)] = o;
    else if (o.name.startsWith('spin:')) {
      refs.spinners.push({ obj: o, speed: o.userData.spinSpeed || 1, axis: o.userData.spinAxis || 'z' });
    }
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.isMeshBasicMaterial) refs.accents.push(m);
        if (m.isSpriteMaterial) refs.glowMats.push(m);
      }
    }
  });
  collectFlashables(g);
  g.userData.refs = refs;
  g.userData.spinners = refs.spinners;
  return g;
}

/* ------------------------------------------------------------------ *
 * 材质
 * ------------------------------------------------------------------ */
function enemyMats(key, accent) {
  const ck = `em:${key}:${accent}`;
  if (protoCache.has(ck)) return protoCache.get(ck);
  const mats = {
    hull: hullMaterial(`enemy-${key}`, {
      emissive: accent,
      emissiveIntensity: 0.9,
      metalness: 0.92,
      roughness: 0.42,
      envMapIntensity: 1.5,
      color: 0xffffff,
      tex: { base: '#3b3540', accent: '#ffb070', stripe: '#ff5a2d', size: 512, normalStrength: 2.2 },
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1e26, metalness: 0.95, roughness: 0.3, envMapIntensity: 1.6 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2e3542, metalness: 0.88, roughness: 0.46, envMapIntensity: 1.4 }),
    accent: energyMaterial(accent, 3.2),
    glow: energyMaterial(accent, 1.5, { transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
    eye: energyMaterial(0xffffff, 4.0),
  };
  protoCache.set(ck, mats);
  return mats;
}

function flameCone(radius, len, color) {
  const g = new THREE.Group();
  g.name = 'flame';
  const m = new THREE.Mesh(
    new THREE.ConeGeometry(radius, len, 12, 1, true),
    energyMaterial(color, 2.2, { transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  // 锥尖朝 -Z（向后喷）
  m.geometry.rotateX(-Math.PI / 2);
  m.position.z = -len / 2;
  g.add(m);
  const s = glowSpriteObject(color, radius * 6.5, 1.6, 0.85);
  s.position.z = -0.05;
  g.add(s);
  return g;
}

function enginePod(x, y, z, r, len, color, mats) {
  const g = new THREE.Group();
  g.name = 'thruster';
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, len, 12, 1, true).rotateX(Math.PI / 2), mats.dark);
  g.add(shell);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(r * 0.85, 12), mats.accent);
  inner.position.z = -len / 2 + 0.01;
  inner.rotation.y = Math.PI;
  g.add(inner);
  g.add(flameCone(r * 0.82, len * 1.9, color));
  g.position.set(x, y, z);
  return g;
}

/* ================================================================== *
 * 1. 侦察机「萤火」——轻快、撞击型
 * ================================================================== */
function buildScoutProto(accent = 0xff7a3d) {
  const M = enemyMats('scout', accent);
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    loftZ(
      [
        { z: -1.15, rx: 0.07, ry: 0.06, e: 2.2 },
        { z: -0.72, rx: 0.25, ry: 0.18, e: 2.8 },
        { z: -0.10, rx: 0.34, ry: 0.25, e: 3.2 },
        { z: 0.48, rx: 0.25, ry: 0.18, e: 2.8 },
        { z: 0.98, rx: 0.09, ry: 0.08, e: 2.2 },
      ],
      { radial: 18, uvU: 2, uvV: 1 }
    ),
    M.hull
  );
  g.add(body);

  const wing = new THREE.Mesh(
    prismXZ(
      [
        [0.20, -0.90],
        [1.42, -1.00],
        [1.18, 0.12],
        [0.22, 0.40],
      ],
      0.13,
      0,
      { uv: 2 }
    ),
    M.hull
  );
  g.add(wing);
  g.add(mirrorGroup(wing));

  const canard = new THREE.Mesh(
    prismXZ(
      [
        [0.18, 0.42],
        [0.86, 0.52],
        [0.80, 0.86],
        [0.20, 0.78],
      ],
      0.09,
      0.04,
      { uv: 2 }
    ),
    M.trim
  );
  g.add(canard);
  g.add(mirrorGroup(canard));

  // 顶部能量脊线（法线朝 +Y）
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1.5), M.glow);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.30, -0.1);
  g.add(stripe);

  // 单发尾喷
  g.add(enginePod(0, 0, -1.30, 0.16, 0.42, 0xff9a4d, M));

  // 传感器"眼"
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), M.eye);
  eye.position.set(0, 0.06, 0.72);
  g.add(eye);

  g.userData.naturalRadius = 1.05;
  return g;
}

/* ================================================================== *
 * 2. 截击机「游隼」——瞄准射击
 * ================================================================== */
function buildInterceptorProto(accent = 0xff4d4d) {
  const M = enemyMats('interceptor', accent);
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    loftZ(
      [
        { z: -1.90, rx: 0.09, ry: 0.08, e: 2.2 },
        { z: -1.30, rx: 0.31, ry: 0.23, e: 2.8 },
        { z: -0.40, rx: 0.47, ry: 0.35, e: 3.1 },
        { z: 0.60, rx: 0.53, ry: 0.38, e: 3.1 },
        { z: 1.50, rx: 0.39, ry: 0.29, e: 2.8 },
        { z: 2.15, rx: 0.21, ry: 0.17, e: 2.4 },
        { z: 2.55, rx: 0.08, ry: 0.07, e: 2.2 },
      ],
      { radial: 22, uvU: 2.4, uvV: 1.2 }
    ),
    M.hull
  );
  g.add(body);

  const wing = new THREE.Mesh(
    prismXZ(
      [
        [0.32, -1.62],
        [2.32, -1.32],
        [2.58, -0.55],
        [1.32, -0.05],
        [0.36, 0.62],
      ],
      0.17,
      0,
      { uv: 1.8 }
    ),
    M.hull
  );
  g.add(wing);
  g.add(mirrorGroup(wing));

  // 前缘发光
  const le = new THREE.Mesh(
    prismXZ(
      [
        [0.40, -1.66],
        [2.26, -1.36],
        [2.40, -1.10],
        [0.42, -1.42],
      ],
      0.07,
      0.09,
      { uv: 3 }
    ),
    M.accent
  );
  g.add(le);
  g.add(mirrorGroup(le));

  // 翼下挂架
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.9), M.dark);
  pylon.position.set(1.1, -0.22, -0.3);
  g.add(pylon);
  g.add(mirrorGroup(pylon));

  // 垂尾
  const fin = new THREE.Mesh(
    prismXZ(
      [
        [0.0, -0.95],
        [0.95, 0.10],
        [1.02, 0.42],
        [0.0, 1.10],
      ],
      0.1,
      0,
      { uv: 2 }
    ),
    M.hull
  );
  fin.rotation.z = THREE.MathUtils.degToRad(70);
  fin.position.set(0.34, 0.16, -0.15);
  g.add(fin);
  g.add(mirrorGroup(fin));

  // 双发
  g.add(enginePod(0.42, -0.05, -2.05, 0.24, 0.7, 0xff6a4d, M));
  g.add(enginePod(-0.42, -0.05, -2.05, 0.24, 0.7, 0xff6a4d, M));

  // 顶部脊线
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 2.6), M.glow);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.42, 0.1);
  g.add(stripe);

  // 机炮
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.0, 10).rotateX(Math.PI / 2), M.dark);
  gun.position.set(2.42, 0, -0.6);
  g.add(gun);
  g.add(mirrorGroup(gun));
  const muzzle = glowSpriteObject(accent, 0.5, 2.0, 0.85);
  muzzle.position.set(2.42, 0, 0.02);
  g.add(muzzle);
  const muzzle2 = muzzle.clone();
  muzzle2.position.x = -2.42;
  g.add(muzzle2);

  addGreebles(g, { material: M.trim, count: 18, seed: 4242, area: { x: [0.3, 0.6], y: [-0.2, 0.25], z: [-1.2, 1.4] } });

  g.userData.naturalRadius = 1.9;
  return g;
}

/* ================================================================== *
 * 3. 轰炸机「铁砧」——重型散射
 * ================================================================== */
function buildBomberProto(accent = 0xffc23d) {
  const M = enemyMats('bomber', accent);
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    loftZ(
      [
        { z: -2.50, rx: 0.14, ry: 0.12, e: 2.6 },
        { z: -1.70, rx: 0.52, ry: 0.40, e: 3.4 },
        { z: -0.30, rx: 0.80, ry: 0.60, e: 3.6 },
        { z: 0.90, rx: 0.74, ry: 0.56, e: 3.6 },
        { z: 1.75, rx: 0.50, ry: 0.38, e: 3.2 },
        { z: 2.15, rx: 0.32, ry: 0.26, e: 2.8 },
      ],
      { radial: 22, uvU: 2.4, uvV: 1.2 }
    ),
    M.hull
  );
  g.add(body);

  const wing = new THREE.Mesh(
    prismXZ(
      [
        [0.50, -2.05],
        [2.62, -1.55],
        [2.95, 0.20],
        [1.55, 0.72],
        [0.52, 1.05],
      ],
      0.26,
      -0.02,
      { uv: 1.4 }
    ),
    M.hull
  );
  g.add(wing);
  g.add(mirrorGroup(wing));

  // 装甲带
  const armor = new THREE.Mesh(
    prismXZ(
      [
        [0.62, -0.9],
        [2.4, -0.55],
        [2.5, 0.15],
        [0.64, 0.05],
      ],
      0.42,
      0.03,
      { uv: 2 }
    ),
    M.trim
  );
  g.add(armor);
  g.add(mirrorGroup(armor));

  // 四发
  for (const x of [0.95, 2.05]) {
    g.add(enginePod(x, -0.02, -2.4, 0.3, 0.85, 0xffb347, M));
    g.add(enginePod(-x, -0.02, -2.4, 0.3, 0.85, 0xffb347, M));
  }

  // 顶部炮塔
  const dome = new THREE.Group();
  dome.name = 'part:turret';
  const base = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12, 0, TAU, 0, Math.PI / 2), M.trim);
  dome.add(base);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.0, 10).rotateX(Math.PI / 2), M.dark);
  barrel.position.z = 0.6;
  dome.add(barrel);
  dome.position.set(0, 0.5, 0.1);
  g.add(dome);

  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 3.0), M.glow);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.62, 0.2);
  g.add(stripe);

  addGreebles(g, { material: M.trim, count: 26, seed: 909, area: { x: [0.4, 0.7], y: [-0.3, 0.3], z: [-1.6, 1.6] } });

  g.userData.naturalRadius = 2.9;
  return g;
}

/* ================================================================== *
 * 4. 浮游炮台「尖塔」——环形弹幕
 * ================================================================== */
function buildTurretProto(accent = 0xc06bff) {
  const M = enemyMats('turret', accent);
  const g = new THREE.Group();

  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.5, 6, 1, false).rotateX(Math.PI / 2), M.hull);
  g.add(core);

  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.66, 0.9, 6).rotateX(Math.PI / 2), M.trim);
  cap.position.z = 1.15;
  g.add(cap);

  const capB = new THREE.Mesh(new THREE.ConeGeometry(0.66, 0.7, 6).rotateX(-Math.PI / 2), M.trim);
  capB.position.z = -1.05;
  g.add(capB);

  // 两个旋转环
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.98 + i * 0.22, 0.075, 6, 26), M.accent);
    ring.name = `spin:ring${i}`;
    ring.position.z = i === 0 ? 0.1 : -0.5;
    ring.userData.spinSpeed = (i === 0 ? 1 : -1) * 0.9;
    ring.userData.spinAxis = 'z';
    g.add(ring);
  }

  // 六根炮管
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 8).rotateX(Math.PI / 2), M.dark);
    bar.position.set(Math.cos(a) * 0.66, Math.sin(a) * 0.66, 0.75);
    g.add(bar);
    const tipGlow = glowSpriteObject(accent, 0.42, 1.8, 0.8);
    tipGlow.position.set(Math.cos(a) * 0.66, Math.sin(a) * 0.66, 1.35);
    g.add(tipGlow);
  }

  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), M.eye);
  eye.position.z = 1.35;
  g.add(eye);

  g.userData.naturalRadius = 1.7;
  return g;
}

/* ================================================================== *
 * 5. 诡雷「荆棘」——漂移 + 死亡环形弹
 * ================================================================== */
function buildMineProto(accent = 0x4dffd2) {
  const M = enemyMats('mine', accent);
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 0), M.hull);
  g.add(core);
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), M.accent);
  g.add(inner);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const b = Math.sin(i * 2.1) * 0.9;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.75, 6), M.dark);
    const dir = new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)).normalize();
    spike.position.copy(dir).multiplyScalar(0.85);
    spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.add(spike);
  }
  const halo = glowSpriteObject(accent, 3.4, 1.5, 0.5);
  g.add(halo);
  g.userData.naturalRadius = 1.2;
  return g;
}

/* ================================================================== *
 * 6. 陨石
 * ================================================================== */
export function buildAsteroid(radius = 2, seed = 1, color = 0x6a5a52) {
  const key = `ast:${radius.toFixed(2)}:${seed}:${color}`;
  if (protoCache.has(key)) return protoCache.get(key);
  const R = mulberry32(seed * 3301 + 17);
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  // 用低频噪声扰动顶点，形成不规则岩石
  const offs = [];
  for (let i = 0; i < 64; i++) offs.push({ dir: new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize(), f: 0.6 + R() * 3.4, a: (R() * 2 - 1) * 0.3 });
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let amp = 0;
    for (const o of offs) amp += Math.sin(v.dot(o.dir) * o.f + o.a) * 0.055;
    const r = 1 + amp + (R() - 0.5) * 0.04;
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.18,
    roughness: 0.92,
    flatShading: true,
    envMapIntensity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(radius);
  const g = new THREE.Group();
  g.add(mesh);
  // 表面矿脉发光
  const vein = glowSpriteObject(0xffb86a, radius * 1.1, 1.2, 0.35);
  vein.position.set(radius * 0.3, radius * 0.3, radius * 0.55);
  g.add(vein);
  g.userData.naturalRadius = radius;
  g.userData.rock = true;
  protoCache.set(key, g);
  return g;
}

/* ================================================================== *
 * 统一入口
 * ================================================================== */
const BUILDERS = {
  scout: buildScoutProto,
  interceptor: buildInterceptorProto,
  bomber: buildBomberProto,
  turret: buildTurretProto,
  mine: buildMineProto,
};

export function getEnemyProto(type, accent) {
  const key = `proto:${type}:${accent}`;
  if (!protoCache.has(key)) {
    const fn = BUILDERS[type];
    if (!fn) throw new Error('unknown enemy type: ' + type);
    protoCache.set(key, fn(accent));
  }
  return protoCache.get(key);
}

/** 生成一个可用的敌机实例 */
export function makeEnemy(type, accent) {
  return instantiate(getEnemyProto(type, accent));
}

export function clearEnemyCache() {
  for (const v of protoCache.values()) {
    if (v && v.isObject3D) {
      v.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    }
  }
  protoCache.clear();
}

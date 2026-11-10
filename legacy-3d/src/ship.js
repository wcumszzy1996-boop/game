/**
 * ship.js — 主战飞机「SF-71 星锋」程序化建模
 * 坐标系约定：机头朝 -Z，机背朝 +Y，右翼朝 +X
 */
import * as THREE from '../vendor/three/three.module.js';
import { loftZ, prismXZ, hullMaterial, energyMaterial, glowMaterial, shieldMaterial, flameMaterial, addGreebles, mirrorGroup, mergeGeometries, glowSpriteObject } from './meshlib.js';
import { glowSprite, hexFieldSprite } from './textures.js';

const HULL_KEY = 'sf71';
const ACCENT = 0x5fe8ff;      // 主发光色（青蓝）
const WARN = 0xff6a3d;        // 副发光色（橙红）
const CANOPY = 0x0b2233;

/** 主机体放样截面 */
const BODY_SECTIONS = [
  { z: -4.55, rx: 0.05, ry: 0.05, y: 0.00, e: 2.2 },
  { z: -4.00, rx: 0.22, ry: 0.18, y: 0.00, e: 2.4 },
  { z: -3.20, rx: 0.38, ry: 0.30, y: 0.03, e: 2.6 },
  { z: -2.20, rx: 0.52, ry: 0.41, y: 0.07, e: 2.8 },
  { z: -1.10, rx: 0.63, ry: 0.50, y: 0.07, e: 3.0 },
  { z: 0.20, rx: 0.62, ry: 0.49, y: 0.03, e: 3.0 },
  { z: 1.40, rx: 0.53, ry: 0.41, y: -0.01, e: 2.9 },
  { z: 2.40, rx: 0.41, ry: 0.33, y: -0.02, e: 2.7 },
  { z: 3.00, rx: 0.30, ry: 0.25, y: -0.01, e: 2.5 },
];

const CANOPY_SECTIONS = [
  { z: -3.10, rx: 0.09, ry: 0.045, y: 0.30, e: 2.0 },
  { z: -2.62, rx: 0.23, ry: 0.125, y: 0.385, e: 2.2 },
  { z: -2.05, rx: 0.295, ry: 0.165, y: 0.445, e: 2.4 },
  { z: -1.45, rx: 0.275, ry: 0.155, y: 0.415, e: 2.4 },
  { z: -1.10, rx: 0.15, ry: 0.085, y: 0.325, e: 2.1 },
];

/** 主翼外形（右翼，[x, z]） */
const WING_OUTLINE = [
  [0.33, -1.55],
  [1.55, -1.05],
  [3.10, 1.35],
  [3.42, 1.82],
  [3.20, 2.48],
  [2.33, 1.72],
  [1.52, 2.62],
  [0.35, 2.38],
];

/** 鸭翼 */
const CANARD_OUTLINE = [
  [0.30, -3.30],
  [1.12, -2.80],
  [1.34, -2.42],
  [0.33, -2.52],
];

/** 垂尾（先画在 XZ 平面，再绕 Z 轴翻转成竖直） */
const FIN_OUTLINE = [
  [0.0, -1.35],
  [1.42, 0.42],
  [1.50, 0.86],
  [0.55, 1.36],
  [0.0, 1.72],
];

function scl(v) {
  return v;
}

/**
 * 构建主战飞机。
 * @param {object} [opt] { emissiveBoost }
 * @returns {THREE.Group}
 */
export function buildPlayerShip(opt = {}) {
  const g = new THREE.Group();
  g.name = 'SF-71';

  const hullTexKey = HULL_KEY;
  const matHull = hullMaterial(hullTexKey, {
    emissive: ACCENT,
    emissiveIntensity: 1.25,
    metalness: 0.9,
    roughness: 0.4,
    envMapIntensity: 1.9,
    color: 0xdfe8f2,
    tex: { base: '#4a5566', accent: '#7fe6ff', stripe: '#ff8a3d', size: 512, normalStrength: 2.4 },
  });
  const matDark = new THREE.MeshStandardMaterial({
    color: 0x1b2129,
    metalness: 0.92,
    roughness: 0.32,
    envMapIntensity: 1.6,
  });
  const matTrim = new THREE.MeshStandardMaterial({
    color: 0x2b3441,
    metalness: 0.85,
    roughness: 0.5,
    envMapIntensity: 1.4,
  });
  const matGlass = new THREE.MeshStandardMaterial({
    color: CANOPY,
    metalness: 0.72,
    roughness: 0.055,
    envMapIntensity: 3.0,
    emissive: new THREE.Color(0x0d3d63),
    emissiveIntensity: 0.9,
  });
  const matAccent = energyMaterial(ACCENT, 3.0);
  const matWarn = energyMaterial(WARN, 2.6);
  const matAccentDim = energyMaterial(ACCENT, 1.6, { transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });

  /* ---------- 1. 主机身 ---------- */
  const bodyGeo = loftZ(BODY_SECTIONS, { radial: 26, uvU: 3, uvV: 1.2 });
  const body = new THREE.Mesh(bodyGeo, matHull);
  g.add(body);

  /* ---------- 2. 座舱盖 ---------- */
  const canopyGeo = loftZ(CANOPY_SECTIONS, { radial: 20, uvU: 1.5, uvV: 1 });
  const canopy = new THREE.Mesh(canopyGeo, matGlass);
  g.add(canopy);
  // 座舱框
  const frame = new THREE.Mesh(loftZ(CANOPY_SECTIONS, { radial: 20, uvU: 1, uvV: 1 }), matDark);
  frame.scale.set(1.045, 1.045, 1.01);
  frame.renderOrder = -1;
  g.add(frame);
  // 舱内 HUD 微光
  const hud = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), matWarn);
  hud.position.set(0, 0.36, -2.25);
  hud.rotation.x = -Math.PI / 2 + 0.35;
  g.add(hud);

  /* ---------- 3. 机翼 ---------- */
  const wingGeo = prismXZ(WING_OUTLINE, 0.17, 0, { uv: 1.6 });
  const wingR = new THREE.Mesh(wingGeo, matHull);
  wingR.rotation.z = 0.045;
  g.add(wingR);
  const wingL = mirrorGroup(wingR);
  g.add(wingL);

  // 翼前缘发光条
  const leGeo = prismXZ(
    [
      [0.40, -1.62],
      [3.05, 1.28],
      [3.30, 1.62],
      [0.42, -1.40],
    ],
    0.055,
    0.10,
    { uv: 3 }
  );
  const leR = new THREE.Mesh(leGeo, matAccent);
  leR.rotation.z = 0.045;
  g.add(leR);
  g.add(mirrorGroup(leR));

  // 翼面装甲板（增加层次）
  const plateGeo = prismXZ(
    [
      [0.55, -0.75],
      [2.35, 0.72],
      [2.55, 1.25],
      [0.58, -0.35],
    ],
    0.30,
    0.02,
    { uv: 2 }
  );
  const plateR = new THREE.Mesh(plateGeo, matTrim);
  plateR.rotation.z = 0.045;
  g.add(plateR);
  g.add(mirrorGroup(plateR));

  /* ---------- 4. 鸭翼 ---------- */
  const canardGeo = prismXZ(CANARD_OUTLINE, 0.1, 0.06, { uv: 2 });
  const canardR = new THREE.Mesh(canardGeo, matHull);
  canardR.rotation.z = -0.18;
  g.add(canardR);
  g.add(mirrorGroup(canardR));

  /* ---------- 5. 双垂尾 ---------- */
  const finGeo = prismXZ(FIN_OUTLINE, 0.11, 0, { uv: 2 });
  const finR = new THREE.Mesh(finGeo, matHull);
  finR.rotation.z = THREE.MathUtils.degToRad(62);
  finR.position.set(0.42, 0.18, 1.45);
  g.add(finR);
  const finL = mirrorGroup(finR);
  g.add(finL);
  // 垂尾发光后缘
  const finEdgeGeo = prismXZ(
    [
      [1.36, 0.40],
      [1.46, 0.80],
      [1.40, 0.86],
      [1.30, 0.46],
    ],
    0.15,
    0,
    { uv: 2 }
  );
  const finEdgeR = new THREE.Mesh(finEdgeGeo, matWarn);
  finEdgeR.rotation.z = THREE.MathUtils.degToRad(62);
  finEdgeR.position.set(0.42, 0.18, 1.45);
  g.add(finEdgeR);
  g.add(mirrorGroup(finEdgeR));

  // 腹鳍
  const vfinGeo = prismXZ(
    [
      [0.0, -0.6],
      [0.86, 0.35],
      [0.9, 0.72],
      [0.0, 1.3],
    ],
    0.1,
    0,
    { uv: 2 }
  );
  const vfin = new THREE.Mesh(vfinGeo, matTrim);
  vfin.rotation.z = THREE.MathUtils.degToRad(-118);
  vfin.position.set(0.0, -0.18, 1.6);
  g.add(vfin);

  /* ---------- 6. 翼尖炮 ---------- */
  const gunGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.088, 0.1, 1.5, 12).rotateX(Math.PI / 2),
    new THREE.CylinderGeometry(0.055, 0.075, 0.42, 10).rotateX(Math.PI / 2).translate(0, 0, -0.9),
  ]);
  const gun = new THREE.Mesh(gunGeo, matDark);
  gun.position.set(3.18, 0.02, 0.62);
  g.add(gun);
  g.add(mirrorGroup(gun));
  const gunTipR = glowSpriteObject(ACCENT, 0.62, 2.2, 0.95);
  gunTipR.position.set(3.18, 0.02, -0.3);
  g.add(gunTipR);
  const gunTipL = gunTipR.clone();
  gunTipL.position.x = -3.18;
  g.add(gunTipL);

  /* ---------- 7. 进气口 / 背脊 ---------- */
  const intakeGeo = mergeGeometries([
    new THREE.BoxGeometry(0.34, 0.26, 1.5).translate(0, 0, 0),
    new THREE.BoxGeometry(0.4, 0.1, 1.32).translate(0, 0.12, 0.06),
  ]);
  const intake = new THREE.Mesh(intakeGeo, matTrim);
  intake.position.set(0.72, 0.02, 0.5);
  g.add(intake);
  g.add(mirrorGroup(intake));

  // 背脊（脊线）
  const spineGeo = prismXZ(
    [
      [-0.16, -1.4],
      [0.16, -1.4],
      [0.2, 2.9],
      [-0.2, 2.9],
    ],
    0.1,
    0.5,
    { uv: 2 }
  );
  const spine = new THREE.Mesh(spineGeo, matTrim);
  g.add(spine);

  // 翼面发光条（贴在机翼上表面，法线 = 局部 +Y = 正对相机）
  const wingStripGeo = new THREE.PlaneGeometry(0.13, 2.05);
  const wingStrip = new THREE.Mesh(wingStripGeo, matAccentDim);
  wingStrip.rotation.x = -Math.PI / 2;
  wingStrip.position.set(1.72, 0.19, 0.42);
  g.add(wingStrip);
  g.add(mirrorGroup(wingStrip));

  // 机身背脊发光条
  const spineStripGeo = new THREE.PlaneGeometry(0.16, 3.4);
  const spineStrip = new THREE.Mesh(spineStripGeo, matAccentDim);
  spineStrip.rotation.x = -Math.PI / 2;
  spineStrip.position.set(0, 0.62, 1.05);
  g.add(spineStrip);

  /* ---------- 8. 机械细节 ---------- */
  const grR = addGreebles(g, {
    material: matTrim,
    count: 30,
    seed: 1337,
    area: { x: [0.35, 0.85], y: [-0.16, 0.2], z: [-1.2, 2.4] },
  });
  g.add(mirrorGroup(grR));

  /* ---------- 9. 引擎 ---------- */
  const thrusters = [];
  const flameMats = [];
  const engineDefs = [
    { x: 0.4, y: -0.06, r: 0.245, z: 3.02 },
    { x: -0.4, y: -0.06, r: 0.245, z: 3.02 },
    { x: 0.0, y: 0.3, r: 0.165, z: 2.95 },
  ];
  for (const e of engineDefs) {
    const nz = new THREE.Group();
    // 外壁
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(e.r, e.r * 1.08, 0.72, 18, 1, true).rotateX(Math.PI / 2),
      matDark
    );
    wall.position.z = 0.36;
    nz.add(wall);
    // 内壁发光
    const innerMat = energyMaterial(ACCENT, 3.4, { side: THREE.DoubleSide });
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(e.r * 0.92, e.r * 0.72, 0.7, 18, 1, true).rotateX(Math.PI / 2), innerMat);
    inner.position.z = 0.34;
    nz.add(inner);
    // 尾喷焰
    const fH = 2.6;
    const fMat = flameMaterial(0x66d8ff, 1.5);
    const flame = new THREE.Mesh(new THREE.CylinderGeometry(0.03, e.r * 0.95, fH, 16, 1, true), fMat);
    flame.rotation.x = Math.PI / 2;
    flame.position.z = 0.72 + fH / 2;
    flame.renderOrder = 2;
    nz.add(flame);
    // 尾喷口辉光（公告板，始终正对相机）
    const halo = glowSpriteObject(0x8fe8ff, e.r * 6.2, 1.5, 0.8);
    halo.position.z = 0.5;
    nz.add(halo);

    nz.position.set(e.x, e.y, e.z);
    g.add(nz);
    thrusters.push(nz);
    flameMats.push(fMat);
  }

  /* ---------- 10. 航行灯 ---------- */
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), energyMaterial(0xff3b3b, 3.0));
  navR.position.set(3.2, 0.12, 1.6);
  g.add(navR);
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), energyMaterial(0x3bff7a, 3.0));
  navL.position.set(-3.2, 0.12, 1.6);
  g.add(navL);

  /* ---------- 11. 护盾 -------- */
  const shieldMat = shieldMaterial(ACCENT, hexFieldSprite('#7fe8ff'));
  const shield = new THREE.Mesh(new THREE.SphereGeometry(3.05, 36, 24), shieldMat);
  shield.scale.set(1.0, 0.72, 1.0);
  shield.renderOrder = 5;
  g.add(shield);

  /* ---------- 12. 引擎点光源 ---------- */
  const engineLight = new THREE.PointLight(0x66d8ff, 3.2, 14, 2);
  engineLight.position.set(0, 0.05, 3.6);
  g.add(engineLight);

  g.userData = {
    body,
    canopy,
    shield,
    shieldMat,
    thrusters,
    flameMats,
    navR,
    navL,
    engineLight,
    matAccent,
    matWarn,
    accentColor: ACCENT,
    engineDefs,
  };
  return g;
}

/* ================================================================== *
 * 僚机（无人机）
 * ================================================================== */
let droneProto = null;
export function buildDrone() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 1), energyMaterial(0x9d6bff, 2.6));
  core.name = 'droneCore';
  g.add(core);
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x39404d, metalness: 0.95, roughness: 0.3, flatShading: true, envMapIntensity: 1.8 })
  );
  g.add(shell);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 6, 20), energyMaterial(0xb08bff, 2.0));
  ring.rotation.x = Math.PI / 2;
  ring.name = 'droneRing';
  g.add(ring);
  return g;
}
export function getDroneProto() {
  if (!droneProto) droneProto = buildDrone();
  return droneProto;
}

/* ================================================================== *
 * 追踪导弹
 * ================================================================== */
let missileProto = null;
export function buildMissile() {
  const g = new THREE.Group();
  const bodyGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.09, 0.11, 1.1, 10).rotateX(Math.PI / 2),
    new THREE.ConeGeometry(0.09, 0.34, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.72),
  ]);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x59606d, metalness: 0.9, roughness: 0.35 }));
  g.add(body);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.24), new THREE.MeshStandardMaterial({ color: 0x2c313a, metalness: 0.8, roughness: 0.5 }));
  fin.position.z = 0.45;
  g.add(fin);
  const fin2 = fin.clone();
  fin2.rotation.z = Math.PI / 2;
  g.add(fin2);
  const exhaust = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.7, 10, 1, true), energyMaterial(0xffd27a, 2.4, { transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.z = 1.0;
  g.add(exhaust);
  const glow = glowSpriteObject(0xffb86a, 1.35, 2.0, 0.95);
  glow.position.z = 0.95;
  g.add(glow);
  return g;
}
export function getMissileProto() {
  if (!missileProto) missileProto = buildMissile();
  return missileProto;
}

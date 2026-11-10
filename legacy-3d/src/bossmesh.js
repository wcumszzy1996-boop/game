/**
 * bossmesh.js — 三个关底 BOSS 程序化建模
 * 统一朝向：舰艏朝 +Z（正对玩家），俯视展示甲板
 */
import * as THREE from '../vendor/three/three.module.js';
import {
  loftZ, prismXZ, hullMaterial, energyMaterial, addGreebles,
  mergeGeometries, glowSpriteObject, shieldMaterial, cloneMaterials, collectFlashables,
} from './meshlib.js';
import { hexFieldSprite, glowSprite } from './textures.js';
import { TAU, mulberry32 } from './util.js';

const cache = new Map();

function bossMats(key, accent, base = '#39404e') {
  const ck = `bm:${key}:${accent}`;
  if (cache.has(ck)) return cache.get(ck);
  const M = {
    hull: hullMaterial(`boss-${key}`, {
      emissive: accent,
      // 船体自发光的底色很关键：emissiveIntensity 一旦接近 1，整块舰体都会发粉色，
      // 再经 Bloom 扩散就变成一大片糊住的粉光，把建模细节全吃掉。
      // 这里只给一点点底色，粉色主要靠 emissiveMap 上的条纹做点缀。
      emissiveIntensity: 0.32,
      metalness: 0.94,
      roughness: 0.38,
      envMapIntensity: 1.5,
      tex: { base, accent: '#9fe8ff', stripe: '#ff6a2d', size: 1024, normalStrength: 2.6 },
    }),
    plate: hullMaterial(`boss-${key}-p`, {
      emissive: accent,
      emissiveIntensity: 0.20,
      metalness: 0.9,
      roughness: 0.52,
      envMapIntensity: 1.3,
      color: 0xb9c4d2,
      tex: { base: '#4c5361', accent: '#88d8ff', stripe: '#ff9a3d', size: 1024, normalStrength: 2.2 },
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x161b22, metalness: 0.96, roughness: 0.28, envMapIntensity: 1.7 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2a313d, metalness: 0.9, roughness: 0.44, envMapIntensity: 1.5 }),
    accent: energyMaterial(accent, 2.1),
    accentSoft: energyMaterial(accent, 1.2, { transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }),
    hot: energyMaterial(0xff5a2d, 2.4),
    core: energyMaterial(0xffffff, 3.4),
  };
  cache.set(ck, M);
  return M;
}

function turretPod(M, radius, barrelLen, color) {
  const g = new THREE.Group();
  g.name = 'part:pod';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.18, radius * 0.8, 8).rotateX(Math.PI / 2), M.dark);
  g.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.92, 14, 10, 0, TAU, 0, Math.PI / 2), M.plate);
  dome.rotation.x = Math.PI / 2;
  dome.position.z = radius * 0.25;
  g.add(dome);
  for (const dx of [-radius * 0.34, radius * 0.34]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.13, radius * 0.16, barrelLen, 8).rotateX(Math.PI / 2), M.dark);
    bar.position.set(dx, 0, radius * 0.4 + barrelLen / 2);
    g.add(bar);
  }
  const glow = glowSpriteObject(color, radius * 1.7, 1.2, 0.35);
  glow.position.z = radius * 0.6;
  g.add(glow);
  return g;
}

/* ================================================================== *
 * BOSS 1 — 蜂巢驱逐舰 VESPER
 * ================================================================== */
function buildVesper(accent = 0xff4d9e) {
  const M = bossMats('vesper', accent, '#39404e');
  const g = new THREE.Group();
  g.name = 'BOSS-VESPER';

  /* 主舰体：六边形蜂巢平台 */
  const hullParts = [];
  const layers = [
    { z: 1.6, r: 4.4, h: 1.2 },
    { z: 0.2, r: 6.4, h: 1.9 },
    { z: -1.6, r: 5.4, h: 1.6 },
    { z: -3.0, r: 3.4, h: 1.3 },
  ];
  for (const L of layers) {
    hullParts.push(new THREE.CylinderGeometry(L.r, L.r * 0.96, L.h, 6).rotateX(Math.PI / 2).translate(0, 0, L.z));
  }
  const hull = new THREE.Mesh(mergeGeometries(hullParts), M.hull);
  g.add(hull);

  /* 甲板装甲 */
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.0, 0.5, 6).rotateX(Math.PI / 2).translate(0, 1.1, 0.2), M.plate);
  g.add(deck);

  /* 核心（六棱发光柱） */
  const coreGeo = new THREE.CylinderGeometry(1.5, 1.5, 3.2, 6).rotateX(Math.PI / 2);
  const core = new THREE.Mesh(coreGeo, M.accent);
  core.position.set(0, 1.35, 0.0);
  g.add(core);
  const coreGlow = glowSpriteObject(accent, 3.6, 1.3, 0.30);
  coreGlow.position.set(0, 1.4, 0.4);
  g.add(coreGlow);

  /* 外环（旋转） */
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7.0, 0.22, 8, 40), M.accent);
  ring.name = 'spin:ring';
  ring.userData.spinSpeed = 0.5;
  ring.rotation.x = Math.PI / 2;
  ring.position.z = -0.2;
  g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.11, 6, 36), M.accentSoft);
  ring2.name = 'spin:ring2';
  ring2.userData.spinSpeed = -0.85;
  ring2.rotation.x = Math.PI / 2;
  ring2.position.z = 1.2;
  g.add(ring2);

  /* 6 个可破坏炮台（围绕中心） */
  const pods = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6;
    const pod = turretPod(M, 0.78, 1.5, accent);
    pod.position.set(Math.cos(a) * 5.2, 0.85, Math.sin(a) * 5.2 * 0.82);
    pod.rotation.y = -a + Math.PI / 2;
    pod.userData.podIndex = i;
    g.add(pod);
    pods.push(pod);
  }

  /* 舰艏尖刺 */
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i - 1) * 0.5;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.6, 6).rotateX(Math.PI / 2), M.dark);
    spike.position.set(Math.cos(a) * 3.6, 0.1, Math.sin(a) * 3.6 + 3.4);
    g.add(spike);
  }

  /* 尾部引擎 */
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const pod = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 1.6, 10, 1, true).rotateX(Math.PI / 2), M.dark);
    pod.add(shell);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.52, 10), M.accent);
    inner.position.z = -0.82;
    inner.rotation.y = Math.PI;
    pod.add(inner);
    const fl = glowSpriteObject(0xff7ad0, 1.4, 1.2, 0.45);
    fl.position.z = -1.2;
    pod.add(fl);
    pod.position.set(Math.cos(a) * 2.9, -0.4, Math.sin(a) * 2.9 - 3.6);
    g.add(pod);
  }

  addGreebles(g, { material: M.trim, count: 60, seed: 555, area: { x: [-4.4, 4.4], y: [-0.4, 1.0], z: [-3.2, 2.6] } });

  /* 护盾力场 */
  const shield = new THREE.Mesh(new THREE.SphereGeometry(9.2, 40, 26), shieldMaterial(accent, hexFieldSprite('#ff8cc8')));
  shield.scale.set(1.0, 0.42, 1.0);
  shield.position.y = 0.6;
  g.add(shield);

  g.userData = {
    parts: pods,
    core,
    ring,
    shield,
    shieldMat: shield.material,
    hitRadius: 6.2,
    coreOffset: new THREE.Vector3(0, 0, 0),
  };
  return g;
}

/* ================================================================== *
 * BOSS 2 — 双子战列舰 CASTOR / POLLUX
 * ================================================================== */
function buildCastor(accent = 0xffa22e) {
  const M = bossMats('castor', accent, '#4a4238');
  const g = new THREE.Group();
  g.name = 'BOSS-CASTOR';

  const pods = [];

  /** 单侧舰体 */
  function buildHalf(sign) {
    const h = new THREE.Group();
    const bodyParts = [];
    const secs = [
      { z: -7.6, rx: 1.0, ry: 0.8 },
      { z: -6.0, rx: 1.7, ry: 1.25 },
      { z: -3.5, rx: 2.0, ry: 1.45 },
      { z: -0.5, rx: 2.1, ry: 1.5 },
      { z: 2.6, rx: 1.85, ry: 1.32 },
      { z: 5.2, rx: 1.25, ry: 0.95 },
      { z: 7.0, rx: 0.75, ry: 0.6 },
      { z: 8.2, rx: 0.28, ry: 0.24 },
    ];
    const body = new THREE.Mesh(loftZ(secs, { radial: 20, uvU: 2.6, uvV: 1.6, exponent: 3.6 }), M.hull);
    h.add(body);

    // 侧舷装甲带
    const belt = new THREE.Mesh(
      mergeGeometries([
        new THREE.BoxGeometry(0.7, 1.5, 13.5).translate(0, 0.15, 0),
        new THREE.BoxGeometry(1.0, 0.7, 11.0).translate(0, 1.05, 0),
      ]),
      M.plate
    );
    belt.position.x = sign * 1.5;
    h.add(belt);

    // 舰桥
    const bridge = new THREE.Mesh(loftZ([
      { z: -1.0, rx: 0.75, ry: 0.5, y: 1.2 },
      { z: 0.2, rx: 1.05, ry: 0.72, y: 1.45 },
      { z: 1.6, rx: 0.8, ry: 0.55, y: 1.3 },
      { z: 2.4, rx: 0.35, ry: 0.28, y: 1.15 },
    ], { radial: 14, uvU: 1.5, uvV: 1, exponent: 3.2 }), M.trim);
    h.add(bridge);

    // 前后主炮
    for (const zz of [3.6, -3.4]) {
      const pod = turretPod(M, 1.05, 2.2, accent);
      pod.position.set(sign * 0.2, 1.5, zz);
      pod.rotation.y = Math.PI * 0.5;
      h.add(pod);
      pods.push(pod);
    }
    // 舷侧副炮
    for (const zz of [0.2, -6.0]) {
      const pod = turretPod(M, 0.72, 1.4, accent);
      pod.position.set(sign * 1.7, 0.95, zz);
      pod.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
      h.add(pod);
      pods.push(pod);
    }

    // 推进器
    for (const dx of [-0.9, 0.9]) {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.78, 2.0, 12, 1, true).rotateX(Math.PI / 2), M.dark);
      shell.position.set(dx, -0.1, -8.0);
      h.add(shell);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.58, 12), M.accent);
      inner.position.set(dx, -0.1, -9.02);
      inner.rotation.y = Math.PI;
      h.add(inner);
      const fl = glowSpriteObject(0xffc06a, 1.6, 1.2, 0.45);
      fl.position.set(dx, -0.1, -9.4);
      h.add(fl);
    }

    // 侧向发光带
    for (const dx of [-0.55, 0.55]) {
      const st = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 12.0), M.accentSoft);
      st.rotation.x = -Math.PI / 2;
      st.position.set(dx, 1.95, 0);
      h.add(st);
    }

    addGreebles(h, { material: M.trim, count: 34, seed: sign > 0 ? 21 : 22, area: { x: [-1.4, 1.4], y: [0.9, 1.6], z: [-6.5, 6.5] } });
    return h;
  }

  const right = buildHalf(1);
  right.position.x = 3.9;
  g.add(right);
  const left = buildHalf(-1);
  left.position.x = -3.9;
  g.add(left);

  /* 中央能量桥：连接两舰 */
  const tetherMat = energyMaterial(accent, 2.0, { transparent: true, opacity: 0.50, blending: THREE.AdditiveBlending, depthWrite: false });
  const tether = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.32, 0.9), tetherMat);
  tether.position.set(0, 0.9, -4.2);
  g.add(tether);
  const tether2 = tether.clone();
  tether2.position.z = 3.0;
  g.add(tether2);
  const tetherCore = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 1), M.accent);
  tetherCore.position.set(0, 0.9, -0.6);
  tetherCore.name = 'spin:core';
  tetherCore.userData.spinSpeed = 1.2;
  g.add(tetherCore);
  const tcGlow = glowSpriteObject(accent, 3.2, 1.3, 0.32);
  tcGlow.position.set(0, 0.9, -0.2);
  g.add(tcGlow);

  const shield = new THREE.Mesh(new THREE.SphereGeometry(11.5, 36, 22), shieldMaterial(accent, hexFieldSprite('#ffc266')));
  shield.scale.set(1.0, 0.4, 0.78);
  g.add(shield);

  g.userData = {
    parts: pods,
    core: tetherCore,
    ring: tetherCore,
    shield,
    shieldMat: shield.material,
    hitRadius: 6.0,
    dual: { right, left },
  };
  return g;
}

/* ================================================================== *
 * BOSS 3 — 星核泰坦 NOVA CORE
 * ================================================================== */
function buildNova(accent = 0x2fe6d0) {
  const M = bossMats('nova', accent, '#324a4e');
  const g = new THREE.Group();
  g.name = 'BOSS-NOVA';

  /* 主球壳 */
  const shellGeo = new THREE.IcosahedronGeometry(4.2, 3);
  const shell = new THREE.Mesh(shellGeo, M.hull);
  g.add(shell);

  /* 内部等离子球 */
  const plasmaMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(accent) },
      uColorB: { value: new THREE.Color(0xffffff) },
      uIntensity: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(normalMatrix * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColorA; uniform vec3 uColorB; uniform float uIntensity;
      varying vec3 vN; varying vec3 vP;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float noise(vec3 p){
        vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        float n = mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                      mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
        return n;
      }
      void main(){
        float t = uTime * 0.5;
        float n = noise(vP * 0.85 + vec3(t, -t * 0.7, t * 0.4));
        n += 0.5 * noise(vP * 1.9 - vec3(t * 1.3, t * 0.5, -t));
        float fres = pow(1.0 - abs(dot(normalize(vN), vec3(0.0, 0.0, 1.0))), 1.6);
        vec3 col = mix(uColorA, uColorB, pow(n, 2.2));
        col *= (0.7 + n * 1.9 + fres * 1.5) * uIntensity;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    toneMapped: false,
  });
  const plasma = new THREE.Mesh(new THREE.IcosahedronGeometry(3.1, 4), plasmaMat);
  g.add(plasma);

  const coreGlow = glowSpriteObject(accent, 5.5, 1.4, 0.40);
  g.add(coreGlow);

  /* 装甲叶片（旋转） */
  const blades = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const blade = new THREE.Mesh(
      prismXZ([
        [-0.9, -3.4], [0.9, -3.0], [1.5, 0.4], [0.4, 2.6], [-0.7, 2.2], [-1.4, 0.2],
      ], 0.7, 0, { uv: 1.2 }),
      M.plate
    );
    blade.rotation.z = Math.PI / 2;
    blade.rotation.y = a;
    blade.position.set(Math.cos(a) * 5.6, 0, Math.sin(a) * 5.6);
    blade.lookAt(0, 0, 0);
    blade.rotateX(Math.PI / 2);
    blades.push(blade);
    g.add(blade);
  }

  /* 三条旋转环 */
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(6.6 + i * 0.5, 0.28, 6, 44), i === 1 ? M.hot : M.accent);
    r.name = `spin:ring${i}`;
    r.userData.spinSpeed = (0.35 + i * 0.22) * (i % 2 ? -1 : 1);
    r.rotation.set(Math.PI / 2 + (i - 1) * 0.42, i * 0.7, 0);
    rings.push(r);
    g.add(r);
  }

  /* 6 个可破坏炮台，挂在外环上 */
  const pods = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const pod = turretPod(M, 0.95, 2.0, accent);
    pod.position.set(Math.cos(a) * 6.6, 0, Math.sin(a) * 6.6);
    pod.lookAt(0, 0, 0);
    pod.rotateY(Math.PI);
    g.add(pod);
    pods.push(pod);
  }

  /* 后部推进环 */
  const drive = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.5, 8, 24), M.dark);
  drive.position.z = -3.4;
  drive.rotation.x = Math.PI / 2;
  g.add(drive);

  const shield = new THREE.Mesh(new THREE.SphereGeometry(8.6, 40, 26), shieldMaterial(accent, hexFieldSprite('#7ffceb')));
  g.add(shield);

  g.userData = {
    parts: pods,
    core: plasma,
    plasmaMat,
    ring: rings[0],
    rings,
    blades,
    shield,
    shieldMat: shield.material,
    hitRadius: 5.4,
    shell,
  };
  return g;
}

/* ================================================================== */
const BUILDERS = { vesper: buildVesper, castor: buildCastor, nova: buildNova };

export function buildBoss(type, accent) {
  const fn = BUILDERS[type] || buildVesper;
  const g = fn(accent);
  // 每个 BOSS 都是独立实例（不做原型克隆），材质已是独立副本
  collectFlashables(g);
  return g;
}

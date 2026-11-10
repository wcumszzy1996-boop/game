/**
 * meshlib.js — 程序化建模基础构件
 *  - loftZ        : 沿 Z 轴放样的超椭圆截面机身（自带解析法线，无接缝）
 *  - prismXZ      : XZ 平面多边形挤出（机翼/尾翼/装甲板），硬边
 *  - 材质工厂     : 金属/能量/辉光/护盾力场
 */
import * as THREE from '../vendor/three/three.module.js';
import { TAU, clamp, mulberry32 } from './util.js';
import { glowSprite, hullTextures } from './textures.js';

/* ================================================================== *
 * 1. 沿 Z 轴放样（机身 / 引擎舱 / 导弹体）
 * ================================================================== */

/**
 * @param {Array<{z:number,rx:number,ry:number,x?:number,y?:number,e?:number}>} sections
 * @param {object} [opts]
 */
export function loftZ(sections, opts = {}) {
  const radial = opts.radial || 24;
  const defExp = opts.exponent || 2.6;
  const uvU = opts.uvU ?? 2;
  const uvV = opts.uvV ?? 1.5;
  const n = sections.length;
  const EPS = 0.015;

  const px = (s, i) => {
    const a = (i / radial) * TAU;
    const c = Math.cos(a), sn = Math.sin(a);
    const e = s.e || defExp;
    const k = 2 / e;
    const rx = Math.max(EPS, s.rx), ry = Math.max(EPS, s.ry);
    return [
      (s.x || 0) + Math.sign(c) * Math.pow(Math.abs(c), k) * rx,
      (s.y || 0) + Math.sign(sn) * Math.pow(Math.abs(sn), k) * ry,
      s.z,
    ];
  };

  const pos = new Float32Array(n * radial * 3);
  const nor = new Float32Array(n * radial * 3);
  const uv = new Float32Array(n * radial * 2);

  // 顶点
  let p = 0, u = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < radial; j++) {
      const q = px(sections[i], j);
      pos[p++] = q[0]; pos[p++] = q[1]; pos[p++] = q[2];
      uv[u++] = (j / radial) * uvU; uv[u++] = (i / (n - 1)) * uvV;
    }
  }

  // 解析法线
  const a1 = new THREE.Vector3(), b1 = new THREE.Vector3(), nn = new THREE.Vector3();
  const at = (i, j) => {
    const ii = clamp(i, 0, n - 1);
    const jj = ((j % radial) + radial) % radial;
    const q = px(sections[ii], jj);
    return new THREE.Vector3(q[0], q[1], q[2]);
  };
  p = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < radial; j++) {
      // du：环绕方向切线
      a1.subVectors(at(i, j + 1), at(i, j - 1));
      // dv：轴向切线
      b1.subVectors(at(i + 1, j), at(i - 1, j));
      nn.crossVectors(a1, b1).normalize();
      nor[p++] = nn.x; nor[p++] = nn.y; nor[p++] = nn.z;
    }
  }

  // 索引
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const a = i * radial + j;
      const b = i * radial + j2;
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + j2;
      idx.push(a, d, c, a, b, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);

  // 端盖
  if (opts.capStart !== false) geo.userData.capStart = { section: sections[0], radial, uvU, uvV };
  if (opts.capEnd !== false) geo.userData.capEnd = { section: sections[n - 1], radial, uvU, uvV };
  if (opts.capStart !== false || opts.capEnd !== false) {
    return mergeCaps(geo, sections, radial, uvU, uvV);
  }
  return geo;
}

function capGeometry(sec, radial, dir, uvU, uvV, exp) {
  const g = new THREE.BufferGeometry();
  const pos = [], nor = [], uv = [], idx = [];
  const EPS = 0.015;
  const k = 2 / (exp || 2.6);
  pos.push(sec.x || 0, sec.y || 0, sec.z);
  nor.push(0, 0, dir);
  uv.push(0.5, 0.5);
  for (let j = 0; j < radial; j++) {
    const a = (j / radial) * TAU;
    const c = Math.cos(a), sn = Math.sin(a);
    pos.push((sec.x || 0) + Math.sign(c) * Math.pow(Math.abs(c), k) * Math.max(EPS, sec.rx));
    pos.push((sec.y || 0) + Math.sign(sn) * Math.pow(Math.abs(sn), k) * Math.max(EPS, sec.ry));
    pos.push(sec.z);
    nor.push(0, 0, dir);
    uv.push(j / radial, dir > 0 ? 0 : 1);
  }
  for (let j = 0; j < radial; j++) {
    const a = 1 + j, b = 1 + ((j + 1) % radial);
    // dir>0 表示朝 +Z（尾部），反之朝 -Z（机头）
    if (dir > 0) idx.push(0, a, b);
    else idx.push(0, b, a);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 把放样体与两端盖合并（无需依赖 BufferGeometryUtils） */
function mergeCaps(geo, sections, radial, uvU, uvV) {
  const parts = [geo];
  if (geo.userData.capStart) parts.push(capGeometry(sections[0], radial, -1, uvU, uvV, sections[0].e));
  if (geo.userData.capEnd) parts.push(capGeometry(sections[sections.length - 1], radial, 1, uvU, uvV, sections[sections.length - 1].e));
  return mergeGeometries(parts);
}

/** 简易几何合并（position/normal/uv，非索引 → 索引） */
export function mergeGeometries(list) {
  const posArr = [], norArr = [], uvArr = [], idxArr = [];
  let offset = 0;
  for (const g of list) {
    if (!g) continue;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, nn = g.attributes.normal, uu = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      posArr.push(p.getX(i), p.getY(i), p.getZ(i));
      norArr.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      uvArr.push(uu ? uu.getX(i) : 0, uu ? uu.getY(i) : 0);
    }
    const ix = g.index;
    if (ix) for (let i = 0; i < ix.count; i++) idxArr.push(ix.getX(i) + offset);
    else for (let i = 0; i < p.count; i++) idxArr.push(i + offset);
    offset += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norArr, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
  out.setIndex(idxArr);
  return out;
}

/* ================================================================== *
 * 2. XZ 平面多边形挤出（机翼 / 尾翼 / 装甲）
 * ================================================================== */

/**
 * @param {Array<[number,number]>} outline 顶点 [x, z]
 * @param {number} thickness 厚度
 * @param {number} centerY 中面高度
 * @param {object} [opts] { taper: 每点独立厚度倍率?, shear }
 */
export function prismXZ(outline, thickness = 0.18, centerY = 0, opts = {}) {
  const pts = outline.map((q) => [q[0], q[1], q[2] == null ? 1 : q[2]]);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) pts.reverse();
  const n = pts.length;

  let cx = 0, cz = 0;
  for (const q of pts) { cx += q[0]; cz += q[1]; }
  cx /= n; cz /= n;

  // 包围盒，用于 UV
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const q of pts) {
    minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
    minZ = Math.min(minZ, q[1]); maxZ = Math.max(maxZ, q[1]);
  }
  const sx = Math.max(1e-4, maxX - minX), sz = Math.max(1e-4, maxZ - minZ);
  const uvs = opts.uv || 1;
  const U = (x, z) => [((x - minX) / sx) * uvs, ((z - minZ) / sz) * uvs];

  const pos = [], nor = [], uv = [], idx = [];
  const T = centerY + thickness / 2;
  const B = centerY - thickness / 2;

  // 顶环 0..n-1（法线 +Y）
  for (const q of pts) { pos.push(q[0], T, q[1]); nor.push(0, 1, 0); uv.push(...U(q[0], q[1])); }
  // 底环 n..2n-1（法线 -Y）
  for (const q of pts) { pos.push(q[0], B, q[1]); nor.push(0, -1, 0); uv.push(...U(q[0], q[1])); }
  // 侧壁上环 2n..3n-1 / 下环 3n..4n-1（法线 = 边外法线）
  const edgeNormals = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const l = Math.hypot(ex, ez) || 1;
    edgeNormals.push([ez / l, 0, -ex / l]);
  }
  for (let i = 0; i < n; i++) {
    const q = pts[i], en = edgeNormals[i];
    pos.push(q[0], T, q[1]); nor.push(en[0], en[1], en[2]); uv.push(...U(q[0], q[1]));
  }
  for (let i = 0; i < n; i++) {
    const q = pts[i], en = edgeNormals[i];
    pos.push(q[0], B, q[1]); nor.push(en[0], en[1], en[2]); uv.push(...U(q[0], q[1]));
  }
  // 顶/底中心
  const CT = 4 * n, CB = 4 * n + 1;
  pos.push(cx, T, cz); nor.push(0, 1, 0); uv.push(...U(cx, cz));
  pos.push(cx, B, cz); nor.push(0, -1, 0); uv.push(...U(cx, cz));

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(CT, j, i);                       // 顶面
    idx.push(CB, n + i, n + j);               // 底面
    idx.push(2 * n + i, 3 * n + i, 3 * n + j); // 外侧壁
    idx.push(2 * n + i, 3 * n + j, 2 * n + j);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ================================================================== *
 * 3. 材质工厂
 * ================================================================== */

export function hullMaterial(key, opt = {}) {
  const t = hullTextures(key, opt.tex || {});
  const m = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    emissiveMap: t.emissiveMap,
    emissive: new THREE.Color(opt.emissive || 0xffffff),
    emissiveIntensity: opt.emissiveIntensity ?? 1.5,
    metalness: opt.metalness ?? 0.88,
    roughness: opt.roughness ?? 0.44,
    envMapIntensity: opt.envMapIntensity ?? 1.6,
    color: new THREE.Color(opt.color || 0xffffff),
    side: opt.side || THREE.FrontSide,
  });
  m.normalScale.set(opt.normalScale ?? 1.15, opt.normalScale ?? 1.15);
  m.userData.baseEmissive = m.emissiveIntensity;
  return m;
}

/** 自发光能量材质（HDR 增益 > 1 以驱动 Bloom） */
export function energyMaterial(color, gain = 2.6, opt = {}) {
  const c = new THREE.Color(color).multiplyScalar(gain);
  return new THREE.MeshBasicMaterial({
    color: c,
    toneMapped: false,
    transparent: opt.transparent || false,
    opacity: opt.opacity ?? 1,
    blending: opt.blending ?? THREE.NormalBlending,
    depthWrite: opt.depthWrite !== false,
    side: opt.side || THREE.FrontSide,
    map: opt.map || null,
  });
}

/** 加性辉光面片材质 */
export function glowMaterial(color, gain = 1.6, opacity = 1, map = null) {
  return new THREE.MeshBasicMaterial({
    map: map || glowSprite(typeof color === 'number' ? '#' + new THREE.Color(color).getHexString() : color, 2.4, 128),
    color: new THREE.Color(color).multiplyScalar(gain),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

/**
 * 公告板式辉光（Sprite 永远正对相机）。
 * 注意：本作相机是"斜上方俯视"，任何法线朝 ±X/±Z 的面片都会侧翻到近乎不可见，
 * 所以点状辉光一律用 Sprite，而不是 Plane。
 */
export function glowSpriteObject(color, size = 1, gain = 1.8, opacity = 1) {
  const hex = typeof color === 'number' ? '#' + new THREE.Color(color).getHexString() : color;
  const mat = new THREE.SpriteMaterial({
    map: glowSprite(hex, 2.5, 96),
    color: new THREE.Color(color).multiplyScalar(gain),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

/** 护盾力场（菲涅尔 + 六边形网格 + 受击脉冲） */
export function shieldMaterial(color = 0x66ddff, hexMap = null) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uOpacity: { value: 0.0 },
      uHit: { value: 0 },
      uHex: { value: hexMap },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uHit;
      uniform sampler2D uHex;
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUv;
      void main() {
        // 菲涅尔指数提到 3.2：护盾只在「掠射边缘」显形，
        // 正对相机的那一大片球面几乎完全透明，舰体细节才不会被吃掉。
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.2);
        vec2 huv = vUv * 3.0 + vec2(uTime * 0.05, -uTime * 0.045);
        float hex = texture2D(uHex, huv).r;
        float ripple = 0.5 + 0.5 * sin(uTime * 6.0 - vUv.y * 14.0);
        // 该材质是「加性混合 + DoubleSide」，前后两个半球会叠加；
        // BOSS 护盾球半径很大，如果整面都加色，会把整个 BOSS 糊成一团单色光。
        // 因此所有能量项都乘上 rim，只保留一圈会呼吸的球壳边缘。
        float rim = fres * (0.82 + ripple * 0.18);
        vec3 col = uColor * (0.10 + rim * 1.55 + hex * rim * 0.9 + uHit * 1.6);
        float a = uOpacity * (0.006 + rim * 0.62 + hex * rim * 0.16) + uHit * 0.42 * (0.25 + rim);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** 尾焰（沿 -Z 方向拉伸的加性锥体，带流动噪声） */
export function flameMaterial(color = 0x66ccff, gain = 3.2) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uColor2: { value: new THREE.Color(0xffffff) },
      uTime: { value: 0 },
      uPower: { value: 1 },
      uGain: { value: gain },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uColor2;
      uniform float uTime;
      uniform float uPower;
      uniform float uGain;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i), b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      void main() {
        // vUv.y: 0 = 喷口, 1 = 尾端
        float t = vUv.y;
        float flick = noise(vec2(vUv.x * 5.0, t * 6.0 - uTime * 7.0));
        float body = pow(1.0 - t, 1.35);
        float core = pow(1.0 - t, 4.0);
        float a = body * (0.62 + flick * 0.7) * uPower;
        a *= smoothstep(0.0, 0.06, t);
        vec3 col = mix(uColor2, uColor, smoothstep(0.0, 0.55, t));
        col += uColor2 * core * 1.6;
        gl_FragColor = vec4(col * uGain * (0.55 + core), clamp(a, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/* ================================================================== *
 * 4. 细节装饰
 * ================================================================== */

/**
 * 在给定包围盒区域内散布小方块（"机械细节"），让模型不显得光滑廉价。
 */
export function addGreebles(parent, opt = {}) {
  const count = opt.count || 26;
  const R = mulberry32(opt.seed || 7);
  const mat = opt.material;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const rng = (a, b) => a + R() * (b - a);
  const area = opt.area || { x: [-1, 1], y: [-0.4, 0.4], z: [-2, 2] };
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    p.set(rng(area.x[0], area.x[1]), rng(area.y[0], area.y[1]), rng(area.z[0], area.z[1]));
    q.identity();
    s.set(rng(0.06, 0.3), rng(0.05, 0.2), rng(0.1, 0.55));
    m4.compose(p, q, s);
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

/** 发光条（细长加性面片） */
export function glowStrip(color, len, width, gain = 3.0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), energyMaterial(color, gain, { side: THREE.DoubleSide }));
  return m;
}

/** 圆柱喷口 */
export function nozzle(radius, length, color = 0x8fd8ff) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.06, length, 18, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.95, roughness: 0.28, side: THREE.DoubleSide })
  );
  body.rotation.x = Math.PI / 2;
  body.position.z = length / 2;
  g.add(body);
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.86, 20),
    energyMaterial(color, 2.4, { side: THREE.DoubleSide })
  );
  inner.position.z = -0.01;
  inner.rotation.y = Math.PI;
  g.add(inner);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.02, radius * 0.09, 8, 22),
    energyMaterial(color, 1.4)
  );
  ring.position.z = 0.02;
  g.add(ring);
  return g;
}

/**
 * 复制几何体并做镜像。
 * 关键：镜像必须作用在"外层"（M·T·R·S 顺序），直接给克隆体 scale.x=-1 会
 * 让旋转分量也被镜像，导致左右机翼二面角反向。这里用外层包裹 Group 解决。
 */
export function mirrorX(mesh) {
  const wrap = new THREE.Group();
  wrap.scale.x = -1;
  const c = mesh.clone(true);
  flipSides(c);
  wrap.add(c);
  return wrap;
}

/** 沿 X 轴整体镜像一组对象 */
export function mirrorGroup(group) {
  const wrap = new THREE.Group();
  wrap.scale.x = -1;
  const c = group.clone(true);
  flipSides(c);
  wrap.add(c);
  return wrap;
}

/** 负缩放会翻转面片朝向，需把 FrontSide 补成 BackSide */
function flipSides(root) {
  root.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const flipped = mats.map((m) => {
        if (m.side === THREE.FrontSide) {
          const n = m.clone();
          n.side = THREE.BackSide;
          return n;
        }
        return m;
      });
      o.material = Array.isArray(o.material) ? flipped : flipped[0];
    }
  });
}

/* ================================================================== *
 * 5. 受击闪白辅助
 * ================================================================== */

/**
 * 收集组内所有可闪白的材质，并记录基准自发光参数。
 * 注意：为支持"单个单位独立闪白"，需要每个实例拥有自己的材质副本。
 */
export function collectFlashables(group) {
  const list = [];
  group.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.isMeshStandardMaterial) {
        list.push({
          mat: m,
          color: m.emissive.clone(),
          intensity: m.emissiveIntensity,
        });
      }
    }
  });
  group.userData.flashables = list;
  return list;
}

/** 给实例克隆独立材质（在对象池创建时调用一次） */
export function cloneMaterials(root) {
  root.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    }
  });
}

/** 应用闪白强度 0..1 */
export function applyFlash(group, t) {
  const list = group.userData.flashables;
  if (!list) return;
  for (const f of list) {
    if (t <= 0) {
      f.mat.emissive.copy(f.color);
      f.mat.emissiveIntensity = f.intensity;
    } else {
      f.mat.emissive.setRGB(
        f.color.r + (1.0 - f.color.r) * t,
        f.color.g + (1.0 - f.color.g) * t,
        f.color.b + (1.0 - f.color.b) * t
      );
      f.mat.emissiveIntensity = f.intensity + t * 3.2;
    }
  }
}

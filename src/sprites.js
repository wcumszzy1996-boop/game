/**
 * sprites.js — 全程序化 2D 贴图库（零美术资源）
 *
 * 设计约定：
 *  1) 所有贴图为「白/灰阶 + alpha」，颜色一律由 material.color 着色，
 *     因此同一张图可被 HDR 倍率（color > 1）拉出 Bloom，无需重复绘制。
 *  2) 发光类贴图（子弹/激光/粒子/引擎焰）用 AdditiveBlending；
 *     实体类贴图（机体/敌机/道具）用 NormalBlending，轮廓内为实心像素。
 *  3) 需要无缝滚动的贴图（激光/星云）用周期函数生成，保证 RepeatWrapping 不接缝。
 *  4) canvas 的 y 轴向下，而世界 y 轴向上；three 的 PlaneGeometry UV 使
 *     贴图顶端对应世界 +y，因此「机首朝上」= canvas 中朝上。
 */
import * as THREE from '../vendor/three/three.module.js';

const TAU = Math.PI * 2;

/* ================================================================== *
 * 基础工具
 * ================================================================== */
function cvs(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function mkTex(c, { repeat = false, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** 逐像素生成白/灰阶 alpha 贴图，fn(u,v,r) -> [0,1] 强度 */
function pixelTex(w, h, fn, opt) {
  const [c, g] = cvs(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  const hw = w * 0.5, hh = h * 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5 - hw) / hw;
      const v = (y + 0.5 - hh) / hh;
      const r = Math.hypot(u, v);
      let a = fn(u, v, r);
      if (!(a > 0)) a = 0;
      else if (a > 1) a = 1;
      const i = (y * w + x) * 4;
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = (a * 255) | 0;
    }
  }
  g.putImageData(img, 0, 0);
  return [c, g];
}

/** 关于 x=0 对称的闭合路径（调用前把原点平移到对称中心） */
function symPath(g, half) {
  g.beginPath();
  g.moveTo(half[0][0], half[0][1]);
  for (let i = 1; i < half.length; i++) g.lineTo(half[i][0], half[i][1]);
  for (let i = half.length - 1; i >= 0; i--) g.lineTo(-half[i][0], half[i][1]);
  g.closePath();
}

function polyPath(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

function vlin(g, x, y0, y1, stops) {
  const gr = g.createLinearGradient(x, y0, x, y1);
  for (const [p, c] of stops) gr.addColorStop(p, c);
  return gr;
}
function hlin(g, x0, x1, y, stops) {
  const gr = g.createLinearGradient(x0, y, x1, y);
  for (const [p, c] of stops) gr.addColorStop(p, c);
  return gr;
}
function rad(g, x, y, r0, r1, stops) {
  const gr = g.createRadialGradient(x, y, r0, x, y, r1);
  for (const [p, c] of stops) gr.addColorStop(p, c);
  return gr;
}

/** 面板分割线（细，半透明亮线） */
function panel(g, pts, color = 'rgba(150,190,235,0.30)', w = 1) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = w;
  polyPath(g, pts);
  g.stroke();
  g.restore();
}

/* ================================================================== *
 * 发光贴图
 * ================================================================== */

/** 柔和光斑（粒子主力） */
function glowTex(size = 128, pow = 2.4) {
  return mkTex(...pixelTex(size, size, (u, v, r) => Math.pow(Math.max(0, 1 - r), pow)));
}
/** 高温光斑：中心接近饱和，外侧一层次辉光 */
function hotTex(size = 128) {
  return mkTex(...pixelTex(size, size, (u, v, r) => {
    const core = Math.exp(-(r * r) / 0.045);
    const halo = Math.exp(-(r * r) / 0.30) * 0.55;
    return core + halo;
  }));
}
/** 四芒星火花 */
function sparkTex(size = 128) {
  return mkTex(...pixelTex(size, size, (u, v, r) => {
    const th = Math.atan2(v, u);
    const core = Math.exp(-(r * r) / 0.02) * 1.0;
    const spikes = Math.pow(Math.abs(Math.cos(2 * th)), 16) * Math.exp(-(r * r) / 0.55) * 1.25;
    const fine = Math.pow(Math.abs(Math.cos(6 * th)), 40) * Math.exp(-(r * r) / 0.20) * 0.5;
    return core + spikes + fine;
  }));
}
/** 纵向速度线 */
function streakTex(w = 32, h = 128) {
  return mkTex(...pixelTex(w, h, (u, v) => {
    const ax = Math.abs(u);
    const env = Math.pow(Math.max(0, 1 - ax), 2.0);
    const tail = Math.pow(Math.max(0, 1 - Math.abs(v)), 1.3);
    return env * (0.35 + 0.65 * tail);
  }));
}
/** 圆环（冲击波） */
function ringTex(size = 256, w = 0.055) {
  return mkTex(...pixelTex(size, size, (u, v, r) => {
    const d = (r - 0.80) / w;
    return Math.exp(-d * d) * (r < 0.94 ? 1 : 0.35);
  }));
}
/** 烟雾/尘云（多层正弦噪声，可平铺） */
function smokeTex(size = 128) {
  const P = [[1, 0, 0.4], [0, 1, 1.7], [1, 1, 2.9], [-1, 2, 0.9], [2, -1, 2.1], [1, 3, 3.4], [-2, -2, 1.2]];
  return mkTex(...pixelTex(size, size, (u, v, r) => {
    let n = 0, wsum = 0;
    for (let i = 0; i < P.length; i++) {
      const [a, b, ph] = P[i];
      const w = 1 / (1 + a * a + b * b);
      n += w * Math.sin(TAU * (a * u + b * v) + ph);
      wsum += w;
    }
    n = (n / wsum) * 0.5 + 0.5;
    const fall = Math.pow(Math.max(0, 1 - r), 1.6);
    return Math.pow(Math.max(0, n * 1.35 - 0.42), 1.1) * fall * 1.9;
  }), { repeat: true });
}

/** 激光光束（中心亮核 + 外层辉光 + 周期亮节；纵向无缝平铺） */
function beamTex() {
  const W = 96, H = 512;
  return mkTex(...pixelTex(W, H, (u, v) => {
    void v;
    const core = Math.exp(-(u * u) / 0.013);
    const halo = Math.exp(-(u * u) / 0.22);
    return Math.min(1, core * 1.0 + halo * 0.46);
  }), { repeat: true });
}
/** 光束外光晕（宽、软、纯度低） */
function beamHaloTex() {
  const W = 96, H = 32;
  return mkTex(...pixelTex(W, H, (u, v) => {
    void v;
    return Math.exp(-(u * u) / 0.30) * 0.75 + Math.exp(-(u * u) / 0.05) * 0.35;
  }), { repeat: true });
}

/** 引擎尾焰（顶部为喷口，向下延伸） */
function flameTex(w = 64, h = 160) {
  return mkTex(...pixelTex(w, h, (u, v0) => {
    const v = (v0 + 1) * 0.5;                    // 0=喷口 1=尾端
    const flare = 0.30 + 0.55 * Math.exp(-v * 7.0) + 0.42 * Math.exp(-Math.pow((v - 0.16) * 5.2, 2));
    const half = flare * Math.pow(Math.max(0, 1 - v), 0.62);
    const ax = Math.abs(u);
    if (ax > half) return 0;
    const t = ax / Math.max(half, 1e-4);
    let a = Math.pow(1 - t, 0.85);
    a *= Math.pow(Math.max(0, 1 - v), 0.45);
    a *= 0.78 + 0.22 * Math.sin(v * 42 + u * 13);
    return a * 1.15;
  }));
}

/** 枪口闪光（小型四芒 + 热核） */
function muzzleTex(size = 128) {
  return mkTex(...pixelTex(size, size, (u, v, r) => {
    const th = Math.atan2(v, u);
    return Math.exp(-(r * r) / 0.055) * 1.1
      + Math.pow(Math.abs(Math.cos(2 * th)), 10) * Math.exp(-(r * r) / 0.42) * 0.85;
  }));
}

/** 护盾泡（边缘亮、中心近透明，带六边形网格感） */
function shieldTex(size = 256) {
  const [c, g] = pixelTex(size, size, (u, v, r) => {
    const rim = Math.exp(-Math.pow((r - 0.90) / 0.075, 2)) * 1.0;
    const cell = 0.5 + 0.5 * Math.sin(u * 26) * Math.sin(v * 26);
    const inner = Math.pow(Math.max(0, 1 - r), 3.4) * 0.30;
    return rim * (0.62 + 0.38 * cell) + inner * (0.5 + 0.5 * cell);
  });
  return mkTex(c, { aniso: 4 });
}

/* ================================================================== *
 * 星云 / 背景
 * ================================================================== */
function cloudTex(size = 512, seed = 1) {
  const K = [];
  const rnd = (() => { let a = seed * 9301 + 49297; return () => ((a = (a * 9301 + 49297) % 233280) / 233280); })();
  for (let i = 0; i < 9; i++) {
    K.push([Math.round(rnd() * 4 - 2) || 1, Math.round(rnd() * 4 - 2) || 1, rnd() * TAU, 0.4 + rnd() * 0.9]);
  }
  return mkTex(...pixelTex(size, size, (u, v) => {
    let n = 0, ws = 0;
    for (const [a, b, ph, w] of K) {
      n += w * Math.sin(TAU * (a * u + b * v) + ph);
      ws += w;
    }
    n = n / ws * 0.5 + 0.5;
    const puff = Math.pow(Math.max(0, n - 0.30), 1.7) * 2.4;
    // 四角渐隐，避免平铺时出现硬边（贴图按 2x2 重复使用）
    const edge = Math.min(1, Math.min(1 - Math.abs(u), 1 - Math.abs(v)) * 3.2);
    return puff * Math.max(0, edge);
  }), { repeat: true, aniso: 4 });
}

/** 岩屑（陨石带装饰）——不规则轮廓 + 陨坑 + 明暗 */
function rockTex(size = 160) {
  const [c, g] = cvs(size, size);
  const cxx = size / 2;
  const rr = size / 2 - 6;
  const rnd = (() => { let a = 12345; return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
  const N = 14;
  const rs = [];
  for (let i = 0; i < N; i++) rs.push(rr * (0.74 + rnd() * 0.26));
  g.save();
  g.translate(cxx, cxx);
  g.beginPath();
  for (let i = 0; i < N; i++) {
    const a = i / N * TAU;
    const x = Math.cos(a) * rs[i], y = Math.sin(a) * rs[i];
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
  g.fillStyle = rad(g, -rr * 0.3, -rr * 0.34, rr * 0.1, rr * 1.5,
    [[0, '#9aa2ad'], [0.34, '#6c747f'], [0.72, '#454c55'], [1, '#242931']]);
  g.fill();
  g.save();
  g.clip();
  // 陨坑
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU, d = rnd() * rr * 0.78;
    const x = Math.cos(a) * d, y = Math.sin(a) * d, r0 = 4 + rnd() * 15;
    g.fillStyle = rad(g, x, y, 0, r0, [[0, 'rgba(20,24,30,0.75)'], [0.7, 'rgba(40,46,54,0.4)'], [1, 'rgba(60,66,74,0)']]);
    g.beginPath(); g.arc(x, y, r0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(190,200,215,0.20)'; g.lineWidth = 1.2;
    g.beginPath(); g.arc(x, y - 1, r0 * 0.95, Math.PI * 1.15, Math.PI * 1.95); g.stroke();
  }
  // 裂纹
  g.strokeStyle = 'rgba(24,28,34,0.6)'; g.lineWidth = 1.6;
  for (let i = 0; i < 5; i++) {
    const a = rnd() * TAU;
    g.beginPath();
    g.moveTo(Math.cos(a) * rr * 0.1, Math.sin(a) * rr * 0.1);
    for (let k = 0; k < 4; k++) g.lineTo(Math.cos(a + (rnd() - 0.5) * 0.8) * rr * (0.3 + k * 0.2), Math.sin(a + (rnd() - 0.5) * 0.8) * rr * (0.3 + k * 0.2));
    g.stroke();
  }
  g.restore();
  g.strokeStyle = 'rgba(200,212,228,0.28)'; g.lineWidth = 1.4;
  g.beginPath();
  for (let i = 0; i < N; i++) {
    const a = i / N * TAU;
    const x = Math.cos(a) * rs[i], y = Math.sin(a) * rs[i];
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath(); g.stroke();
  g.restore();
  return mkTex(c, { aniso: 4 });
}

/** 母舰内部风格：暗金属六边网格板 */
function gridTex(size = 256, cell = 32, line = 'rgba(120,170,190,0.16)', fill = 'rgba(10,26,30,0.55)') {
  const [c, g] = cvs(size, size);
  g.fillStyle = fill;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = line;
  g.lineWidth = 1;
  for (let i = 0; i <= size; i += cell) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(size, i); g.stroke();
  }
  g.strokeStyle = 'rgba(160,220,230,0.10)';
  g.lineWidth = 3;
  for (let i = 0; i <= size; i += cell * 4) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.stroke();
  }
  return mkTex(c, { repeat: true, aniso: 4 });
}

/* ================================================================== *
 * 自机（俯视，机首朝上）
 * ================================================================== */
function playerShipTex(size = 256) {
  const [c, g] = cvs(size, size);
  const R = 256 / size;                        // 设计基准 256
  g.save();
  g.translate(size / 2, size / 2);
  g.scale(1 / R, 1 / R);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  const HULL_D = '#1b2233', HULL_M = '#2e3b57', HULL_L = '#4a5c82', HULL_H = '#6f86b4';
  const ACC = '#ff8a2e', ACC2 = '#35ffc8';

  /* --- 底部环境遮蔽 --- */
  g.save();
  g.filter = 'blur(6px)';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  symPath(g, [[0, -104], [20, -60], [72, -6], [96, 26], [34, 54], [38, 108], [22, 118], [0, 122]]);
  g.fill();
  g.restore();

  /* --- 主翼（大三角）--- */
  g.fillStyle = vlin(g, 0, -40, 108, [
    [0, '#5b7096'], [0.28, HULL_L], [0.72, HULL_M], [1, HULL_D]]);
  symPath(g, [[18, -32], [66, -14], [102, 22], [96, 40], [46, 52], [22, 44]]);
  g.fill();
  // 翼面高光
  g.fillStyle = vlin(g, 0, -30, 40, [
    [0, 'rgba(255,255,255,0.20)'], [0.5, 'rgba(190,220,255,0.07)'], [1, 'rgba(0,0,0,0.16)']]);
  symPath(g, [[18, -30], [62, -12], [94, 20], [64, 26], [22, 30]]);
  g.fill();
  // 翼尖导轨
  g.fillStyle = '#131a28';
  symPath(g, [[78, 4], [104, 22], [100, 36], [74, 22]]);
  g.fill();
  // 翼尖指示灯
  for (const s of [1, -1]) {
    g.fillStyle = s > 0 ? 'rgba(60,255,190,0.95)' : 'rgba(255,70,90,0.95)';
    g.beginPath(); g.arc(s * 94, 28, 3.4, 0, TAU); g.fill();
    g.fillStyle = s > 0 ? 'rgba(60,255,190,0.35)' : 'rgba(255,70,90,0.35)';
    g.beginPath(); g.arc(s * 94, 28, 8, 0, TAU); g.fill();
  }

  /* --- 前翼（鸭翼）--- */
  g.fillStyle = vlin(g, 0, -80, -30, [[0, HULL_H], [1, HULL_M]]);
  symPath(g, [[14, -62], [50, -74], [62, -66], [58, -52], [20, -44]]);
  g.fill();
  g.strokeStyle = 'rgba(140,180,230,0.35)'; g.lineWidth = 1;
  symPath(g, [[14, -62], [50, -74], [62, -66], [58, -52], [20, -44]]); g.stroke();

  /* --- 机身 --- */
  g.fillStyle = hlin(g, -26, 26, 0, [
    [0, HULL_D], [0.22, HULL_M], [0.46, HULL_H], [0.56, HULL_L], [0.80, HULL_M], [1, HULL_D]]);
  symPath(g, [[0, -114], [10, -88], [17, -58], [22, -26], [26, 12], [30, 52], [35, 92], [30, 112], [0, 118]]);
  g.fill();

  /* --- 机身脊线 / 面板 --- */
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(160,200,255,0.26)'; g.lineWidth = 1.3;
  for (const x of [7, -7]) { g.beginPath(); g.moveTo(x, -104); g.lineTo(x * 1.5, 100); g.stroke(); }
  g.strokeStyle = 'rgba(140,180,230,0.18)'; g.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const y = -86 + i * 22;
    const w = 9 + i * 2.4;
    g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
  }
  g.restore();

  /* --- 座舱 --- */
  g.fillStyle = rad(g, 0, -56, 1, 17, [[0, '#eaffff'], [0.28, '#63e0ff'], [0.62, '#1a6fa8'], [1, '#0a1a2b']]);
  symPath(g, [[0, -84], [9, -72], [11, -52], [8, -40], [0, -36]]);
  g.fill();
  g.strokeStyle = 'rgba(120,230,255,0.55)'; g.lineWidth = 1.2;
  symPath(g, [[0, -84], [9, -72], [11, -52], [8, -40], [0, -36]]);
  g.stroke();

  /* --- 橙色识别条 --- */
  g.fillStyle = 'rgba(255,138,46,0.92)';
  symPath(g, [[52, -26], [74, -18], [76, -10], [54, -18]]);
  g.fill();

  /* --- 垂尾（俯视呈小三角）--- */
  g.fillStyle = '#232d43';
  for (const s of [1, -1]) {
    polyPath(g, [[s * 40, 46], [s * 54, 26], [s * 60, 40], [s * 46, 62]]);
    g.fill();
  }

  /* --- 发动机短舱 --- */
  g.fillStyle = vlin(g, 0, 40, 118, [[0, HULL_L], [0.45, HULL_M], [1, '#151c2b']]);
  symPath(g, [[22, 42], [46, 48], [50, 96], [42, 112], [24, 112], [21, 78]]);
  g.fill();
  g.strokeStyle = 'rgba(150,190,240,0.24)'; g.lineWidth = 1;
  symPath(g, [[22, 42], [46, 48], [50, 96], [42, 112], [24, 112], [21, 78]]); g.stroke();

  /* --- 尾喷口 --- */
  for (const s of [1, -1]) {
    g.save();
    g.translate(s * 33, 108);
    g.fillStyle = rad(g, 0, 0, 2, 16, [[0, '#e8ffff'], [0.32, '#6fe8ff'], [0.7, '#1b4a63'], [1, '#0b1520']]);
    g.beginPath(); g.ellipse(0, 0, 15, 9, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(180,240,255,0.55)'; g.lineWidth = 1.4;
    g.beginPath(); g.ellipse(0, 0, 15, 9, 0, 0, TAU); g.stroke();
    g.restore();
  }

  /* --- 机首探测器 --- */
  g.fillStyle = 'rgba(255,190,90,0.95)';
  g.beginPath(); g.arc(0, -104, 3.0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,190,90,0.30)';
  g.beginPath(); g.arc(0, -104, 8, 0, TAU); g.fill();

  /* --- 边线收边 --- */
  g.strokeStyle = 'rgba(190,225,255,0.20)'; g.lineWidth = 1.2;
  symPath(g, [[0, -114], [10, -88], [17, -58], [22, -26], [26, 12], [30, 52], [35, 92], [30, 112], [0, 118]]);
  g.stroke();

  g.restore();
  return mkTex(c, { aniso: 8 });
}

/* ================================================================== *
 * 敌机（俯视，机首朝下 —— 面向自机）
 * ================================================================== */

/** 通用外壳底色 */
function enemyBase(g, half, colors) {
  const { d, m, l } = colors;
  g.fillStyle = vlin(g, 0, -60, 90, [[0, l], [0.4, m], [1, d]]);
  symPath(g, half);
  g.fill();
  g.strokeStyle = 'rgba(220,240,255,0.24)';
  g.lineWidth = 1.2;
  symPath(g, half);
  g.stroke();
}

function scoutTex(size = 128) {
  const [c, g] = cvs(size, size);
  const R = 128 / size;
  g.save(); g.translate(size / 2, size / 2); g.scale(1 / R, 1 / R);
  g.lineJoin = 'round';
  g.fillStyle = rad(g, 0, 10, 4, 44, [[0, 'rgba(255,90,90,0.35)'], [1, 'rgba(255,90,90,0)']]);
  g.beginPath(); g.arc(0, 6, 44, 0, TAU); g.fill();
  enemyBase(g, [[0, 52], [16, 20], [14, -8], [30, -30], [12, -40], [0, -34]], { d: '#1b2027', m: '#3a444f', l: '#5d6d7c' });
  g.fillStyle = '#161b21';
  symPath(g, [[6, 40], [26, 6], [18, -4], [6, 6]]); g.fill();
  g.fillStyle = 'rgba(255,80,70,0.98)';
  g.beginPath(); g.arc(0, 14, 5.2, 0, TAU); g.fill();
  g.fillStyle = rad(g, 0, 14, 1, 15, [[0, 'rgba(255,180,160,0.8)'], [1, 'rgba(255,80,70,0)']]);
  g.beginPath(); g.arc(0, 14, 15, 0, TAU); g.fill();
  g.restore();
  return mkTex(c, { aniso: 4 });
}

function fighterTex(size = 160) {
  const [c, g] = cvs(size, size);
  const R = 160 / size;
  g.save(); g.translate(size / 2, size / 2); g.scale(1 / R, 1 / R);
  g.lineJoin = 'round';
  enemyBase(g, [[0, 60], [15, 30], [13, 0], [54, -14], [70, 4], [30, 26], [32, 52], [0, 62]],
    { d: '#2a1c14', m: '#5a4030', l: '#8a6a4a' });
  g.fillStyle = vlin(g, 0, -20, 44, [[0, '#b98a52'], [1, '#3a2a1e']]);
  symPath(g, [[0, 58], [12, 28], [10, -2], [7, 30], [0, 34]]); g.fill();
  g.fillStyle = '#20160f';
  symPath(g, [[14, -12], [56, -30], [64, -20], [22, 2]]); g.fill();
  g.fillStyle = 'rgba(255,120,40,0.95)';
  for (const s of [1, -1]) { g.beginPath(); g.arc(s * 40, -12, 3.4, 0, TAU); g.fill(); }
  g.fillStyle = rad(g, 0, 36, 2, 20, [[0, '#fff0c0'], [0.4, 'rgba(255,150,50,0.85)'], [1, 'rgba(255,90,20,0)']]);
  g.beginPath(); g.arc(0, 36, 20, 0, TAU); g.fill();
  g.fillStyle = '#14100c';
  symPath(g, [[9, 34], [24, 12], [19, 6], [8, 20]]); g.fill();
  g.restore();
  return mkTex(c, { aniso: 4 });
}

function gunshipTex(size = 224) {
  const [c, g] = cvs(size, size);
  const R = 224 / size;
  g.save(); g.translate(size / 2, size / 2); g.scale(1 / R, 1 / R);
  g.lineJoin = 'round';
  // 侧舱
  g.fillStyle = vlin(g, 0, -40, 80, [[0, '#4e5a68'], [1, '#20272f']]);
  symPath(g, [[30, -34], [70, -22], [78, 26], [64, 62], [38, 62], [28, 28]]); g.fill();
  g.strokeStyle = 'rgba(210,230,255,0.20)'; g.lineWidth = 1.2;
  symPath(g, [[30, -34], [70, -22], [78, 26], [64, 62], [38, 62], [28, 28]]); g.stroke();
  // 炮管
  g.fillStyle = '#141920';
  for (const s of [1, -1]) for (const dx of [0, 14]) {
    g.fillRect(s * (48 + dx) - 3, 30, 6, 34);
  }
  g.fillStyle = 'rgba(90,220,255,0.20)';
  for (const s of [1, -1]) for (const dx of [0, 14]) g.fillRect(s * (48 + dx) - 2, 60, 4, 6);
  // 主体
  enemyBase(g, [[0, 66], [20, 40], [26, -6], [18, -44], [0, -50]], { d: '#1d232b', m: '#414d5b', l: '#6d7d8f' });
  g.fillStyle = vlin(g, 0, -40, 40, [[0, '#8fa2b6'], [1, '#2b333d']]);
  symPath(g, [[0, 62], [16, 36], [20, -4], [12, -38], [0, -42]]); g.fill();
  // 中央核心（弱点）
  g.fillStyle = rad(g, 0, 22, 2, 24, [[0, '#ffffff'], [0.35, '#ff5a4a'], [0.7, 'rgba(255,60,40,0.55)'], [1, 'rgba(255,60,40,0)']]);
  g.beginPath(); g.arc(0, 22, 24, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,150,120,0.55)'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(0, 22, 13, 0, TAU); g.stroke();
  g.restore();
  return mkTex(c, { aniso: 4 });
}

function bomberTex(size = 256) {
  const [c, g] = cvs(size, size);
  const R = 256 / size;
  g.save(); g.translate(size / 2, size / 2); g.scale(1 / R, 1 / R);
  g.lineJoin = 'round';
  enemyBase(g, [[0, 74], [26, 62], [74, 40], [88, 6], [70, -28], [30, -56], [0, -62]],
    { d: '#241b2e', m: '#4a3a5c', l: '#7a638f' });
  // 装甲板
  g.fillStyle = 'rgba(255,255,255,0.07)';
  for (let i = 0; i < 3; i++) {
    symPath(g, [[12, 58 - i * 34], [58 - i * 6, 36 - i * 30], [66 - i * 6, 22 - i * 30], [14, 44 - i * 34]]);
    g.fill();
  }
  g.strokeStyle = 'rgba(220,200,255,0.18)'; g.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-80 + i * 6, 30 - i * 26); g.lineTo(80 - i * 6, 30 - i * 26); g.stroke(); }
  // 引擎
  for (const s of [1, -1]) {
    g.fillStyle = rad(g, s * 40, -34, 2, 22, [[0, '#e0fff0'], [0.35, 'rgba(120,255,200,0.7)'], [1, 'rgba(60,200,150,0)']]);
    g.beginPath(); g.arc(s * 40, -34, 22, 0, TAU); g.fill();
  }
  // 机首感应器
  g.fillStyle = rad(g, 0, 62, 2, 26, [[0, '#ffffff'], [0.4, 'rgba(190,120,255,0.8)'], [1, 'rgba(140,80,220,0)']]);
  g.beginPath(); g.arc(0, 62, 26, 0, TAU); g.fill();
  g.restore();
  return mkTex(c, { aniso: 4 });
}

function turretTex(size = 160) {
  const [c, g] = cvs(size, size);
  const R = 160 / size;
  g.save(); g.translate(size / 2, size / 2); g.scale(1 / R, 1 / R);
  // 外环（带辐条）
  g.strokeStyle = '#48535f'; g.lineWidth = 14;
  g.beginPath(); g.arc(0, 0, 46, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(200,225,255,0.22)'; g.lineWidth = 1.4;
  g.beginPath(); g.arc(0, 0, 53, 0, TAU); g.stroke();
  g.beginPath(); g.arc(0, 0, 39, 0, TAU); g.stroke();
  g.fillStyle = '#2b333d';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    g.save(); g.rotate(a);
    g.fillRect(-6, -54, 12, 16);
    g.fillStyle = 'rgba(255,180,80,0.85)';
    g.beginPath(); g.arc(0, -50, 3.0, 0, TAU); g.fill();
    g.fillStyle = '#2b333d';
    g.restore();
  }
  // 核心
  g.fillStyle = rad(g, 0, 0, 2, 32, [[0, '#ffffff'], [0.28, '#ffd35a'], [0.6, 'rgba(255,140,40,0.75)'], [1, 'rgba(255,90,20,0)']]);
  g.beginPath(); g.arc(0, 0, 32, 0, TAU); g.fill();
  g.save(); g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,240,180,0.7)'; g.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    g.beginPath(); g.arc(0, 0, 12 + i * 7, i * 1.3, i * 1.3 + 2.0); g.stroke();
  }
  g.restore();
  g.restore();
  return mkTex(c, { aniso: 4 });
}

function eliteTex(size = 192) {
  const [c, g] = cvs(size, size);
  const R = 192 / size;
  g.save(); g.translate(size / 2, size / 2); g.scale(1 / R, 1 / R);
  g.lineJoin = 'round';
  // 能量轮廓
  g.save(); g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,60,200,0.16)';
  symPath(g, [[0, 76], [30, 34], [22, -6], [76, -32], [86, -6], [40, 22], [34, 62], [0, 78]]);
  g.fill();
  g.restore();
  enemyBase(g, [[0, 68], [26, 32], [19, -4], [70, -30], [78, -8], [36, 20], [30, 58], [0, 70]],
    { d: '#12141c', m: '#2b2f42', l: '#4a5170' });
  // 能量翼缘
  g.save(); g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,70,205,0.9)'; g.lineWidth = 2.4;
  symPath(g, [[19, -4], [70, -30], [78, -8], [36, 20]]); g.stroke();
  g.strokeStyle = 'rgba(255,140,230,0.5)'; g.lineWidth = 1.2;
  symPath(g, [[0, 68], [26, 32], [19, -4]]); g.stroke();
  g.restore();
  // 前部晶体
  g.fillStyle = rad(g, 0, 44, 2, 22, [[0, '#ffffff'], [0.3, '#ff77dd'], [0.7, 'rgba(210,40,170,0.6)'], [1, 'rgba(180,20,140,0)']]);
  g.beginPath(); g.arc(0, 44, 22, 0, TAU); g.fill();
  // 引擎
  for (const s of [1, -1]) {
    g.fillStyle = rad(g, s * 26, -24, 1, 18, [[0, '#ffffff'], [0.35, '#ff9be8'], [1, 'rgba(255,80,210,0)']]);
    g.beginPath(); g.arc(s * 26, -24, 18, 0, TAU); g.fill();
  }
  g.restore();
  return mkTex(c, { aniso: 4 });
}

/* ================================================================== *
 * BOSS（俯视，朝下）
 * ================================================================== */

function bossVesperTex(size = 512) {
  const [c, g] = cvs(size, size);
  const R = 512 / size;
  g.save(); g.translate(size / 2, size / 2); g.scale(1 / R, 1 / R);
  g.lineJoin = 'round';
  const A = '#c94f8f', B = '#8e2d6e', D = '#3a1533';

  // 侧翼荚舱
  for (const s of [1, -1]) {
    g.fillStyle = vlin(g, 0, -140, 180, [[0, '#5a2a4e'], [0.45, '#8a3a6c'], [1, '#2a1024']]);
    polyPath(g, [[s * 96, -120], [s * 190, -90], [s * 214, -6], [s * 196, 92], [s * 120, 122], [s * 92, 60]]);
    g.fill();
    g.strokeStyle = 'rgba(255,180,230,0.28)'; g.lineWidth = 1.6;
    polyPath(g, [[s * 96, -120], [s * 190, -90], [s * 214, -6], [s * 196, 92], [s * 120, 122], [s * 92, 60]]);
    g.stroke();
    // 荚舱格栅
    g.fillStyle = 'rgba(0,0,0,0.32)';
    for (let i = 0; i < 5; i++) g.fillRect(s * (122 + i * 16), -50 + i * 30, 10, 60);
    // 荚舱核心
    g.fillStyle = rad(g, s * 168, 30, 3, 34, [[0, '#ffffff'], [0.3, '#ff8ed0'], [0.65, 'rgba(255,70,170,0.6)'], [1, 'rgba(255,40,140,0)']]);
    g.beginPath(); g.arc(s * 168, 30, 34, 0, TAU); g.fill();
  }

  // 主舰体
  g.fillStyle = hlin(g, -110, 110, 0, [
    [0, D], [0.16, B], [0.42, A], [0.52, '#ff9ed0'], [0.64, A], [0.86, B], [1, D]]);
  polyPath(g, [[0, -168], [54, -138], [96, -74], [116, 10], [104, 96], [56, 152], [0, 172],
    [-56, 152], [-104, 96], [-116, 10], [-96, -74], [-54, -138]]);
  g.fill();
  g.strokeStyle = 'rgba(255,200,235,0.32)'; g.lineWidth = 2;
  polyPath(g, [[0, -168], [54, -138], [96, -74], [116, 10], [104, 96], [56, 152], [0, 172],
    [-56, 152], [-104, 96], [-116, 10], [-96, -74], [-54, -138]]);
  g.stroke();

  // 舰体面板
  g.strokeStyle = 'rgba(255,190,230,0.18)'; g.lineWidth = 1.4;
  for (let i = 0; i < 6; i++) {
    const y = -120 + i * 46;
    const w = 40 + i * 10;
    g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
  }
  g.strokeStyle = 'rgba(255,190,230,0.13)';
  for (const x of [40, 78]) { g.beginPath(); g.moveTo(x, -130); g.lineTo(x + 26, 140); g.stroke(); g.beginPath(); g.moveTo(-x, -130); g.lineTo(-x - 26, 140); g.stroke(); }

  // 舰首晶体
  g.fillStyle = rad(g, 0, -128, 4, 54, [[0, '#ffffff'], [0.26, '#ffd6f2'], [0.55, 'rgba(255,110,190,0.7)'], [1, 'rgba(230,50,150,0)']]);
  g.beginPath(); g.arc(0, -128, 54, 0, TAU); g.fill();

  // 蜂巢核心（弱点）
  g.fillStyle = '#2a1024';
  polyPath(g, [[0, -40], [52, 6], [52, 74], [0, 118], [-52, 74], [-52, 6]]);
  g.fill();
  g.fillStyle = rad(g, 0, 38, 3, 52, [[0, '#ffffff'], [0.3, '#ffe08a'], [0.6, 'rgba(255,150,40,0.65)'], [1, 'rgba(255,90,20,0)']]);
  g.beginPath(); g.arc(0, 38, 52, 0, TAU); g.fill();
  g.save(); g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,235,190,0.65)'; g.lineWidth = 2.4;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    g.beginPath(); g.moveTo(Math.cos(a) * 24, 38 + Math.sin(a) * 24);
    g.lineTo(Math.cos(a) * 46, 38 + Math.sin(a) * 46); g.stroke();
  }
  g.restore();

  // 炮塔
  for (const s of [1, -1]) for (const p of [[62, -58], [78, 46]]) {
    g.fillStyle = '#4a2040';
    g.beginPath(); g.arc(s * p[0], p[1], 17, 0, TAU); g.fill();
    g.fillStyle = rad(g, s * p[0], p[1], 1, 11, [[0, '#fff'], [0.4, '#ff7ec0'], [1, 'rgba(255,60,150,0)']]);
    g.beginPath(); g.arc(s * p[0], p[1], 11, 0, TAU); g.fill();
  }
  g.restore();
  return mkTex(c, { aniso: 4 });
}

function bossCastorTex(size = 512) {
  const [c, g] = cvs(size, size);
  const R = 512 / size;
  g.save(); g.translate(size / 2, size / 2); g.scale(1 / R, 1 / R);
  g.lineJoin = 'round';
  const A = '#ffa22e', D = '#4a2a0c', L = '#ffd98a';

  // 中央连接桥
  g.fillStyle = vlin(g, 0, -60, 60, [[0, '#8a6a3a'], [1, '#3a2712']]);
  polyPath(g, [[-88, -44], [88, -44], [104, 8], [88, 60], [-88, 60], [-104, 8]]);
  g.fill();
  g.strokeStyle = 'rgba(255,220,160,0.3)'; g.lineWidth = 1.6;
  polyPath(g, [[-88, -44], [88, -44], [104, 8], [88, 60], [-88, 60], [-104, 8]]); g.stroke();

  // 双子舰体
  for (const s of [1, -1]) {
    g.fillStyle = vlin(g, 0, -180, 190, [[0, L], [0.32, A], [0.72, '#b06a14'], [1, D]]);
    polyPath(g, [[s * 66, -186], [s * 150, -152], [s * 190, -70], [s * 186, 80], [s * 142, 158], [s * 70, 172], [s * 60, 60], [s * 58, -60]]);
    g.fill();
    g.strokeStyle = 'rgba(255,235,190,0.32)'; g.lineWidth = 2;
    polyPath(g, [[s * 66, -186], [s * 150, -152], [s * 190, -70], [s * 186, 80], [s * 142, 158], [s * 70, 172], [s * 60, 60], [s * 58, -60]]);
    g.stroke();

    // 装甲带
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let i = 0; i < 6; i++) {
      polyPath(g, [[s * 70, 140 - i * 46], [s * 176, 108 - i * 46], [s * 176, 92 - i * 46], [s * 70, 124 - i * 46]]);
      g.fill();
    }
    // 舰首撞角
    g.fillStyle = '#2a1a08';
    polyPath(g, [[s * 96, -190], [s * 138, -150], [s * 100, -132], [s * 80, -164]]);
    g.fill();
    // 舰首炮
    g.fillStyle = rad(g, s * 118, -150, 3, 40, [[0, '#ffffff'], [0.3, '#ffe6a8'], [0.6, 'rgba(255,180,60,0.7)'], [1, 'rgba(255,120,20,0)']]);
    g.beginPath(); g.arc(s * 118, -150, 40, 0, TAU); g.fill();
    // 侧向炮塔组
    for (let i = 0; i < 3; i++) {
      const ty = -60 + i * 70;
      g.fillStyle = '#5a3a14';
      g.beginPath(); g.arc(s * 150, ty, 18, 0, TAU); g.fill();
      g.fillStyle = rad(g, s * 150, ty, 1, 12, [[0, '#fff'], [0.4, '#ffbe5a'], [1, 'rgba(255,140,30,0)']]);
      g.beginPath(); g.arc(s * 150, ty, 12, 0, TAU); g.fill();
    }
    // 引擎
    g.fillStyle = rad(g, s * 116, 168, 4, 36, [[0, '#ffffff'], [0.3, '#a8f0ff'], [0.65, 'rgba(80,200,255,0.55)'], [1, 'rgba(40,140,255,0)']]);
    g.beginPath(); g.arc(s * 116, 168, 36, 0, TAU); g.fill();
  }

  // 中央核心
  g.fillStyle = '#170e04';
  g.beginPath(); g.arc(0, 4, 46, 0, TAU); g.fill();
  g.fillStyle = rad(g, 0, 4, 3, 44, [[0, '#ffffff'], [0.26, '#ffeeb0'], [0.55, 'rgba(255,160,40,0.75)'], [1, 'rgba(255,90,10,0)']]);
  g.beginPath(); g.arc(0, 4, 44, 0, TAU); g.fill();
  g.save(); g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,240,200,0.6)'; g.lineWidth = 2.2;
  g.beginPath(); g.arc(0, 4, 30, 0, TAU); g.stroke();
  g.restore();
  g.restore();
  return mkTex(c, { aniso: 4 });
}

function bossNovaTex(size = 512) {
  const [c, g] = cvs(size, size);
  const R = 512 / size;
  g.save(); g.translate(size / 2, size / 2); g.scale(1 / R, 1 / R);
  g.lineJoin = 'round';
  const ACC = '#2fe6d0';

  // 外侧环（12 段装甲）
  for (let i = 0; i < 12; i++) {
    const a0 = i / 12 * TAU + 0.03, a1 = (i + 1) / 12 * TAU - 0.03;
    const R0 = 150, R1 = 222;
    g.fillStyle = i % 2 ? '#1e3f4a' : '#26505c';
    polyPath(g, [
      [Math.cos(a0) * R0, Math.sin(a0) * R0], [Math.cos(a0) * R1, Math.sin(a0) * R1],
      [Math.cos(a1) * R1, Math.sin(a1) * R1], [Math.cos(a1) * R0, Math.sin(a1) * R0],
    ]);
    g.fill();
    g.strokeStyle = 'rgba(150,255,235,0.26)'; g.lineWidth = 1.4;
    polyPath(g, [
      [Math.cos(a0) * R0, Math.sin(a0) * R0], [Math.cos(a0) * R1, Math.sin(a0) * R1],
      [Math.cos(a1) * R1, Math.sin(a1) * R1], [Math.cos(a1) * R0, Math.sin(a1) * R0],
    ]);
    g.stroke();
    // 环上能量缝
    g.fillStyle = 'rgba(80,255,225,0.55)';
    const am = (a0 + a1) / 2;
    g.beginPath();
    g.arc(0, 0, (R0 + R1) / 2, am - 0.06, am + 0.06);
    g.lineWidth = 12; g.strokeStyle = 'rgba(90,255,230,0.5)'; g.stroke();
  }

  // 中层：四片巨臂
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * TAU + 0.4;
    g.save(); g.rotate(a);
    g.fillStyle = vlin(g, 0, 0, 150, [[0, '#2b5c68'], [0.5, '#3c7f8c'], [1, '#16323a']]);
    polyPath(g, [[-46, 0], [-26, -148], [26, -148], [46, 0]]);
    g.fill();
    g.strokeStyle = 'rgba(160,255,240,0.3)'; g.lineWidth = 1.8;
    polyPath(g, [[-46, 0], [-26, -148], [26, -148], [46, 0]]);
    g.stroke();
    g.fillStyle = rad(g, 0, -132, 3, 30, [[0, '#ffffff'], [0.3, '#8ffff0'], [0.65, 'rgba(40,220,200,0.6)'], [1, 'rgba(20,150,150,0)']]);
    g.beginPath(); g.arc(0, -132, 30, 0, TAU); g.fill();
    g.restore();
  }

  // 内壳
  g.fillStyle = rad(g, 0, 0, 20, 140, [[0, '#0c2229'], [0.7, '#123038'], [1, '#08181e']]);
  g.beginPath(); g.arc(0, 0, 140, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(120,220,220,0.22)'; g.lineWidth = 2;
  g.beginPath(); g.arc(0, 0, 140, 0, TAU); g.stroke();
  g.beginPath(); g.arc(0, 0, 116, 0, TAU); g.stroke();

  // 星核（大弱点）
  g.fillStyle = rad(g, 0, 0, 4, 96, [
    [0, '#ffffff'], [0.18, '#d8ffff'], [0.36, 'rgba(60,255,225,0.9)'],
    [0.62, 'rgba(30,180,200,0.55)'], [1, 'rgba(20,90,140,0)']]);
  g.beginPath(); g.arc(0, 0, 96, 0, TAU); g.fill();
  g.save(); g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(220,255,255,0.7)'; g.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    g.beginPath(); g.arc(0, 0, 34 + i * 15, i * 1.7, i * 1.7 + 2.4); g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath(); g.arc(0, 0, 18, 0, TAU); g.fill();
  g.restore();
  g.restore();
  return mkTex(c, { aniso: 4 });
}

/* ================================================================== *
 * 道具
 * ================================================================== */
function capsuleTex(size = 96) {
  const [c, g] = cvs(size, size);
  g.save(); g.translate(size / 2, size / 2);
  const s = size / 96;
  g.scale(s, s);
  const r = 40;
  const grd = g.createLinearGradient(0, -r, 0, r);
  grd.addColorStop(0, 'rgba(255,255,255,0.96)');
  grd.addColorStop(0.42, 'rgba(225,235,245,0.72)');
  grd.addColorStop(1, 'rgba(140,160,180,0.55)');
  g.fillStyle = grd;
  g.beginPath();
  // 六边形胶囊
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 4.5;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 9;
  g.stroke();
  // 内部暗底（让图标可读）
  g.fillStyle = 'rgba(4,10,16,0.55)';
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU - Math.PI / 2;
    const x = Math.cos(a) * (r - 8), y = Math.sin(a) * (r - 8);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
  g.restore();
  return mkTex(c, { aniso: 4 });
}

const GLYPH_DRAW = {
  power: (g) => { g.moveTo(-16, 14); g.lineTo(-16, -12); g.lineTo(-2, -12); g.arcTo(6, -12, 6, -2, 6); g.arcTo(6, 6, -2, 6, 6); g.lineTo(-16, 6); },
  spread: (g) => { g.moveTo(-18, 16); g.lineTo(0, -18); g.lineTo(18, 16); },
  missile: (g) => { g.moveTo(-14, 16); g.lineTo(0, -18); g.lineTo(14, 16); g.lineTo(0, 6); },
  drone: (g) => { g.moveTo(0, -18); g.lineTo(14, 0); g.lineTo(0, 18); g.lineTo(-14, 0); },
  shield: (g) => { g.moveTo(0, -19); g.lineTo(15, -11); g.lineTo(15, 4); g.arcTo(15, 19, 0, 19, 15); g.arcTo(-15, 19, -15, 4, 15); g.lineTo(-15, -11); },
  repair: (g) => { g.moveTo(-6, -18); g.lineTo(6, -18); g.lineTo(6, -6); g.lineTo(18, -6); g.lineTo(18, 6); g.lineTo(6, 6); g.lineTo(6, 18); g.lineTo(-6, 18); g.lineTo(-6, 6); g.lineTo(-18, 6); g.lineTo(-18, -6); g.lineTo(-6, -6); },
  life: (g) => { g.moveTo(0, 18); g.bezierCurveTo(-26, -2, -12, -20, 0, -8); g.bezierCurveTo(12, -20, 26, -2, 0, 18); },
  bomb: (g) => { g.moveTo(-16, 14); g.lineTo(-16, -6); g.arc(0, -6, 16, Math.PI, 0); g.lineTo(16, 14); },
  score: (g) => {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * TAU / 5;
      const a2 = a + TAU / 10;
      const x = Math.cos(a) * 19, y = Math.sin(a) * 19;
      const x2 = Math.cos(a2) * 8, y2 = Math.sin(a2) * 8;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
      g.lineTo(x2, y2);
    }
  },
  laser: (g) => {
    g.moveTo(0, -20); g.lineTo(9, 0); g.lineTo(2, 0); g.lineTo(9, 20);
    g.lineTo(0, 2); g.lineTo(-9, 2); g.lineTo(-4, -8); g.lineTo(-9, -8);
  },
};

function glyphTex(type, size = 72) {
  const [c, g] = cvs(size, size);
  g.save(); g.translate(size / 2, size / 2);
  const k = size / 72;
  g.scale(k, k);
  g.lineWidth = 4; g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.fillStyle = 'rgba(255,255,255,1)';
  const fn = GLYPH_DRAW[type] || GLYPH_DRAW.score;
  g.beginPath(); fn(g);
  if (type === 'missile' || type === 'life' || type === 'score' || type === 'laser' || type === 'drone' || type === 'spread') g.fill();
  g.stroke();
  g.restore();
  return mkTex(c, { aniso: 4 });
}

/* ================================================================== *
 * 统一构建
 * ================================================================== */
export function createSprites() {
  const S = {
    /* 自机 */
    player: playerShipTex(256),

    /* 敌机 */
    scout: scoutTex(128),
    fighter: fighterTex(160),
    gunship: gunshipTex(224),
    bomber: bomberTex(256),
    turret: turretTex(160),
    elite: eliteTex(192),

    /* BOSS */
    bossVesper: bossVesperTex(512),
    bossCastor: bossCastorTex(512),
    bossNova: bossNovaTex(512),

    /* 弹幕 */
    bulletCore: hotTex(64),
    bulletGlow: glowTex(64, 2.0),
    beam: beamTex(),
    beamHalo: beamHaloTex(),
    warnLine: streakTex(24, 128),

    /* 特效 */
    glow: glowTex(128, 2.2),
    soft: glowTex(128, 1.3),
    spark: sparkTex(128),
    streak: streakTex(32, 128),
    smoke: smokeTex(128),
    ring: ringTex(256),
    flare: muzzleTex(128),
    shield: shieldTex(256),
    flame: flameTex(64, 160),

    /* 背景 */
    cloud0: cloudTex(512, 3),
    cloud1: cloudTex(512, 17),
    cloud2: cloudTex(512, 41),
    grid: gridTex(256, 34),
    rock: rockTex(160),

    /* 道具 */
    capsule: capsuleTex(96),
    glyphs: {},
  };
  for (const k of Object.keys(GLYPH_DRAW)) S.glyphs[k] = glyphTex(k, 72);
  return S;
}

/** 释放全部贴图 */
export function disposeSprites(S) {
  const walk = (o) => {
    for (const k in o) {
      const v = o[k];
      if (v && v.isTexture) v.dispose();
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(S);
}

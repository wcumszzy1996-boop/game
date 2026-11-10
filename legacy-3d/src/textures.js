/**
 * textures.js — 全程序化贴图生成（无外部美术资源）
 * 生成：辉光精灵 / 粒子 / 冲击波环 / 船体 PBR 三件套 / 星云环境贴图 / 背景
 */
import * as THREE from '../vendor/three/three.module.js';
import { TAU, mulberry32, clamp } from './util.js';

const cache = new Map();
function cached(key, fn) {
  if (cache.has(key)) return cache.get(key);
  const v = fn();
  cache.set(key, v);
  return v;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, { srgb = false, wrap = THREE.ClampToEdgeWrapping, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = wrap;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/**
 * 统一颜色表示。
 * 调色板里 nebulaA/B/C 写的是 CSS 字符串，其余（key / rim / backdrop …）写的是
 * 0xRRGGBB 数字。Canvas 的 addColorStop 只吃 CSS 字符串，所以数字必须先转成
 * '#rrggbb'，否则会得到 "16763368ff" 这种非法颜色并抛异常。
 */
export function css(color) {
  if (typeof color === 'number') {
    return '#' + ((color >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  }
  const s = String(color == null ? '#000000' : color).trim();
  return s[0] === '#' ? s : '#' + s;
}

/** 颜色 + 两位十六进制透明度，例如 cssA(0xffc9e8, '88') → '#ffc9e888' */
export function cssA(color, alphaHex) {
  return css(color) + alphaHex;
}

/* ================================================================== *
 * 1. 辉光 / 粒子精灵
 * ================================================================== */

/** 通用径向辉光：白热核心 → 色彩衰减 → 透明 */
export function glowSprite(color = '#ffffff', power = 2.6, size = 128) {
  return cached(`glow:${color}:${power}:${size}`, () => {
    const c = canvas(size, size);
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const col = new THREE.Color(color);
    const cr = col.r * 255, cg = col.g * 255, cb = col.b * 255;
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - half + 0.5) / half;
        const dy = (y - half + 0.5) / half;
        const d = Math.sqrt(dx * dx + dy * dy);
        let a = 1 - clamp(d, 0, 1);
        a = Math.pow(a, power);
        // 中心白热
        const core = Math.pow(clamp(1 - d * 2.6, 0, 1), 2.2);
        const i = (y * size + x) * 4;
        img.data[i] = clamp(cr + (255 - cr) * core, 0, 255);
        img.data[i + 1] = clamp(cg + (255 - cg) * core, 0, 255);
        img.data[i + 2] = clamp(cb + (255 - cb) * core, 0, 255);
        img.data[i + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return tex(c, { srgb: true, aniso: 1 });
  });
}

/** 细长条辉光（子弹拖尾 / 引擎尾焰） */
export function streakSprite(color = '#a8f0ff') {
  color = css(color);
  return cached(`streak:${color}`, () => {
    const w = 64, h = 128;
    const c = canvas(w, h);
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.35, color);
    grd.addColorStop(0.72, '#ffffff');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // 横向柔化
    const grd2 = g.createLinearGradient(0, 0, w, 0);
    grd2.addColorStop(0, 'rgba(0,0,0,1)');
    grd2.addColorStop(0.5, 'rgba(0,0,0,0)');
    grd2.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = grd2;
    g.fillRect(0, 0, w, h);
    return tex(c, { srgb: true, aniso: 1 });
  });
}

/** 冲击波环 */
export function ringSprite(color = '#ffe9b0', soft = 0.24) {
  color = css(color);
  return cached(`ring:${color}:${soft}`, () => {
    const size = 256, c = canvas(size, size), g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const col = new THREE.Color(color);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - half + 0.5) / half, dy = (y - half + 0.5) / half;
        const d = Math.sqrt(dx * dx + dy * dy);
        const e = Math.abs(d - 0.86);
        const a = clamp(1 - e / soft, 0, 1);
        const w = Math.pow(a, 1.7);
        const i = (y * size + x) * 4;
        img.data[i] = clamp(col.r * 255 * (0.6 + 0.9 * w), 0, 255);
        img.data[i + 1] = clamp(col.g * 255 * (0.6 + 0.9 * w), 0, 255);
        img.data[i + 2] = clamp(col.b * 255 * (0.6 + 0.9 * w), 0, 255);
        img.data[i + 3] = w * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return tex(c, { srgb: true, aniso: 1 });
  });
}

/** 蓬松星云/烟雾块 */
export function puffSprite(seed = 1, tint = '#ffffff', blobs = 22) {
  tint = css(tint);
  return cached(`puff:${seed}:${tint}:${blobs}`, () => {
    const size = 256, c = canvas(size, size), g = c.getContext('2d');
    const R = mulberry32(seed * 7919 + 13);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < blobs; i++) {
      const a = R() * TAU;
      const r = Math.pow(R(), 0.65) * size * 0.34;
      const x = size / 2 + Math.cos(a) * r;
      const y = size / 2 + Math.sin(a) * r;
      const rad = size * (0.07 + R() * 0.2);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      const alpha = 0.16 + R() * 0.2;
      grd.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rad, 0, TAU);
      g.fill();
    }
    // 圆形遮罩去掉硬边
    g.globalCompositeOperation = 'destination-in';
    const mask = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(0.62, 'rgba(0,0,0,0.85)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = mask;
    g.fillRect(0, 0, size, size);
    // 上色
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = tint;
    g.fillRect(0, 0, size, size);
    return tex(c, { srgb: true, aniso: 1 });
  });
}

/** 能量六边形网格（用于护盾 / BOSS 力场） */
export function hexFieldSprite(color = '#66e0ff') {
  color = css(color);
  return cached(`hex:${color}`, () => {
    const size = 256, c = canvas(size, size), g = c.getContext('2d');
    g.clearRect(0, 0, size, size);
    const r = 22;
    const hw = Math.sqrt(3) * r;
    g.strokeStyle = color;
    g.lineWidth = 2.2;
    g.globalAlpha = 0.95;
    for (let row = -1; row < size / (r * 1.5) + 2; row++) {
      for (let col = -1; col < size / hw + 2; col++) {
        const cx = col * hw + (row % 2 ? hw / 2 : 0);
        const cy = row * r * 1.5;
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + Math.PI / 6;
          const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath();
        g.stroke();
      }
    }
    return tex(c, { srgb: true, wrap: THREE.RepeatWrapping, aniso: 1 });
  });
}

/** 圆形软遮罩（用于体积光束截面） */
export function softDiscSprite(color = '#ffffff') {
  color = css(color);
  return cached(`disc:${color}`, () => {
    const size = 128, c = canvas(size, size), g = c.getContext('2d');
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, color);
    grd.addColorStop(0.45, color);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    return tex(c, { srgb: true, aniso: 1 });
  });
}

/* ================================================================== *
 * 2. 船体 PBR 贴图（法线 / 粗糙度 / 自发光）
 * ================================================================== */

function drawHullBase(g, S, R, tint) {
  // 底色
  g.fillStyle = tint.base;
  g.fillRect(0, 0, S, S);
  // 大块明暗变化
  for (let i = 0; i < 26; i++) {
    const x = R() * S, y = R() * S, w = S * (0.1 + R() * 0.45), h = S * (0.06 + R() * 0.3);
    g.fillStyle = `rgba(${R() > 0.5 ? '255,255,255' : '0,0,0'},${0.015 + R() * 0.035})`;
    g.fillRect(x, y, w, h);
  }
  // 面板线
  const line = (x1, y1, x2, y2, w) => {
    g.strokeStyle = 'rgba(0,0,0,0.62)';
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.09)';
    g.lineWidth = w * 0.55;
    g.beginPath(); g.moveTo(x1, y1 + w * 0.9); g.lineTo(x2, y2 + w * 0.9); g.stroke();
  };
  for (let i = 0; i < 30; i++) {
    const y = R() * S;
    line(0, y, S, y, 1.6 + R() * 1.6);
  }
  for (let i = 0; i < 16; i++) {
    const x = R() * S;
    line(x, 0, x, S, 1.4 + R() * 1.4);
  }
  // 铆钉 / 紧固件
  for (let i = 0; i < 320; i++) {
    const x = R() * S, y = R() * S, r = 1.1 + R() * 1.7;
    g.fillStyle = 'rgba(0,0,0,0.34)';
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, r * 0.55, 0, TAU); g.fill();
  }
  // 通风槽
  for (let i = 0; i < 14; i++) {
    const x = R() * S, y = R() * S;
    g.fillStyle = 'rgba(0,0,0,0.42)';
    for (let k = 0; k < 5; k++) g.fillRect(x, y + k * 5, 26 + R() * 22, 2.2);
  }
  // 磨损划痕
  g.globalAlpha = 0.16;
  for (let i = 0; i < 90; i++) {
    const x = R() * S, y = R() * S, len = 8 + R() * 70;
    g.strokeStyle = R() > 0.4 ? '#ffffff' : '#000000';
    g.lineWidth = 0.7 + R();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len * (R() - 0.5), y + len * (R() - 0.5));
    g.stroke();
  }
  g.globalAlpha = 1;
}

/**
 * 生成船体贴图组。
 * @param {string} key 缓存键
 * @param {object} opt {base, accent, stripe, size}
 * @returns {{map, normalMap, roughnessMap, emissiveMap}}
 */
export function hullTextures(key, opt = {}) {
  return cached(`hull:${key}`, () => {
    const S = opt.size || 512;
    const base = opt.base || '#3c4450';
    const accent = opt.accent || '#8fd4ff';
    const stripe = opt.stripe || '#ff8a3d';
    const R = mulberry32(key.length * 977 + 31);

    // -- 颜色贴图
    const cCol = canvas(S, S), gc = cCol.getContext('2d');
    drawHullBase(gc, S, R, { base });

    // -- 高度图（用于生成法线）
    const cH = canvas(S, S), gh = cH.getContext('2d');
    gh.fillStyle = '#808080';
    gh.fillRect(0, 0, S, S);
    const R2 = mulberry32(key.length * 977 + 31); // 同一随机序列保证对齐
    // 复刻同样的面板线到高度图
    gh.fillStyle = base; gh.fillRect(0, 0, S, S);
    for (let i = 0; i < 26; i++) {
      const x = R2() * S, y = R2() * S, w = S * (0.1 + R2() * 0.45), h = S * (0.06 + R2() * 0.3);
      R2() > 0.5 ? R2() : R2();
      gh.fillStyle = `rgba(${R2() > 0.5 ? '255,255,255' : '0,0,0'},${0.02 + R2() * 0.04})`;
      gh.fillRect(x, y, w, h);
    }
    for (let i = 0; i < 30; i++) {
      const y = R2() * S;
      R2();
      gh.strokeStyle = '#3a3a3a'; gh.lineWidth = 1.6 + R2() * 1.6;
      gh.beginPath(); gh.moveTo(0, y); gh.lineTo(S, y); gh.stroke();
    }
    for (let i = 0; i < 16; i++) {
      const x = R2() * S;
      R2();
      gh.strokeStyle = '#3a3a3a'; gh.lineWidth = 1.4 + R2() * 1.4;
      gh.beginPath(); gh.moveTo(x, 0); gh.lineTo(x, S); gh.stroke();
    }
    for (let i = 0; i < 320; i++) {
      const x = R2() * S, y = R2() * S, r = 1.1 + R2() * 1.7;
      R2();
      gh.fillStyle = '#e8e8e8';
      gh.beginPath(); gh.arc(x, y, r, 0, TAU); gh.fill();
    }
    for (let i = 0; i < 14; i++) {
      const x = R2() * S, y = R2() * S;
      gh.fillStyle = '#282828';
      for (let k = 0; k < 5; k++) { gh.fillRect(x, y + k * 5, 26 + R2() * 22, 2.6); R2(); }
      R2();
    }
    const hData = gh.getImageData(0, 0, S, S).data;

    // -- 由高度图求法线
    const cN = canvas(S, S), gn = cN.getContext('2d');
    const nImg = gn.createImageData(S, S);
    const strength = opt.normalStrength == null ? 2.6 : opt.normalStrength;
    const at = (x, y) => hData[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        let nx = -dx, ny = -dy, nz = 1;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= l; ny /= l; nz /= l;
        const i = (y * S + x) * 4;
        nImg.data[i] = (nx * 0.5 + 0.5) * 255;
        nImg.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        nImg.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        nImg.data[i + 3] = 255;
      }
    }
    gn.putImageData(nImg, 0, 0);

    // -- 粗糙度：面板线处更粗糙
    const cR = canvas(S, S), gr = cR.getContext('2d');
    const rImg = gr.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const h = hData[i * 4] / 255;
      const rough = clamp(0.62 - (h - 0.5) * 0.55, 0.08, 0.98);
      const v = rough * 255;
      rImg.data[i * 4] = v; rImg.data[i * 4 + 1] = v; rImg.data[i * 4 + 2] = v; rImg.data[i * 4 + 3] = 255;
    }
    gr.putImageData(rImg, 0, 0);

    // -- 自发光：机翼警示条 / 标识
    const cE = canvas(S, S), ge = cE.getContext('2d');
    ge.fillStyle = '#000000';
    ge.fillRect(0, 0, S, S);
    ge.globalAlpha = 1;
    // 斜条纹警示块
    ge.save();
    ge.translate(S * 0.08, S * 0.62);
    ge.fillStyle = stripe;
    for (let i = 0; i < 7; i++) {
      ge.beginPath();
      ge.moveTo(i * 18, 0); ge.lineTo(i * 18 + 10, 0); ge.lineTo(i * 18 + 10 - 26, 34); ge.lineTo(i * 18 - 26, 34);
      ge.closePath(); ge.fill();
    }
    ge.restore();
    // 机号
    ge.fillStyle = accent;
    ge.font = `bold ${Math.floor(S * 0.055)}px "Consolas", monospace`;
    ge.fillText('SF-71', S * 0.06, S * 0.2);
    ge.fillStyle = '#ffffff';
    ge.globalAlpha = 0.75;
    ge.font = `bold ${Math.floor(S * 0.026)}px "Consolas", monospace`;
    ge.fillText('★ 09', S * 0.06, S * 0.26);
    ge.globalAlpha = 1;
    // 细发光线
    ge.strokeStyle = accent;
    ge.lineWidth = 2;
    ge.beginPath(); ge.moveTo(0, S * 0.5); ge.lineTo(S, S * 0.5); ge.stroke();

    return {
      map: tex(cCol, { srgb: true, wrap: THREE.RepeatWrapping, aniso: 8 }),
      normalMap: tex(cN, { srgb: false, wrap: THREE.RepeatWrapping, aniso: 8 }),
      roughnessMap: tex(cR, { srgb: false, wrap: THREE.RepeatWrapping, aniso: 8 }),
      emissiveMap: tex(cE, { srgb: true, wrap: THREE.RepeatWrapping, aniso: 8 }),
    };
  });
}

/* ================================================================== *
 * 3. 星云环境贴图（PMREM 源） —— 让金属船体有高光反射
 * ================================================================== */
export function buildEnvironment(renderer, palette) {
  const W = 1024, H = 512;
  const c = canvas(W, H), g = c.getContext('2d');
  // 深空底色
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#05030c');
  bg.addColorStop(0.45, css(palette.nebulaA));
  bg.addColorStop(0.62, css(palette.nebulaC));
  bg.addColorStop(1, '#04020a');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const R = mulberry32(4242);
  // 星云团
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i++) {
    const x = R() * W, y = R() * H;
    const rad = 60 + R() * 260;
    const col = css([palette.nebulaA, palette.nebulaB, palette.nebulaC][(R() * 3) | 0]);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, col + 'cc');
    grd.addColorStop(0.5, col + '55');
    grd.addColorStop(1, col + '00');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
  }
  // 主光源（决定船体高光的方位）
  const sunX = W * 0.74, sunY = H * 0.26;
  const sun = g.createRadialGradient(sunX, sunY, 0, sunX, sunY, 260);
  sun.addColorStop(0, cssA(palette.key, 'ff'));
  sun.addColorStop(0.18, cssA(palette.key, '88'));
  sun.addColorStop(1, cssA(palette.key, '00'));
  g.fillStyle = sun;
  g.beginPath(); g.arc(sunX, sunY, 260, 0, TAU); g.fill();
  // 补光
  const fill = g.createRadialGradient(W * 0.2, H * 0.75, 0, W * 0.2, H * 0.75, 300);
  fill.addColorStop(0, cssA(palette.rim, '66'));
  fill.addColorStop(1, cssA(palette.rim, '00'));
  g.fillStyle = fill;
  g.beginPath(); g.arc(W * 0.2, H * 0.75, 300, 0, TAU); g.fill();
  // 星点
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 1400; i++) {
    const x = R() * W, y = R() * H, r = R() * 1.5 + 0.3;
    g.fillStyle = `rgba(255,255,255,${0.25 + R() * 0.75})`;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }

  const eq = tex(c, { srgb: true, wrap: THREE.RepeatWrapping, aniso: 1 });
  eq.mapping = THREE.EquirectangularReflectionMapping;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(eq);
  pmrem.dispose();
  eq.dispose();
  return rt.texture;
}

/* ================================================================== *
 * 4. 远景星云天幕（大尺寸、低分辨率即可）
 * ================================================================== */
export function backdropTexture(palette, seed = 7) {
  return cached(`backdrop:${palette.nebulaA}:${seed}`, () => {
    const W = 1024, H = 1024;
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = css(palette.backdrop);
    g.fillRect(0, 0, W, H);
    const R = mulberry32(seed * 1031 + 7);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 90; i++) {
      const x = R() * W, y = R() * H;
      const rad = 40 + R() * 340;
      const col = css([palette.nebulaA, palette.nebulaB, palette.nebulaC][(R() * 3) | 0]);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, col + '77');
      grd.addColorStop(0.45, col + '2e');
      grd.addColorStop(1, col + '00');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    }
    // 暗尘带
    g.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 26; i++) {
      const x = R() * W, y = R() * H, rad = 80 + R() * 300;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(0,0,0,0.85)');
      grd.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    // 远景星尘：必须画得「极小、极淡」。
    // 天幕是一个半径 520 的球，1024 宽的贴图绕球一周，
    // 而视口水平 FOV≈76°，即屏幕横向只覆盖约 21% 的贴图宽度，
    // 所以 1 个贴图像素 ≈ 6.6 个屏幕像素。
    // 早先半径 0.25~1.85 的点映射到屏幕上就是 3~24px 的大白斑，
    // 整屏像糊了一层雪。真正的星星交给 3D 星空层，这里只做尘埃。
    for (let i = 0; i < 1800; i++) {
      const x = R() * W, y = R() * H, r = R() * 0.42 + 0.10;
      g.fillStyle = `rgba(255,255,255,${0.10 + R() * 0.42})`;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    const t = tex(c, { srgb: true, wrap: THREE.RepeatWrapping, aniso: 1 });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

/* ================================================================== *
 * 5. HUD 用的道具图标
 * ================================================================== */
export function iconTexture(glyph, color, ring = '#ffffff') {
  color = css(color);
  ring = css(ring);
  return cached(`icon:${glyph}:${color}:${ring}`, () => {
    const S = 128, c = canvas(S, S), g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    // 外环
    g.strokeStyle = ring;
    g.globalAlpha = 0.9;
    g.lineWidth = 6;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.40, 0, TAU); g.stroke();
    // 内盘
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.4);
    grd.addColorStop(0, color);
    grd.addColorStop(0.55, color + '99');
    grd.addColorStop(1, color + '22');
    g.globalAlpha = 1;
    g.fillStyle = grd;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.37, 0, TAU); g.fill();
    // 字符
    g.fillStyle = '#0a0a12';
    g.font = `bold ${Math.floor(S * 0.46)}px "Arial Black", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(glyph, S / 2, S / 2 + S * 0.02);
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.55;
    g.font = `bold ${Math.floor(S * 0.46)}px "Arial Black", Arial, sans-serif`;
    g.fillText(glyph, S / 2, S / 2 - S * 0.01);
    return tex(c, { srgb: true, aniso: 4 });
  });
}

/** 释放所有缓存（重开一局切换主题时用） */
export function clearTextureCache() {
  for (const t of cache.values()) if (t && t.dispose) t.dispose();
  cache.clear();
}

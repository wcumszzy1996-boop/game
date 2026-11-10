/**
 * postfx.js — 自研后处理管线（不依赖 three/examples）
 *
 * 流程：
 *   scene → HDR(RGBA16F) RT
 *        → 亮部提取 (soft-knee threshold)
 *        → 5 级降采样 + 分离式高斯模糊
 *        → 加性上采样合成
 *        → 最终合成：色散 / Bloom 叠加 / 曝光 / ACES / 暗角 / 颗粒 / 扫描线 / sRGB
 *
 * 这样做的原因：可控的光晕半径、稳定的性能、以及把"屏幕震动/旋转"放在
 * 后期里做，使 Bloom 与画面始终同步（避免震动时背景露边）。
 */
import * as THREE from '../vendor/three/three.module.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uKnee;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
  gl_FragColor = vec4(c * contrib * uIntensity, 1.0);
}
`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tDiffuse, vUv + vec2(-uTexel.x, -uTexel.y)).rgb;
  s += texture2D(tDiffuse, vUv + vec2( uTexel.x, -uTexel.y)).rgb;
  s += texture2D(tDiffuse, vUv + vec2(-uTexel.x,  uTexel.y)).rgb;
  s += texture2D(tDiffuse, vUv + vec2( uTexel.x,  uTexel.y)).rgb;
  gl_FragColor = vec4(s * 0.25, 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uDirection;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
  s += texture2D(tDiffuse, vUv + uDirection * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tDiffuse, vUv - uDirection * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tDiffuse, vUv + uDirection * 3.2307692308).rgb * 0.0702702703;
  s += texture2D(tDiffuse, vUv - uDirection * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}
`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec2 o = uTexel * uRadius;
  vec3 s = texture2D(tDiffuse, vUv).rgb * 4.0;
  s += texture2D(tDiffuse, vUv + vec2(-o.x, 0.0)).rgb * 2.0;
  s += texture2D(tDiffuse, vUv + vec2( o.x, 0.0)).rgb * 2.0;
  s += texture2D(tDiffuse, vUv + vec2(0.0, -o.y)).rgb * 2.0;
  s += texture2D(tDiffuse, vUv + vec2(0.0,  o.y)).rgb * 2.0;
  s += texture2D(tDiffuse, vUv + vec2(-o.x, -o.y)).rgb;
  s += texture2D(tDiffuse, vUv + vec2( o.x, -o.y)).rgb;
  s += texture2D(tDiffuse, vUv + vec2(-o.x,  o.y)).rgb;
  s += texture2D(tDiffuse, vUv + vec2( o.x,  o.y)).rgb;
  gl_FragColor = vec4(s / 16.0 * uWeight, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uAberration;
uniform float uVignette;
uniform float uGrain;
uniform float uScanline;
uniform float uTime;
uniform float uFlash;
uniform float uDamage;
uniform float uWarp;
uniform vec2  uShake;
uniform float uShakeRot;
uniform vec3  uTint;
varying vec2 vUv;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666666)) - 0.055, step(vec3(0.0031308), c));
}
float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

void main() {
  // ---- 屏幕震动 / 旋转（在 uv 空间完成，Bloom 同步跟随）----
  vec2 uv = vUv - 0.5;
  float cs = cos(uShakeRot), sn = sin(uShakeRot);
  uv = mat2(cs, -sn, sn, cs) * uv;
  uv += 0.5 + uShake;

  // ---- 超空间扭曲 ----
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  uv += d * uWarp * (0.35 + r2 * 2.2);

  // ---- 色散（径向）----
  float ab = uAberration * (0.45 + r2 * 3.4);
  vec3 col;
  col.r = texture2D(tScene, uv + d * ab).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - d * ab).b;

  // ---- Bloom 叠加 ----
  col += texture2D(tBloom, uv).rgb * uBloom;

  // ---- 色调 / 曝光 ----
  col *= uTint;
  col *= uExposure;

  // ---- 受击闪白 ----
  col += uFlash;

  // ---- 低血量红边 ----
  float edge = smoothstep(0.28, 0.98, length(vec2(d.x * 1.25, d.y)));
  col = mix(col, vec3(0.75, 0.03, 0.06), edge * uDamage);

  // ---- ACES 色调映射 ----
  col = aces(col);

  // ---- 暗角 ----
  float vig = 1.0 - uVignette * pow(clamp(length(vec2(d.x * 1.12, d.y)) * 1.42, 0.0, 1.0), 2.1);
  col *= vig;

  // ---- 胶片颗粒 ----
  float g = hash(vUv * 1024.0 + uTime * 91.7) - 0.5;
  col += g * uGrain;

  // ---- 扫描线（极轻微，模拟 CRT）----
  col *= 1.0 - uScanline * 0.5 * (0.5 + 0.5 * sin(vUv.y * 1400.0));

  // ---- sRGB 输出 ----
  gl_FragColor = vec4(linearToSRGB(max(col, vec3(0.0))), 1.0);
}
`;

class FSQuad {
  constructor(material) {
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  material(m) {
    this.mesh.material = m;
  }
  render(renderer, target) {
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.geometry.dispose();
  }
}

function makeRT(w, h, { depth = false, type = THREE.HalfFloatType, samples = 0 } = {}) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: depth,
    stencilBuffer: false,
    samples,
    generateMipmaps: false,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

export class PostFX {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} [opts]
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    const isGL2 = renderer.capabilities.isWebGL2;
    const canFloat = isGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    this.hdrType = canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.isGL2 = isGL2;

    this.levels = opts.levels || 5;
    this.bloomScale = opts.bloomScale || 0.5;
    this.msaa = isGL2 ? (opts.samples ?? 4) : 0;

    // 参数（可运行时调整）
    // 注意：亮部提取作用在「线性 HDR」空间，阈值必须 > 1.0，
    // 否则连船体中调、星云、雾都会被抽出来做 Bloom，整屏发灰发白。
    this.params = {
      threshold: 1.30,
      knee: 0.32,
      brightIntensity: 1.0,
      bloomStrength: 0.50,
      exposure: 1.02,
      aberration: 0.0016,
      vignette: 0.50,
      grain: 0.016,
      scanline: 0.030,
      warp: 0.0,
    };
    this.flash = 0;
    this.damage = 0;
    this.shake = new THREE.Vector2();
    this.shakeRot = 0;

    const mkMat = (frag, uniforms) =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: frag,
        uniforms,
        depthTest: false,
        depthWrite: false,
        transparent: false,
      });

    this.mBright = mkMat(BRIGHT_FRAG, {
      tDiffuse: { value: null },
      uThreshold: { value: this.params.threshold },
      uKnee: { value: this.params.knee },
      uIntensity: { value: this.params.brightIntensity },
    });
    this.mDown = mkMat(DOWN_FRAG, { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mBlur = mkMat(BLUR_FRAG, { tDiffuse: { value: null }, uDirection: { value: new THREE.Vector2() } });
    this.mUp = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: UP_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: 1.0 },
        uWeight: { value: 0.55 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    this.mComposite = mkMat(COMPOSITE_FRAG, {
      tScene: { value: null },
      tBloom: { value: null },
      uBloom: { value: this.params.bloomStrength },
      uExposure: { value: this.params.exposure },
      uAberration: { value: this.params.aberration },
      uVignette: { value: this.params.vignette },
      uGrain: { value: this.params.grain },
      uScanline: { value: this.params.scanline },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uDamage: { value: 0 },
      uWarp: { value: 0 },
      uShake: { value: new THREE.Vector2() },
      uShakeRot: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
    });

    this.quad = new FSQuad(this.mComposite);
    this.rtScene = null;
    this.mips = [];
    this.setSize(opts.width || 1, opts.height || 1);
  }

  setSize(width, height) {
    const r = this.renderer;
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));

    if (this.rtScene) this.rtScene.dispose();
    this.rtScene = makeRT(w, h, { depth: true, type: this.hdrType, samples: this.msaa });

    for (const m of this.mips) {
      m.a.dispose();
      m.b.dispose();
    }
    this.mips = [];
    let mw = Math.max(2, Math.floor(w * this.bloomScale));
    let mh = Math.max(2, Math.floor(h * this.bloomScale));
    for (let i = 0; i < this.levels; i++) {
      this.mips.push({
        w: mw,
        h: mh,
        a: makeRT(mw, mh, { type: this.hdrType }),
        b: makeRT(mw, mh, { type: this.hdrType }),
      });
      mw = Math.max(2, mw >> 1);
      mh = Math.max(2, mh >> 1);
    }
    this.width = w;
    this.height = h;
    r.setSize(w, h, false);
  }

  setQuality(q) {
    const samples = this.isGL2 ? (q.samples ?? 4) : 0;
    if (samples !== this.msaa) {
      this.msaa = samples;
      this.setSize(this.width, this.height);
    }
    this.bloomScale = q.bloomScale ?? this.bloomScale;
  }

  /** 立即把场景渲染到 HDR 缓冲（不合成） */
  renderScene(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);
  }

  /** 执行完整管线并输出到屏幕/目标 */
  present(target = null) {
    const r = this.renderer;
    const p = this.params;
    r.autoClear = true;

    // 1) 亮部提取
    this.mBright.uniforms.tDiffuse.value = this.rtScene.texture;
    this.mBright.uniforms.uThreshold.value = p.threshold;
    this.mBright.uniforms.uIntensity.value = p.brightIntensity;
    this.quad.material(this.mBright);
    this.quad.render(r, this.mips[0].a);

    // 2) 降采样链
    this.quad.material(this.mDown);
    for (let i = 0; i < this.levels - 1; i++) {
      const src = this.mips[i], dst = this.mips[i + 1];
      this.mDown.uniforms.tDiffuse.value = src.a.texture;
      this.mDown.uniforms.uTexel.value.set(1 / src.w, 1 / src.h);
      this.quad.render(r, dst.a);
    }

    // 3) 每级分离式高斯模糊
    this.quad.material(this.mBlur);
    for (let i = 0; i < this.levels; i++) {
      const m = this.mips[i];
      // 水平
      this.mBlur.uniforms.tDiffuse.value = m.a.texture;
      this.mBlur.uniforms.uDirection.value.set(1 / m.w, 0);
      this.quad.render(r, m.b);
      // 垂直
      this.mBlur.uniforms.tDiffuse.value = m.b.texture;
      this.mBlur.uniforms.uDirection.value.set(0, 1 / m.h);
      this.quad.render(r, m.a);
    }

    // 4) 加性上采样合成（小 → 大）
    r.autoClear = false;
    this.quad.material(this.mUp);
    for (let i = this.levels - 1; i > 0; i--) {
      const src = this.mips[i], dst = this.mips[i - 1];
      this.mUp.uniforms.tDiffuse.value = src.a.texture;
      this.mUp.uniforms.uTexel.value.set(1 / src.w, 1 / src.h);
      this.mUp.uniforms.uRadius.value = 1.0;
      // 不清理目标，直接叠加
      r.setRenderTarget(dst.a);
      r.render(this.quad.scene, this.quad.camera);
    }
    r.autoClear = true;

    // 5) 最终合成到屏幕
    const u = this.mComposite.uniforms;
    u.tScene.value = this.rtScene.texture;
    u.tBloom.value = this.mips[0].a.texture;
    u.uBloom.value = p.bloomStrength;
    u.uExposure.value = p.exposure;
    u.uAberration.value = p.aberration;
    u.uVignette.value = p.vignette;
    u.uGrain.value = p.grain;
    u.uScanline.value = p.scanline;
    u.uWarp.value = p.warp;
    u.uFlash.value = this.flash;
    u.uDamage.value = this.damage;
    u.uShake.value.copy(this.shake);
    u.uShakeRot.value = this.shakeRot;
    this.quad.material(this.mComposite);
    this.quad.render(r, target);
  }

  /** 便捷入口：渲染场景 + 后处理 */
  render(scene, camera, dt = 0) {
    this.mComposite.uniforms.uTime.value += dt;
    this.renderScene(scene, camera);
    this.present();
  }

  dispose() {
    this.rtScene?.dispose();
    for (const m of this.mips) {
      m.a.dispose();
      m.b.dispose();
    }
    this.mips = [];
    for (const k of ['mBright', 'mDown', 'mBlur', 'mUp', 'mComposite']) this[k]?.dispose();
    this.quad.dispose();
  }
}

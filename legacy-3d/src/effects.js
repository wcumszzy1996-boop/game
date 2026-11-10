/**
 * effects.js — 特效系统
 *  · 粒子层（点精灵 + 自定义 shader，紧凑 SoA 存储，零 GC）
 *  · 冲击波环 / 碎片 / 爆炸补光 / BOSS 激光束
 */
import * as THREE from '../vendor/three/three.module.js';
import { glowSprite, puffSprite, ringSprite, streakSprite } from './textures.js';
import { rand, randSign, TAU, clamp, easeOutCubic, ActiveList } from './util.js';

/* ================================================================== *
 * 粒子层
 * ================================================================== */
const P_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uSizeScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uSizeScale / max(0.05, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;
const P_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  if (t.a < 0.004) discard;
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
}
`;

class ParticleLayer {
  constructor(scene, opt) {
    this.cap = opt.max;
    this.count = 0;
    const F = Float32Array;
    this.px = new F(this.cap); this.py = new F(this.cap); this.pz = new F(this.cap);
    this.vx = new F(this.cap); this.vy = new F(this.cap); this.vz = new F(this.cap);
    this.life = new F(this.cap); this.maxLife = new F(this.cap);
    this.s0 = new F(this.cap); this.s1 = new F(this.cap);
    this.drag = new F(this.cap); this.grav = new F(this.cap);
    this.r0 = new F(this.cap); this.g0 = new F(this.cap); this.b0 = new F(this.cap);
    this.r1 = new F(this.cap); this.g1 = new F(this.cap); this.b1 = new F(this.cap);
    this.a0 = new F(this.cap); this.a1 = new F(this.cap);
    this.shrink = new Uint8Array(this.cap);

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new F(this.cap * 3), 3);
    this.aSize = new THREE.BufferAttribute(new F(this.cap), 1);
    this.aAlpha = new THREE.BufferAttribute(new F(this.cap), 1);
    this.aColor = new THREE.BufferAttribute(new F(this.cap * 3), 3);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setAttribute('aColor', this.aColor);
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: opt.map },
        uSizeScale: { value: 800 },
      },
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: opt.blending,
      toneMapped: false,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = opt.renderOrder || 3;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(x, y, z, vx, vy, vz, o) {
    let i;
    if (this.count < this.cap) i = this.count++;
    else i = (Math.random() * this.cap) | 0; // 满载时随机替换，视觉上无感
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.s0[i] = o.size0;
    this.s1[i] = o.size1 == null ? o.size0 : o.size1;
    this.drag[i] = o.drag == null ? 1.6 : o.drag;
    this.grav[i] = o.gravity || 0;
    const c0 = o.color0 || o.color;
    const c1 = o.color1 || c0;
    this.r0[i] = c0.r; this.g0[i] = c0.g; this.b0[i] = c0.b;
    this.r1[i] = c1.r; this.g1[i] = c1.g; this.b1[i] = c1.b;
    this.a0[i] = o.alpha0 == null ? 1 : o.alpha0;
    this.a1[i] = o.alpha1 == null ? 0 : o.alpha1;
    this.shrink[i] = o.shrink ? 1 : 0;
    return i;
  }

  update(dt) {
    const n = this.count;
    if (!n) return;
    const p = this.px, q = this.py, r = this.pz;
    const vx = this.vx, vy = this.vy, vz = this.vz;
    const lf = this.life, ml = this.maxLife;
    const s0 = this.s0, s1 = this.s1, dr = this.drag, gr = this.grav;
    const r0 = this.r0, g0 = this.g0, b0 = this.b0;
    const r1 = this.r1, g1 = this.g1, b1 = this.b1;
    const a0 = this.a0, a1 = this.a1;
    const ps = this.aPos.array, sz = this.aSize.array, al = this.aAlpha.array, co = this.aColor.array;

    let i = 0;
    while (i < this.count) {
      lf[i] -= dt;
      if (lf[i] <= 0) {
        // 与末尾交换，保持紧凑
        const j = --this.count;
        if (i !== j) {
          p[i] = p[j]; q[i] = q[j]; r[i] = r[j];
          vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
          lf[i] = lf[j]; ml[i] = ml[j];
          s0[i] = s0[j]; s1[i] = s1[j]; dr[i] = dr[j]; gr[i] = gr[j];
          r0[i] = r0[j]; g0[i] = g0[j]; b0[i] = b0[j];
          r1[i] = r1[j]; g1[i] = g1[j]; b1[i] = b1[j];
          a0[i] = a0[j]; a1[i] = a1[j];
          this.shrink[i] = this.shrink[j];
        }
        continue;
      }
      const d = Math.exp(-dr[i] * dt);
      vx[i] *= d; vy[i] *= d; vz[i] *= d;
      vy[i] += gr[i] * dt;
      p[i] += vx[i] * dt; q[i] += vy[i] * dt; r[i] += vz[i] * dt;

      const t = 1 - lf[i] / ml[i];
      const size = s0[i] + (s1[i] - s0[i]) * t;
      const alpha = a0[i] + (a1[i] - a0[i]) * t;
      const k = i * 3;
      ps[k] = p[i]; ps[k + 1] = q[i]; ps[k + 2] = r[i];
      sz[i] = size;
      al[i] = alpha;
      co[k] = r0[i] + (r1[i] - r0[i]) * t;
      co[k + 1] = g0[i] + (g1[i] - g0[i]) * t;
      co[k + 2] = b0[i] + (b1[i] - b0[i]) * t;
      i++;
    }
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.geo.setDrawRange(0, this.count);
  }
}

/* ================================================================== *
 * 冲击波 / 碎片
 * ================================================================== */
class Shockwave {
  constructor(scene, color, soft) {
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: ringSprite(color, soft),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.alive = false;
    this.t = 0;
    this.theme = color;
  }
  fire(x, y, z, r0, r1, life, opacity, flat) {
    this.alive = true;
    this.t = 0;
    this.life = life;
    this.r0 = r0;
    this.r1 = r1;
    this.op0 = opacity;
    this.mesh.position.set(x, y, z);
    this.mesh.quaternion.copy(flat || new THREE.Quaternion());
    this.mesh.visible = true;
  }
  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    const u = this.t / this.life;
    if (u >= 1) {
      this.alive = false;
      this.mesh.visible = false;
      return;
    }
    const r = this.r0 + (this.r1 - this.r0) * easeOutCubic(u);
    this.mesh.scale.set(r, r, r);
    this.mesh.material.opacity = this.op0 * (1 - u) * (1 - u);
  }
}

class Debris {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.9, roughness: 0.5, emissive: 0x1a0a00, emissiveIntensity: 1.2 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.alive = false;
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();
  }
  fire(x, y, z, vx, vy, vz, s, color) {
    this.alive = true;
    this.t = 0;
    this.life = 1.1 + Math.random() * 0.9;
    this.mesh.visible = true;
    this.mesh.position.set(x, y, z);
    this.mesh.scale.setScalar(s);
    this.vel.set(vx, vy, vz);
    this.spin.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
    if (color) this.mesh.material.emissive.set(color);
  }
  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    if (this.t > this.life) {
      this.alive = false;
      this.mesh.visible = false;
      return;
    }
    this.vel.multiplyScalar(Math.exp(-1.2 * dt));
    this.vel.y -= 12 * dt;
    this.mesh.position.addScaledVector(this.vel, dt);
    this.mesh.rotation.x += this.spin.x * dt;
    this.mesh.rotation.y += this.spin.y * dt;
    this.mesh.rotation.z += this.spin.z * dt;
    const u = this.t / this.life;
    this.mesh.material.emissiveIntensity = 1.2 * (1 - u) + 0.1;
  }
}

/* ================================================================== *
 * BOSS 激光束
 * ================================================================== */
export class Beam {
  constructor(scene, color = 0xff4466) {
    const g = new THREE.Group();
    const len = 60;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uFlicker: { value: 1 },
      },
      vertexShader: `
        varying float vAcross;
        varying float vAlong;
        void main(){
          // 圆柱局部坐标：xy 为单位圆（径向），z 为长度
          vAcross = clamp(length(position.xy), 0.0, 1.0);
          vAlong = position.z + 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime; uniform vec3 uColor; uniform float uFlicker;
        varying float vAcross;
        varying float vAlong;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        void main(){
          float a = vAcross;
          float core = pow(1.0 - a, 4.0);
          float halo = pow(1.0 - a, 1.1) * 0.55;
          float flick = 0.84 + 0.16 * hash(vec2(floor(uTime * 46.0), floor(vAlong * 90.0)));
          float head = smoothstep(0.0, 0.05, vAlong) * smoothstep(1.0, 0.9, vAlong);
          vec3 col = mix(uColor * 1.35, vec3(1.0), core * 0.9);
          float alpha = clamp(core * 0.85 + halo, 0.0, 1.0) * uFlicker * head * flick;
          gl_FragColor = vec4(col * (1.2 + core * 3.4) * uFlicker * flick, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    // 圆柱沿 Z 轴，半径 1、长度 1，靠 scale 控制
    const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true).rotateX(Math.PI / 2);
    const tube = new THREE.Mesh(tubeGeo, mat);
    tube.frustumCulled = false;
    g.add(tube);
    this.group = g;
    this.tube = tube;
    this.mat = mat;
    this.geometry = tubeGeo;
    this.len = len;
    this.charge = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 20, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    g.add(this.charge);
    this.glowSpriteMesh = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowSprite('#' + new THREE.Color(color).getHexString(), 2.6, 128),
        color: new THREE.Color(color).multiplyScalar(2.4),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    g.add(this.glowSpriteMesh);
    this.glowSpriteMesh.scale.setScalar(7);
    scene.add(g);
    this.group.visible = false;
    this.active = false;
    this.phase = 'idle';
    this.t = 0;
  }

  /** 开火：从 origin 沿 dir 发射，持续时间 dur，半径 w */
  fire(origin, dir, dur, w, chargeTime = 0.9) {
    this.active = true;
    this.group.visible = true;
    this.origin = origin.clone();
    this.dir = dir.clone().normalize();
    this.phase = chargeTime > 0 ? 'charge' : 'fire';
    this.chargeTime = chargeTime;
    this.dur = dur;
    this.width = w;
    this.t = 0;
    this.group.position.copy(this.origin);
    this._orient();
  }

  _orient() {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir);
    this.group.quaternion.copy(q);
  }

  stop() {
    this.active = false;
    this.group.visible = false;
    this.charge.material.opacity = 0;
    this.glowSpriteMesh.material.opacity = 0;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    this.mat.uniforms.uTime.value += dt;
    this._orient();

    if (this.phase === 'charge') {
      const u = clamp(this.t / this.chargeTime, 0, 1);
      this.charge.material.opacity = u * 0.9;
      this.charge.scale.setScalar(0.4 + u * 1.9);
      this.glowSpriteMesh.material.opacity = u * 0.9;
      this._size(this.width * (0.12 + u * 0.9), 0.001);
      if (u >= 1) {
        this.phase = 'fire';
        this.t = 0;
      }
      return;
    }

    if (this.phase === 'fire') {
      const grow = clamp(this.t / 0.12, 0, 1);
      this._size(this.width * (0.45 + 0.55 * grow), this.len);
      this.mat.uniforms.uFlicker.value = 1;
      this.charge.material.opacity = Math.max(0, 0.9 - this.t * 3);
      this.glowSpriteMesh.material.opacity = Math.max(0, 0.9 - this.t * 2.2);
      if (this.t > this.dur) {
        this.phase = 'fade';
        this.t = 0;
      }
      return;
    }

    // fade
    const u = clamp(this.t / 0.28, 0, 1);
    this.mat.uniforms.uFlicker.value = 1 - u;
    if (u >= 1) this.stop();
  }

  _size(radius, length) {
    this.tube.scale.set(radius, radius, Math.max(0.001, length));
    this.tube.position.set(0, 0, length / 2);
  }
}

/* ================================================================== *
 * Effects 总控
 * ================================================================== */
export class Effects {
  constructor(scene, quality) {
    this.scene = scene;
    this.maxParticles = quality.maxParticles;

    // 加性辉光粒子
    this.glowLayer = new ParticleLayer(scene, {
      max: Math.floor(this.maxParticles * 0.72),
      map: glowSprite('#ffffff', 2.3, 128),
      blending: THREE.AdditiveBlending,
      renderOrder: 3,
    });
    // 拖尾/拉丝
    this.streakLayer = new ParticleLayer(scene, {
      max: Math.floor(this.maxParticles * 0.16),
      map: streakSprite('#ffffff'),
      blending: THREE.AdditiveBlending,
      renderOrder: 3,
    });
    // 烟雾（普通混合）
    this.smokeLayer = new ParticleLayer(scene, {
      max: Math.floor(this.maxParticles * 0.26),
      map: puffSprite(11, '#ffffff', 26),
      blending: THREE.NormalBlending,
      renderOrder: 2,
    });

    this.waves = new ActiveList();
    this.wavePool = [];
    this.debris = new ActiveList();
    this.debrisPool = [];

    this.beams = [];

    // 爆炸补光（固定 3 盏，常驻场景以避免着色器重编译）
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 40, 2);
      l.intensity = 0;
      scene.add(l);
      this.lights.push({ light: l, t: 0, dur: 1, peak: 0 });
    }
    this.lightCursor = 0;

    this._tmpQ = new THREE.Quaternion();
  }

  setSizeScale(h, fov) {
    const s = h / (2 * Math.tan((fov * Math.PI) / 180 / 2));
    this.glowLayer.mat.uniforms.uSizeScale.value = s;
    this.streakLayer.mat.uniforms.uSizeScale.value = s;
    this.smokeLayer.mat.uniforms.uSizeScale.value = s;
  }

  /* ---------------- 粒子 ---------------- */

  hitSpark(x, y, z, color = 0xffd08a, scale = 1, count = 6) {
    const c0 = new THREE.Color(0xffffff);
    const c1 = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const sp = rand(6, 26) * scale;
      this.glowLayer.spawn(
        x, y, z,
        Math.cos(a) * sp, Math.sin(a) * sp, rand(-6, 10),
        {
          life: rand(0.12, 0.28),
          size0: rand(0.18, 0.4) * scale,
          size1: 0.02,
          drag: 5,
          color0: c0,
          color1: c1,
        }
      );
    }
  }

  muzzle(x, y, z, color = 0x9fe8ff, scale = 1) {
    const c = new THREE.Color(color);
    const w = new THREE.Color(0xffffff);
    for (let i = 0; i < 3; i++) {
      this.glowLayer.spawn(x, y, z, rand(-4, 4), rand(-4, 4), rand(-6, 6), {
        life: rand(0.05, 0.12),
        size0: rand(0.26, 0.48) * scale,
        size1: 0.03,
        drag: 8,
        color0: w,
        color1: c,
      });
    }
  }

  engineTrail(x, y, z, vx, vy, vz, color, size, life = 0.3) {
    this.glowLayer.spawn(x, y, z, vx + rand(-2, 2), vy + rand(-2, 2), vz + rand(-2, 2), {
      life,
      size0: size,
      size1: size * 0.15,
      drag: 4.2,
      color0: new THREE.Color(0xffffff),
      color1: new THREE.Color(color),
      alpha1: 0,
    });
  }

  /**
   * 爆炸。power 0.3(小) ~ 3(超大)
   */
  explosion(x, y, z, power = 1, color = 0xffb050, opt = {}) {
    const c1 = new THREE.Color(color);
    const cWhite = new THREE.Color(0xffffff);
    const cDark = new THREE.Color(0x662200);
    const n = Math.floor(16 + power * 26);
    const radius = 0.5 * power;

    // 白热核心
    for (let i = 0; i < Math.floor(4 + power * 5); i++) {
      this.glowLayer.spawn(x + rand(-radius, radius), y + rand(-radius, radius), z + rand(-radius, radius), rand(-8, 8), rand(-8, 8), rand(-8, 8), {
        life: rand(0.1, 0.26),
        size0: rand(0.55, 1.15) * power,
        size1: 0.16,
        drag: 4.5,
        color0: cWhite,
        color1: c1,
      });
    }
    // 火花
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const e = rand(-0.7, 0.7);
      const sp = rand(10, 40) * power;
      this.glowLayer.spawn(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, {
        life: rand(0.28, 0.85),
        size0: rand(0.22, 0.7) * power,
        size1: 0.02,
        drag: 1.5,
        gravity: -3,
        color0: cWhite,
        color1: c1,
      });
    }
    // 烟雾
    for (let i = 0; i < Math.floor(n * 0.5); i++) {
      const a = Math.random() * TAU;
      const sp = rand(2, 11) * power;
      this.smokeLayer.spawn(x, y, z, Math.cos(a) * sp, Math.sin(a) * sp + rand(1, 5), rand(-4, 4), {
        life: rand(0.5, 1.5),
        size0: rand(0.6, 1.4) * power,
        size1: rand(2.4, 4.6) * power,
        drag: 1.1,
        gravity: 1.2,
        color0: cDark,
        color1: new THREE.Color(0x1a1a22),
        alpha0: 0.55 * (opt.smokeOpacity ?? 1),
        alpha1: 0,
      });
    }
    // 冲击波
    if (power >= 0.8) {
      this.shockwave(x, y, z, 0.4 * power, 6.5 * power, 0.42 + power * 0.1, clamp(0.9 - power * 0.08, 0.3, 1), color);
    }
    // 碎片
    if (power >= 0.9 && !opt.noDebris) {
      const dn = Math.min(14, Math.floor(3 + power * 3));
      for (let i = 0; i < dn; i++) {
        const d = this._debris();
        const a = Math.random() * TAU;
        const sp = rand(6, 24) * power;
        d.fire(x, y, z, Math.cos(a) * sp, rand(-4, 16), Math.sin(a) * sp, rand(0.12, 0.4) * power, color);
      }
    }
    // 补光
    if (power >= 0.85) this._flash(x, y, z, power, color);
  }

  shockwave(x, y, z, r0, r1, life, opacity, color, flatQuat) {
    let w = this.wavePool.find((q) => !q.alive);
    if (!w) {
      w = new Shockwave(this.scene, '#' + new THREE.Color(color || 0xffe0a0).getHexString(), 0.26);
      this.wavePool.push(w);
    } else if (color) {
      // 颜色不同则重建贴图
      const hex = '#' + new THREE.Color(color).getHexString();
      if (w.theme !== hex) {
        w.mesh.material.map = ringSprite(hex, 0.26);
        w.mesh.material.needsUpdate = true;
        w.theme = hex;
      }
    }
    w.fire(x, y, z, r0, r1, life, opacity == null ? 0.9 : opacity, flatQuat);
    this.waves.add(w);
    return w;
  }

  _debris() {
    let d = this.debrisPool.find((q) => !q.alive);
    if (!d) {
      d = new Debris(this.scene);
      this.debrisPool.push(d);
    }
    this.debris.add(d);
    return d;
  }

  _flash(x, y, z, power, color) {
    const slot = this.lights[this.lightCursor++ % this.lights.length];
    slot.light.position.set(x, y, z);
    slot.light.color.set(color);
    slot.peak = clamp(8 * power, 6, 60);
    slot.light.distance = 22 + power * 14;
    slot.dur = 0.16 + power * 0.12;
    slot.t = slot.dur;
  }

  createBeam(color) {
    const b = new Beam(this.scene, color);
    this.beams.push(b);
    return b;
  }

  /** 超空间跃迁粒子（关卡切换用） */
  warpStreaks(camPos, dir, count = 90) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const r = rand(2, 24);
      const x = camPos.x + Math.cos(a) * r;
      const y = camPos.y + Math.sin(a) * r;
      const z = camPos.z + rand(-40, -8);
      this.streakLayer.spawn(x, y, z, 0, 0, 120, {
        life: rand(0.24, 0.5),
        size0: rand(0.3, 0.9),
        size1: rand(1.2, 3.6),
        drag: 0.2,
        color0: new THREE.Color(0xffffff),
        color1: new THREE.Color(0x66ccff),
        alpha0: 0.9,
        alpha1: 0,
      });
    }
  }

  update(dt) {
    this.glowLayer.update(dt);
    this.streakLayer.update(dt);
    this.smokeLayer.update(dt);
    this.waves.sweep(null);
    for (const w of this.wavePool) w.update(dt);
    this.debris.sweep(null);
    for (const d of this.debrisPool) d.update(dt);
    for (const b of this.beams) b.update(dt);
    for (const s of this.lights) {
      if (s.t > 0) {
        s.t -= dt;
        const u = clamp(s.t / s.dur, 0, 1);
        s.light.intensity = s.peak * u * u;
        if (s.t <= 0) s.light.intensity = 0;
      }
    }
  }

  clear() {
    for (const l of [this.glowLayer, this.streakLayer, this.smokeLayer]) l.count = 0;
    for (const w of this.wavePool) {
      w.alive = false;
      w.mesh.visible = false;
    }
    for (const d of this.debrisPool) {
      d.alive = false;
      d.mesh.visible = false;
    }
    for (const b of this.beams) b.stop();
    for (const s of this.lights) {
      s.t = 0;
      s.light.intensity = 0;
    }
  }
}

/**
 * game.js — 主控：渲染 / 状态机 / 碰撞 / 关卡流转
 */
import * as THREE from '../vendor/three/three.module.js';
import { DIFFICULTIES, LEVELS, WORLD, SCORE, QUALITY, BOSS_AT, LEVEL_DURATION } from './config.js';
import { clamp, damp, rand, chance, formatTime, Trauma, TAU } from './util.js';
import { buildEnvironment } from './textures.js';
import { PostFX } from './postfx.js';
import { World } from './world.js';
import { Effects } from './effects.js';
import { Combat } from './combat.js';
import { Enemies } from './enemies.js';
import { Player } from './player.js';
import { Boss } from './bossai.js';
import { LevelDirector } from './levels.js';
import { HUD } from './hud.js';

const _v = new THREE.Vector3();

export class Game {
  constructor(canvas, input, audio) {
    this.canvas = canvas;
    this.input = input;
    this.audio = audio;
    this.hud = new HUD();
    this.quality = QUALITY.mid;
    this.state = 'menu';
    this.paused = false;
    this.time = 0;
    this.director = null;
  }

  /* ================================================================ *
   * 初始化
   * ================================================================ */
  init() {
    /* --- 渲染器 --- */
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // 自己在合成阶段做 sRGB
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;
    this.renderer = renderer;

    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    const w = Math.max(2, Math.floor(window.innerWidth * dpr));
    const h = Math.max(2, Math.floor(window.innerHeight * dpr));

    /* --- 场景 --- */
    const scene = new THREE.Scene();
    this.scene = scene;

    /* --- 相机 --- */
    this.camTarget = new THREE.Vector3(0, 1, -10);
    this.camDir = new THREE.Vector3(0, -14, -46).normalize();
    // fitCamera() 会在竖屏时自动拉远，直到横向可视宽度 >= WORLD.minHalfWidth。
    // 横屏下取这个初值，机体在屏幕上足够大、又不至于挡住弹幕。
    this.camDist = 34;
    const camera = new THREE.PerspectiveCamera(WORLD.fov, 1, 0.5, 1400);
    this.camera = camera;

    /* --- 后处理 --- */
    this.postfx = new PostFX(renderer, { width: w, height: h, bloomScale: this.quality.bloomScale, levels: 5, samples: 4 });
    this.postfx.setSize(w, h);

    /* --- 光照 --- */
    this.hemi = new THREE.HemisphereLight(0x8899cc, 0x140f22, 0.55);
    scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 2.0);
    this.key.position.set(14, 26, 18);
    scene.add(this.key);
    this.rim = new THREE.DirectionalLight(0x66aaff, 1.1);
    this.rim.position.set(-16, -10, -22);
    scene.add(this.rim);
    this.fill = new THREE.DirectionalLight(0xff9ad8, 0.6);
    this.fill.position.set(-12, 18, 6);
    scene.add(this.fill);

    /* --- 系统 --- */
    this.effects = new Effects(scene, this.quality);
    this.combat = new Combat(scene, this.effects, this.quality);
    this.enemies = new Enemies(scene, this.combat, this.effects, this.audio);
    this.world = new World(scene, renderer);
    this.trauma = new Trauma();
    this.player = new Player(scene, this.combat, this.effects, this.audio);
    this.boss = new Boss(scene, this.combat, this.effects, this.audio);
    this.director = new LevelDirector(this);

    /* --- 运行时数据 --- */
    this.diff = DIFFICULTIES.normal;
    this.levelIndex = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.bossActive = false;
    this.bossPending = false;
    this.bossWarnT = 0;
    this.stateT = 0;
    this.scrollSpeed = 26;
    this.pointerWorld = new THREE.Vector3();
    this.bounds = { minX: -21, maxX: 21, minY: -16, maxY: 10.5 };
    this.fpsAcc = 0;
    this.fpsCount = 0;
    this.fps = 60;
    this.autoQualityDone = 0;

    this.applyLevelLook(0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    return this;
  }

  /** 按关卡主题切换灯光/环境/雾 */
  applyLevelLook(index) {
    const L = LEVELS[index];
    const p = L.palette;
    this.hemi.color.set(p.ambient);
    this.hemi.groundColor.set(p.fog);
    this.key.color.set(p.key);
    this.rim.color.set(p.rim);
    this.fill.color.set(p.accent);

    this.scene.environment?.dispose?.();
    this.scene.environment = buildEnvironment(this.renderer, p);
    this.scene.fog = new THREE.Fog(new THREE.Color(p.fog), 190, 560);

    const theme = index === 1 ? 'belt' : index === 2 ? 'core' : 'nebula';
    this.world.setTheme(p, theme);
  }

  /* ================================================================ *
   * 尺寸 / 相机 / 战场边界
   * ================================================================ */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    const w = Math.max(2, Math.floor(window.innerWidth * dpr));
    const h = Math.max(2, Math.floor(window.innerHeight * dpr));
    this.renderer.setPixelRatio(1);
    this.postfx.setSize(w, h);
    this.camera.aspect = w / h;
    this.fitCamera();
    this.effects.setSizeScale(h, WORLD.fov);
    this.updateBounds();
  }

  /** 自适应相机距离：保证战场至少有 minHalfWidth 的横向空间（竖屏友好） */
  fitCamera() {
    const cam = this.camera;
    for (let iter = 0; iter < 6; iter++) {
      cam.position.copy(this.camTarget).addScaledVector(this.camDir, -this.camDist);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.camTarget);
      cam.updateProjectionMatrix();
      const b = this.computeBoundsRaw(WORLD.playerZ);
      const halfW = (b.maxX - b.minX) * 0.5;
      if (halfW >= WORLD.minHalfWidth || this.camDist > 260) break;
      this.camDist *= WORLD.minHalfWidth / Math.max(0.01, halfW);
    }
    this.updateBounds();
  }

  /** NDC → 平面 z 上的世界坐标 */
  ndcToPlane(nx, ny, z, out = new THREE.Vector3()) {
    out.set(nx, ny, 0.5).unproject(this.camera);
    out.sub(this.camera.position).normalize();
    const t = (z - this.camera.position.z) / (out.z || -1e-5);
    return out.multiplyScalar(t).add(this.camera.position);
  }

  computeBoundsRaw(z) {
    const pts = [
      this.ndcToPlane(-1, 1, z, new THREE.Vector3()),
      this.ndcToPlane(1, 1, z, new THREE.Vector3()),
      this.ndcToPlane(-1, -1, z, new THREE.Vector3()),
      this.ndcToPlane(1, -1, z, new THREE.Vector3()),
    ];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      pts,
    };
  }

  updateBounds() {
    const b = this.computeBoundsRaw(WORLD.playerZ);
    // 竖屏时取四角中较小的半宽，保证玩家任何时候都在屏内
    const halfW = Math.min(Math.abs(b.minX), Math.abs(b.maxX));
    const marginX = 1.6;
    this.bounds = {
      minX: -halfW + marginX,
      maxX: halfW - marginX,
      // 上边界留出空间给自机，下边界留 HUD
      minY: b.minY + 4.2,
      maxY: b.maxY - 5.0,
    };
    this.enemies.bounds = {
      minX: -halfW - 4,
      maxX: halfW + 4,
      minY: b.minY - 2,
      maxY: b.maxY + 6,
    };
    this.enemyArea = { halfW, bottomY: b.minY, topY: b.maxY };
  }

  /* ================================================================ *
   * 流程
   * ================================================================ */
  startRun(diffId) {
    this.diff = DIFFICULTIES[diffId] || DIFFICULTIES.normal;
    this.score = 0;
    this.combo = 0;
    this.levelIndex = 0;
    this.enemies.setDifficulty(this.diff);
    this.player.reset(this.diff);
    this.combat.clear();
    this.enemies.clear();
    this.effects.clear();
    this.boss.stop();
    this.startLevel(0);
  }

  startLevel(index) {
    this.levelIndex = index;
    this.applyLevelLook(index);
    this.director.start(index, this.diff);
    this.combat.clear();
    this.enemies.clear();
    this.boss.stop();
    this.bossActive = false;
    this.bossPending = false;
    this.bossWarnT = 0;
    this.world.reset();
    this.state = 'briefing';
    this.stateT = 0;
    this.scrollSpeed = 42;
    this.postfx.params.warp = 0.25;
    const L = LEVELS[index];
    this.hud.showBanner(L.name, L.code, 3.0, 'level');
    this.audio.startMusic(L.music);
    this.audio.setIntensity(0.4);
  }

  triggerBoss() {
    if (this.bossActive || this.bossPending) return;
    this.bossPending = true;
    this.bossWarnT = 3.6;
    this.audio.alarm();
    this.audio.setIntensity(1);
    const L = LEVELS[this.levelIndex];
    this.hud.showBanner('WARNING', L.bossName + ' 已进入射程', 3.4, 'warn');
    this.combat.clearEnemyBullets(0, null);
  }

  spawnBossNow() {
    const L = LEVELS[this.levelIndex];
    this.boss.start(L.boss, this.diff, L.bossName);
    this.bossActive = true;
    this.bossPending = false;
    this.postfx.params.warp = 0.18;
  }

  onBossDefeated() {
    this.audio.levelClear();
    this.hud.showBanner('TARGET DESTROYED', '目标已摧毁', 2.6, 'clear');
  }

  onBossGone() {
    this.bossActive = false;
    this.combat.clearEnemyBullets(0, null);
    this.state = 'levelclear';
    this.stateT = 0;
    this.audio.stopMusic(1.6);
    if (this.levelIndex >= LEVELS.length - 1) {
      this.state = 'victory';
    }
    this.saveBest();
  }

  advanceLevel() {
    if (this.levelIndex < LEVELS.length - 1) this.startLevel(this.levelIndex + 1);
    else this.state = 'victory';
  }

  gameOver() {
    this.state = 'gameover';
    this.stateT = 0;
    this.audio.stopMusic(1.4);
    this.saveBest();
  }

  saveBest() {
    try {
      const key = 'starstrike.best.' + this.diff.id;
      const prev = parseInt(localStorage.getItem(key) || '0', 10);
      if (this.score > prev) localStorage.setItem(key, String(this.score));
    } catch (e) { /* 忽略 */ }
  }

  /* ================================================================ *
   * 生成 / 查询接口（供关卡与 AI 调用）
   * ================================================================ */
  spawnEnemy(type, opts = {}) {
    if (!opts.diff) opts = { ...opts, diff: this.diff };
    return this.enemies.spawn(type, opts);
  }

  addScore(n, pos) {
    const mul = 1 + Math.min(SCORE.comboMax, this.combo) * SCORE.perCombo;
    this.score += n * mul;
    this.combo++;
    this.comboTimer = SCORE.comboWindow;
  }

  findNearestEnemy(pos, maxDist = 1e9) {
    let best = null;
    let bestD = maxDist * maxDist;
    const list = this.enemies.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const dx = e.pos.x - pos.x, dy = e.pos.y - pos.y, dz = e.pos.z - pos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (this.bossActive && this.boss.alive && this.boss.state === 'combat') {
      for (const b of this.boss.bodies) {
        const dx = b.world.x - pos.x, dy = b.world.y - pos.y, dz = b.world.z - pos.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = { alive: true, pos: b.world, isBoss: true };
        }
      }
    }
    return best;
  }

  /* ================================================================ *
   * 主循环
   * ================================================================ */
  update(dtRaw) {
    const dt = Math.min(dtRaw, 1 / 25);
    this.time += dt;
    this.stateT += dt;

    /* 性能自适应 */
    this.fpsAcc += dtRaw;
    this.fpsCount++;
    if (this.fpsAcc > 1) {
      this.fps = this.fpsCount / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsCount = 0;
      this.autoAdapt();
    }
    this.audio.update();

    const playing = this.state === 'playing' && !this.paused;
    const menu = this.state === 'menu' || this.state === 'briefing';
    this.input.update();

    /* ------- 暂停 ------- */
    if (this.input.consumePause()) {
      if (this.state === 'playing') {
        this.paused = !this.paused;
        this.audio.ui(this.paused ? 'back' : 'click');
        document.getElementById('pause').classList.toggle('hidden', !this.paused);
      }
    }
    const sdt = this.paused ? 0 : dt;

    /* ------- 指针世界坐标 ------- */
    if (this.input.mode === 'pointer' && this.input.pointer.active) {
      this.ndcToPlane(this.input.pointer.ndcX, this.input.pointer.ndcY, WORLD.playerZ, this.pointerWorld);
    }

    /* ------- 状态推进 ------- */
    switch (this.state) {
      case 'briefing':
        if (this.stateT > 3.0) {
          this.state = 'playing';
          this.stateT = 0;
          this.postfx.params.warp = 0;
          this.scrollSpeed = 26;
        } else {
          this.postfx.params.warp = damp(this.postfx.params.warp, 0.05, 1.2, sdt);
        }
        break;
      case 'levelclear':
        this.postfx.params.warp = damp(this.postfx.params.warp, 0.75, 1.6, sdt);
        this.scrollSpeed = damp(this.scrollSpeed, 190, 1.4, sdt);
        if (this.stateT > 3.4) {
          this.advanceLevel();
        }
        break;
      case 'gameover':
        this.scrollSpeed = damp(this.scrollSpeed, 4, 1.2, sdt);
        if (this.stateT > 1.2 && this.input.consumeConfirm()) this.toMenu();
        break;
      case 'victory':
        this.scrollSpeed = damp(this.scrollSpeed, 8, 1.2, sdt);
        if (this.stateT > 1.2 && this.input.consumeConfirm()) this.toMenu();
        break;
      default:
        break;
    }

    /* ------- 战斗逻辑 ------- */
    if (playing) {
      this.director.update(sdt);
      if (this.bossPending) {
        this.bossWarnT -= sdt;
        if (this.bossWarnT <= 0) this.spawnBossNow();
      }
      if (this.comboTimer > 0) {
        this.comboTimer -= sdt;
        if (this.comboTimer <= 0) this.combo = 0;
      }
      this.audio.setIntensity(clamp(0.4 + this.enemies.count() / 18 + (this.bossActive ? 0.5 : 0), 0.3, 1));
    } else if (menu || this.state === 'levelclear') {
      if (this.state !== 'levelclear') this.scrollSpeed = 34;
    }

    /* ------- 实体更新 ------- */
    const ctx = this.makeCtx(sdt, playing);
    if (sdt > 0) {
      this.player.update(sdt, this.input, ctx);
      this.enemies.update(sdt, ctx);
      if (this.bossActive) this.boss.update(sdt, ctx);
      this.combat.update(sdt, ctx);
      this.effects.update(sdt);
      if (playing) this.collide(ctx);
    }
    this.world.update(sdt, this.scrollSpeed, this.postfx.params.warp);

    /* ------- 镜头 ------- */
    const tr = this.trauma.update(sdt);
    const follow = this.state === 'menu' ? 0 : 1;
    const camFollowX = damp(this.camHudX || 0, this.player.pos.x * 0.05 * follow, 3.2, sdt);
    const camFollowY = damp(this.camHudY || 0, this.player.pos.y * 0.03 * follow, 3.2, sdt);
    this.camHudX = camFollowX;
    this.camHudY = camFollowY;
    this.camera.position.copy(this.camTarget).addScaledVector(this.camDir, -this.camDist);
    this.camera.position.x += camFollowX;
    this.camera.position.y += camFollowY;
    this.camera.lookAt(this.camTarget.x + camFollowX * 0.35, this.camTarget.y + camFollowY * 0.4, this.camTarget.z);
    this.camera.updateMatrixWorld(true);

    this.postfx.shake.set(tr.x * 0.0055, tr.y * 0.0055);
    this.postfx.shakeRot = tr.r;
    this.postfx.flash = damp(this.postfx.flash, this.player.bombFlash * 0.5, 8, sdt);
    const hpFrac = this.player.hp / this.player.maxHp;
    this.postfx.damage = this.player.alive && hpFrac < 0.35 ? (1 - hpFrac / 0.35) * 0.55 : 0;

    /* ------- HUD ------- */
    this.hud.update(sdt, this.hudState());

    /* ------- 渲染 ------- */
    this.postfx.render(this.scene, this.camera, sdt);
  }

  autoAdapt() {
    // 连续低帧则降画质（只降一次）
    if (this.autoQualityDone >= 1) return;
    if (this.fps < 42) {
      this.autoQualityDone = 1;
      this.quality = QUALITY.low;
      this.effects.maxParticles = this.quality.maxParticles;
      this.postfx.params.bloomStrength *= 0.85;
      this.postfx.params.scanline = 0.02;
      this.effects.setSizeScale(this.postfx.height, WORLD.fov);
      this.resize();
    }
  }

  makeCtx(dt, playing) {
    const self = this;
    return {
      dt,
      time: this.time,
      playerPos: this.player.pos,
      player: this.player,
      bounds: this.bounds,
      playerZ: WORLD.playerZ,
      pointerWorld: this.pointerWorld,
      magnetRange: this.player.magnetRange,
      trauma: this.trauma,
      canFire: playing && this.player.alive,
      findNearestEnemy: (p, d) => self.findNearestEnemy(p, d),
      findMissileTarget: (p) => self.findNearestEnemy(p, 400),
      addScore: (n, pos) => self.addScore(n, pos),
      spawnEnemy: (t, o) => self.spawnEnemy(t, o),
      onBomb: (pos) => self.onBomb(pos),
      onPlayerDeath: () => self.onPlayerDeath(),
      onPlayerHitByBoss: (d) => self.hurtPlayer(d),
      onBossDefeated: () => self.onBossDefeated(),
      onBossGone: () => self.onBossGone(),
    };
  }

  hudState() {
    const p = this.player;
    const inBoss = this.bossActive && this.boss.alive;
    return {
      levelName: LEVELS[this.levelIndex].name,
      levelCode: LEVELS[this.levelIndex].code,
      timerText: this.bossActive || this.bossPending ? 'BOSS' : formatTime(this.director.timeLeft),
      progress: this.director.progress,
      hp: p.hp,
      maxHp: p.maxHp,
      shields: p.shields,
      lives: p.lives,
      bombs: p.bombs,
      score: this.score,
      combo: this.combo,
      dps: p.dps,
      fps: this.fps,
      levels: p.levels,
      bossActive: inBoss,
      bossName: LEVELS[this.levelIndex].bossName,
      bossHpFrac: inBoss ? this.boss.hpFrac : 0,
      bossPhase: inBoss ? this.boss.phase : 0,
    };
  }

  /* ================================================================ *
   * 碰撞
   * ================================================================ */
  collide(ctx) {
    const player = this.player;
    const pb = this.combat.pBullets;

    /* --- 玩家子弹 → 敌机 / BOSS --- */
    for (let i = 0; i < pb.n; i++) {
      const bx = pb.x[i], by = pb.y[i], bz = pb.z[i], pz = pb.pz[i], r = pb.r[i], dmg = pb.dmg[i];
      // 敌机：取 z 最大（离玩家最近）的命中目标
      let target = null, bestZ = -1e9;
      const list = this.enemies.list;
      for (let k = 0; k < list.length; k++) {
        const e = list[k];
        if (!e.alive) continue;
        if (e.pos.z < bz - 1.2 || e.pos.z > pz + 1.2) continue;
        const dx = e.pos.x - bx, dy = e.pos.y - by;
        const rr = e.radius + r;
        if (dx * dx + dy * dy > rr * rr) continue;
        if (e.pos.z > bestZ) {
          bestZ = e.pos.z;
          target = e;
        }
      }
      let handled = false;
      if (target) {
        this.enemies.damage(target, dmg, ctx);
        this.effects.hitSpark(bx, by, bz, 0xffd08a, 1.1, 4);
        handled = true;
      }
      /* --- BOSS --- */
      if (!handled && this.bossActive && this.boss.alive) {
        const hit = this.boss.hitTest(bx, by, bz, r);
        if (hit) {
          this.boss.damage(dmg, ctx, hit.kind === 'pod', hit.pod);
          this.effects.hitSpark(bx, by, bz, hit.kind === 'pod' ? 0xffe07a : 0x9fe8ff, 1.3, 5);
          handled = true;
        }
      }
      if (handled) {
        // 移除子弹
        const j = --pb.n;
        if (i !== j) pb._copy(j, i);
        i--;
      }
    }

    if (!player.alive) return;
    const pr = 0.55;   // 自机判定半径（小判定，手感公平）

    /* --- 敌弹 → 玩家 --- */
    for (const pool of [this.combat.eBullets, this.combat.nBullets]) {
      for (let i = 0; i < pool.n; i++) {
        const bz = pool.z[i];
        if (bz < WORLD.playerZ - 3.2 || bz > WORLD.playerZ + 3.6) continue;
        const dx = pool.x[i] - player.pos.x;
        const dy = pool.y[i] - player.pos.y;
        const rr = pool.r[i] + pr;
        if (dx * dx + dy * dy > rr * rr) continue;
        this.hurtPlayer(pool.dmg[i]);
        const j = --pool.n;
        if (i !== j) pool._copy(j, i);
        i--;
        break;
      }
    }

    /* --- 敌机撞击 --- */
    const list = this.enemies.list;
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      if (!e.alive) continue;
      const dx = e.pos.x - player.pos.x;
      const dy = e.pos.y - player.pos.y;
      const dz = e.pos.z - player.pos.z;
      const rr = e.radius + pr + 0.4;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (Math.abs(dz) > 3.4) continue;
      this.hurtPlayer(e.contactDamage);
      this.enemies.damage(e, 9999, ctx);
      break;
    }

    /* --- BOSS 撞击 --- */
    if (this.bossActive && this.boss.alive && this.boss.state === 'combat') {
      for (const b of this.boss.bodies) {
        const dx = b.world.x - player.pos.x;
        const dy = b.world.y - player.pos.y;
        const dz = b.world.z - player.pos.z;
        if (dz < -2 || dz > 5) continue;
        const rr = b.r * 0.86 + pr;
        if (dx * dx + dy * dy < rr * rr) {
          this.hurtPlayer(26);
          break;
        }
      }
    }

    /* --- 道具拾取 --- */
    for (const p of this.combat.pickups) {
      if (!p.alive) continue;
      const dx = p.obj.position.x - player.pos.x;
      const dy = p.obj.position.y - player.pos.y;
      const dz = p.obj.position.z - player.pos.z;
      if (dx * dx + dy * dy < 2.4 * 2.4 && Math.abs(dz) < 3.4) {
        this.collect(p);
      }
    }
  }

  collect(p) {
    p.alive = false;
    p.obj.visible = false;
    const type = p.type;
    if (type === 'score') {
      this.score += 500 * (1 + Math.min(SCORE.comboMax, this.combo) * SCORE.perCombo);
      this.audio.pickup();
    } else {
      this.player.applyPowerup(type);
    }
    this.effects.hitSpark(p.obj.position.x, p.obj.position.y, p.obj.position.z, p.def.color, 1.4, 10);
    this.effects.shockwave(p.obj.position.x, p.obj.position.y, p.obj.position.z, 0.4, 3.2, 0.32, 0.8, p.def.color);
  }

  hurtPlayer(damage) {
    if (!this.player.alive) return;
    const res = this.player.hit(damage, this.makeCtx(0, true));
    if (res !== 'none') this.combat.clearEnemyBullets(9, this.player.pos);
  }

  onPlayerDeath() {
    this.combo = 0;
    if (this.player.lives <= 0) {
      this.gameOver();
    } else {
      this.respawnTimer = 1.6;
      this.state = 'playing';
      setTimeout(() => {
        if (this.state !== 'gameover' && this.state !== 'victory') this.player.respawn();
      }, 1400);
    }
  }

  onBomb(pos) {
    this.enemies.damageAll(1400, this.makeCtx(0, true));
    if (this.bossActive && this.boss.alive) {
      this.boss.damage(this.boss.maxHp * 0.035, this.makeCtx(0, true), false, null);
    }
    this.combat.clearEnemyBullets(0, null);
    this.trauma.add(0.85);
  }

  toMenu() {
    this.state = 'menu';
    this.stateT = 0;
    this.paused = false;
    this.bossActive = false;
    this.boss.stop();
    this.enemies.clear();
    this.combat.clear();
    this.effects.clear();
    this.applyLevelLook(0);
    document.getElementById('pause').classList.add('hidden');
    if (this.onMenuShown) this.onMenuShown();
  }
}

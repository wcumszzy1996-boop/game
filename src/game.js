/**
 * game.js — 引擎装配 / 状态机 / 主循环（2D 竖版）
 *
 * 渲染：正交相机（VIEW_W 18 × VIEW_H 32 = 9:16）+ 自研 HDR Bloom 后处理。
 * 全部物体为「贴图平面 + MeshBasicMaterial」，无实时光照 —— 颜色可通过
 * material.color > 1 精确控制哪一部分参与 Bloom，因此射击光效可以给得很足
 * 而背景与机体依然干净。
 *
 * 状态：menu → playing（波次 → BOSS）→ levelclear → playing … → victory / gameover
 */
import * as THREE from '../vendor/three/three.module.js';
import { WORLD, LAYER, DIFFICULTIES, LEVELS, WEAPON, QUALITY, LEVEL_DURATION, BOSS_AT, GUARANTEED_DROPS, ASTEROID, POWERUPS } from './config.js';
import { clamp, damp, Trauma, chance, rand, formatTime, mulberry32 } from './util.js';
import { createSprites } from './sprites.js';
import { PostFX } from './postfx.js';
import { World } from './world.js';
import { Effects } from './effects.js';
import { BulletField, LaserSystem } from './combat.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { Boss } from './boss.js';
import { PickupManager, rollDropType } from './powerups.js';
import { buildWaves } from './levels.js';
import { HUD } from './hud.js';

const HALF_W = WORLD.VIEW_W / 2;
const HALF_H = WORLD.VIEW_H / 2;
const _c = new THREE.Color();

export class Game {
  constructor(canvas, input, audio) {
    this.canvas = canvas;
    this.input = input;
    this.audio = audio;
    this.state = 'menu';
    this.stateT = 0;
    this.time = 0;
    this.paused = false;

    this.score = 0;
    this.combo = 0;
    this.comboT = 0;
    this.diff = DIFFICULTIES.normal;
    this.levelIndex = 0;
    this.levelT = 0;
    this.waveIndex = 0;
    this.waves = [];
    this.bossActive = false;
    this.bossWarnT = 0;
    this.scrollSpeed = 11;
    this.respawnT = 0;
    this.levelClearT = 0;
    this.dpsAcc = 0;
    this.dpsT = 0;
    this.dps = 0;
    this.fps = 60;
    this.drawCalls = 0;
    this.triangles = 0;
    this._fpsAcc = 0;
    this._fpsN = 0;
    this._qualityT = 0;
    this.quality = 'high';

    // 指针控制
    this.pointerControl = true;
    this.pointerTarget = new THREE.Vector2(0, WORLD.playerY);
    this._pointerDown = false;
  }

  /* ------------------------------------------------------------------ */
  init() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-HALF_W, HALF_W, HALF_H, -HALF_H, 0.1, 400);
    this.camera.position.set(0, 0, WORLD.camZ);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.spr = createSprites();
    this.postfx = new PostFX(renderer, { width: 2, height: 2, samples: 4, bloomScale: QUALITY.high.bloomScale });

    this.world = new World(this.scene, this.spr);
    this.effects = new Effects(this.scene, this.spr);
    this.pbul = new BulletField(this.scene, this.spr, {
      max: 320, layer: LAYER.playerBullet, renderOrder: 140,
    });
    this.ebul = new BulletField(this.scene, this.spr, {
      max: 620, layer: LAYER.enemyBullet, renderOrder: 120,
    });
    this.lasers = new LaserSystem(this.scene, this.spr, WEAPON.laser.maxBeams);
    this.player = new Player(this.scene, this.spr, this.effects);
    this.enemies = new EnemyManager(this.scene, this.spr, this.effects);
    this.boss = new Boss(this.scene, this.spr, this.effects, this.enemies);
    this.pickups = new PickupManager(this.scene, this.spr, this.effects);
    this.shake = new Trauma();
    this.hud = new HUD();

    this.homingTargets = [];
    this.ctx = this._buildCtx();

    this.resize();
    this.world.setLevel(0);
    this.player.park();
    this.state = 'menu';
    return this;
  }

  _buildCtx() {
    const self = this;
    return {
      game: this,
      player: this.player,
      enemies: this.enemies,
      boss: this.boss,
      pbul: this.pbul,
      ebul: this.ebul,
      lasers: this.lasers,
      pickups: this.pickups,
      effects: this.effects,
      audio: this.audio,
      shake: this.shake,
      postfx: this.postfx,
      input: this.input,
      world: this.world,
      pointerControl: true,
      pointerTarget: this.pointerTarget,
      onEnemyKilled(e) { self._onEnemyKilled(e); },
      onPickup(p) { self._onPickup(p); },
      onPlayerHit(dmg) { self._playerHit(dmg); },
      onPlayerBeam(dmg) { self._playerBeam(dmg); },
      onBossDefeated() { self._onBossDefeated(); },
    };
  }

  /* ------------------------------------------------------------------ *
   * 尺寸
   * ------------------------------------------------------------------ */
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, QUALITY[this.quality].pixelRatio);
    let w = Math.max(160, Math.round(r.width * dpr));
    let h = Math.max(280, Math.round(r.height * dpr));
    // 上限保护：避免 4K 屏把 Bloom 链撑爆
    const maxH = 1700;
    if (h > maxH) { const k = maxH / h; h = maxH; w = Math.round(w * k); }
    if (w === this._w && h === this._h) return;
    this._w = w; this._h = h;
    this.postfx.setSize(w, h);
    this.postfx.bloomScale = QUALITY[this.quality].bloomScale;
    // 粒子点尺寸按设备像素换算
    this.effects.setPixelScale(h / WORLD.VIEW_H);
    this.viewH = h;
  }

  /* ------------------------------------------------------------------ *
   * 流程
   * ------------------------------------------------------------------ */
  startRun(diffId) {
    this.diff = DIFFICULTIES[diffId] || DIFFICULTIES.normal;
    this.score = 0;
    this.combo = 0;
    this.comboT = 0;
    this.levelIndex = 0;
    this._resultShown = false;
    this.paused = false;
    this.player.reset(this.diff);
    this.enemies.setDiff(this.diff);
    this.startLevel(0);
  }

  startLevel(index) {
    this.levelIndex = index % LEVELS.length;
    const L = LEVELS[this.levelIndex];
    this.waves = buildWaves(this.levelIndex);
    this.waveIndex = 0;
    this.levelT = 0;
    this.bossActive = false;
    this.bossWarnT = 0;
    this.bossWarned = false;
    this.scrollSpeed = 11;
    this.paused = false;
    this.levelClearT = 0;
    this.respawnT = 0;
    this.state = 'playing';

    this.world.setLevel(this.levelIndex);
    this.world.setScroll(11);
    /* 关卡级敌机射速：第 1 关 1.25（射速削弱 20%），第 2/3 关 1.0 */
    this.enemies.setFireMul(L.enemyFireMul || 1);
    this.enemies.clear(false);
    this.ebul.clearAll();
    this.pbul.clearAll();
    this.pickups.clear();
    this.boss.clear();
    this.effects.clear();
    this.player.unpark();
    this.player.invuln = Math.max(this.player.invuln, 1.6);
    this.player.firing = true;

    if (this.diff.autoRepair) this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.diff.autoRepair);

    this.audio.stopMusic(0.6);
    this.audio.startMusic(L.music);
    this.audio.setIntensity(0.35);

    this.hud.showBanner(`第 ${this.levelIndex + 1} 关`, L.name + ' · ' + L.code, 2.6, 'clear');
    this.postfx.params.warp = 0.0;
    this.warpT = 0.9;
    this.postfx.flash = 0.35;
  }

  toMenu() {
    this.state = 'menu';
    this.stateT = 0;
    this.bossActive = false;
    this.boss.clear();
    this.enemies.clear(false);
    this.ebul.clearAll();
    this.pbul.clearAll();
    this.pickups.clear();
    this.lasers.hide();
    this.audio.laserStop();
    this.audio.stopMusic(1.2);
    this.audio.setIntensity(0.2);
    this.world.setLevel(0);
    this.world.setScroll(9);
    this.player.park();
    this.hud.hideBanner();
    this.hud.setBoss(false);
    this.postfx.params.warp = 0;
    this.postfx.damage = 0;
    this.triggeredBoss = false;
  }

  triggerBoss() {
    if (this.bossActive) return;
    this.bossActive = true;
    this.triggeredBoss = true;
    this.enemies.clear(false);
    this.ebul.clearAll();
    this.scrollSpeed = 7.0;
    this.world.setScroll(7.0);
    const L = LEVELS[this.levelIndex];
    this.boss.start(L.boss, this.diff);
    this.audio.setIntensity(1.0);
    this.audio.alarm();
    this.hud.showBanner('警  告', L.bossName + ' 接近中', 2.6, 'warn');
    this.shake.add(0.5);
  }

  /* ------------------------------------------------------------------ *
   * 每帧
   * ------------------------------------------------------------------ */
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.stateT += dt;

    /* FPS */
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 0.5) {
      this.fps = this._fpsN / this._fpsAcc;
      this._fpsAcc = 0; this._fpsN = 0;
      this._autoQuality();
    }

    this.shake.update(dt);
    this.input.update();

    /* 指针目标 */
    if (this.input.pointer.active && this.input.mode === 'pointer') {
      const nx = this.input.pointer.ndcX * HALF_W;
      const ny = this.input.pointer.ndcY * HALF_H + 1.9;   // 抬高，手指不挡机体
      this.pointerTarget.set(clamp(nx, -WORLD.boundX, WORLD.boundX), clamp(ny, -WORLD.boundY, WORLD.boundY * 0.34));
    }

    const ctx = this.ctx;
    ctx.pointerControl = this.pointerControl && !this.paused;

    /* 组合屏震（震动 + 后处理） */
    const sh = this.shake.offset;
    this.postfx.shake.set(sh.x * 0.028, sh.y * 0.028);
    this.postfx.shakeRot = sh.r;
    this.postfx.flash = Math.max(0, this.postfx.flash - dt * 3.2);
    this.postfx.damage = damp(this.postfx.damage,
      (!this.player.dead && this.player.hp / this.player.maxHp < 0.32) ? (1 - this.player.hp / this.player.maxHp) * 0.85 : 0, 4, dt);
    if (this.warpT > 0) {
      this.warpT -= dt;
      this.postfx.params.warp = Math.max(0, this.warpT / 0.9) * 0.055;
    }

    if (this.state === 'menu') this._updateMenu(dt, ctx);
    else if (this.state === 'playing') this._updatePlaying(dt, ctx);
    else if (this.state === 'levelclear') this._updateLevelClear(dt, ctx);
    else if (this.state === 'gameover' || this.state === 'victory') this._updateEnded(dt, ctx);

    /* --- 系统推进 --- */
    this.world.setScroll(this.scrollSpeed);
    this.world.update(dt);
    this.effects.update(dt);
    this.player.update(dt, ctx);
    this.enemies.update(dt, ctx);
    this.boss.update(dt, ctx);
    this.pickups.update(dt, ctx);
    this.lasers.update(dt);
    this._buildHomingTargets();
    this.pbul.update(dt, (b) => this._bulletCull(b, ctx), this.homingTargets);
    this.ebul.update(dt);

    if (this.state === 'playing') this._collide(dt, ctx);

    /* --- 渲染 --- */
    const st = this.postfx.render(this.scene, this.camera, dt);
    this.drawCalls = st.drawCalls;
    this.triangles = st.triangles;
    this._updateHud(dt);
  }

  _bulletCull(b, ctx) {
    if (b.kind === 1 && b.t > 0.02) {
      this.effects.puff('smoke', b.x, b.y, {
        life: rand(0.22, 0.42), s0: 0.26, s1: 0.62,
        r: 1.1, g: 0.5, b: 0.5, a0: 0.45, a1: 0, drag: 1.2, vx: rand(-0.6, 0.6), vy: rand(-0.4, 0.4),
      });
    }
  }

  _buildHomingTargets() {
    const t = this.homingTargets;
    t.length = 0;
    for (const e of this.enemies.list) t.push(e);
    if (this.boss.alive && !this.boss.dying) t.push({ x: this.boss.x, y: this.boss.y, alive: true });
  }

  /* ------------------------------------------------------------------ *
   * 各状态
   * ------------------------------------------------------------------ */
  _updateMenu(dt, ctx) {
    this.scrollSpeed = 9;
    ctx.player.firing = false;
    this.lasers.hide();
    // 菜单里偶尔放点装饰性敌机编队
    this._menuSpawnT = (this._menuSpawnT || 0) - dt;
    if (this._menuSpawnT <= 0) {
      this._menuSpawnT = rand(3.4, 6.5);
      const n = 3 + ((Math.random() * 3) | 0);
      const type = chance(0.5) ? 'scout' : 'fighter';
      for (let i = 0; i < n; i++) {
        this.enemies.spawn(type, {
          x: rand(-6, 6), y: HALF_H + 2 + i * 1.6,
          move: chance(0.5) ? 'sine' : 'straight', speed: 3.4,
        });
      }
    }
    this.ebul.clearAll();
  }

  _updatePlaying(dt, ctx) {
    this.levelT += dt;
    ctx.player.firing = !this.noAutoFire;

    /* 波次 */
    if (!this.bossActive) {
      while (this.waveIndex < this.waves.length && this.levelT >= this.waves[this.waveIndex].t) {
        this._runWave(this.waves[this.waveIndex++], ctx);
      }
      /* BOSS 预警 */
      if (!this.bossWarned && this.levelT >= BOSS_AT - 4.0) {
        this.bossWarned = true;
        this.bossWarnT = 4.0;
        this.hud.showBanner('警  告', '旗舰信号接近 · 准备交战', 3.4, 'warn');
        this.audio.alarm();
      }
      if (this.bossWarnT > 0) {
        this.bossWarnT -= dt;
        this.postfx.flash = Math.max(this.postfx.flash, 0.06 + 0.06 * Math.sin(this.time * 18));
      }
      if (this.levelT >= BOSS_AT) this.triggerBoss();
    } else {
      this.scrollSpeed = damp(this.scrollSpeed, 6.5, 1.2, dt);
    }

    /* 阵亡复活 */
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        this.player.respawn(this.diff);
        this.ebul.clearNear(this.player.pos.x, this.player.pos.y, 7.5);
      }
    }

    /* 难度强度 → BGM */
    this.audio.setIntensity(this.bossActive ? 1.0 : clamp(this.enemies.count / 12, 0.3, 0.9));
  }

  _updateLevelClear(dt, ctx) {
    this.levelClearT -= dt;
    this.scrollSpeed = damp(this.scrollSpeed, 14, 1.5, dt);
    ctx.player.firing = true;
    if (this.levelClearT <= 0) {
      const next = this.levelIndex + 1;
      if (next >= LEVELS.length) {
        this.state = 'victory';
        this.stateT = 0;
        this._resultShown = false;
      } else {
        this.startLevel(next);
      }
    }
  }

  _updateEnded(dt, ctx) {
    this.scrollSpeed = damp(this.scrollSpeed, 6, 1, dt);
    ctx.player.firing = false;
    this.lasers.hide();
    this.ebul.clearAll();
    if (this.state === 'gameover' && this.stateT < 1.0) {
      this.scrollSpeed = 3;
    }
  }

  /* ------------------------------------------------------------------ *
   * 波次执行
   * ------------------------------------------------------------------ */
  _runWave(w, ctx) {
    if (w.banner) {
      this.hud.showBanner(w.banner.text, w.banner.sub, w.banner.dur || 2.0, w.banner.cls || '');
    }
    if (w.drop) {
      this.pickups.spawn(w.drop, w.dropX ?? rand(-3, 3), HALF_H - 1.5, { vy: -1.8 });
      this.hud.toast(`掉落：${w.drop}`);
    }
    if (!w.spawn) return;
    const mul = this.diff.spawnMul || 1;
    for (const s of w.spawn) {
      this.enemies.spawn(s.type, s);
    }
    // 数量倍率：额外补充一批（保持编队外观）
    const extra = Math.round((mul - 1) * w.spawn.length);
    for (let i = 0; i < extra; i++) {
      const s = w.spawn[(Math.random() * w.spawn.length) | 0];
      this.enemies.spawn(s.type, {
        ...s,
        x: clamp((s.x ?? 0) + rand(-1.6, 1.6), -8, 8),
        y: (s.y ?? HALF_H + 2) + rand(0.4, 2.6),
        fireOffset: rand(0.6, 1.5),
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 碰撞
   * ------------------------------------------------------------------ */
  _collide(dt, ctx) {
    const p = this.player;

    /* --- 自机子弹 vs 敌机 --- */
    const elist = this.enemies.list;
    for (let i = elist.length - 1; i >= 0; i--) {
      const e = elist[i];
      if (!e.alive) continue;
      const dmg = this.pbul.hitCircle(e.x, e.y, e.r, (b, hx, hy) => {
        this._addDps(b.dmg);
      });
      if (dmg > 0) this.enemies.hurt(e, dmg, ctx);
    }

    /* --- 激光 vs 敌机 --- */
    if (this.lasers.active) {
      for (let i = elist.length - 1; i >= 0; i--) {
        const e = elist[i];
        if (!e.alive) continue;
        const dmg = this.lasers.hitCircle(e.x, e.y, e.r, dt, (b, hx, hy) => {
          if (Math.random() < 0.10) this.audio.laserHit();
        });
        if (dmg > 0) {
          this._addDps(dmg);
          this.enemies.hurt(e, dmg, ctx);
        }
      }
    }

    /* --- 自机子弹 / 激光 vs BOSS --- */
    const b = this.boss;
    if (b.alive && !b.dying) {
      for (const box of b.def.hitboxes) {
        const bx = b.x + box.dx, by = b.y + box.dy;
        const d1 = this.pbul.hitCircle(bx, by, box.r, (bl) => this._addDps(bl.dmg));
        if (d1 > 0) this._bossDamage(d1, bx, by, ctx);
        if (this.lasers.active) {
          const d2 = this.lasers.hitCircle(bx, by, box.r, dt, () => { if (Math.random() < 0.06) this.audio.laserHit(); });
          if (d2 > 0) { this._addDps(d2); this._bossDamage(d2, bx, by, ctx); }
        }
      }
    }

    if (p.dead) return;

    /* --- 敌弹 vs 自机 ---
     * 直接采用 hitCircle 返回的累计伤害。每型敌机的弹丸伤害由
     * ENEMY_TYPES[].dmg 决定，因此"敌机攻击力"可以在图鉴里按机型分别调。
     */
    const ehit = this.ebul.hitCircle(p.pos.x, p.pos.y, p.hitRadius, null);
    if (ehit > 0) this._playerHit(ehit);

    /* --- 撞机 --- */
    for (let i = elist.length - 1; i >= 0; i--) {
      const e = elist[i];
      if (!e.alive) continue;
      const dx = e.x - p.pos.x, dy = e.y - p.pos.y;
      const r = e.r + p.hitRadius + 0.22;
      if (dx * dx + dy * dy <= r * r) {
        this.enemies.hurt(e, 9999, ctx);
        this._playerHit(this.diff.ramDamage);
        break;
      }
    }
    if (b.alive && !b.dying && b.transT <= 0) {
      for (const box of b.def.hitboxes) {
        const dx = b.x + box.dx - p.pos.x, dy = b.y + box.dy - p.pos.y;
        const r = box.r * 0.72 + p.hitRadius;
        if (dx * dx + dy * dy <= r * r) { this._playerHit(this.diff.ramDamage * 1.5); break; }
      }
    }

    /* --- 陨石：先结算「被自机打碎」，再结算「撞击自机」（第 2 关）--- */
    this._hitAsteroids(dt, ctx);
    this._collideAsteroids(ctx);
  }

  /**
   * 陨石 vs 自机：撞上就消耗装甲值（走 _playerHit，因此护盾可以抵挡、
   * 无敌帧依然生效），随后陨石碎裂并回到屏幕上沿重新坠落。
   * 陨石只在第 2 关「陨石带」可见，其他关卡 world.rocksOn 为 false，直接跳过。
   */
  _collideAsteroids(ctx) {
    const rocks = this.world.rocks;
    if (!this.world.rocksOn) return;
    const p = this.player;
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      const u = rock.userData;
      if (u.respawnT > 0) continue;                 // 碎裂中：不可碰撞
      const dx = rock.position.x - p.pos.x;
      const dy = rock.position.y - p.pos.y;
      const rr = u.hitR + p.hitRadius;
      if (dx * dx + dy * dy > rr * rr) continue;

      const hx = rock.position.x, hy = rock.position.y;
      this._playerHit(u.dmg);

      // 撞击碎裂演出（与"被击破"共用 _rockBurst，但无积分/掉落）
      this._rockBurst(hx, hy, u, false);
      this.world.shatterRock(rock);
      break;
    }
  }

  /**
   * 自机子弹 / 激光 vs 陨石（本轮新增：**陨石可击破**）。
   *
   * 判定半径用 u.shootR（比撞击判定 hitR 更大），所以"想打碎它"比"躲开它"更容易。
   * 子弹命中即被消耗（hitCircle 内部处理），激光按 dps×dt 持续扣血。
   * 打空生命值 → 爆炸 + 碎屑 + 积分 + 概率掉落 + 陨石重生。
   */
  _hitAsteroids(dt, ctx) {
    const rocks = this.world.rocks;
    if (!this.world.rocksOn) return;
    const laserOn = this.lasers.active;
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      const u = rock.userData;
      if (u.respawnT > 0) continue;
      const rx = rock.position.x, ry = rock.position.y;

      let dmg = this.pbul.hitCircle(rx, ry, u.shootR, (b) => this._addDps(b.dmg));
      if (laserOn) {
        const d2 = this.lasers.hitCircle(rx, ry, u.shootR, dt, () => {
          if (Math.random() < 0.05) this.audio.laserHit();
        });
        if (d2 > 0) { dmg += d2; this._addDps(d2); }
      }
      if (dmg <= 0) continue;

      if (this.world.hurtRock(rock, dmg)) {
        this.score += Math.round(ASTEROID.score * this.diff.scoreMul);
        // 与敌机掉落共用同一张权重表
        if (chance(clamp(ASTEROID.drop * this.diff.dropMul, 0, 0.95))) {
          this.pickups.spawn(rollDropType(), rx, ry, { vy: rand(-2.0, -0.9) });
        }
        this._rockBurst(rx, ry, u, true);
        this.world.shatterRock(rock);
      } else {
        // 未击破：给一点小火花，让"在掉血"这件事看得见
        this.effects.hitSpark(rx, ry, 0, -1, _c.setRGB(1.0, 0.78, 0.46), 0.55);
      }
    }
  }

  /** 陨石碎裂演出：大石头炸得更凶 */
  _rockBurst(x, y, u, destroyed) {
    const size = (destroyed ? 0.95 : 0.7) + u.s * 0.55;
    _c.setRGB(1.0, 0.74, 0.42);
    this.effects.explosion(x, y, { size, color: _c });
    this.effects.debris(x, y, destroyed ? 1.9 : 1.4, _c, destroyed ? 12 : 8);
    this.audio.explode((destroyed ? 0.7 : 0.55) + u.s * 0.22);
    this.shake.add(ASTEROID.shake * (destroyed ? 1.25 : 1));
  }

  _bossDamage(dmg, x, y, ctx) {
    const res = this.boss.hurt(dmg, x, y);
    if (res === 'phase') {
      this.boss.nextPhase();
      this._onBossPhase();
    } else if (res === 'dead') {
      this.audio.explode(1.6);
      this.shake.add(0.6);
      this.postfx.flash = 0.7;
    }
  }

  _onBossPhase() {
    const names = ['阶段 2', '阶段 3 · 狂暴'];
    this.hud.showBanner(names[this.boss.phase - 1] || '阶段', this.boss.short + ' 装甲重组', 1.8, 'warn');
    this.hud.toast('BOSS 进入下一阶段');
    this.audio.alarm();
    this.shake.add(0.75);
    this.postfx.flash = 0.55;
  }

  /* ------------------------------------------------------------------ *
   * 事件
   * ------------------------------------------------------------------ */
  _onEnemyKilled(e) {
    const mult = (1 + this.combo * 0.12) * this.diff.scoreMul;
    this.score += Math.round(e.score * mult);
    this.combo = Math.min(8, this.combo + 1);
    this.comboT = 2.2;
    if (chance(clamp(e.drop * this.diff.dropMul, 0, 0.95))) {
      this.pickups.spawn(rollDropType(), e.x, e.y, { vy: rand(-2.4, -1.0) });
    }
  }

  _onPickup(p) {
    const def = p.def;
    if (p.type === 'score') {
      this.score += 1500;
      this.audio.pickup();
      this.effects.pickupBurst(p.x, p.y, _c.setHex(def.color));
      this.hud.toast(`${def.label}  +1500`, def.color);
      this.score += 20;
      return;
    }

    const res = this.player.applyPowerup(p.type);
    const maxed = !!(res && res.maxed);

    if (maxed) {
      // 已达叠加上限（5 项武器强化各 5 级）：给"满级"提示，并把道具折成积分
      this.score += 200;
      this.audio.powerUp();
    } else if (p.type === 'life') this.audio.pickLife();
    else if (p.type === 'shield') this.audio.pickShield();
    else if (p.type === 'laser') this.audio.laserCharge(0.6);
    else if (p.type === 'repair') this.audio.pickShield();
    else this.audio.powerUp();

    this.effects.pickupBurst(p.x, p.y, _c.setHex(def.color));
    if (maxed) this.hud.toast(`${def.label} 已满级  +200`, 0xffe08a);
    else this.hud.toast(`${def.label}  ${this._pickupDetail(p.type)}`, def.color);
    this.score += 20;
  }

  /** 拾取飘字里的"数值"部分（生命/修复/核弹不是一个可比的等级，单独给文案） */
  _pickupDetail(type) {
    const L = this.player.levels;
    switch (type) {
      case 'score': return '+1500';
      case 'life': return `+1 机体（余 ${Math.max(0, this.player.lives)}）`;
      case 'repair': return `装甲 +26（${Math.round(this.player.hp)}/${this.player.maxHp}）`;
      case 'bomb': return `核弹 ×${this.player.bombs}`;
      case 'shield': return `护盾 ×${this.player.shields}`;
      default: {
        const cap = POWERUPS[type] && POWERUPS[type].maxLevel;
        const v = L[type] ?? '';
        // 有上限的强化显示 Lv.N/5，让玩家一眼看到还剩多少空间
        return cap ? `Lv.${v}/${cap}` : `Lv.${v}`;
      }
    }
  }

  _addDps(v) {
    this.dpsAcc += v;
  }

  _playerHit(dmg) {
    const p = this.player;
    if (p.dead || p.invuln > 0) return;
    const res = p.damage(dmg);
    if (res === 'none') return;
    if (res === 'shield') {
      this.audio.shieldAbsorb();
      this.hud.toast('护盾吸收', 0x4dffa0);
      this.shake.add(0.22);
      this.postfx.flash = 0.30;
      this.ebul.clearNear(p.pos.x, p.pos.y, 2.6);
      return;
    }
    this.audio.playerHit();
    this.shake.add(0.5);
    this.postfx.flash = 0.55;
    this.effects.explosion(p.pos.x, p.pos.y, { size: 1.1, color: _c.setRGB(0.6, 0.95, 1.2) });
    if (res === 'dead') this._playerDeath();
  }

  _playerBeam(dmg) {
    const p = this.player;
    if (p.dead) return;
    const res = p.beamDamage(dmg);
    if (res === 'shield') {
      this.audio.shieldAbsorb();
      this.hud.toast('护盾吸收', 0x4dffa0);
      this.shake.add(0.2);
    } else if (res === 'hit') {
      this.shake.add(0.05);
    } else if (res === 'dead') {
      this._playerDeath();
    }
  }

  _playerDeath() {
    const p = this.player;
    this.audio.laserStop();
    this.effects.playerBurst(p.pos.x, p.pos.y);
    this.audio.playerHit();
    this.audio.explode(1.4);
    this.shake.add(1.0);
    this.postfx.flash = 1.0;
    this.combo = 0;
    this.ebul.clearNear(p.pos.x, p.pos.y, 9);

    const out = p.kill();
    if (out) {
      this.state = 'gameover';
      this.stateT = 0;
      this._resultShown = false;
      this.audio.stopMusic(1.6);
    } else {
      this.respawnT = 1.35;
      this.hud.showBanner('机体损失', `剩余机体 ${p.lives}`, 1.6, 'warn');
    }
  }

  _onBossDefeated() {
    const D = this.boss.def;
    const bonus = Math.round((D.hp / 40) * this.diff.scoreMul);
    this.score += bonus;
    this._resultShown = false;
    this.hud.showBanner('旗舰击破', `+${bonus} 积分`, 3.0, 'clear');
    this.audio.levelClear();
    this.ebul.clearAll();
    // BOSS 后保底送一命
    this.pickups.spawn(GUARANTEED_DROPS.afterBoss || 'life', 0, HALF_H - 3.0, { vy: -2.0 });
    this.pickups.spawn('power', -3.2, HALF_H - 2.2, { vy: -2.2 });
    this.pickups.spawn('laser', 3.2, HALF_H - 2.2, { vy: -2.2 });
    this.bossActive = false;
    this.state = 'levelclear';
    this.levelClearT = 3.4;
    this.audio.setIntensity(0.3);
  }

  /* ------------------------------------------------------------------ *
   * HUD
   * ------------------------------------------------------------------ */
  _updateHud(dt) {
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    // DPS：按 0.25s 窗口统计并平滑（HUD 显示）
    this.dpsT += dt;
    if (this.dpsT >= 0.25) {
      const inst = this.dpsAcc / this.dpsT;
      this.dps = damp(this.dps, inst, 7, dt + 0.25);
      this.dpsAcc = 0;
      this.dpsT = 0;
    }

    const remaining = Math.max(0, LEVEL_DURATION - this.levelT);
    const L = LEVELS[this.levelIndex];
    let progress;
    if (this.bossActive) progress = 1;
    else progress = clamp(this.levelT / BOSS_AT, 0, 1);

    const bossProgress = this.bossActive && this.boss.alive
      ? clamp((this.levelT - BOSS_AT) / Math.max(1, (LEVEL_DURATION - BOSS_AT) + 30), 0, 1)
      : 0;

    this.snap = {
      levelName: `第 ${this.levelIndex + 1} 关 · ${L.name}`,
      levelCode: L.code,
      timerText: formatTime(remaining),
      progress,
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      shields: this.player.shields,
      lives: Math.max(0, this.player.lives),
      bombs: this.player.bombs,
      score: this.score,
      combo: this.combo,
      dps: this.dps,
      fps: this.fps,
      levels: this.player.levels,
      bossActive: this.bossActive && this.boss.alive,
      bossName: this.boss.name,
      bossHpFrac: this.boss.hpFrac,
      bossPhase: this.boss.phase,
      bossProgress,
      state: this.state,
    };
    this.hud.update(dt, this.snap);
  }

  _autoQuality() {
    this._qualityT += 0.5;
    if (this._qualityT < 4) return;
    this._qualityT = 0;
    if (this.fps < 46 && this.quality !== 'low') {
      this.quality = this.quality === 'high' ? 'mid' : 'low';
      this._w = this._h = -1;
      this.resize();
    } else if (this.fps > 58 && this.quality === 'low') {
      this.quality = 'mid';
      this._w = this._h = -1;
      this.resize();
    }
  }
}

export { mulberry32 };

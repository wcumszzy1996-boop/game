/**
 * main.js — 引导 / 竖版画布布局 / 主循环 / 菜单交互
 */
import { DIFFICULTIES, LEVELS, BOSS_AT } from './config.js';
import { Input } from './input.js';
import { AudioSystem } from './audio.js';
import { Game } from './game.js';
import { formatScore } from './util.js';

const $ = (id) => document.getElementById(id);

let game = null;
let input = null;
const audio = new AudioSystem();

let selDiff = 'normal';
let selLevel = 0;
let running = false;
let lastT = 0;

const stage = $('stage');

/* ------------------------------------------------------------------ *
 * 竖版画布布局：始终维持 9:16，自动适应窗口
 * ------------------------------------------------------------------ */
function layout() {
  const pad = window.innerWidth < 900 ? 10 : 26;
  const availW = window.innerWidth - pad * 2;
  const availH = window.innerHeight - pad * 2;
  let h = Math.max(240, availH);
  let w = h * 9 / 16;
  if (w > availW) { w = availW; h = w * 16 / 9; }
  const W = Math.round(w), H = Math.round(h);
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';
  stage.style.setProperty('--sw', W + 'px');
  stage.style.borderRadius = (window.innerWidth < 700 ? 8 : 16) + 'px';
  if (game) game.resize();
}

let resizeT = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(layout, 90);
});
window.addEventListener('orientationchange', () => setTimeout(layout, 220));

/* ------------------------------------------------------------------ */
function showError(msg) {
  const e = $('err');
  e.style.display = 'grid';
  e.innerHTML = `<div><h2>无法启动</h2><p style="margin-top:14px">${msg}</p>
    <p style="margin-top:14px;opacity:.6">请使用支持 WebGL2 的现代浏览器（Chrome / Edge / Firefox / Safari）。</p></div>`;
}

function bestScore(diffId) {
  try { return parseInt(localStorage.getItem('starstrike2d.best.' + diffId) || '0', 10) || 0; } catch (e) { return 0; }
}

/* ------------------------------------------------------------------ *
 * 菜单
 * ------------------------------------------------------------------ */
function buildMenus() {
  const dc = $('diff-cards');
  dc.innerHTML = '';
  Object.values(DIFFICULTIES).forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'card' + (d.id === selDiff ? ' sel' : '');
    el.style.setProperty('--ac', i === 0 ? '#5fe8ff' : '#ff4d9e');
    el.innerHTML = `
      <h3>${d.name}</h3>
      <div class="en">${d.sub}</div>
      <p>${d.desc}</p>
      <div class="tags">
        <span class="tag">机体 ×${d.playerLives}</span>
        <span class="tag">装甲 ${d.playerHp}</span>
        <span class="tag">敌血 ×${d.enemyHpMul}</span>
        <span class="tag">开火间隔 ×${d.enemyFireMul}</span>
        <span class="tag">积分 ×${d.scoreMul}</span>
      </div>`;
    el.onclick = () => { selDiff = d.id; audio.ui(); buildMenus(); };
    dc.appendChild(el);
  });

  const lc = $('lv-cards');
  lc.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const el = document.createElement('div');
    el.className = 'card' + (i === selLevel ? ' sel' : '');
    el.style.setProperty('--ac', ['#5fe8ff', '#ffc23d', '#2fe6d0'][i]);
    el.innerHTML = `
      <h3>第 ${i + 1} 关 · ${L.name}</h3>
      <div class="en">${L.code}</div>
      <p style="margin-top:6px">${L.brief}</p>`;
    el.onclick = () => { selLevel = i; audio.ui(); buildMenus(); };
    lc.appendChild(el);
  });

  $('best-score').textContent = formatScore(bestScore(selDiff));
}

/* ------------------------------------------------------------------ */
function showResult(kind) {
  const L = game.player.levels;
  const totalPower = L.power + L.spread + L.missile + L.drone + L.laser + L.shield;
  const win = kind === 'victory';
  const rt = $('res-title');
  rt.textContent = win ? '任务完成' : '任务失败';
  rt.style.background = win
    ? 'linear-gradient(100deg,#ffffff,#5fe8ff,#2fe6d0)'
    : 'linear-gradient(100deg,#ffffff,#ff4d9e,#ffb03b)';
  rt.style.webkitBackgroundClip = 'text';
  rt.style.backgroundClip = 'text';
  $('res-sub').textContent = win ? 'ALL SECTORS CLEARED' : 'MISSION FAILED';
  $('res-score').textContent = formatScore(game.score);
  $('res-diff').textContent = game.diff.name;
  $('res-level').textContent = `${Math.min(3, game.levelIndex + 1)} / 3`;
  $('res-power').textContent = totalPower;
  $('res-laser').textContent = 'Lv.' + game.player.levels.laser;
  $('result').classList.remove('hidden');
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
function boot() {
  layout();
  const canvas = $('gl');
  try {
    input = new Input(canvas);
    game = new Game(canvas, input, audio).init();
  } catch (err) {
    console.error(err);
    showError(String(err && err.message ? err.message : err));
    return;
  }
  layout();

  game.onMenuShown = () => {
    $('result').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('menu').classList.remove('hidden');
    game.toMenu();
    game.hud.setPlaying(false);
    buildMenus();
  };
  buildMenus();
  game.toMenu();
  game.hud.setPlaying(false);

  let waiting = true;
  const begin = () => {
    audio.init();
    audio.resume();
    if (waiting) waiting = false;
  };
  window.addEventListener('pointerdown', begin);
  window.addEventListener('keydown', begin);
  window.addEventListener('touchstart', begin);

  const startPlay = () => {
    begin();
    audio.ui();
    $('menu').classList.add('hidden');
    $('result').classList.add('hidden');
    $('pause').classList.add('hidden');
    game.hud.setPlaying(true);
    game.startRun(selDiff);
    if (selLevel > 0) game.startLevel(selLevel);
    running = true;
  };

  $('btn-start').onclick = startPlay;

  $('btn-again').onclick = () => {
    audio.ui();
    $('result').classList.add('hidden');
    game.hud.setPlaying(true);
    game.startRun(game.diff.id);
    running = true;
  };
  $('btn-menu').onclick = () => {
    audio.ui();
    $('result').classList.add('hidden');
    $('menu').classList.remove('hidden');
    game.hud.setPlaying(false);
    game.toMenu();
    running = true;
  };
  $('btn-resume').onclick = () => {
    audio.ui();
    game.paused = false;
    $('pause').classList.add('hidden');
  };
  $('btn-restart').onclick = () => {
    audio.ui();
    $('pause').classList.add('hidden');
    game.paused = false;
    game.hud.setPlaying(true);
    game.startRun(game.diff.id);
  };
  $('btn-quit').onclick = () => {
    audio.ui();
    $('pause').classList.add('hidden');
    game.paused = false;
    $('menu').classList.remove('hidden');
    game.hud.setPlaying(false);
    game.toMenu();
  };

  let muted = false;
  $('btn-mute').onclick = () => {
    muted = !muted;
    audio.setMuted(muted);
    $('btn-mute').textContent = '音效：' + (muted ? '关' : '开');
    if (!muted) audio.ui();
  };
  $('btn-full').onclick = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };

  /* 移动端按钮 */
  $('touch-bomb')?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (game.state === 'playing' && !game.paused) doBomb();
  }, { passive: false });
  const fb = $('touch-focus');
  fb?.addEventListener('touchstart', (e) => { e.preventDefault(); input._touchFocus = true; fb.style.opacity = '0.55'; }, { passive: false });
  fb?.addEventListener('touchend', () => { input._touchFocus = false; fb.style.opacity = '1'; });

  /* 空格核弹 / 暂停 */
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && game.state === 'playing' && !game.paused) {
      e.preventDefault();
      doBomb();
    }
    if ((e.code === 'Escape' || e.code === 'KeyP') && (game.state === 'playing' || game.state === 'levelclear')) {
      game.paused = !game.paused;
      $('pause').classList.toggle('hidden', !game.paused);
      if (game.paused) input.clearQueues();
    }
  });

  function doBomb() {
    if (!game.player.dead && game.player.bombs > 0) {
      game.player.useBomb();
      game.audio.bomb();
      game.shake.add(0.9);
      game.postfx.flash = 0.8;
      game.ebul.clearAll();
      for (const e of game.enemies.list) game.enemies.hurt(e, 260, game.ctx);
      if (game.boss.alive && !game.boss.dying) game._bossDamage(2600, game.boss.x, game.boss.y, game.ctx);
      game.hud.toast('核弹清屏', 0xfff0a0);
    }
  }

  /* ------------------------------------------------------------------ *
   * 调试 / 自动化验收句柄（不影响正常游玩）
   * ------------------------------------------------------------------ */
  window.__strike = {
    get game() { return game; },
    get input() { return input; },
    get audio() { return audio; },
    get ready() { return !!game; },
    get state() { return game.state; },
    step(dt) { game.update(dt); },
    startRun(diffId = 'normal', levelIndex = 0) {
      begin();
      $('menu').classList.add('hidden');
      $('result').classList.add('hidden');
      game.hud.setPlaying(true);
      game.startRun(diffId);
      if (levelIndex > 0) game.startLevel(levelIndex);
      running = true;
      return game.state;
    },
    skipToBoss() {
      begin();
      $('menu').classList.add('hidden');
      $('result').classList.add('hidden');
      game.hud.setPlaying(true);
      if (game.state === 'menu') game.startRun(selDiff);
      game.startLevel(game.levelIndex);
      game.levelT = BOSS_SKIP_T;
      game.triggerBoss();
      running = true;
      return game.state;
    },
    /** 直接给自机加满各类强化，用于验证「无限增强」 */
    grant(type, n = 1) {
      for (let i = 0; i < n; i++) game.player.applyPowerup(type);
      return {
        ...game.player.levels,
        lasers: game.player.laserBeams,
        shields: game.player.shields,
        bombs: game.player.bombs,
        dps: Math.round(game.player.dps),
      };
    },
    grantAll(n = 6) {
      for (const k of ['power', 'spread', 'missile', 'drone', 'laser', 'shield', 'bomb']) {
        for (let i = 0; i < n; i++) game.player.applyPowerup(k);
      }
      return window.__strike.grant('power', 0);
    },
    /**
     * 直接把某项强化设到指定等级。
     * 验收专用：5 项强化已封顶 5 级，想验证"再吃到同类道具仍会提升"必须先降级。
     */
    setLevel(type, v) {
      const L = game.player.levels;
      if (!(type in L)) return null;
      L[type] = Math.max(0, v | 0);
      if (type === 'shield') game.player.shields = L.shield;
      if (type === 'bomb') game.player.bombs = L.bomb;
      game.player.recalc();
      return window.__strike.grant('power', 0);
    },
    /** 陨石相关状态（第 2 关验收用） */
    rocks() {
      const list = game.world.rocks;
      return {
        on: game.world.rocksOn,
        count: list.length,
        broken: list.filter((r) => r.userData.respawnT > 0).length,
        hp: list.map((r) => Math.round(r.userData.hp)),
        maxHp: list.map((r) => Math.round(r.userData.maxHp)),
      };
    },
    /** 直接把 BOSS 打到下一阶段 / 击杀 */
    hurtBoss(dmg) {
      if (!game.boss.alive) return 'no boss';
      const r = game._bossDamage(dmg, game.boss.x, game.boss.y, game.ctx);
      void r;
      return { hp: Math.round(game.boss.hp), phase: game.boss.phase, dying: game.boss.dying };
    },
    killBoss() {
      if (!game.boss.alive) return 'no boss';
      game._bossDamage(game.boss.hp + 1, game.boss.x, game.boss.y, game.ctx);
      return 'ok';
    },
    /** 模拟拾取，用于验收掉落物（护盾 / 生命 / 激光） */
    drop(type, x = 0, y = 4) {
      const p = game.pickups.spawn(type, x, y, { vy: -1.5 });
      return p ? p.type : null;
    },
    nextLevel() {
      game.startLevel((game.levelIndex + 1) % LEVELS.length);
      return game.levelIndex;
    },
    /** 验收用：暂停/恢复自机自动开火（满配 DPS 过高会把 BOSS 秒掉，看不到弹幕） */
    setFiring(v) {
      game.noAutoFire = !v;
      return !game.noAutoFire;
    },
    info() {
      return {
        state: game.state,
        level: game.levelIndex,
        levelT: +game.levelT.toFixed(1),
        score: game.score,
        fps: +game.fps.toFixed(1),
        enemies: game.enemies.count,
        pbul: game.pbul.count,
        ebul: game.ebul.count,
        particles: game.effects.count,
        lasers: game.lasers.beams.length,
        laserActive: game.lasers.active,
        shields: game.player.shields,
        lives: game.player.lives,
        hp: Math.round(game.player.hp),
        bombs: game.player.bombs,
        levels: { ...game.player.levels },
        dps: Math.round(game.player.dps),
        boss: game.boss.alive ? { hp: Math.round(game.boss.hp), max: Math.round(game.boss.maxHp), phase: game.boss.phase, dying: game.boss.dying } : null,
        quality: game.quality,
        drawCalls: game.drawCalls,
        triangles: game.triangles,
        programs: game.renderer.info.programs ? game.renderer.info.programs.length : -1,
      };
    },
  };
  /** skipToBoss 用的"波次已走完"时刻 —— 直接取 BOSS_AT，让 HUD 剩余时间与 BOSS 战窗口对上 */
  const BOSS_SKIP_T = BOSS_AT;
  window.dispatchEvent(new Event('strike-ready'));

  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ *
 * 主循环
 * ------------------------------------------------------------------ */
function loop(t) {
  requestAnimationFrame(loop);
  if (!lastT) lastT = t;
  let dt = (t - lastT) / 1000;
  lastT = t;
  if (dt > 0.1) dt = 0.1;
  if (dt <= 0) dt = 1 / 60;

  try {
    if (game.state === 'gameover' || game.state === 'victory') {
      if (!game._resultShown) {
        game._resultShown = true;
        game.hud.setPlaying(false);
        showResult(game.state);
      }
    }

    if (game.paused) {
      // 暂停时仍渲染（背景静止），但不推进逻辑
      game.audio.update();
      return;
    }

    if (game.state === 'menu' && input.consumeConfirm()) $('btn-start').click();

    game.update(dt);
    audio.update();
  } catch (err) {
    console.error(err);
    showError(String(err && err.stack ? err.stack : err));
    throw err;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

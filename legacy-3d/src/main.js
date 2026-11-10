/**
 * main.js — 引导 / 主循环 / 菜单交互
 */
import { DIFFICULTIES, LEVELS } from './config.js';
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
let started = false;

/* ------------------------------------------------------------------ */
function showError(msg) {
  const e = $('err');
  e.style.display = 'grid';
  e.innerHTML = `<div><h2>无法启动</h2><p style="margin-top:14px">${msg}</p>
    <p style="margin-top:14px;opacity:.6">请使用支持 WebGL2 的现代浏览器（Chrome / Edge / Firefox / Safari）。</p></div>`;
}

function bestScore(diffId) {
  try {
    return parseInt(localStorage.getItem('starstrike.best.' + diffId) || '0', 10) || 0;
  } catch (e) {
    return 0;
  }
}

/* ------------------------------------------------------------------ *
 * 菜单构建
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
        <span class="tag">盾值 ${d.playerHp}</span>
        <span class="tag">敌血 ×${d.enemyHpMul}</span>
        <span class="tag">弹速 ×${d.enemyBulletSpeedMul}</span>
        <span class="tag">积分 ×${d.scoreMul}</span>
      </div>`;
    el.onclick = () => {
      selDiff = d.id;
      audio.ui();
      buildMenus();
    };
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
    el.onclick = () => {
      selLevel = i;
      audio.ui();
      buildMenus();
    };
    lc.appendChild(el);
  });

  $('best-score').textContent = formatScore(bestScore(selDiff));
}

/* ------------------------------------------------------------------ *
 * 结果界面
 * ------------------------------------------------------------------ */
function showResult(kind) {
  const totalPower = game.player.levels.power + game.player.levels.spread + game.player.levels.missile
    + game.player.levels.drone + game.player.levels.shield;
  const win = kind === 'victory';
  $('res-title').textContent = win ? '任务完成' : '任务失败';
  $('res-title').style.background = win
    ? 'linear-gradient(100deg,#ffffff,#5fe8ff,#2fe6d0)'
    : 'linear-gradient(100deg,#ffffff,#ff4d9e,#ffb03b)';
  $('res-title').style.webkitBackgroundClip = 'text';
  $('res-sub').textContent = win ? 'ALL SECTORS CLEARED' : 'MISSION FAILED';
  $('res-score').textContent = formatScore(game.score);
  $('res-diff').textContent = game.diff.name;
  $('res-level').textContent = `${Math.min(3, game.levelIndex + 1)} / 3`;
  $('res-power').textContent = totalPower;
  $('res-best').textContent = formatScore(Math.max(bestScore(game.diff.id), game.score));
  $('result').classList.remove('hidden');
}

/** 把机体移出视野（保持可见以维持灯光数量恒定，避免着色器重编译卡顿） */
function parkPlayer() {
  game.player.group.position.set(0, -400, -6);
  game.player.vel.set(0, 0, 0);
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
function boot() {
  const canvas = $('gl');
  try {
    input = new Input(canvas);
    game = new Game(canvas, input, audio).init();
  } catch (err) {
    console.error(err);
    showError(String(err && err.message ? err.message : err));
    return;
  }
  game.onMenuShown = () => {
    $('result').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('menu').classList.remove('hidden');
    parkPlayer();
    buildMenus();
  };
  buildMenus();

  // 主菜单背景用第 1 关主题。
  // 注意：不能把机体设成 visible=false —— 机体挂了 PointLight，
  // 一旦从渲染列表消失，全场材质都会因灯光数量变化而重编译，造成明显卡顿。
  // 统一用 parkPlayer() 把它挪出视野，灯光数量保持恒定。
  game.state = 'menu';
  parkPlayer();

  let waiting = true;
  const begin = () => {
    audio.init();
    audio.resume();
    if (waiting) {
      waiting = false;
      game.player.group.position.set(0, -8, -6);
    }
  };
  window.addEventListener('pointerdown', begin);
  window.addEventListener('keydown', begin);
  window.addEventListener('touchstart', begin);

  $('btn-start').onclick = () => {
    begin();
    audio.ui();
    $('menu').classList.add('hidden');
    $('result').classList.add('hidden');
    game.startRun(selDiff);
    if (selLevel > 0) game.startLevel(selLevel);
    running = true;
  };

  $('btn-again').onclick = () => {
    audio.ui();
    $('result').classList.add('hidden');
    game.startRun(game.diff.id);
    running = true;
  };
  $('btn-menu').onclick = () => {
    audio.ui();
    $('result').classList.add('hidden');
    $('menu').classList.remove('hidden');
    game.toMenu();
    parkPlayer();
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
    game.startRun(game.diff.id);
  };
  $('btn-quit').onclick = () => {
    audio.ui();
    $('pause').classList.add('hidden');
    game.paused = false;
    $('menu').classList.remove('hidden');
    game.toMenu();
    parkPlayer();
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
  const bombBtn = $('touch-bomb');
  bombBtn?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (game.state === 'playing' && !game.paused) game.player.useBomb(game.makeCtx(0.016, true));
  }, { passive: false });
  const focusBtn = $('touch-focus');
  focusBtn?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    input.focus = true;
    focusBtn.style.opacity = '0.55';
  }, { passive: false });
  focusBtn?.addEventListener('touchend', () => {
    input.focus = false;
    focusBtn.style.opacity = '1';
  });

  /* 空格核弹 / 菜单确认 */
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && game.state === 'playing' && !game.paused) {
      e.preventDefault();
      game.player.useBomb(game.makeCtx(0.016, true));
    }
  });

  /* 调试 / 自动化验收句柄（不影响正常游玩） */
  window.__strike = {
    get game() { return game; },
    get input() { return input; },
    get audio() { return audio; },
    get ready() { return !!game; },
    step(dt) { game.update(dt); },
    startRun(diffId = 'normal', levelIndex = 0) {
      begin();
      $('menu').classList.add('hidden');
      $('result').classList.add('hidden');
      game.startRun(diffId);
      if (levelIndex > 0) game.startLevel(levelIndex);
      running = true;
      return game.state;
    },
    skipToBoss() {
      begin();
      $('menu').classList.add('hidden');
      $('result').classList.add('hidden');
      if (game.state === 'menu') game.startRun(selDiff);
      game.startLevel(game.levelIndex);
      game.state = 'playing';
      game.stateT = 0;
      game.postfx.params.warp = 0;
      game.scrollSpeed = 26;
      game.triggerBoss();
      game.bossWarnT = 0.2;
      running = true;
      return game.state;
    },
    /** 直接给自机加满各类强化，用于验证「无限增强」 */
    grant(type, n = 1) {
      for (let i = 0; i < n; i++) game.player.applyPowerup(type);
      return { ...game.player.levels, shields: game.player.shields, dps: Math.round(game.player.dps) };
    },
  };
  window.dispatchEvent(new Event('strike-ready'));

  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ *
 * 主循环
 * ------------------------------------------------------------------ */
function loop(t) {
  requestAnimationFrame(loop);
  if (!lastT) lastT = t;
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;

  try {
    /* --- 状态流转：结算界面 --- */
    if (game.state === 'gameover' || game.state === 'victory') {
      if (!game._resultShown) {
        game._resultShown = true;
        showResult(game.state);
      }
    } else {
      game._resultShown = false;
    }

    /* --- 菜单下的回车开始 --- */
    if (game.state === 'menu' && input.consumeConfirm()) {
      $('btn-start').click();
    }

    game.update(dt);
  } catch (err) {
    console.error(err);
    showError(String(err && err.stack ? err.stack : err));
    throw err;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

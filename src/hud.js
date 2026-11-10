/**
 * hud.js — DOM 抬头显示（竖版 9:16 布局）
 *
 * 从上到下的信息层级：
 *   关卡名 / 倒计时 / 关卡进度
 *   装甲条 + 护盾·机体·核弹 计数
 *   积分 + DPS/FPS
 *   （BOSS 血条在进入 BOSS 战时出现）
 *   底部：强化模块一览（含新增的「激光 L」「生命 ♥」）
 */
import { POWERUPS } from './config.js';
import { clamp, formatScore } from './util.js';

const $ = (id) => document.getElementById(id);

/** 底部强化模块的展示顺序 */
const ORDER = ['power', 'spread', 'missile', 'drone', 'laser', 'shield', 'repair', 'life', 'bomb'];

export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      level: $('hud-level'),
      levelCode: $('hud-level-code'),
      timer: $('hud-timer'),
      progress: $('hud-progress-fill'),
      hpFill: $('hud-hp-fill'),
      hpText: $('hud-hp-text'),
      shield: $('hud-shield'),
      lives: $('hud-lives'),
      bombs: $('hud-bombs'),
      score: $('hud-score'),
      combo: $('hud-combo'),
      dps: $('hud-dps'),
      fps: $('hud-fps'),
      bossWrap: $('boss-bar'),
      bossName: $('boss-name'),
      bossFill: $('boss-fill'),
      bossPhase: $('boss-phase'),
      banner: $('banner'),
      bannerText: $('banner-text'),
      bannerSub: $('banner-sub'),
      powers: $('hud-powers'),
      toasts: $('toasts'),
      lowhp: $('lowhp'),
    };
    this.powerEls = {};
    this.buildPowerRow();
    this._bannerTimer = 0;
    this._comboHide = 0;
    this._lastBossPhase = -1;
    this._toastIdx = 0;
  }

  buildPowerRow() {
    this.el.powers.innerHTML = '';
    for (const k of ORDER) {
      const def = POWERUPS[k];
      const d = document.createElement('div');
      d.className = 'pw lv0';
      d.style.setProperty('--c', '#' + def.color.toString(16).padStart(6, '0'));
      d.innerHTML = `<span class="pw-g">${def.glyph}</span><span class="pw-v">0</span>`;
      d.title = def.label;
      this.el.powers.appendChild(d);
      this.powerEls[k] = { v: d.querySelector('.pw-v'), root: d };
    }
  }

  setBoss(v) {
    this.el.bossWrap.classList.toggle('hidden', !v);
  }

  setPlaying(v) {
    this.root.classList.toggle('in-game', !!v);
  }

  showBanner(text, sub = '', dur = 2.2, cls = '') {
    this.el.bannerText.textContent = text;
    this.el.bannerSub.textContent = sub;
    this.el.banner.className = 'banner show ' + cls;
    this._bannerTimer = dur;
  }

  hideBanner() {
    this.el.banner.className = 'banner';
  }

  /** 底部飘字（拾取 / 事件） */
  toast(text, color) {
    const n = document.createElement('div');
    n.className = 'toast';
    if (color != null) n.style.color = '#' + (color >>> 0).toString(16).padStart(6, '0');
    n.textContent = text;
    const el = this.el.toasts;
    el.appendChild(n);
    while (el.children.length > 6) el.removeChild(el.firstChild);
    setTimeout(() => { n.classList.add('out'); }, 780);
    setTimeout(() => { n.parentNode && n.parentNode.removeChild(n); }, 1500);
  }

  update(dt, s) {
    /* 计时 / 进度 */
    this.el.level.textContent = s.levelName;
    this.el.levelCode.textContent = s.levelCode;
    const bossMode = s.bossActive;
    this.el.timer.textContent = s.timerText === '0:00' && bossMode ? 'BOSS' : s.timerText;
    this.el.timer.classList.toggle('boss', bossMode);
    this.el.progress.style.width = (s.progress * 100).toFixed(2) + '%';
    this.el.progress.classList.toggle('boss', bossMode);

    /* 装甲 */
    const frac = clamp(s.hp / s.maxHp, 0, 1);
    this.el.hpFill.style.width = (frac * 100).toFixed(1) + '%';
    this.el.hpFill.style.background = frac < 0.3
      ? 'linear-gradient(90deg,#ff2e56,#ff8a3d)'
      : frac < 0.6
        ? 'linear-gradient(90deg,#ffb03b,#ffe07a)'
        : 'linear-gradient(90deg,#2fe6d0,#7ff5ff)';
    this.el.hpText.textContent = `${Math.max(0, Math.ceil(s.hp))}`;
    this.el.lowhp.classList.toggle('on', frac < 0.3);

    this.el.shield.textContent = String(s.shields);
    this.el.shield.parentElement.classList.toggle('on', s.shields > 0);
    this.el.lives.textContent = String(Math.max(0, s.lives));
    this.el.bombs.textContent = String(s.bombs);
    this.el.bombs.parentElement.classList.toggle('on', s.bombs > 0);

    /* 积分 / 性能 */
    this.el.score.textContent = formatScore(s.score);
    this.el.dps.textContent = Math.round(s.dps);
    if (this.el.fps) this.el.fps.textContent = Math.round(s.fps || 0);

    if (s.combo > 0) {
      this.el.combo.textContent = `连击 ×${(1 + s.combo * 0.12).toFixed(2)}`;
      this.el.combo.classList.add('show');
      this._comboHide = 0.7;
    } else {
      this._comboHide = Math.max(0, this._comboHide - dt);
      if (this._comboHide <= 0) this.el.combo.classList.remove('show');
    }

    /* 强化等级 */
    for (const k in this.powerEls) {
      const v = s.levels[k] ?? 0;
      const P = this.powerEls[k];
      if (P.v.textContent !== String(v)) P.v.textContent = String(v);
      P.root.classList.toggle('lv0', v === 0);
    }

    /* BOSS */
    if (bossMode) {
      this.el.bossWrap.classList.remove('hidden');
      this.el.bossName.textContent = s.bossName;
      const w = clamp(s.bossHpFrac, 0, 1) * 100;
      this.el.bossFill.style.width = bossMode && !s.bossActive ? '0%' : w.toFixed(2) + '%';
      this.el.bossPhase.textContent = s.bossPhase > 0 ? `阶段 ${s.bossPhase + 1} · 狂暴` : '阶段 1';
      this.el.bossWrap.classList.toggle('enrage', s.bossPhase > 0);
      this._lastBossPhase = s.bossPhase;
    } else {
      this.el.bossWrap.classList.add('hidden');
    }

    /* 横幅 */
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) this.hideBanner();
    }
  }
}

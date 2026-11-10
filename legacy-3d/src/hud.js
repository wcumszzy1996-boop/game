/**
 * hud.js — DOM 抬头显示
 */
import { POWERUPS } from './config.js';
import { clamp, formatScore } from './util.js';

const $ = (id) => document.getElementById(id);

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
      bossWrap: $('boss-bar'),
      bossName: $('boss-name'),
      bossFill: $('boss-fill'),
      bossPhase: $('boss-phase'),
      banner: $('banner'),
      bannerText: $('banner-text'),
      bannerSub: $('banner-sub'),
      fps: $('hud-fps'),
      powers: $('hud-powers'),
    };
    this.powerEls = {};
    this.buildPowerRow();
    this._bannerTimer = 0;
    this._comboHide = 0;
  }

  buildPowerRow() {
    const order = ['power', 'spread', 'missile', 'drone', 'shield', 'bomb'];
    this.el.powers.innerHTML = '';
    for (const k of order) {
      const def = POWERUPS[k];
      const d = document.createElement('div');
      d.className = 'pw';
      d.style.setProperty('--c', '#' + def.color.toString(16).padStart(6, '0'));
      d.innerHTML = `<span class="pw-g">${def.glyph}</span><span class="pw-v">0</span><span class="pw-l">${def.label}</span>`;
      this.el.powers.appendChild(d);
      this.powerEls[k] = d.querySelector('.pw-v');
    }
  }

  setVisible(v) {
    this.el.bossWrap.classList.toggle('hidden', !v);
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

  update(dt, s) {
    /* 计时 / 进度 */
    this.el.level.textContent = s.levelName;
    this.el.levelCode.textContent = s.levelCode;
    this.el.timer.textContent = s.timerText;
    this.el.progress.style.width = (s.progress * 100).toFixed(1) + '%';
    this.el.progress.classList.toggle('boss', s.bossActive);

    /* 生命 */
    const hpFrac = clamp(s.hp / s.maxHp, 0, 1);
    this.el.hpFill.style.width = (hpFrac * 100).toFixed(1) + '%';
    this.el.hpFill.style.background = hpFrac < 0.3
      ? 'linear-gradient(90deg,#ff3b5c,#ff8a3d)'
      : hpFrac < 0.6
        ? 'linear-gradient(90deg,#ffb03b,#ffe07a)'
        : 'linear-gradient(90deg,#2fe6d0,#7ff5ff)';
    this.el.hpText.textContent = `${Math.max(0, Math.ceil(s.hp))} / ${s.maxHp}`;
    this.el.shield.textContent = '×' + s.shields;
    this.el.shield.parentElement.classList.toggle('active', s.shields > 0);
    this.el.lives.textContent = '×' + Math.max(0, s.lives);
    this.el.bombs.textContent = '×' + s.bombs;
    this.el.bombs.parentElement.classList.toggle('active', s.bombs > 0);

    /* 分数 / 连击 */
    this.el.score.textContent = formatScore(s.score);
    this.el.dps.textContent = Math.round(s.dps);
    if (this.el.fps) this.el.fps.textContent = Math.round(s.fps || 0);
    if (s.combo > 1) {
      this.el.combo.textContent = `×${(1 + s.combo * 0.12).toFixed(2)} 连击 ${s.combo}`;
      this.el.combo.classList.add('show');
      this._comboHide = 0.6;
    } else {
      this._comboHide = Math.max(0, this._comboHide - dt);
      if (this._comboHide <= 0) this.el.combo.classList.remove('show');
    }

    /* 强化等级 */
    for (const k in this.powerEls) {
      const v = s.levels[k] ?? 0;
      if (this.powerEls[k].textContent !== String(v)) this.powerEls[k].textContent = String(v);
      this.powerEls[k].parentElement.classList.toggle('lv0', v === 0);
    }

    /* BOSS */
    if (s.bossActive) {
      this.el.bossWrap.classList.remove('hidden');
      this.el.bossName.textContent = s.bossName;
      this.el.bossFill.style.width = (s.bossHpFrac * 100).toFixed(2) + '%';
      this.el.bossPhase.textContent = s.bossPhase > 0 ? `阶段 ${s.bossPhase + 1}` : '';
      this.el.bossWrap.classList.toggle('enrage', s.bossPhase > 0);
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

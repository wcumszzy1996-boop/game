/**
 * levels.js — 关卡波次编排
 *
 * 每关 160 秒，波次阶段到 1:58 (118s) 结束，随后 BOSS 登场（仍为 42 秒战斗窗口）。
 * 波次由「阶段表」驱动：不同时间段启用不同的敌机池 / 编队 / 运动模式，
 * 用固定种子随机，保证同一关的节奏可复现（便于调参与验收）。
 *
 * 时长由 180s 缩短 20s 后，下列时刻全部按 118/138 的同一比例前移，
 * 因此各阶段的**节奏比重**与旧版完全一致：
 *   阶段分界   28 / 56 / 88 / 114  →  24 / 48 / 75 / 98
 *   特殊事件   94 / 66 / 60 / 130  →  80 / 56 / 51 / 111
 *
 * 保底掉落：
 *   t=1.2s  护盾  —— 开局先给一层护盾，容错起步
 *   t=111s  修复  —— BOSS 前补血
 *   BOSS 击破 生命 —— 由 game 在击破时投放（见 config.GUARANTEED_DROPS）
 */
import { LEVELS, BOSS_AT, LEVEL_DURATION } from './config.js';
import { ENEMY_TYPES } from './enemies.js';
import { mulberry32 } from './util.js';

/** 阶段表：每个阶段启用哪些敌机 / 编队 / 运动 */
const PHASES = [
  {
    name: '侦察',
    until: 24,
    types: ['scout', 'scout', 'drone'],
    formations: ['line', 'v', 'stream'],
    moves: ['straight', 'sine'],
    interval: 4.5,
    count: [4, 6],
  },
  {
    name: '遭遇',
    until: 48,
    types: ['scout', 'fighter', 'fighter', 'drone'],
    formations: ['v', 'arc', 'stream', 'line'],
    moves: ['straight', 'swoop', 'sine'],
    interval: 4.0,
    count: [4, 7],
  },
  {
    name: '压制',
    until: 75,
    types: ['fighter', 'turret', 'gunship', 'drone'],
    formations: ['line', 'arc', 'column', 'stream'],
    moves: ['straight', 'hover', 'drift', 'swoop'],
    interval: 3.6,
    count: [3, 6],
  },
  {
    name: '强袭',
    until: 98,
    types: ['gunship', 'bomber', 'elite', 'fighter'],
    formations: ['line', 'v', 'arc', 'stream'],
    moves: ['hover', 'straight', 'swoop', 'sine'],
    interval: 3.3,
    count: [3, 5],
  },
  {
    name: '狂潮',
    until: BOSS_AT,
    types: ['elite', 'fighter', 'drone', 'bomber', 'gunship'],
    formations: ['stream', 'arc', 'v', 'line'],
    moves: ['swoop', 'sine', 'kamikaze', 'straight'],
    interval: 2.7,
    count: [4, 8],
  },
];

/** 每关的个性化配置 */
const LEVEL_TUNING = [
  { density: 1.00, bias: { turret: 0.6, drone: 1.0, elite: 0.9 } },   // 星云边境：温和
  { density: 1.10, bias: { drone: 1.7, gunship: 1.2, bomber: 1.15 } }, // 陨石带：无人机与重甲多
  { density: 1.22, bias: { elite: 1.6, turret: 1.3, bomber: 1.2 } },   // 母舰核心：精英为主
];

/** 特定时刻的"重点事件"（时刻已按 118/138 比例前移） */
function specialEvents(levelIndex, out) {
  // 开局保底护盾
  out.push({ t: 1.2, drop: 'shield', dropX: 0 });
  // 中期重装小队
  out.push({
    t: 80,
    banner: { text: '重装编队', sub: 'HEAVY SQUADRON INBOUND', cls: 'warn', dur: 2.0 },
    spawn: [
      { type: 'gunship', x: -5.4, y: 18.6, move: 'hover', patrolY: 5.0, speed: 3.4, hpMul: 1.5, fireOffset: 0.9 },
      { type: 'gunship', x: 0, y: 19.6, move: 'hover', patrolY: 7.2, speed: 3.4, hpMul: 1.5, fireOffset: 1.15 },
      { type: 'gunship', x: 5.4, y: 18.6, move: 'hover', patrolY: 5.0, speed: 3.4, hpMul: 1.5, fireOffset: 0.9 },
    ],
  });
  // 陨石带：密集无人机突袭
  if (levelIndex === 1) {
    out.push({
      t: 56,
      banner: { text: '无人机 swarm', sub: 'DRONE SWARM', cls: 'warn', dur: 1.8 },
      spawn: [
        { type: 'drone', x: -6, y: 19, move: 'kamikaze', speed: 6.4 },
        { type: 'drone', x: -3, y: 19.6, move: 'kamikaze', speed: 6.4 },
        { type: 'drone', x: 0, y: 20.2, move: 'kamikaze', speed: 6.4 },
        { type: 'drone', x: 3, y: 19.6, move: 'kamikaze', speed: 6.4 },
        { type: 'drone', x: 6, y: 19, move: 'kamikaze', speed: 6.4 },
      ],
    });
  }
  // 母舰核心：精英双机
  if (levelIndex === 2) {
    out.push({
      t: 51,
      banner: { text: '精英截击机', sub: 'ACE INTERCEPTORS', cls: 'warn', dur: 1.8 },
      spawn: [
        { type: 'elite', x: -4.2, y: 18.6, move: 'swoop', speed: 4.6, bulletSpeedMul: 1.1 },
        { type: 'elite', x: 4.2, y: 18.6, move: 'swoop', speed: 4.6, bulletSpeedMul: 1.1, dir: -1 },
      ],
    });
  }
  // BOSS 前补血
  out.push({ t: 111, drop: 'repair', dropX: 0 });
}

/**
 * 生成一关的完整事件表
 * @param {number} levelIndex 0..2
 * @returns {Array<object>} 按 t 升序
 */
export function buildWaves(levelIndex) {
  const idx = levelIndex % LEVELS.length;
  const tune = LEVEL_TUNING[idx];
  const rng = mulberry32(90210 + idx * 7717);
  const pickFrom = (arr) => arr[(rng() * arr.length) | 0];
  const out = [];

  for (const P of PHASES) {
    const from = out.length ? out[out.length - 1].t + 0.1 : 3.0;
    let t = from;
    while (t < P.until) {
      const interval = P.interval / (tune.density * (0.9 + rng() * 0.25));
      // 按 bias 加权挑选敌机
      let type = pickFrom(P.types);
      if (tune.bias[type]) {
        const roll = rng();
        if (roll > 1 / (tune.bias[type] || 1)) type = pickFrom(P.types);
        else if (roll < 0.22) type = Object.keys(tune.bias)[(rng() * Object.keys(tune.bias).length) | 0];
      }
      if (!ENEMY_TYPES[type]) type = 'scout';
      const form = pickFrom(P.formations);
      const n = Math.round(P.count[0] + rng() * (P.count[1] - P.count[0]));
      const move = pickFrom(P.moves);
      const crowd = tune.density;

      const spawn = [];
      const cx = (rng() * 2 - 1) * 4.0;
      const gap = type === 'bomber' ? 2.9 : type === 'gunship' ? 2.5 : 1.85;
      const y0 = 18.6;

      for (let i = 0; i < n; i++) {
        let x = cx, y = y0;
        switch (form) {
          case 'line': x = cx + (i - (n - 1) / 2) * gap; break;
          case 'column': x = cx; y = y0 + i * 2.1; break;
          case 'v': {
            const k = i - (n - 1) / 2;
            x = cx + k * gap; y = y0 + Math.abs(k) * gap * 0.62;
            break;
          }
          case 'arc': {
            const u = n === 1 ? 0.5 : i / (n - 1);
            const a = Math.PI * (0.20 + u * 0.60);
            x = Math.cos(a) * 8.4; y = y0 + Math.sin(a) * 3.2;
            break;
          }
          case 'stream': default:
            x = (rng() * 2 - 1) * 7.0; y = y0 + rng() * 3.6;
            break;
        }
        x = Math.max(-8.0, Math.min(8.0, x));
        const base = { type, x, y, move };
        if (move === 'straight' || move === 'sine') base.speed = type === 'drone' ? 6.0 : 3.9 + rng() * 1.6;
        if (move === 'hover') { base.patrolY = 3.0 + rng() * 5.5; base.speed = 3.6; }
        if (move === 'swoop') { base.speed = 4.2; base.dir = rng() < 0.5 ? -1 : 1; }
        if (move === 'kamikaze') base.speed = 5.6 + rng() * 1.6;
        if (move === 'drift') { base.speed = 3.4; base.amp = 2.2 + rng() * 1.6; }
        if (type === 'elite' || type === 'turret') base.fireOffset = 0.8 + rng() * 0.6;
        spawn.push(base);
      }

      out.push({ t, spawn, phase: P.name });

      // 偶尔插一段密集无人机
      if (rng() < 0.16 * crowd && t > 20) {
        const d = [];
        for (let i = 0; i < 4 + Math.round(rng() * 3); i++) {
          d.push({
            type: 'drone', x: -6 + rng() * 12, y: 19 + rng() * 3.5,
            move: rng() < 0.45 ? 'kamikaze' : 'straight',
            speed: 5.4 + rng() * 1.8,
          });
        }
        out.push({ t: t + 0.9, spawn: d, phase: P.name });
      }

      t += Math.max(1.7, interval);
    }
  }

  specialEvents(idx, out);
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** 关卡元信息 */
export function levelInfo(index) {
  const L = LEVELS[index % LEVELS.length];
  return { ...L, duration: LEVEL_DURATION, bossAt: BOSS_AT };
}

export { PHASES, LEVEL_DURATION, BOSS_AT };

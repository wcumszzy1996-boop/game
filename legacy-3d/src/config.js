/**
 * config.js — 全局平衡参数 / 难度表 / 关卡定义 / 配色
 * 所有数值集中在此，便于调参。
 */

/* ------------------------------------------------------------------ *
 * 难度
 * ------------------------------------------------------------------ */
export const DIFFICULTIES = {
  normal: {
    id: 'normal',
    name: '普通',
    sub: 'STANDARD FLIGHT',
    desc: '标准弹幕密度，容错较高，适合首次出击的飞行员。',
    playerLives: 4,          // 初始机体数（含当前机）
    playerHp: 100,           // 护盾值
    shieldDecay: 0,          // 每秒衰减
    enemyHpMul: 1.0,
    enemyFireMul: 1.0,       // 开火间隔倍率（越小越快）
    enemyBulletSpeedMul: 1.0,
    spawnMul: 1.0,           // 敌机数量倍率
    scoreMul: 1.0,
    dropMul: 1.0,
    bossHpMul: 1.0,
    ramDamage: 22,
    invulnTime: 2.6,
    autoRepair: 0,           // 每关开始恢复的护盾
  },
  elite: {
    id: 'elite',
    name: '精英',
    sub: 'ACE COMBAT',
    desc: '弹速更快、编队更密、BOSS 血更厚，通关者可获 1.8× 积分。',
    playerLives: 3,
    playerHp: 80,
    shieldDecay: 0,
    enemyHpMul: 1.75,
    enemyFireMul: 0.72,
    enemyBulletSpeedMul: 1.32,
    spawnMul: 1.45,
    scoreMul: 1.8,
    dropMul: 1.15,
    bossHpMul: 1.9,
    ramDamage: 30,
    invulnTime: 2.2,
    autoRepair: 0,
  },
};

/* ------------------------------------------------------------------ *
 * 玩家武器 / 无限强化
 * ------------------------------------------------------------------ */
export const WEAPON = {
  baseInterval: 0.135,     // 主炮发射间隔（秒）
  minInterval: 0.068,      // 射速上限
  intervalPerPower: 0.0040,
  baseDamage: 9,
  damageScalePerPower: 0.16,  // 单发伤害 = base * (1 + 0.16*(power-1))
  barrelsPerTwoPower: 2,      // 每 2 级火力 +1 门炮（避免与伤害双重线性叠加）
  bulletSpeed: 118,
  maxVisualBarrels: 7,     // 超过后不再增加炮口，只提升伤害
  missileInterval: 0.62,
  missileDamage: 46,
  droneOrbitR: 3.4,
  droneFireInterval: 0.42,
  droneDamage: 7,
  /** BOSS 战超过此时长后，伤害递增（防止僵持） */
  bossRushStart: 46,
  bossRushRate: 0.05,
};

/** 道具类型定义（全部可无限叠加） */
export const POWERUPS = {
  power: { id: 'power', label: '火力', color: 0xffb020, glyph: 'P', stack: true },
  spread: { id: 'spread', label: '散射', color: 0x40e0ff, glyph: 'S', stack: true },
  missile: { id: 'missile', label: '导弹', color: 0xff4d6d, glyph: 'M', stack: true },
  drone: { id: 'drone', label: '僚机', color: 0x9d6bff, glyph: 'D', stack: true },
  shield: { id: 'shield', label: '护盾', color: 0x4dffa0, glyph: 'H', stack: true },
  bomb: { id: 'bomb', label: '核弹', color: 0xfff0a0, glyph: 'B', stack: true },
  repair: { id: 'repair', label: '修复', color: 0x66ff66, glyph: '+', stack: true },
  score: { id: 'score', label: '勋章', color: 0xffd76a, glyph: '★', stack: false },
};

/* ------------------------------------------------------------------ *
 * 关卡定义 —— 每关设计时长 180 秒（3 分钟）
 * ------------------------------------------------------------------ */
export const LEVEL_DURATION = 180;
export const BOSS_AT = 138;   // 波次阶段持续到 2:18，随后 BOSS 登场

export const LEVELS = [
  {
    id: 0,
    name: '星云边境',
    code: 'SECTOR 01 · VESPER NEBULA',
    brief: '穿越紫红色星云，摧毁边境哨戒舰队与其旗舰。',
    duration: LEVEL_DURATION,
    bossAt: BOSS_AT,
    boss: 'vesper',
    bossName: '蜂巢驱逐舰「VESPER」',
    palette: {
      nebulaA: '#3a1d6e', nebulaB: '#8e2d7a', nebulaC: '#1b6a8f',
      fog: 0x1a0f2e, ambient: 0x5566aa, key: 0xffc9e8, rim: 0x6fd8ff,
      starTint: 0xffffff, accent: 0xff5fa2, backdrop: 0x150a26,
    },
    music: { root: 55, scale: [0, 3, 5, 7, 10], bpm: 138 },
  },
  {
    id: 1,
    name: '陨石带',
    code: 'SECTOR 02 · KESSLER BELT',
    brief: '在高速岩屑带中穿行，敌方的双子战列舰已然就位。',
    duration: LEVEL_DURATION,
    bossAt: BOSS_AT,
    boss: 'castor',
    bossName: '双子战列舰「CASTOR / POLLUX」',
    palette: {
      nebulaA: '#5a2a12', nebulaB: '#a05a18', nebulaC: '#2b4a6b',
      fog: 0x2a1608, ambient: 0xaa8855, key: 0xffd9a0, rim: 0xff9b40,
      starTint: 0xffe9c8, accent: 0xffa22e, backdrop: 0x1a0f06,
    },
    music: { root: 49, scale: [0, 2, 3, 7, 9], bpm: 146 },
  },
  {
    id: 2,
    name: '母舰核心',
    code: 'SECTOR 03 · MOTHERSHIP CORE',
    brief: '突入敌方母舰内部，终结星核泰坦的动力炉。',
    duration: LEVEL_DURATION,
    bossAt: BOSS_AT,
    boss: 'nova',
    bossName: '星核泰坦「NOVA CORE」',
    palette: {
      nebulaA: '#0d3a44', nebulaB: '#166b6b', nebulaC: '#4a1f5e',
      fog: 0x04191f, ambient: 0x66aabb, key: 0xa8f4ff, rim: 0x35ffd6,
      starTint: 0xd8ffff, accent: 0x2fe6d0, backdrop: 0x03131a,
    },
    music: { root: 46, scale: [0, 2, 5, 7, 8], bpm: 156 },
  },
];

/* ------------------------------------------------------------------ *
 * 世界 / 相机
 * ------------------------------------------------------------------ */
export const WORLD = {
  camPos: [0, 11.5, 31],
  camLookAt: [0, 0, -4],
  fov: 45,
  minHalfWidth: 13.0,     // 竖屏时保证的最小战场半宽
  playerZ: 0,
  spawnZ: 0,
  entryMargin: 3.2,       // 敌机从屏幕外进入的余量
  sceneDepth: 7.0,        // 单位沿视线方向的最大前后错落
};

export const SCORE = {
  comboWindow: 2.2,
  comboMax: 8,
  perCombo: 0.12,
  hitScore: 1,
  killScore: 10,
};

/** 品质档位：用于自动降画质 */
export const QUALITY = {
  low: { bloomScale: 0.35, maxParticles: 1400, shadows: false, pixelRatio: 1.0 },
  mid: { bloomScale: 0.5, maxParticles: 2600, shadows: false, pixelRatio: 1.35 },
  high: { bloomScale: 0.5, maxParticles: 4200, shadows: false, pixelRatio: 1.75 },
};

/**
 * config.js — 全局平衡参数 / 难度表 / 关卡定义 / 配色
 *
 * 《星锋突击 STARSTRIKE 2D》 为竖版（9:16）纯 2D 卷轴射击。
 * 世界坐标：正交相机，x ∈ [-VIEW_W/2, VIEW_W/2]，y ∈ [-VIEW_H/2, VIEW_H/2]。
 * 自机在下方（y 小），敌机自上方（y 大）进入。
 * 所有数值集中在此，便于调参。
 */

/* ------------------------------------------------------------------ *
 * 世界 / 相机（正交竖版）
 * ------------------------------------------------------------------ */
export const WORLD = {
  /** 可见宽度（世界单位）—— 固定宽度保证弹幕密度在任何分辨率下一致 */
  VIEW_W: 18,
  /** 可见高度 —— 18 / 32 = 0.5625 = 9:16 竖版 */
  VIEW_H: 32,
  /** 战场左右边界（自机可达范围） */
  boundX: 8.10,
  /** 战场上下边界 */
  boundY: 15.10,
  /** 自机起始 y */
  playerY: -12.40,
  /** 敌机自此处进入 */
  spawnY: 18.4,
  /** 出界回收余量 */
  cullMargin: 3.2,
  /** 相机 z（正交，仅用于深度排序） */
  camZ: 60,
};

/* ------------------------------------------------------------------ *
 * 陨石带（第 2 关）—— 会撞击自机、也可被击破的实体障碍
 *
 * 双向互动：
 *   · 撞上自机  → 消耗装甲值（可被护盾抵挡、受无敌帧保护），陨石自身碎裂重生
 *   · 被自机打  → 子弹与激光都会累积伤害，打空生命值即炸开，有积分与掉落
 *
 * 视觉尺寸与判定半径分开：贴图轮廓不规则且边缘带透明，撞击判定取小一些手感更宽容，
 * 而**可被射击的判定略大**（shootScale > hitScale），让"想打碎它"比"躲开它"更容易命中。
 * ------------------------------------------------------------------ */
export const ASTEROID = {
  /** 场上同时存在的陨石数量 */
  count: 13,
  /** 视觉尺寸范围（世界单位） */
  sizeMin: 0.55,
  sizeMax: 2.40,
  /** 撞击自机的判定半径 = 视觉尺寸 × 此系数 */
  hitScale: 0.42,
  /** 被射击的判定半径 = 视觉尺寸 × 此系数（比撞击判定宽容，方便打断） */
  shootScale: 1.15,
  /** 撞击伤害 = damageBase + 视觉尺寸 × damagePerSize */
  damageBase: 12,
  damagePerSize: 7,
  /** 撞击后陨石碎裂并回到上方重生（false = 不碎，会持续存在） */
  shatter: true,
  /** 撞击时的额外屏震 */
  shake: 0.34,

  /* --- 可击破 --- */
  /** 生命值 = hpBase + 视觉尺寸 × hpPerSize（越大的石头越耐打） */
  hpBase: 30,
  hpPerSize: 42,
  /** 击破后的重生等待（秒）—— 期间不可见、不可碰撞 */
  respawnDelay: 1.15,
  /** 击破得分（再乘难度 scoreMul） */
  score: 25,
  /** 击破掉落概率（再乘难度 dropMul） */
  drop: 0.10,
  /** 被命中时的闪白亮度 */
  hitFlash: 0.85,
};

/* ------------------------------------------------------------------ *
 * 难度
 * ------------------------------------------------------------------ */
export const DIFFICULTIES = {
  normal: {
    id: 'normal',
    name: '普通',
    sub: 'STANDARD FLIGHT',
    desc: '标准弹幕密度，敌机开火节奏舒缓，容错较高。',
    playerLives: 4,          // 初始机体数（含当前机）
    playerHp: 100,           // 装甲值
    shieldDecay: 0,          // 每秒衰减
    enemyHpMul: 1.0,
    /** 敌机开火间隔倍率 —— 越大越慢（本次已整体下调开火频率） */
    enemyFireMul: 1.24,
    enemyBulletSpeedMul: 1.0,
    spawnMul: 1.0,           // 敌机数量倍率
    scoreMul: 1.0,
    dropMul: 1.0,
    bossHpMul: 1.0,
    ramDamage: 32,
    invulnTime: 2.8,
    autoRepair: 0,           // 每关开始恢复的装甲
  },
  elite: {
    id: 'elite',
    name: '精英',
    sub: 'ACE COMBAT',
    desc: '弹速更快、编队更密、BOSS 装甲更厚，通关者可获 1.8× 积分。',
    playerLives: 3,
    playerHp: 80,
    shieldDecay: 0,
    enemyHpMul: 1.75,
    enemyFireMul: 0.92,      // 相对普通更快一点，但仍明显慢于旧版
    enemyBulletSpeedMul: 1.28,
    spawnMul: 1.45,
    scoreMul: 1.8,
    dropMul: 1.15,
    bossHpMul: 1.9,
    ramDamage: 44,
    invulnTime: 2.4,
    autoRepair: 0,
  },
};

/** 敌机开火间隔的全局保险系数（在难度倍率之上再乘一次，纯手感微调） */
export const ENEMY_FIRE_SAFETY = 1.15;

/* ------------------------------------------------------------------ *
 * 玩家武器 / 无限强化
 * ------------------------------------------------------------------ */
export const WEAPON = {
  /* --- 主炮 --- */
  baseInterval: 0.108,        // 主炮发射间隔（秒）
  minInterval: 0.052,         // 射速上限
  intervalPerPower: 0.0032,
  baseDamage: 8,
  damageScalePerPower: 0.16,  // 单发伤害 = base * (1 + 0.16*(power-1))
  barrelsPerTwoPower: 2,      // 每 2 级火力 +1 门炮
  maxVisualBarrels: 7,        // 超过后不再增加炮口，只提升伤害
  bulletSpeed: 46,
  bulletRadius: 0.26,
  spawnOffset: 0.72,          // 炮口相对机体的横向偏移

  /* --- 散射 --- */
  spreadAngle: 0.19,          // 每级增加的分叉角（弧度）
  spreadMaxAngle: 0.82,

  /* --- 导弹 --- */
  missileInterval: 0.52,
  missileDamage: 40,
  missileTurn: 5.2,
  missileSpeed: 30,

  /* --- 僚机 --- */
  droneOrbitR: 2.05,
  droneFireInterval: 0.34,
  droneDamage: 6,

  /* --- 激光（新增武器）--- */
  laser: {
    /** 每 N 级激光新增一道光束 */
    stacksPerBeam: 3,
    maxBeams: 5,
    /** 单道光束基础 DPS / 每级增量 */
    dpsBase: 30,
    dpsPerStack: 15,
    /**
     * 光束宽度随叠加上升（世界单位）。
     * 刻意收窄：宽度决定「覆盖面积」，过宽会让多道光束在自机附近叠加成一片死白，
     * 反而看不清机体与弹道；亮度则交给 HDR 倍率与 Bloom 去表现。
     */
    widthBase: 0.34,
    widthPerStack: 0.062,
    widthMax: 1.42,
    /** 视觉长度（超出屏幕即可） */
    length: 40,
    /** 命中判定：沿光束逐帧做圆-矩形检测，命中间隔（秒）——越小越连续 */
    tickInterval: 0.05,
    /** 连射时每级激光额外提供的"灼烧"衰减伤害（对 BOSS 的持续输出） */
    burnMul: 1.0,
  },

  /** BOSS 战超过此时长后，伤害递增（防止僵持） */
  bossRushStart: 46,
  bossRushRate: 0.05,
};

/**
 * 「增强类」强化的叠加上限（本轮新增）。
 *
 * 火力 / 散射 / 导弹 / 僚机 / 激光 这 5 项是**武器强化**，各自最高 5 级；
 * 拾取至满级后再吃到同类道具只会给出"已满级"提示，不再提升数值。
 * 护盾 / 核弹 / 生命属于消耗品（层数即存量），不受此上限约束。
 */
export const POWERUP_MAX_LEVEL = 5;

/**
 * 道具类型定义
 * - maxLevel：该项强化的叠加上限（缺省 = 无上限）
 */
export const POWERUPS = {
  power:   { id: 'power',   label: '火力', color: 0xffb020, glyph: 'P', stack: true, weight: 22, maxLevel: POWERUP_MAX_LEVEL },
  spread:  { id: 'spread',  label: '散射', color: 0x40e0ff, glyph: 'S', stack: true, weight: 13, maxLevel: POWERUP_MAX_LEVEL },
  missile: { id: 'missile', label: '导弹', color: 0xff4d6d, glyph: 'M', stack: true, weight: 12, maxLevel: POWERUP_MAX_LEVEL },
  drone:   { id: 'drone',   label: '僚机', color: 0x9d6bff, glyph: 'D', stack: true, weight: 10, maxLevel: POWERUP_MAX_LEVEL },
  laser:   { id: 'laser',   label: '激光', color: 0x35ffc8, glyph: 'L', stack: true, weight: 14, maxLevel: POWERUP_MAX_LEVEL },
  shield:  { id: 'shield',  label: '护盾', color: 0x4dffa0, glyph: 'H', stack: true, weight: 12 },
  repair:  { id: 'repair',  label: '修复', color: 0x66ff66, glyph: '+', stack: true, weight: 10 },
  life:    { id: 'life',    label: '生命', color: 0xff6ad5, glyph: '♥', stack: true, weight: 3  },
  bomb:    { id: 'bomb',    label: '核弹', color: 0xfff0a0, glyph: 'B', stack: true, weight: 4  },
  score:   { id: 'score',   label: '勋章', color: 0xffd76a, glyph: '★', stack: false, weight: 0 },
};

/** 哪些道具是"武器强化"（用于 HUD 显示满级状态 / 文案） */
export const UPGRADE_KEYS = ['power', 'spread', 'missile', 'drone', 'laser'];

/** 护盾/生命额外保底：每关 BOSS 前与 BOSS 后各送一次 */
export const GUARANTEED_DROPS = {
  perLevelStart: 'shield',
  beforeBoss: 'repair',
  afterBoss: 'life',
};

/* ------------------------------------------------------------------ *
 * 关卡定义 —— 每关设计时长 160 秒（2 分 40 秒）
 *
 * BOSS 登场时间同步前移，因此 BOSS 战窗口仍为 42 秒（160 - 118）。
 * levels.js 的波次阶段分界与特殊事件时刻都已按同一比例重排。
 *
 * enemyFireMul（本轮新增）：**关卡级**的敌机开火间隔倍率，越大越慢。
 * 第 1 关作为教学关，射速额外削弱 20%（间隔 ×1.25）—— 与难度倍率、全局保险
 * 系数相乘后生效，因此第 1 关的弹幕会明显比后两关舒缓。
 * ------------------------------------------------------------------ */
export const LEVEL_DURATION = 160;
export const BOSS_AT = 118;   // 波次阶段持续到 1:58，随后 BOSS 登场

export const LEVELS = [
  {
    id: 0,
    name: '星云边境',
    code: 'SECTOR 01 · VESPER NEBULA',
    brief: '穿越紫红星云，摧毁边境哨戒舰队与其旗舰。',
    duration: LEVEL_DURATION,
    bossAt: BOSS_AT,
    boss: 'vesper',
    bossName: '蜂巢驱逐舰「VESPER」',
    /** 关卡级敌机开火间隔倍率（1.25 = 射速削弱 20%） */
    enemyFireMul: 1.25,
    /** 2D 配色：星云/星点/雾/装饰光 */
    palette: {
      sky0: '#120a26', sky1: '#2a1148', sky2: '#06121f',
      nebulaA: 'rgba(150,60,190,0.55)', nebulaB: 'rgba(220,60,140,0.42)', nebulaC: 'rgba(50,130,210,0.38)',
      starTint: 0xffffff, starWarm: 0xffd8f0, starCool: 0x9fd8ff,
      accent: 0xff5fa2, accent2: 0x6fd8ff, hazard: 0xff4d6b,
      flashTint: 0xffd9f2,
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
    enemyFireMul: 1.0,
    palette: {
      sky0: '#1c0f06', sky1: '#3d2208', sky2: '#0d1420',
      nebulaA: 'rgba(210,120,40,0.50)', nebulaB: 'rgba(240,180,70,0.36)', nebulaC: 'rgba(80,110,180,0.34)',
      starTint: 0xffe9c8, starWarm: 0xffcf8a, starCool: 0xc8dcff,
      accent: 0xffa22e, accent2: 0xffd98a, hazard: 0xff6a2e,
      flashTint: 0xffe6c2,
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
    enemyFireMul: 1.0,
    palette: {
      sky0: '#03161c', sky1: '#0b3b42', sky2: '#1a0c33',
      nebulaA: 'rgba(40,190,190,0.48)', nebulaB: 'rgba(120,60,200,0.40)', nebulaC: 'rgba(60,240,210,0.30)',
      starTint: 0xd8ffff, starWarm: 0xa8fff0, starCool: 0x8fb8ff,
      accent: 0x2fe6d0, accent2: 0x7ff5ff, hazard: 0xff3d8a,
      flashTint: 0xd6fff8,
    },
    music: { root: 46, scale: [0, 2, 5, 7, 8], bpm: 156 },
  },
];

/* ------------------------------------------------------------------ *
 * 渲染层（正交相机下用 renderOrder 保证稳定的前后关系）
 * ------------------------------------------------------------------ */
export const LAYER = {
  sky: -110,
  nebulaFar: -100,
  nebulaMid: -92,
  nebulaNear: -84,
  grid: -78,
  starFar: -70,
  starMid: -66,
  starNear: -62,
  asteroid: -50,
  pickup: -24,
  enemy: -14,
  bossGlow: -12,
  boss: -10,
  player: -8,
  boss2: -7,
  playerBullet: -6,
  enemyBullet: -2,
  laser: 2,
  warn: 3,
  impact: 5,
  particle: 6,
  muzzle: 8,
  banner: 20,
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
  low: { bloomScale: 0.40, maxParticles: 1600, pixelRatio: 1.0 },
  mid: { bloomScale: 0.50, maxParticles: 3200, pixelRatio: 1.35 },
  high: { bloomScale: 0.50, maxParticles: 5200, pixelRatio: 1.75 },
};

/** 权威玩法常量。若与 docs/GAME_DESIGN.md 不一致，以《查房_AI开发说明.md》为准。 */

export interface Point {
  x: number;
  z: number;
}

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type DoorId = 'A' | 'B';

export interface PlayerInput {
  /** 朝镜头前方推进，-1..1 */
  forward: number;
  /** 朝镜头右侧推进，-1..1 */
  right: number;
  sprint: boolean;
  /** 镜头朝向（弧度），0 表示世界 +x（东） */
  yaw: number;
}

export const NO_INPUT: PlayerInput = { forward: 0, right: 0, sprint: false, yaw: 0 };

export const MAP_WIDTH = 30;
export const MAP_DEPTH = 22;

export const TIME_LIMIT = 45;
/** 单帧最大模拟步长，避免切后台回来瞬间跳过几秒玩法 */
export const MAX_STEP = 0.1;

/** 值班员调参基准 = 二星（标准）档。各难度只写与基准的差异项，缺省回落基准；
 *  调平衡 / 加新档只动这里和 DIFFICULTY_OVERRIDES，不散落在代码各处。 */
export const BASE_TUNING = {
  sightRange: 8,
  litSightRange: 12,
  hearingRange: 7,
  chaseSpeed: 4.2,
  patrolSpeed: 2.8,
  searchSeconds: 4,
  alertSearchSeconds: 6,
  graceSeconds: 6,
} as const;

type TuningOverrides = Partial<{ [K in keyof typeof BASE_TUNING]: number }>;

const DIFFICULTY_NAMES: Record<DifficultyId, string> = {
  intern: '一星难度',
  standard: '二星难度',
  graveyard: '三星难度',
};
const DIFFICULTY_BRIEFS: Record<DifficultyId, string> = {
  intern: '值班员走得慢 · 看得近',
  standard: '值班员正常巡逻',
  graveyard: '值班员更快 · 看得更远',
};
const DIFFICULTY_OVERRIDES: Record<DifficultyId, TuningOverrides> = {
  intern: {
    sightRange: 6.5, litSightRange: 10, hearingRange: 5.5,
    chaseSpeed: 3.9, patrolSpeed: 2.4,
    searchSeconds: 3, alertSearchSeconds: 4.5, graceSeconds: 8,
  },
  standard: {},
  graveyard: {
    sightRange: 9.5, litSightRange: 14, hearingRange: 9,
    chaseSpeed: 4.5, patrolSpeed: 3.2,
    searchSeconds: 5, alertSearchSeconds: 7.5, graceSeconds: 3,
  },
};

export const WALK_SPEED = 3.4;
export const RUN_SPEED = 5.0;
export const STAMINA_DRAIN_SECONDS = 3;
export const STAMINA_RECOVER_SECONDS = 6;

export const PATROL_SPEED = BASE_TUNING.patrolSpeed;
export const CATCH_RADIUS = 0.8;

export const PLAYER_RADIUS = 0.35;
export const GUARD_RADIUS = 0.4;

export const PLAYER_SPAWN: Point = { x: 10, z: 4.5 };
/** 巡逻选路时出生点周围的安全圈：直线方向穿过该圈的候选路点被排除，防止对角线路沿北走廊碾过出生点。 */
export const SPAWN_SAFE_RADIUS = 3;
export const GUARD_SPAWN: Point = { x: 22, z: 4.5 };

export const EXIT_POINT: Point = { x: 27, z: 11 };
export const EXIT_TRIGGER_RADIUS = 1.0;
/** 玩家能站到的、最贴近安全门的合法位置 */
export const EXIT_APPROACH: Point = { x: 26.5, z: 11 };

/** 巡逻路点池：远离出生点的三个角 + 病房 02 门口。到达后随机挑下一个可达点。
 *  西北角 (4.5,4.5) 与出生点同走廊；病房 01 门口 (4.5,11) 距出生点仅 8.5m 且是
 *  西南走廊的必经中间点——两者都会造成“开局即死”路线，均不入池。开局另有 6 秒目视宽限兜底。 */
export const PATROL_WAYPOINTS: readonly Point[] = [
  { x: 25, z: 4.5 },
  { x: 25.5, z: 17.5 },
  { x: 4.5, z: 17.5 },
  { x: 25.5, z: 11 },
];

/**
 * 可通行区域：四条走廊 + 护士站浅凹间。
 * 凹间矩形故意与北走廊重叠 0.5 m，避免矩形边缘出现无法跨越的缝隙。
 */
export const WALKABLE_RECTS: readonly Rect[] = [
  { minX: 3, maxX: 27, minZ: 3, maxZ: 6 }, // 北走廊
  { minX: 3, maxX: 27, minZ: 16, maxZ: 19 }, // 南走廊
  { minX: 3, maxX: 6, minZ: 3, maxZ: 19 }, // 西走廊
  { minX: 24, maxX: 27, minZ: 3, maxZ: 19 }, // 东走廊
  { minX: 11, maxX: 13, minZ: 5, maxZ: 7.2 }, // 护士站浅凹间
  // 病房凹间：从走廊向中央建筑凹进 2.6 m，玩家可以躲进去断视线。
  // 与走廊重叠 1.0 m ≥ 2×碰撞半径：canOccupy 要求圆完整落在单一矩形内，重叠不足会在接缝出现死区。
  { minX: 5.0, maxX: 8.6, minZ: 9.7, maxZ: 12.3 }, // 病房 01（西侧）
  { minX: 21.4, maxX: 25.0, minZ: 9.7, maxZ: 12.3 }, // 病房 02（东侧）
  { minX: 18.7, maxX: 21.3, minZ: 15.0, maxZ: 17.0 }, // 药房（南走廊北侧，重叠 1.0 m）
];

/** 大型掩体：只靠墙摆放，保证走廊净宽 2 m */
export const FURNITURE_RECTS: readonly Rect[] = [
  { minX: 18, maxX: 20, minZ: 5, maxZ: 6 }, // 北走廊推床
  { minX: 10, maxX: 12, minZ: 16, maxZ: 17 }, // 南走廊推床
  { minX: 3, maxX: 4, minZ: 9, maxZ: 10 }, // 西走廊药柜
  { minX: 26, maxX: 27, minZ: 13, maxZ: 14 }, // 东走廊药柜
  // 医用屏风：贴墙伸出的隔断，挡视线形成“贴缝走位”的博弈；各留 ≥1.2 m 绕行缝。
  { minX: 26.0, maxX: 27.0, minZ: 6.5, maxZ: 8.3 }, // 东走廊屏风（西缝 2 m 绕行）
  { minX: 5.5, maxX: 7.5, minZ: 17.2, maxZ: 19.0 }, // 南走廊屏风（北缝 1.2 m 绕行，与推床完全错开）
  { minX: 3.0, maxX: 4.8, minZ: 13.5, maxZ: 15.5 }, // 西走廊屏风（东缝绕行）
];

export const DOOR_IDS: readonly DoorId[] = ['A', 'B'];

export const DOORS: Record<DoorId, Rect & { center: Point; label: string }> = {
  A: { minX: 14.9, maxX: 15.1, minZ: 3, maxZ: 6, center: { x: 15, z: 4.5 }, label: '防火门 A（北走廊）' },
  B: { minX: 14.9, maxX: 15.1, minZ: 16, maxZ: 19, center: { x: 15, z: 17.5 }, label: '防火门 B（南走廊）' },
};

/** 门框 1 m 内有角色时禁止落门 */
export const DOOR_CLEARANCE = 1.0;

export const CHASE_SPEED = BASE_TUNING.chaseSpeed;
export const SIGHT_RANGE = BASE_TUNING.sightRange;
export const LIT_SIGHT_RANGE = BASE_TUNING.litSightRange;
export const HEARING_RANGE = BASE_TUNING.hearingRange;
export const SEARCH_SECONDS = BASE_TUNING.searchSeconds;
export const ALERT_SEARCH_SECONDS = BASE_TUNING.alertSearchSeconds;
/** 开局宽限：随机巡逻不可预判，前几秒值班员可能路过出生点；宽限期内直接目视不转追逐，站着不动绝不开局即死。 */
export const GRACE_SECONDS = BASE_TUNING.graceSeconds;

/** 三档难度：同一张地图，靠值班员感知与节奏递进；标准档 = 上表现值（零漂移事实源）。 */
export type DifficultyId = 'intern' | 'standard' | 'graveyard';

export interface DifficultyPreset {
  id: DifficultyId;
  /** 玩家可见名（值班记录风格） */
  name: string;
  /** 一句话说明，开始卡片副标题 */
  brief: string;
  sightRange: number;
  litSightRange: number;
  hearingRange: number;
  chaseSpeed: number;
  patrolSpeed: number;
  searchSeconds: number;
  alertSearchSeconds: number;
  graceSeconds: number;
}

export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['intern', 'standard', 'graveyard'];
export const DIFFICULTIES: Record<DifficultyId, DifficultyPreset> = Object.fromEntries(
  DIFFICULTY_ORDER.map(id => [id, {
    id,
    name: DIFFICULTY_NAMES[id],
    brief: DIFFICULTY_BRIEFS[id],
    ...BASE_TUNING,
    ...DIFFICULTY_OVERRIDES[id],
  }]),
) as Record<DifficultyId, DifficultyPreset>;


export type CommandId = 'lights' | 'lockdown' | 'broadcast';
export const COMMAND_IDS: readonly CommandId[] = ['lights', 'lockdown', 'broadcast'];
export const COMMANDS = {
  lights: { key: '1', name: '全院开灯', duration: 6, cost: '你也更容易暴露' },
  lockdown: { key: '2', name: '封锁走廊', duration: 5, cost: '你也要绕路' },
  broadcast: { key: '3', name: '广播查房', duration: 6, cost: '之后搜查更严' },
} as const;
export const COMMAND_COOLDOWN = 12;
export const WARD_TARGETS: readonly Point[] = [{ x: 4.5, z: 11 }, { x: 25.5, z: 11 }];

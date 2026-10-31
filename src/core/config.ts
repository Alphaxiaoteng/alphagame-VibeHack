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

export const WALK_SPEED = 3.4;
export const RUN_SPEED = 5.0;
export const STAMINA_DRAIN_SECONDS = 3;
export const STAMINA_RECOVER_SECONDS = 6;

export const PATROL_SPEED = 2.8;
export const CATCH_RADIUS = 0.8;

export const PLAYER_RADIUS = 0.35;
export const GUARD_RADIUS = 0.4;

export const PLAYER_SPAWN: Point = { x: 10, z: 4.5 };
export const GUARD_SPAWN: Point = { x: 22, z: 4.5 };

export const EXIT_POINT: Point = { x: 27, z: 11 };
export const EXIT_TRIGGER_RADIUS = 1.0;
/** 玩家能站到的、最贴近安全门的合法位置 */
export const EXIT_APPROACH: Point = { x: 26.5, z: 11 };

/** 巡逻路点池：四角 + 两间病房门口。到达后随机挑下一个可达点，不再按固定环序走。 */
export const PATROL_WAYPOINTS: readonly Point[] = [
  { x: 25, z: 4.5 },
  { x: 25.5, z: 17.5 },
  { x: 4.5, z: 17.5 },
  { x: 4.5, z: 4.5 },
  { x: 4.5, z: 11 },
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
  // 病房凹间：从走廊向中央建筑凹进 2.6 m，玩家可以躲进去断视线；与走廊重叠 0.5 m 防缝隙。
  { minX: 5.5, maxX: 8.6, minZ: 9.7, maxZ: 12.3 }, // 病房 01（西侧）
  { minX: 21.4, maxX: 24.5, minZ: 9.7, maxZ: 12.3 }, // 病房 02（东侧）
];

/** 大型掩体：只靠墙摆放，保证走廊净宽 2 m */
export const FURNITURE_RECTS: readonly Rect[] = [
  { minX: 18, maxX: 20, minZ: 5, maxZ: 6 }, // 北走廊推床
  { minX: 10, maxX: 12, minZ: 16, maxZ: 17 }, // 南走廊推床
  { minX: 3, maxX: 4, minZ: 9, maxZ: 10 }, // 西走廊药柜
  { minX: 26, maxX: 27, minZ: 13, maxZ: 14 }, // 东走廊药柜
];

export const DOOR_IDS: readonly DoorId[] = ['A', 'B'];

export const DOORS: Record<DoorId, Rect & { center: Point; label: string }> = {
  A: { minX: 14.9, maxX: 15.1, minZ: 3, maxZ: 6, center: { x: 15, z: 4.5 }, label: '防火门 A（北走廊）' },
  B: { minX: 14.9, maxX: 15.1, minZ: 16, maxZ: 19, center: { x: 15, z: 17.5 }, label: '防火门 B（南走廊）' },
};

/** 门框 1 m 内有角色时禁止落门 */
export const DOOR_CLEARANCE = 1.0;

export const CHASE_SPEED = 4.2;
export const SIGHT_RANGE = 8;
export const LIT_SIGHT_RANGE = 12;
export const HEARING_RANGE = 7;
export const SEARCH_SECONDS = 4;
export const ALERT_SEARCH_SECONDS = 6;

export type CommandId = 'lights' | 'lockdown' | 'broadcast';
export const COMMAND_IDS: readonly CommandId[] = ['lights', 'lockdown', 'broadcast'];
export const COMMANDS = {
  lights: { key: '1', name: '全院开灯', duration: 6, cost: '你也更容易暴露' },
  lockdown: { key: '2', name: '封锁走廊', duration: 5, cost: '你也要绕路' },
  broadcast: { key: '3', name: '广播查房', duration: 6, cost: '之后搜查更严' },
} as const;
export const COMMAND_COOLDOWN = 12;
export const WARD_TARGETS: readonly Point[] = [{ x: 4.5, z: 11 }, { x: 25.5, z: 11 }];

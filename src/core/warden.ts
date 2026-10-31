import { DIFFICULTIES, GUARD_RADIUS, GUARD_SPAWN, PATROL_WAYPOINTS, PLAYER_SPAWN, SPAWN_SAFE_RADIUS } from './config';
import type { DifficultyPreset } from './config';
import { Player } from './player';
import type { Point } from './config';
import { distance, moveCircle } from './map';
import type { HospitalMap } from './map';

/**
 * 第一阶段的值班员只是临时路点巡逻：
 * 不感知、不追逐、不搜索，只负责「沿外圈走 + 近身抓人时不能穿门」。
 * 第二阶段会用正式的感知与寻路 AI 替换本类，导航与碰撞数据已经共用 HospitalMap。
 */
export class PatrolGuard {
  position: Point = { ...GUARD_SPAWN };
  path: Point[] = [];
  targetIndex = 0;
  facing = 0;
  /** 巡逻速度等调参：Warden 子类与游戏共享同一引用，难度切换时整体替换。 */
  tuning: DifficultyPreset = DIFFICULTIES.standard;
  customPatrolSpeed?: number;
  get patrolSpeed(): number {
    return this.customPatrolSpeed ?? this.tuning.patrolSpeed;
  }
  set patrolSpeed(val: number) {
    this.customPatrolSpeed = val;
  }
  private revision = -1;

  constructor(map: HospitalMap, private readonly rand: () => number = Math.random) {
    this.replan(map);
  }

  reset(map: HospitalMap): void {
    this.position = { ...GUARD_SPAWN };
    // 出生段固定先向东（路点 0，远离玩家出生点）：随机选点从到达第一个路点后才开始，
    // 否则开局就可能沿北走廊穿过玩家，造成“上来就死”。
    this.targetIndex = 0;
    this.facing = 0;
    this.path = [];
    this.revision = -1;
    this.replan(map);
  }

  /** 调试/测试用：直接指定下一个巡逻路点 */
  setPatrolTarget(index: number, map: HospitalMap): void {
    this.targetIndex = ((index % PATROL_WAYPOINTS.length) + PATROL_WAYPOINTS.length) % PATROL_WAYPOINTS.length;
    this.replan(map);
  }

  replan(map: HospitalMap): void {
    for (let attempt = 0; attempt < PATROL_WAYPOINTS.length; attempt += 1) {
      const target = PATROL_WAYPOINTS[this.targetIndex];
      const path = map.findPath(this.position, target, GUARD_RADIUS);
      if (path.length > 0) {
        this.path = path;
        this.revision = map.revision;
        return;
      }
      this.targetIndex = (this.targetIndex + 1) % PATROL_WAYPOINTS.length;
    }
    this.path = [];
    this.revision = map.revision;
  }

  /** 到达路点后随机挑下一个：不重复当前点，只从当前可达的路点里选，路线不再固定成环。
   *  排除“直线方向穿过出生点保护圈”的候选：对角线路（如东上→西南）的最短路会沿北走廊
   *  穿过玩家出生点，造成开局即死；绕行成本由值班员自己承担（寻路自动走南走廊）。 */
  private pickNextWaypoint(map: HospitalMap, playerPos?: Point): number {
    const candidates: number[] = [];
    for (let index = 0; index < PATROL_WAYPOINTS.length; index += 1) {
      if (index === this.targetIndex) continue;
      if (map.findPath(this.position, PATROL_WAYPOINTS[index], GUARD_RADIUS).length === 0) continue;
      // 开局保护窗内才避开出生点走廊：窗口关闭后恢复全图巡逻，否则值班员被锁死在东南半区。
      if (this.openingProtection) {
        const path = map.findPath(this.position, PATROL_WAYPOINTS[index], GUARD_RADIUS);
        if (this.pathNearSpawn(this.position, path)) continue;
      }
      candidates.push(index);
    }
    // 猎手倾向：以一定概率选“离玩家最近的可达路点”，主动压向玩家所在的半区。
    if (playerPos && this.tuning.huntBias > 0 && candidates.length > 0 && this.rand() < this.tuning.huntBias) {
      let best = candidates[0];
      let bestDist = Infinity;
      for (const index of candidates) {
        const d = distance(PATROL_WAYPOINTS[index], playerPos);
        if (d < bestDist) { bestDist = d; best = index; }
      }
      return best;
    }
    if (candidates.length === 0) {
      const fallback: number[] = [];
      for (let index = 0; index < PATROL_WAYPOINTS.length; index += 1) {
        if (index === this.targetIndex) continue;
        if (map.findPath(this.position, PATROL_WAYPOINTS[index], GUARD_RADIUS).length > 0) fallback.push(index);
      }
      if (fallback.length > 0) return fallback[Math.min(fallback.length - 1, Math.floor(this.rand() * fallback.length))];
      return (this.targetIndex + 1) % PATROL_WAYPOINTS.length;
    }
    return candidates[Math.min(candidates.length - 1, Math.floor(this.rand() * candidates.length))];
  }

  /** 折线（起点 + 各拐点）任意一段是否进入出生点保护圈：点到线段的最近距离判定。 */
  private pathNearSpawn(start: Point, path: readonly Point[]): boolean {
    let previous = start;
    for (const point of path) {
      if (this.segmentNearSpawn(previous, point)) return true;
      previous = point;
    }
    return false;
  }

  /** 线段是否穿过出生点周围的保护圈（圆与线段的最近距离判定）。 */
  private segmentNearSpawn(a: Point, b: Point): boolean {
    const abx = b.x - a.x, abz = b.z - a.z;
    const lengthSq = abx * abx + abz * abz;
    let t = 0;
    if (lengthSq > 1e-9) t = Math.max(0, Math.min(1, ((PLAYER_SPAWN.x - a.x) * abx + (PLAYER_SPAWN.z - a.z) * abz) / lengthSq));
    const cx = a.x + abx * t - PLAYER_SPAWN.x;
    const cz = a.z + abz * t - PLAYER_SPAWN.z;
    return Math.hypot(cx, cz) < SPAWN_SAFE_RADIUS;
  }

  /** 路点停留扫视：一星档到点后站着张望，给玩家更大的行动窗口。 */
  pauseRemaining = 0;
  private pauseFacing = 0;
  private pauseClock = 0;
  /** 开局保护窗：true 时选路避开出生点走廊（防“上来就死”）；10 秒后由 Warden 关闭，恢复全图巡逻。 */
  openingProtection = true;

  movePatrol(dt: number, map: HospitalMap, playerPos?: Point, opts?: { openingProtected?: boolean }): void {
    if (map.revision !== this.revision) this.replan(map);
    if (opts?.openingProtected !== undefined) this.openingProtection = opts.openingProtected;
    // 路点停留：按档位站立张望（朝向缓摆），期间不移动；被追逐时 Warden 不会进入本方法。
    if (this.pauseRemaining > 0) {
      this.pauseRemaining = Math.max(0, this.pauseRemaining - dt);
      this.pauseClock += dt;
      this.facing = this.pauseFacing + Math.sin(this.pauseClock * 1.7) * 0.5;
      return;
    }
    let budget = this.patrolSpeed * dt;
    let hops = 0;
    while (budget > 1e-6 && hops < 8) {
      hops += 1;
      const target = this.path[0];
      if (!target) {
        const previous = this.targetIndex;
        this.targetIndex = this.pickNextWaypoint(map, playerPos);
        this.replan(map);
        if (this.path.length === 0 || this.targetIndex === previous) break;
        // 按档位停留扫视后再出发（±30% 随机化，节奏不机械）。
        if (this.tuning.pauseSeconds > 0) {
          this.pauseRemaining = this.tuning.pauseSeconds * (0.8 + this.rand() * 0.6);
          this.pauseFacing = this.facing;
          this.pauseClock = 0;
          return;
        }
        continue;
      }
      const remaining = distance(this.position, target);
      if (remaining < 1e-6) {
        this.path.shift();
        continue;
      }
      const travel = Math.min(budget, remaining);
      this.facing = Math.atan2(target.z - this.position.z, target.x - this.position.x);
      const next = moveCircle(
        this.position,
        {
          x: ((target.x - this.position.x) / remaining) * travel,
          z: ((target.z - this.position.z) / remaining) * travel,
        },
        GUARD_RADIUS,
        map,
      );
      const moved = distance(this.position, next);
      this.position = next;
      budget -= moved;
      if (distance(this.position, target) < 1e-6) {
        this.path.shift();
        if (this.path.length === 0) {
          this.targetIndex = this.pickNextWaypoint(map);
          this.replan(map);
        }
      }
      if (moved < 1e-6) break;
    }
  }
}

export type GuardMode = 'patrol' | 'chase' | 'search' | 'broadcast';

/** 正式感知层复用已有巡逻与地图。只对看到/听到的位置寻路，不透墙追踪。 */
export class Warden extends PatrolGuard {
  mode: GuardMode = 'patrol';
  targetPoint: Point | null = null;
  lastKnownPoint: Point | null = null;
  searchRemaining = 0;
  broadcastInterrupted = false;
  seesPlayer = false;
  /** 本局难度调参：由 RoundsGame.setDifficulty 在开局注入，游玩中不可热切。 */
  tuning: DifficultyPreset = DIFFICULTIES.standard;
  private broadcastTarget: Point | null = null;
  /** 广播结束时仍在追声源：失去声音后才去病房兑现警觉搜索。 */
  private pendingAlertTarget: Point | null = null;
  /** 警觉搜索被再次发现/听见打断时保留，完成搜索或重开才清除。 */
  private alertSearch = false;
  private pathTimer = 0;
  private stuckTime = 0;
  private routeRevision = -1;
  /** 搜索到位后的扫视计时与基准朝向：左右张望而不是单向转圈。 */
  private searchScan = 0;
  private searchBaseFacing = 0;

  constructor(map: HospitalMap, readonly perception = true) {
    super(map);
  }

  override reset(map: HospitalMap): void {
    this.mode = 'patrol';
    this.targetPoint = null;
    this.lastKnownPoint = null;
    this.searchRemaining = 0;
    this.broadcastInterrupted = false;
    this.broadcastTarget = null;
    this.pendingAlertTarget = null;
    this.alertSearch = false;
    this.seesPlayer = false;
    this.pathTimer = 0;
    this.stuckTime = 0;
    this.searchScan = 0;
    super.reset(map);
    this.routeRevision = map.revision;
  }

  override setPatrolTarget(index: number, map: HospitalMap): void {
    this.mode = 'patrol';
    this.targetPoint = null;
    this.lastKnownPoint = null;
    this.broadcastTarget = null;
    this.pendingAlertTarget = null;
    this.searchRemaining = 0;
    this.broadcastInterrupted = false;
    this.alertSearch = false;
    super.setPatrolTarget(index, map);
  }

  /** 新一局调用：开局几秒直接目视不转追逐，杜绝随机巡逻撞上出生点的“开局即死”。 */
  beginGrace(): void {
    this.graceImmunity = true;
    this.graceRemaining = this.tuning.graceSeconds;
  }

  canSeePlayer(map: HospitalMap, player: Player, range?: number): boolean {
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const gap = Math.hypot(dx, dz);
    if (gap > (range ?? this.tuning.sightRange)) return false;
    if (gap > 0.001 && (dx * Math.cos(this.facing) + dz * Math.sin(this.facing)) / gap < Math.SQRT1_2) return false;
    return map.hasLineOfSight(this.position, player.position);
  }

  beginBroadcast(target: Point, map: HospitalMap): void {
    this.broadcastTarget = { ...target };
    this.pendingAlertTarget = null;
    this.targetPoint = { ...target };
    this.broadcastInterrupted = false;
    this.mode = 'broadcast';
    this.searchRemaining = 0;
    this.replan(map);
  }

  endBroadcast(map: HospitalMap): void {
    const point = this.broadcastTarget;
    this.broadcastTarget = null;
    if (!point || this.broadcastInterrupted) return;
    this.alertSearch = true;
    if (this.mode === 'chase') {
      this.pendingAlertTarget = { ...point };
      return;
    }
    this.mode = 'search';
    this.targetPoint = { ...point };
    this.searchRemaining = this.tuning.alertSearchSeconds;
    this.replan(map);
  }

  override replan(map: HospitalMap): void {
    if (!this.mode || this.mode === 'patrol' || !this.targetPoint) {
      super.replan(map);
    } else {
      const goal = map.closestWalkable(this.targetPoint, GUARD_RADIUS);
      this.path = goal ? map.findPath(this.position, goal, GUARD_RADIUS) : [];
    }
    this.pathTimer = 0;
    this.routeRevision = map.revision;
  }

  /** 开局宽限：true 时直接目视不触发追逐（奔跑声/广播/主动接近不受影响）。 */
  graceImmunity = false;
  private graceRemaining = 0;

  update(dt: number, map: HospitalMap, playerOrPos?: Player | Point, sightRange?: number, opts?: { openingProtected?: boolean }): void {
    const player = playerOrPos instanceof Player ? playerOrPos : undefined;
    this.pathTimer += dt;
    // 开局保护窗：由调用方按游玩时长传入（elapsed < 10s 为 true），超窗自动恢复全图巡逻。
    if (opts?.openingProtected !== undefined) this.openingProtection = opts.openingProtected;
    if (this.graceRemaining > 0) this.graceRemaining = Math.max(0, this.graceRemaining - dt);
    else this.graceImmunity = false;
    const visible = !!player && this.perception && this.canSeePlayer(map, player, sightRange);
    const heard = !!player && this.perception && player.sprinting && distance(this.position, player.position) <= this.tuning.hearingRange;
    this.seesPlayer = visible && !this.graceImmunity;
    if (heard) this.graceImmunity = false;
    if (player && (this.seesPlayer || heard)) {
      const changed = this.mode !== 'chase';
      if (this.seesPlayer && (this.broadcastTarget || this.pendingAlertTarget)) {
        this.broadcastInterrupted = true;
        this.pendingAlertTarget = null;
      }
      this.mode = 'chase';
      this.lastKnownPoint = { ...player.position };
      this.targetPoint = { ...player.position };
      if (changed || this.pathTimer >= 0.25) this.replan(map);
    } else if (this.broadcastTarget && !this.broadcastInterrupted && this.mode !== 'broadcast') {
      // 声源消失后恢复仍在进行的广播；只有直接目视能永久取消诱导。
      this.mode = 'broadcast';
      this.targetPoint = { ...this.broadcastTarget };
      this.searchRemaining = 0;
      this.replan(map);
    } else if (this.mode === 'chase') {
      this.mode = 'search';
      const target = this.pendingAlertTarget ?? this.lastKnownPoint ?? this.position;
      this.targetPoint = { ...target };
      this.searchRemaining = this.alertSearch ? this.tuning.alertSearchSeconds : this.tuning.searchSeconds;
      this.pendingAlertTarget = null;
      this.replan(map);
    }
    if (map.revision !== this.routeRevision) this.replan(map);
    if (this.mode === 'patrol') {
      this.movePatrol(dt, map, this.perception ? player?.position : undefined, { openingProtected });
      return;
    }

    const before = { ...this.position };
    let budget = (this.mode === 'chase' ? this.tuning.chaseSpeed : this.patrolSpeed) * dt;
    for (let hop = 0; budget > 1e-6 && this.path.length > 0 && hop < 12; hop++) {
      const point = this.path[0];
      const gap = distance(this.position, point);
      if (gap < 0.025) { this.path.shift(); continue; }
      const travel = Math.min(gap, budget);
      this.facing = Math.atan2(point.z - this.position.z, point.x - this.position.x);
      const next = moveCircle(this.position, {
        x: (point.x - this.position.x) / gap * travel,
        z: (point.z - this.position.z) / gap * travel,
      }, GUARD_RADIUS, map);
      const moved = distance(this.position, next);
      this.position = next;
      budget -= moved;
      if (distance(next, point) < 0.025) this.path.shift();
      if (moved < 0.0001) break;
    }
    if (this.path.length && distance(before, this.position) < 0.001) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 0.6) { this.replan(map); this.stuckTime = 0; }
    if (this.mode === 'search' && this.path.length === 0) {
      this.searchRemaining = Math.max(0, this.searchRemaining - dt);
      if (this.searchScan === 0) this.searchBaseFacing = this.facing;
      this.searchScan += dt;
      // 到位后左右扫视（约 ±66°），比匀速转圈更像人找东西。
      this.facing = this.searchBaseFacing + Math.sin(this.searchScan * 1.7) * 1.15;
      if (this.searchRemaining <= 1e-6) {
        this.alertSearch = false;
        this.mode = 'patrol';
        this.targetPoint = null;
        this.lastKnownPoint = null;
        this.targetIndex = PATROL_WAYPOINTS.reduce((best, point, index) => distance(this.position, point) < distance(this.position, PATROL_WAYPOINTS[best]) ? index : best, 0);
        this.replan(map);
      }
    }
  }
}

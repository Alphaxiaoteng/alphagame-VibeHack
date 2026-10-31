import { ALERT_SEARCH_SECONDS, CHASE_SPEED, GUARD_RADIUS, GUARD_SPAWN, HEARING_RANGE, PATROL_SPEED, PATROL_WAYPOINTS, SEARCH_SECONDS, SIGHT_RANGE } from './config';
import type { Player } from './player';
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
  /** 巡逻速度（米/秒）：由关卡规则注入，默认等于 01 住院部。 */
  patrolSpeed: number = PATROL_SPEED;
  private revision = -1;

  constructor(map: HospitalMap, private readonly rand: () => number = Math.random) {
    this.replan(map);
  }

  reset(map: HospitalMap): void {
    this.position = { ...GUARD_SPAWN };
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

  /** 到达路点后随机挑下一个：不重复当前点，只从当前可达的路点里选，路线不再固定成环。 */
  private pickNextWaypoint(map: HospitalMap): number {
    const candidates: number[] = [];
    for (let index = 0; index < PATROL_WAYPOINTS.length; index += 1) {
      if (index === this.targetIndex) continue;
      if (map.findPath(this.position, PATROL_WAYPOINTS[index], GUARD_RADIUS).length > 0) candidates.push(index);
    }
    if (candidates.length === 0) return (this.targetIndex + 1) % PATROL_WAYPOINTS.length;
    return candidates[Math.min(candidates.length - 1, Math.floor(this.rand() * candidates.length))];
  }

  update(dt: number, map: HospitalMap): void {
    if (map.revision !== this.revision) this.replan(map);
    let budget = this.patrolSpeed * dt;
    let hops = 0;
    while (budget > 1e-6 && hops < 8) {
      hops += 1;
      const target = this.path[0];
      if (!target) {
        const previous = this.targetIndex;
        this.targetIndex = this.pickNextWaypoint(map);
        this.replan(map);
        if (this.path.length === 0 || this.targetIndex === previous) break;
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

  constructor(map: HospitalMap, readonly perception = true, patrolSpeed = PATROL_SPEED) {
    super(map);
    this.patrolSpeed = patrolSpeed;
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

  canSeePlayer(map: HospitalMap, player: Player, range = SIGHT_RANGE): boolean {
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const gap = Math.hypot(dx, dz);
    if (gap > range) return false;
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
    this.searchRemaining = ALERT_SEARCH_SECONDS;
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

  override update(dt: number, map: HospitalMap, player?: Player, sightRange = SIGHT_RANGE): void {
    this.pathTimer += dt;
    this.seesPlayer = !!player && this.perception && this.canSeePlayer(map, player, sightRange);
    const heard = !!player && this.perception && player.sprinting && distance(this.position, player.position) <= HEARING_RANGE;
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
      this.searchRemaining = this.alertSearch ? ALERT_SEARCH_SECONDS : SEARCH_SECONDS;
      this.pendingAlertTarget = null;
      this.replan(map);
    }
    if (map.revision !== this.routeRevision) this.replan(map);
    if (this.mode === 'patrol') {
      super.update(dt, map);
      return;
    }

    const before = { ...this.position };
    let budget = (this.mode === 'chase' ? CHASE_SPEED : this.patrolSpeed) * dt;
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

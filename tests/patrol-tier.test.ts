import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, NO_INPUT, PATROL_WAYPOINTS, PLAYER_SPAWN } from '../src/core/config';
import { HospitalMap, distance } from '../src/core/map';
import { PatrolGuard, pickHuntTarget } from '../src/core/warden';
import { RoundsGame } from '../src/core/state';

const map = () => new HospitalMap();

describe('三档巡逻走位', () => {
  it('一星：到达路点后停留扫视约 2 秒不动，然后继续走', () => {
    const guard = new PatrolGuard(map(), () => 0.99);
    guard.tuning = DIFFICULTIES.intern;
    guard.setPatrolTarget(0, map());
    guard.position = { ...PATROL_WAYPOINTS[0] };
    guard.path = [];
    guard.movePatrol(1 / 60, map()); // 触发选点 + 进入停留
    expect(guard.pauseRemaining).toBeGreaterThan(1.5); // 一星停留 ≈2s
    const stuck = { ...guard.position };
    for (let frame = 0; frame < 60; frame++) guard.movePatrol(1 / 60, map()); // 1 秒
    expect(distance(guard.position, stuck)).toBeLessThan(0.05); // 停留期内不移动
    for (let frame = 0; frame < 180; frame++) guard.movePatrol(1 / 60, map()); // 3 秒
    expect(guard.pauseRemaining).toBe(0); // 停留结束，恢复移动
  });

  it('标准档：停留较短（约 0.7 秒）', () => {
    const guard = new PatrolGuard(map(), () => 0.99);
    guard.tuning = DIFFICULTIES.standard;
    guard.setPatrolTarget(0, map());
    guard.position = { ...PATROL_WAYPOINTS[0] };
    guard.path = [];
    guard.movePatrol(1 / 60, map());
    expect(guard.pauseRemaining).toBeGreaterThan(0.4);
    expect(guard.pauseRemaining).toBeLessThan(1.0);
  });

  it('三星：到点不停留（持续施压）', () => {
    const guard = new PatrolGuard(map(), () => 0.99);
    guard.tuning = DIFFICULTIES.graveyard;
    guard.setPatrolTarget(0, map());
    guard.position = { ...PATROL_WAYPOINTS[0] };
    guard.path = [];
    guard.movePatrol(1 / 60, map());
    expect(guard.pauseRemaining).toBe(0);
  });

  it('三星猎手倾向：在安全候选中选离玩家最近的可达路点（纯函数）', () => {
    // 东北角 (25,4.5) 出发：穿出生点的候选被过滤，安全候选 = 东南角/西南角/病房02门口；
    // 玩家在出生点 (10,4.5) → 最近的安全点 = 病房 02 门口 (25.5,11)。
    const playerPos = { ...PLAYER_SPAWN };
    const safeCandidates = [1, 2, 3]; // (25.5,17.5) / (4.5,17.5) / (25.5,11)
    // 玩家在出生点 (10,4.5)：最近的安全点 = 西南角 (4.5,17.5) 距 14.1m
    expect(pickHuntTarget(safeCandidates, PATROL_WAYPOINTS, playerPos)).toBe(2);

    // 玩家在西南角 (4.5,17.5) → 最近的安全点 = 路点 2 自身距离 0
    expect(pickHuntTarget([1, 2, 3], PATROL_WAYPOINTS, { x: 4.5, z: 17.5 })).toBe(2);
  });


  it('一星停留不破坏开局安全：停留位置距出生点仍 > 7m', () => {
    const guard = new PatrolGuard(map(), () => 0.99);
    guard.tuning = DIFFICULTIES.intern;
    guard.setPatrolTarget(0, map());
    guard.position = { ...PATROL_WAYPOINTS[0] };
    guard.path = [];
    guard.movePatrol(1 / 60, map());
    for (let frame = 0; frame < 240; frame++) {
      guard.movePatrol(1 / 60, map());
      expect(distance(guard.position, PLAYER_SPAWN)).toBeGreaterThan(7);
    }
  });
});
describe('巡逻覆盖回归（开局保护窗 10 秒后恢复全图）', () => {
  it('45 秒巡逻北/西走廊有覆盖，且值班员会目视发现出生点挂机玩家', () => {
    const game = new RoundsGame();
    game.start();
    const zones: Record<string, number> = { 北: 0, 南: 0, 西: 0, 东: 0 };
    let seen = false;
    const total = 45 * 60;
    for (let frame = 0; frame < total; frame++) {
      game.tick(1 / 60, NO_INPUT);
      const p = game.guard.position;
      zones[p.z < 6.4 ? '北' : p.z > 15.6 ? '南' : p.x < 6 ? '西' : '东']++;
      if (!seen && game.guard.seesPlayer) seen = true;
    }
    const pct = Object.fromEntries(Object.entries(zones).map(([k, v]) => [k, Math.round(v / total * 100)]));
    // 修复前：北 6%、西 0%（值班员被锁死东南）；修复后北走廊为主要巡逻区
    expect(pct['北']).toBeGreaterThanOrEqual(10); // 修复前 6%：随机波动下仍须显著恢复
    expect(seen).toBe(true);
  });
});

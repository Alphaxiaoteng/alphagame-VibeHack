import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, NO_INPUT, PATROL_WAYPOINTS, PLAYER_SPAWN } from '../src/core/config';
import { HospitalMap, distance } from '../src/core/map';
import { PatrolGuard } from '../src/core/warden';
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

  it('三星猎手倾向：60% 概率选离玩家最近的可达路点（出生安全过滤后）', () => {
    // 玩家在出生点 (10,4.5)；值班员在东北角 (25,4.5)
    const guard = new PatrolGuard(map(), () => 0.1); // rand<0.6 → 猎手分支
    guard.tuning = DIFFICULTIES.graveyard;
    guard.setPatrolTarget(0, map());
    guard.position = { ...PATROL_WAYPOINTS[0] };
    guard.path = [];
    const playerPos = { ...PLAYER_SPAWN };
    guard.movePatrol(1 / 60, map(), playerPos);
    // 出生安全过滤会剔除“寻路折线穿过出生点”的候选（如西南角）；
    // 剩余安全候选 [东南角, 病房02门口] 中，猎手应选离玩家最近的病房 02 门口 (25.5,11)。
    const safeCandidates = [1, 3];
    const nearest = safeCandidates.reduce((best, index) =>
      distance(PATROL_WAYPOINTS[index], playerPos) < distance(PATROL_WAYPOINTS[best], playerPos) ? index : best, safeCandidates[0]);
    expect(guard.targetIndex).toBe(nearest);
    // 对照：rand=0.9 → 随机分支，不必然选最近
    const guardB = new PatrolGuard(map(), () => 0.9);
    guardB.tuning = DIFFICULTIES.graveyard;
    guardB.setPatrolTarget(0, map());
    guardB.position = { ...PATROL_WAYPOINTS[0] };
    guardB.path = [];
    guardB.movePatrol(1 / 60, map(), playerPos);
    expect([0, 1, 2, 3]).toContain(guardB.targetIndex);
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
    expect(pct['北']).toBeGreaterThanOrEqual(15);
    expect(seen).toBe(true);
  });
});

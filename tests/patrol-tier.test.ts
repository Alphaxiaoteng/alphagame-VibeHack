import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, PATROL_WAYPOINTS, PLAYER_SPAWN } from '../src/core/config';
import { HospitalMap, distance } from '../src/core/map';
import { PatrolGuard } from '../src/core/warden';

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

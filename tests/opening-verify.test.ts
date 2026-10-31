import { describe, it, expect } from 'vitest';
import { PLAYER_SPAWN } from '../src/core/config';
import { HospitalMap, distance } from '../src/core/map';
import { PatrolGuard } from '../src/core/warden';
import { RoundsGame } from '../src/core/state';

describe('开局安全：任何随机分支都不会“上来就死”', () => {
  it('出生段固定向东远离玩家；从真实开局状态出发的所有随机分支 5 秒内不贴近出生点', () => {
    for (const rand of [() => 0, () => 0.5, () => 0.99]) {
      const map = new HospitalMap();
      const guard = new PatrolGuard(map, rand);
      // 真实开局（reset 语义）：先向东，x 必须增大且不向玩家靠近
      const x0 = guard.position.x;
      guard.movePatrol(1, map);
      expect(guard.position.x).toBeGreaterThan(x0);
      expect(distance(guard.position, PLAYER_SPAWN)).toBeGreaterThan(11);
      // 随机巡逻完整 5 秒：任何分支都不进抓捕半径
      for (let frame = 0; frame < 300; frame++) {
        guard.movePatrol(1 / 60, map);
        expect(distance(guard.position, PLAYER_SPAWN)).toBeGreaterThan(1.2);
      }
      // 到达第一个路点后的后续随机段（模拟第二段起点，从各真实可达路点出发）
      for (const origin of [{ x: 25, z: 4.5 }, { x: 25.5, z: 17.5 }, { x: 4.5, z: 17.5 }, { x: 25.5, z: 11 }]) {
        const map2 = new HospitalMap();
        const g2 = new PatrolGuard(map2, rand);
        g2.position = { ...origin };
        g2.targetIndex = 0;
        g2.path = [];
        g2.movePatrol(1 / 60, map2); // 触发到达→随机选点
        for (let frame = 0; frame < 300; frame++) {
          g2.movePatrol(1 / 60, map2);
          if (distance(g2.position, PLAYER_SPAWN) <= 1.2) {
            throw new Error(`origin=${JSON.stringify(origin)} 5 秒内贴近出生点 (${g2.position.x.toFixed(2)},${g2.position.z.toFixed(2)})`);
          }
        }
      }
    }
  });

  it('宽限期：站立玩家被值班员路过目视也不失败（正常开局时钟推进）', () => {
    const game = new RoundsGame();
    game.start();
    game.guard.position = { x: 12, z: 4.5 };
    game.guard.facing = Math.PI;
    for (let frame = 0; frame < 180; frame++) game.tick(1 / 60);
    expect(game.phase).toBe('playing');
    expect(game.guard.mode).toBe('patrol');
  });
});

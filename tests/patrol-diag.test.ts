import { describe, it } from 'vitest';
import { RoundsGame } from '../src/core/state';
import { distance } from '../src/core/map';

describe('诊断：标准档巡逻覆盖与遭遇', () => {
  it('45 秒巡逻覆盖与距玩家最近距离', () => {
    const game = new RoundsGame();
    game.start();
    const g = game.guard;
    const zones: Record<string, number> = { 北: 0, 南: 0, 西: 0, 东: 0 };
    let minToPlayer = Infinity;
    const trace: string[] = [];
    for (let frame = 0; frame < 45 * 60; frame++) {
      game.tick(1 / 60, { forward: 0, right: 0, sprint: false, yaw: 0 });
      const p = g.position;
      const zone = p.z < 6.4 ? '北' : p.z > 15.6 ? '南' : p.x < 6 ? '西' : '东';
      zones[zone]++;
      minToPlayer = Math.min(minToPlayer, distance(p, game.player.position));
      if (frame % 300 === 0) trace.push(`${(frame / 60).toFixed(0)}s@(${p.x.toFixed(1)},${p.z.toFixed(1)})`);
    }
    const total = 45 * 60;
    console.log('ZONES', JSON.stringify(Object.fromEntries(Object.entries(zones).map(([k, v]) => [k, Math.round(v / total * 100) + '%']))));
    console.log('MIN_DIST_TO_SPAWN', minToPlayer.toFixed(2));
    console.log('TRACE', trace.join(' '));
  });

  it('玩家站出生点不动：45 秒内值班员是否目视发现', () => {
    const game = new RoundsGame();
    game.start();
    let seenAt = -1;
    for (let frame = 0; frame < 45 * 60; frame++) {
      game.tick(1 / 60, { forward: 0, right: 0, sprint: false, yaw: 0 });
      if (game.guard.seesPlayer) { seenAt = game.elapsed; break; }
    }
    console.log('CAMP_SPAWN', JSON.stringify({ seen: seenAt >= 0, seenAt: +seenAt.toFixed(1), mode: game.guard.mode, phase: game.phase }));
  });
});

import { describe, expect, it } from 'vitest';
import { EXIT_APPROACH, GUARD_RADIUS, GUARD_SPAWN, NO_INPUT, PATROL_SPEED, PATROL_WAYPOINTS, PLAYER_SPAWN, TIME_LIMIT } from '../src/core/config';
import { RoundsGame } from '../src/core/state';
import { HospitalMap, distance } from '../src/core/map';
import { Player } from '../src/core/player';
import { PatrolGuard } from '../src/core/warden';
import type { PlayerInput } from '../src/core/config';

const walk: PlayerInput = { ...NO_INPUT, forward: 1 };
const run: PlayerInput = { ...walk, sprint: true };

function advance(game: RoundsGame, seconds: number, input = NO_INPUT) {
  const frames = Math.round(seconds * 60);
  for (let frame = 0; frame < frames; frame++) game.tick(1 / 60, input);
}

function safeGame() {
  const game = new RoundsGame({ perception: false });
  game.start();
  // 护士站的浅凹间可站立，距固定巡逻路线超过抓捕半径。
  game.player.position = { x: 12, z: 6.5 };
  return game;
}

describe('第一阶段胜负、计时与重开', () => {
  it('点击开始前不推进计时、体力或巡逻', () => {
    const game = new RoundsGame({ perception: false });
    game.tick(1, run);
    expect(game.phase).toBe('start');
    expect(game.elapsed).toBe(0);
    expect(game.player.position).toEqual(PLAYER_SPAWN);
    expect(game.guard.position).toEqual(GUARD_SPAWN);
    expect(game.player.stamina).toBe(1);
  });

  it('暂停冻结整局，继续后才推进', () => {
    const game = safeGame();
    advance(game, 2);
    game.pause();
    const elapsed = game.elapsed;
    const guard = { ...game.guard.position };
    const player = { ...game.player.position };
    advance(game, 5, run);
    expect(game.elapsed).toBe(elapsed);
    expect(game.guard.position).toEqual(guard);
    expect(game.player.position).toEqual(player);
    game.resume();
    game.tick(0.1);
    expect(game.elapsed).toBeCloseTo(elapsed + 0.1);
  });

  it('后台恢复的大 dt 最多模拟 0.1 秒，非法 dt 不推进', () => {
    const game = new RoundsGame({ perception: false });
    game.start();
    game.tick(20, walk);
    expect(game.elapsed).toBeCloseTo(0.1);
    // 平滑起步：0.1 秒内应已位移，但尚未达到满速位移。
    expect(game.player.position.x).toBeGreaterThan(10);
    expect(game.player.position.x).toBeLessThan(10.34);
    game.tick(Number.NaN, walk);
    game.tick(-5, walk);
    expect(game.elapsed).toBeCloseTo(0.1);
  });

  it('倒计时结束前站在安全门口不能获胜', () => {
    const game = safeGame();
    advance(game, TIME_LIMIT - 1);
    game.player.position = { ...EXIT_APPROACH };
    game.guard.position = { x: 4.5, z: 17.5 };
    game.guard.replan(game.map);
    game.tick(0.05);
    expect(game.exitUnlocked).toBe(false);
    expect(game.phase).toBe('playing');
  });

  it('倒计时只解锁，不自动判胜；必须亲自进入门口触发区', () => {
    const game = safeGame();
    advance(game, TIME_LIMIT);
    expect(game.remaining).toBe(0);
    expect(game.exitUnlocked).toBe(true);
    expect(game.phase).toBe('playing');
    game.player.position = { ...EXIT_APPROACH };
    game.guard.position = { x: 4.5, z: 17.5 };
    game.guard.replan(game.map);
    game.tick(1 / 60);
    expect(game.phase).toBe('won');
  });

  it('近距离且无遮挡时立即被抓', () => {
    const game = new RoundsGame({ perception: false });
    game.start();
    game.guard.position = { x: 10.6, z: 4.5 };
    game.guard.replan(game.map);
    game.tick(1 / 60);
    expect(game.phase).toBe('lost');
    expect(game.drainEvents().filter(event => event.type === 'caught')).toHaveLength(1);
  });

  it('隔着关闭的门即使距离 0.8 米以内也不能抓人', () => {
    const game = new RoundsGame({ perception: false });
    game.start();
    game.map.setDoor('A', true);
    game.player.position = { x: 14.65, z: 4.5 };
    game.guard.position = { x: 15.35, z: 4.5 };
    expect(game.canCatchPlayer()).toBe(false);
  });

  it('同一更新既触门又被抓，优先失败且不会二次结算', () => {
    const game = safeGame();
    advance(game, TIME_LIMIT);
    game.drainEvents();
    game.player.position = { ...EXIT_APPROACH };
    game.guard.position = { x: 26.35, z: 11.5 };
    game.guard.replan(game.map);
    game.tick(1 / 60);
    expect(game.phase).toBe('lost');
    expect(game.drainEvents().map(event => event.type)).toEqual(['caught']);
    advance(game, 5);
    expect(game.phase).toBe('lost');
    expect(game.drainEvents()).toEqual([]);
  });

  for (const terminal of ['won', 'lost'] as const) {
    it(`${terminal} 后冻结，重开恢复位置、计时、门、体力及事件`, () => {
      const game = safeGame();
      advance(game, TIME_LIMIT);
      game.setDoor('A', true);
      game.player.stamina = 0.2;
      if (terminal === 'won') {
        game.player.position = { ...EXIT_APPROACH };
        game.guard.position = { x: 4.5, z: 17.5 };
      } else {
        game.player.position = { x: 10, z: 4.5 };
        game.guard.position = { x: 10.6, z: 4.5 };
      }
      game.guard.replan(game.map);
      game.tick(1 / 60);
      expect(game.phase).toBe(terminal);
      const elapsed = game.elapsed;
      const player = { ...game.player.position };
      const guard = { ...game.guard.position };
      advance(game, 3, run);
      expect(game.elapsed).toBe(elapsed);
      expect(game.player.position).toEqual(player);
      expect(game.guard.position).toEqual(guard);
      game.restart();
      expect(game.phase).toBe('playing');
      expect(game.remaining).toBe(TIME_LIMIT);
      expect(game.exitUnlocked).toBe(false);
      expect(game.map.closedDoor).toBeNull();
      expect(game.player.position).toEqual(PLAYER_SPAWN);
      expect(game.player.stamina).toBe(1);
      expect(game.guard.position).toEqual(GUARD_SPAWN);
      expect(game.drainEvents().map(event => event.type)).toEqual(['started']);
    });
  }

  it('30 秒、10 秒和解锁语音事件每局各发一次', () => {
    const game = safeGame();
    advance(game, TIME_LIMIT + 5);
    const types = game.drainEvents().map(event => event.type);
    for (const type of ['warning30', 'warning10', 'exitUnlocked']) {
      expect(types.filter(value => value === type)).toHaveLength(1);
    }
  });

  it('调试快进只改变时间，不替代到门口获胜', () => {
    const game = safeGame();
    game.debugSetRemaining(3);
    expect(game.remaining).toBe(3);
    expect(game.exitUnlocked).toBe(false);
    advance(game, 3);
    expect(game.exitUnlocked).toBe(true);
    expect(game.phase).toBe('playing');
  });
});

describe('移动方向与体力', () => {
  it('朝东的镜头下 W 向东、D 向屏幕右侧（南，+z），不反向', () => {
    const map = new HospitalMap();
    const player = new Player();
    player.update(0.1, walk, map);
    expect(player.position.x).toBeGreaterThan(10);
    expect(player.position.x).toBeLessThan(10.34);
    const z = player.position.z;
    player.update(0.1, { ...NO_INPUT, right: 1 }, map);
    expect(player.position.z).toBeGreaterThan(z);
  });

  it('转镜头后 W 随镜头移动，斜向输入不加速', () => {
    const map = new HospitalMap();
    const player = new Player();
    player.position = { x: 25.5, z: 8 };
    player.update(0.1, { ...walk, yaw: Math.PI / 2 }, map);
    expect(player.position.z).toBeGreaterThan(8);
    expect(player.position.z).toBeLessThan(8.34);
    const before = { ...player.position };
    player.update(0.1, { ...walk, right: 1 }, map);
    // 斜向输入归一化：持续位移但不超过满速。
    expect(distance(before, player.position)).toBeGreaterThan(0.05);
    expect(distance(before, player.position)).toBeLessThan(0.35);
  });

  it('奔跑恰好持续三秒，耗尽后一直按 Shift 也只能走', () => {
    const map = new HospitalMap();
    const player = new Player();
    for (let frame = 0; frame < 180; frame++) player.update(1 / 60, run, map);
    expect(player.stamina).toBeCloseTo(0);
    expect(player.position.x).toBeGreaterThan(24.3);
    expect(player.position.x).toBeLessThan(25);
    const x = player.position.x;
    player.update(0.1, run, map);
    // 耗尽后立即降为步行：步长介于步行与奔跑之间，绝不能继续按 0.5 前进。
    expect(player.position.x - x).toBeGreaterThan(0.3);
    expect(player.position.x - x).toBeLessThan(0.5);
    expect(player.sprinting).toBe(false);
  });

  it('静止六秒补满；只按 Shift 不移动不耗体力', () => {
    const map = new HospitalMap();
    const player = new Player();
    player.stamina = 0;
    for (let frame = 0; frame < 360; frame++) player.update(1 / 60, NO_INPUT, map);
    expect(player.stamina).toBeCloseTo(1);
    player.update(0.1, { ...NO_INPUT, sprint: true }, map);
    expect(player.stamina).toBe(1);
  });

  it('耗尽后松开 Shift 再按才恢复奔跑，不每帧自动抽搐加速', () => {
    const map = new HospitalMap();
    const player = new Player();
    for (let frame = 0; frame < 180; frame++) player.update(1 / 60, run, map);
    for (let frame = 0; frame < 360; frame++) player.update(1 / 60, { ...NO_INPUT, sprint: true }, map);
    player.update(0.1, run, map);
    expect(player.sprinting).toBe(false);
    player.update(0.1, NO_INPUT, map);
    player.update(0.1, run, map);
    expect(player.sprinting).toBe(true);
  });

  it('起步平滑加速、松手平滑滑停，不瞬移不滑步', () => {
    const map = new HospitalMap();
    const player = new Player();
    player.update(0.1, walk, map);
    const eased = player.position.x - 10;
    expect(eased).toBeGreaterThan(0.05);
    expect(eased).toBeLessThan(0.34);
    for (let frame = 0; frame < 120; frame++) player.update(1 / 60, walk, map);
    const settled = player.position.x;
    player.update(1 / 60, walk, map);
    expect(player.position.x - settled).toBeCloseTo(3.4 / 60, 2);
    player.update(1 / 60, NO_INPUT, map);
    expect(player.position.x).toBeGreaterThan(settled + 3.4 / 60);
    for (let frame = 0; frame < 120; frame++) player.update(1 / 60, NO_INPUT, map);
    const stopped = player.position.x;
    player.update(1 / 60, NO_INPUT, map);
    expect(player.position.x).toBeCloseTo(stopped, 5);
  });
});

describe('临时路点巡逻（不是第二阶段感知 AI）', () => {
  it('先沿北走廊向东、到 (25,4.5) 后转向南，开局不追玩家', () => {
    const game = new RoundsGame({ perception: false });
    game.start();
    advance(game, 3);
    expect(game.phase).toBe('playing');

    const map = new HospitalMap();
    // rand=0 时随机选点总是落在候选首位（下一个环序点），保持与固定环序相同的可复现期望。
    const guard = new PatrolGuard(map, () => 0);
    guard.update(1, map);
    expect(guard.position.x).toBeGreaterThan(GUARD_SPAWN.x);
    for (let frame = 0; frame < 120; frame++) guard.update(1 / 60, map);
    expect(guard.position.z).toBeGreaterThan(8);
    expect(guard.position.x).toBeLessThanOrEqual(25.6);
  });

  it('随机巡逻：到达路点后不重复当前点，选点由随机源决定', () => {
    const map = new HospitalMap();
    const guard = new PatrolGuard(map, () => 0.99);
    guard.setPatrolTarget(0, map);
    // 直接放到路点 0 上并清空路径，下一帧 update 触发随机选点。
    guard.position = { ...PATROL_WAYPOINTS[0] };
    guard.path = [];
    guard.update(1 / 60, map);
    expect(guard.targetIndex).not.toBe(0);
    expect(guard.targetIndex).toBe(PATROL_WAYPOINTS.length - 1);
    expect(guard.path.length).toBeGreaterThan(0);

    const guardB = new PatrolGuard(map, () => 0);
    guardB.setPatrolTarget(2, map);
    guardB.position = { ...PATROL_WAYPOINTS[2] };
    guardB.path = [];
    guardB.update(1 / 60, map);
    expect(guardB.targetIndex).not.toBe(2);
    expect(guardB.targetIndex).toBe(0);
  });

  it('随机巡逻不穿墙、不传送，长距离移动持续合法', () => {
    const map = new HospitalMap();
    const guard = new PatrolGuard(map, Math.random);
    for (let leg = 0; leg < 6; leg++) {
      guard.position = { ...PATROL_WAYPOINTS[guard.targetIndex] };
      guard.path = [];
      guard.update(1 / 60, map);
      // 随机选点可能出现远路点往返：用累计移动量断言“持续在走”，净位移不再适用。
      let traveled = 0;
      for (let frame = 0; frame < 900; frame++) {
        const before = { ...guard.position };
        guard.update(1 / 60, map);
        traveled += distance(before, guard.position);
        expect(map.canOccupy(guard.position, GUARD_RADIUS)).toBe(true);
        expect(distance(before, guard.position)).toBeLessThanOrEqual(PATROL_SPEED / 60 + 0.001);
      }
      expect(traveled).toBeGreaterThan(4);
    }
  });

  it('动态关门马上重算路线，持续移动且不穿门、不传送', () => {
    const map = new HospitalMap();
    const guard = new PatrolGuard(map);
    // 把值班员放到北走廊，它正沿走廊向东穿过防火门 A
    guard.position = { x: 12, z: 4.5 };
    guard.setPatrolTarget(0, map);
    expect(guard.path.every(point => Math.abs(point.z - 4.5) < 0.1)).toBe(true);
    map.setDoor('A', true);
    guard.update(1 / 60, map);
    expect(guard.path.some(point => point.z >= 16.5)).toBe(true);
    const start = { ...guard.position };
    for (let frame = 0; frame < 900; frame++) {
      const before = { ...guard.position };
      guard.update(1 / 60, map);
      expect(map.canOccupy(guard.position, GUARD_RADIUS)).toBe(true);
      expect(distance(before, guard.position)).toBeLessThanOrEqual(PATROL_SPEED / 60 + 0.001);
    }
    expect(distance(start, guard.position)).toBeGreaterThan(5);
  });
});

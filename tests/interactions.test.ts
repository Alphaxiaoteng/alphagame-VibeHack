import { describe, expect, it } from 'vitest';
import { GRACE_SECONDS, NO_INPUT } from '../src/core/config';
import { HospitalMap, distance } from '../src/core/map';
import { Player } from '../src/core/player';
import { Warden } from '../src/core/warden';
import { RoundsGame } from '../src/core/state';

function advance(game: RoundsGame, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.tick(1 / 60, NO_INPUT);
}

function commandGame() {
  // 使用真实巡逻器但关闭感知，隔离指令时钟；正式入口默认开启感知。
  const game = new RoundsGame({ perception: false });
  game.start();
  game.player.position = { x: 12, z: 6.5 };
  return game;
}

describe('三条指令是真实规则，不是禁用按钮', () => {
  it('开灯六秒扩大视距，十二秒冷却；主效果不能叠加', () => {
    const game = commandGame();
    expect(game.useCommand('lights')).toBe(true);
    expect(game.lightsOn).toBe(true);
    expect(game.sightRange).toBe(12);
    expect(game.commandStatus('lights').cooldown).toBe(12);
    expect(game.useCommand('broadcast')).toBe(false);
    expect(game.commandStatus('broadcast').cooldown).toBe(0);
    advance(game, 6);
    expect(game.lightsOn).toBe(false);
    expect(game.sightRange).toBe(8);
    expect(game.activeEffect).toBeNull();
    expect(game.useCommand('lights')).toBe(false);
    advance(game, 6);
    expect(game.useCommand('lights')).toBe(true);
  });

  it('封锁选择最短路线上的门，双方被挡、AI 立刻绕行，五秒后打开', () => {
    const game = commandGame();
    game.player.position = { x: 12, z: 4.5 };
    game.guard.position = { x: 20, z: 4.5 };
    game.guard.setPatrolTarget(2, game.map);
    expect(game.useCommand('lockdown')).toBe(true);
    expect(game.map.closedDoor).toBe('A');
    expect(game.guard.path.some(p => p.z >= 16.5)).toBe(true);
    expect(game.map.segmentClear({ x: 14, z: 4.5 }, { x: 16, z: 4.5 }, 0.35)).toBe(false);
    advance(game, 5);
    expect(game.map.closedDoor).toBeNull();
    expect(game.map.segmentClear({ x: 14, z: 4.5 }, { x: 16, z: 4.5 }, 0.4)).toBe(true);
  });

  it('无门在最短路径上时明确拒绝，不扣冷却', () => {
    const game = commandGame();
    game.player.position = { x: 10, z: 4.5 };
    game.guard.position = { x: 12, z: 4.5 };
    expect(game.useCommand('lockdown')).toBe(false);
    expect(game.map.closedDoor).toBeNull();
    expect(game.commandStatus('lockdown').cooldown).toBe(0);
    expect(game.drainEvents().some(e => e.type === 'commandRejected' && e.message)).toBe(true);
  });

  it('门框被占用拒绝落门，不推人、不消耗冷却', () => {
    const game = commandGame();
    game.player.position = { x: 12, z: 4.5 };
    game.guard.position = { x: 15.8, z: 4.5 };
    expect(game.useCommand('lockdown')).toBe(false);
    expect(game.guard.position).toEqual({ x: 15.8, z: 4.5 });
    expect(game.commandStatus('lockdown').cooldown).toBe(0);
  });

  it('广播选择离玩家更远的可达病房，结束后警觉搜索六秒', () => {
    const game = commandGame();
    game.guard.position = { x: 22, z: 4.5 };
    expect(game.useCommand('broadcast')).toBe(true);
    expect(game.activeEffect?.target).toEqual({ x: 25.5, z: 11 });
    // 方向必须写进反馈：玩家在西侧时广播会把值班员引向东侧（逃生路方向），不能让他蒙在鼓里。
    const started = game.drainEvents().find(event => event.type === 'commandStarted');
    expect(started?.message).toContain('东侧');
    expect(game.guard.mode).toBe('broadcast');
    advance(game, 6);
    expect(game.activeEffect).toBeNull();
    expect(game.guard.mode).toBe('search');
    expect(game.guard.searchRemaining).toBeGreaterThan(5.9);
    expect(game.useCommand('lights')).toBe(true); // 警觉搜索不占主要效果锁
  });

  it('正在被直接目视时广播拒绝，不播放成功事件也不扣冷却', () => {
    const game = new RoundsGame();
    game.start();
    game.player.position = { x: 12, z: 4.5 };
    game.guard.position = { x: 18, z: 4.5 };
    game.guard.facing = Math.PI;
    expect(game.useCommand('broadcast')).toBe(false);
    expect(game.activeEffect).toBeNull();
    expect(game.commandStatus('broadcast').cooldown).toBe(0);
    expect(game.drainEvents().some(e => e.type === 'commandStarted')).toBe(false);
  });

  it('开局宽限：直接目视不切换追逐，但奔跑声与抓捕照常生效', () => {
    const game = new RoundsGame();
    game.start();
    // 无遮挡对视 3m——宽限期内不进追逐
    game.player.position = { x: 12, z: 4.5 };
    game.guard.position = { x: 15, z: 4.5 };
    game.guard.facing = Math.PI;
    advance(game, 1);
    expect(game.guard.mode).toBe('patrol');
    // 宽限期后同样对视立即追逐
    advance(game, GRACE_SECONDS + 0.5);
    game.player.position = { x: 12, z: 4.5 };
    game.guard.position = { x: 15, z: 4.5 };
    game.guard.facing = Math.PI;
    game.tick(1 / 60);
    expect(game.guard.mode).toBe('chase');
    // 宽限期内近身无遮挡仍会被抓：乱跑作死不死保底
    const gameB = new RoundsGame();
    gameB.start();
    gameB.guard.graceImmunity = false;
    gameB.player.position = { x: 10.5, z: 4.5 };
    gameB.guard.position = { x: 11.3, z: 4.5 };
    gameB.guard.facing = Math.PI;
    gameB.tick(1 / 60);
    expect(gameB.phase).toBe('lost');
  });

  it('暂停冻结主效果、门、冷却及 AI；重开清空全部残留', () => {
    const game = commandGame();
    game.useCommand('lights');
    advance(game, 1);
    game.pause();
    const effect = game.activeEffect?.remaining;
    const cooldown = game.commandStatus('lights').cooldown;
    const guard = { ...game.guard.position };
    advance(game, 4);
    expect(game.activeEffect?.remaining).toBe(effect);
    expect(game.commandStatus('lights').cooldown).toBe(cooldown);
    expect(game.guard.position).toEqual(guard);
    expect(game.useCommand('broadcast')).toBe(false);
    game.restart();
    expect(game.activeEffect).toBeNull();
    expect(game.commandsUsed).toBe(0);
    expect(game.guard.mode).toBe('patrol');
    expect(game.guard.lastKnownPoint).toBeNull();
    expect(game.map.closedDoor).toBeNull();
    for (const id of ['lights', 'lockdown', 'broadcast'] as const) expect(game.commandStatus(id).cooldown).toBe(0);
  });
});

describe('值班员感知、追逐与脱身', () => {
  it('无遮挡正面才看见玩家，扩大视野能发现八米以外的目标', () => {
    const map = new HospitalMap();
    const guard = new Warden(map);
    guard.position = { x: 22, z: 4.5 };
    guard.facing = Math.PI;
    const player = new Player();
    player.position = { x: 12, z: 4.5 };
    expect(guard.canSeePlayer(map, player, 8)).toBe(false);
    expect(guard.canSeePlayer(map, player, 12)).toBe(true);
    guard.facing = 0;
    expect(guard.canSeePlayer(map, player, 12)).toBe(false);
    guard.position = { x: 4.5, z: 11 };
    guard.facing = 0;
    player.position = { x: 25.5, z: 11 };
    expect(guard.canSeePlayer(map, player, 30)).toBe(false);
  });

  it('看到后追逐；墙后玩家停止奔跑，不透墙读取实时位置', () => {
    const map = new HospitalMap();
    const guard = new Warden(map);
    const player = new Player();
    guard.position = { x: 4.5, z: 5 };
    guard.facing = Math.PI / 2;
    player.position = { x: 4.5, z: 10 };
    guard.update(0.1, map, player);
    expect(guard.mode).toBe('chase');
    expect(guard.lastKnownPoint).toEqual({ x: 4.5, z: 10 });
    player.position = { x: 25.5, z: 11 };
    guard.update(0.2, map, player);
    expect(guard.mode).toBe('search');
    expect(guard.lastKnownPoint).toEqual({ x: 4.5, z: 10 });
    expect(guard.targetPoint).toEqual({ x: 4.5, z: 10 });
  });

  it('七米内仅记住奔跑声源；步行或八米外不触发听觉追踪', () => {
    const map = new HospitalMap();
    const guard = new Warden(map);
    const player = new Player();
    guard.position = { x: 10, z: 4.5 };
    guard.facing = 0;
    player.position = { x: 4.5, z: 7 };
    player.sprinting = true;
    guard.update(0.1, map, player);
    expect(guard.mode).toBe('chase');
    expect(guard.lastKnownPoint).toEqual({ x: 4.5, z: 7 });
    player.sprinting = false;
    player.position = { x: 4.5, z: 12 };
    guard.update(0.2, map, player);
    expect(guard.lastKnownPoint).toEqual({ x: 4.5, z: 7 });
    const far = new Warden(map);
    far.position = { x: 10, z: 4.5 };
    player.position = { x: 2, z: 4.5 }; // 距离恰好八米，只用于听觉边界
    player.sprinting = true;
    far.update(0.1, map, player);
    expect(far.mode).toBe('patrol');
  });

  it('直接目视会打断广播，广播结束不能把追逐强制改成搜索', () => {
    const map = new HospitalMap();
    const guard = new Warden(map);
    const player = new Player();
    guard.position = { x: 18, z: 4.5 };
    guard.facing = Math.PI;
    guard.beginBroadcast({ x: 25.5, z: 11 }, map);
    player.position = { x: 12, z: 4.5 };
    guard.update(0.1, map, player);
    expect(guard.mode).toBe('chase');
    expect(guard.broadcastInterrupted).toBe(true);
    guard.endBroadcast(map);
    expect(guard.mode).toBe('chase');
  });

  it('广播期间只听到声源不会永久取消诱导；声音消失后返回病房并警觉搜索六秒', () => {
    const map = new HospitalMap();
    const guard = new Warden(map);
    const player = new Player();
    const ward = { x: 25.5, z: 11 };
    guard.position = { x: 10, z: 4.5 };
    guard.facing = 0;
    guard.beginBroadcast(ward, map);
    player.position = { x: 4.5, z: 7 };
    player.sprinting = true;
    expect(guard.canSeePlayer(map, player)).toBe(false);
    guard.update(0.1, map, player);
    expect(guard.mode).toBe('chase');
    expect(guard.lastKnownPoint).toEqual(player.position);
    expect(guard.broadcastInterrupted).toBe(false);
    player.sprinting = false;
    player.position = { x: 4.5, z: 12 };
    guard.update(0.2, map, player);
    expect(guard.mode).toBe('broadcast');
    expect(guard.targetPoint).toEqual(ward);
    guard.endBroadcast(map);
    expect(guard.mode).toBe('search');
    expect(guard.targetPoint).toEqual(ward);
    expect(guard.searchRemaining).toBe(6);
  });

  it('广播结束时仍听到奔跑声先追声源，声音消失后才兑现六秒警觉搜索', () => {
    const map = new HospitalMap();
    const guard = new Warden(map);
    const player = new Player();
    const ward = { x: 25.5, z: 11 };
    guard.position = { x: 10, z: 4.5 };
    guard.facing = 0;
    guard.beginBroadcast(ward, map);
    player.position = { x: 4.5, z: 7 };
    player.sprinting = true;
    guard.update(0.1, map, player);
    guard.endBroadcast(map);
    expect(guard.mode).toBe('chase');
    expect(guard.lastKnownPoint).toEqual(player.position);
    player.sprinting = false;
    player.position = { x: 4.5, z: 12 };
    guard.update(0.1, map, player);
    expect(guard.mode).toBe('search');
    expect(guard.targetPoint).toEqual(ward);
    expect(guard.searchRemaining).toBe(6);
    guard.reset(map);
    guard.position = { x: 4.5, z: 6 };
    guard.facing = Math.PI / 2;
    player.position = { x: 4.5, z: 7 };
    guard.update(0.1, map, player);
    player.position = { x: 25.5, z: 11 };
    guard.update(0.1, map, player);
    expect(guard.targetPoint).toEqual({ x: 4.5, z: 7 });
    expect(guard.searchRemaining).toBe(4);
  });

  it('广播后的警觉搜索被声源打断仍保留六秒，搜索完后恢复普通四秒规则', () => {
    const map = new HospitalMap();
    const guard = new Warden(map);
    const player = new Player();
    guard.position = { x: 25.5, z: 11 };
    guard.facing = 0;
    guard.beginBroadcast({ x: 25.5, z: 11 }, map);
    guard.endBroadcast(map);
    expect(guard.searchRemaining).toBe(6);
    player.position = { x: 25.5, z: 17.5 };
    player.sprinting = true;
    expect(guard.canSeePlayer(map, player)).toBe(false);
    guard.update(0.1, map, player);
    expect(guard.mode).toBe('chase');
    player.position = { x: 4.5, z: 11 };
    player.sprinting = false;
    guard.update(0.1, map, player);
    expect(guard.mode).toBe('search');
    expect(guard.searchRemaining).toBe(6);
    expect(guard.targetPoint).toEqual({ x: 25.5, z: 17.5 });
    for (let i = 0; i < 600; i++) guard.update(1 / 60, map, player);
    expect(guard.mode).toBe('patrol');
    guard.position = { x: 4.5, z: 6 };
    guard.facing = Math.PI / 2;
    player.position = { x: 4.5, z: 7 };
    guard.update(0.1, map, player);
    player.position = { x: 25.5, z: 11 };
    guard.update(0.1, map, player);
    expect(guard.mode).toBe('search');
    expect(guard.searchRemaining).toBe(4);
  });

  it('搜索到最后已知位置四秒后恢复巡逻，角色不传送', () => {
    const map = new HospitalMap();
    const guard = new Warden(map);
    const player = new Player();
    guard.position = { x: 4.5, z: 6 };
    guard.facing = Math.PI / 2;
    player.position = { x: 4.5, z: 7 };
    guard.update(0.1, map, player);
    player.position = { x: 25.5, z: 11 };
    for (let i = 0; i < 400; i++) {
      const before = { ...guard.position };
      guard.update(1 / 60, map, player);
      expect(map.canOccupy(guard.position, 0.4)).toBe(true);
      expect(distance(before, guard.position)).toBeLessThanOrEqual(4.2 / 60 + 0.001);
    }
    expect(guard.mode).toBe('patrol');
  });
});

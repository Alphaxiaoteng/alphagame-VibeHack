import { describe, expect, it } from 'vitest';
import {
  ALERT_SEARCH_SECONDS,
  CHASE_SPEED,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  GRACE_SECONDS,
  HEARING_RANGE,
  LIT_SIGHT_RANGE,
  PATROL_SPEED,
  SEARCH_SECONDS,
  SIGHT_RANGE,
  BASE_TUNING,
} from '../src/core/config';
import { RoundsGame } from '../src/core/state';
import { NO_INPUT } from '../src/core/config';
import { appendRecord, formatRecord } from '../src/core/gameLog';

function advance(game: RoundsGame, seconds: number, input = NO_INPUT) {
  const frames = Math.round(seconds * 60);
  for (let frame = 0; frame < frames; frame++) game.tick(1 / 60, input);
}

describe('三档难度', () => {
  it('标准档 = 上线数值，预设表不漂移', () => {
    expect(DIFFICULTIES.standard).toMatchObject({
      sightRange: SIGHT_RANGE,
      litSightRange: LIT_SIGHT_RANGE,
      hearingRange: HEARING_RANGE,
      chaseSpeed: CHASE_SPEED,
      patrolSpeed: PATROL_SPEED,
      searchSeconds: SEARCH_SECONDS,
      alertSearchSeconds: ALERT_SEARCH_SECONDS,
      graceSeconds: GRACE_SECONDS,
    });
    expect(DIFFICULTY_ORDER).toEqual(['intern', 'standard', 'graveyard']);
  });

  it('预设表 = 基准值 + 覆盖项：标准档全回落基准，各档无缺失字段', () => {
    // 标准档应完全回落基准（8 个调参键逐键相等）
    const standard = DIFFICULTIES.standard;
    for (const key of Object.keys(BASE_TUNING) as (keyof typeof BASE_TUNING)[]) {
      expect(standard[key]).toBe(BASE_TUNING[key]);
    }
    expect(standard.id).toBe('standard');
    for (const id of DIFFICULTY_ORDER) {
      const preset = DIFFICULTIES[id];
      for (const key of Object.keys(BASE_TUNING) as (keyof typeof BASE_TUNING)[]) {
        expect(typeof preset[key]).toBe('number');
        expect(Number.isFinite(preset[key])).toBe(true);
      }
    }
  });

  it('难度数值层层递进：视距、速度、搜索随档位单调增加', () => {
    const intern = DIFFICULTIES.intern;
    const standard = DIFFICULTIES.standard;
    const graveyard = DIFFICULTIES.graveyard;
    for (const key of ['sightRange', 'hearingRange', 'chaseSpeed', 'patrolSpeed', 'searchSeconds', 'alertSearchSeconds'] as const) {
      expect(intern[key]).toBeLessThan(standard[key]);
      expect(standard[key]).toBeLessThan(graveyard[key]);
    }
    expect(intern.graceSeconds).toBeGreaterThan(standard.graceSeconds);
    expect(standard.graceSeconds).toBeGreaterThan(graveyard.graceSeconds);
  });

  it('同一 7 米无遮挡对视：见习不进追逐，标准立即追逐', () => {
    const intern = new RoundsGame();
    intern.setDifficulty('intern');
    intern.start();
    intern.player.position = { x: 12, z: 4.5 };
    intern.guard.position = { x: 18.9, z: 4.5 };
    intern.guard.facing = Math.PI;
    intern.guard.graceImmunity = false;
    intern.tick(1 / 60);
    expect(intern.guard.mode).toBe('patrol'); // 6.9m > 6.5m 见习视距

    const standard = new RoundsGame();
    standard.start();
    standard.player.position = { x: 12, z: 4.5 };
    standard.guard.position = { x: 18.9, z: 4.5 };
    standard.guard.facing = Math.PI;
    standard.guard.graceImmunity = false;
    standard.tick(1 / 60);
    expect(standard.guard.mode).toBe('chase'); // 6.9m < 8m 标准视距
  });

  it('换难度只在下一局生效：游玩与暂停中拒绝热切', () => {
    const game = new RoundsGame();
    expect(game.setDifficulty('intern')).toBe(true);
    expect(game.difficulty.id).toBe('intern');
    game.start();
    expect(game.setDifficulty('graveyard')).toBe(false);
    expect(game.difficulty.id).toBe('intern');
    game.pause();
    expect(game.setDifficulty('graveyard')).toBe(false);
    // 回到 playing 后被抓进入结算态，再切下一局难度
    game.resume();
    game.player.position = { x: 10.5, z: 4.5 };
    game.guard.position = { x: 11.2, z: 4.5 };
    game.guard.replan(game.map);
    game.tick(1 / 60);
    expect(game.phase).toBe('lost');
    expect(game.setDifficulty('graveyard')).toBe(true);
    game.start();
    expect(game.difficulty.id).toBe('graveyard');
  });

  it('难度随开局生效：巡逻速度按档位推进', () => {
    // 出生段固定先向东 3 m：0.8 秒窗口内两档都未到路点，纯速度可比。
    const intern = new RoundsGame({ perception: false });
    intern.setDifficulty('intern');
    intern.start();
    const guardX0 = intern.guard.position.x;
    advance(intern, 0.8);
    const internMoved = intern.guard.position.x - guardX0;
    expect(internMoved).toBeCloseTo(DIFFICULTIES.intern.patrolSpeed * 0.8, 1);

    const graveyard = new RoundsGame({ perception: false });
    graveyard.setDifficulty('graveyard');
    graveyard.start();
    const guardY0 = graveyard.guard.position.x;
    advance(graveyard, 0.8);
    const graveyardMoved = graveyard.guard.position.x - guardY0;
    expect(graveyardMoved).toBeCloseTo(DIFFICULTIES.graveyard.patrolSpeed * 0.8, 1);
    expect(graveyardMoved).toBeGreaterThan(internMoved);
  });

  it('通关事件带难度，可用于解锁下一档', () => {
    const game = new RoundsGame();
    game.setDifficulty('intern');
    game.start();
    // 巡逻覆盖修复后挂机 45 秒会被值班员抓住（设计如此），故用调试快进直接通电。
    game.debugSetRemaining(0);
    game.player.position = { x: 26.5, z: 11 };
    game.guard.position = { x: 4.5, z: 17.5 };
    game.guard.replan(game.map);
    game.tick(1 / 60);
    expect(game.phase).toBe('won');
    const cleared = game.drainEvents().find(event => event.type === 'difficultyCleared');
    expect(cleared?.difficulty).toBe('intern');
  });

  it('值班日志按难度分档：记录与文案带档位标签', () => {
    const first = appendRecord([], 'won', 45, 1, 'intern');
    expect(first.record.difficulty).toBe('intern');
    expect(formatRecord(first.record)).toBe('第 1 局 · 见习 · 逃脱成功 · 指令 1 次');
    const second = appendRecord(first.records, 'lost', 20, 2, 'graveyard');
    expect(formatRecord(second.record)).toContain('高危');
    // 旧档无难度字段时文案不崩
    const legacy = appendRecord(first.records, 'lost', 10, 0, undefined as never);
    expect(formatRecord(legacy.record)).not.toContain('undefined');
  });
});

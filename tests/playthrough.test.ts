import { describe, expect, it } from 'vitest';
import { NO_INPUT } from '../src/core/config';
import type { DifficultyId, PlayerInput } from '../src/core/config';
import { distance } from '../src/core/map';
import { RoundsGame } from '../src/core/state';

/** 可复现随机源 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HIDE_SPOTS = [
  { x: 7.3, z: 11 },   // 病房 01 凹间（西侧，隔帘后）
  { x: 20, z: 15.9 },  // 药房凹间（南侧，隔帘后）
  { x: 22.7, z: 11 },  // 病房 02 凹间（东侧，贴安全门）
];
const EXIT_APPROACH = { x: 26.5, z: 11 };
const midNorth = { x: 15, z: 4.5 };
const midSouth = { x: 15, z: 17.5 };

/**
 * 理性玩家策略 v3：
 * - 开局去西走廊安全带；值班员靠近（<8m）就逃向离他最远的藏身凹间（隔帘后真隐身）
 * - 中距离经南北远端走廊挪位，避免迎头穿越窄走廊
 * - 32 秒起预位到“离值班员远且离门近”的凹间
 * - 被追时封门挡来路；蹲守被贴近时广播调虎离山
 * - 解锁后从预位凹间 4m 冲门
 */
function playRound(difficulty: DifficultyId, seed: number): { result: 'won' | 'lost' | 'playing'; seconds: number; commands: number } {
  const game = new RoundsGame({ difficulty, rand: mulberry32(seed) });
  game.start();
  let target = { x: 4.5, z: 11 };
  let via: { x: number; z: number } | null = null;
  let usedLockdown = false;
  let usedBroadcast = false;

  for (let frame = 0; frame < (45 + 12) * 60; frame++) {
    if (game.phase !== 'playing') {
      if (game.phase === 'lost') {
        console.log(`  died@${game.elapsed.toFixed(0)}s player=(${game.player.position.x.toFixed(1)},${game.player.position.z.toFixed(1)}) guard=(${game.guard.position.x.toFixed(1)},${game.guard.position.z.toFixed(1)}) target=(${target.x.toFixed(1)},${target.z.toFixed(1)})`);
      }
      return { result: game.phase as 'won' | 'lost', seconds: game.elapsed, commands: game.commandsUsed };
    }
    const g = game.guard.position;
    const p = game.player.position;
    const gap = distance(p, g);
    const elapsed = game.elapsed;
    const unlocked = game.exitUnlocked;

    if (frame % 10 === 0) {
      if (unlocked) {
        target = EXIT_APPROACH;
        via = null;
      } else if (elapsed >= 32) {
        target = HIDE_SPOTS.reduce((best, h) => {
          const score = distance(h, g) - distance(h, EXIT_APPROACH) * 0.8;
          const bestScore = distance(best, g) - distance(best, EXIT_APPROACH) * 0.8;
          return score > bestScore ? h : best;
        }, HIDE_SPOTS[2]);
        via = null;
      } else if (gap < 8) {
        const spot = HIDE_SPOTS.reduce((best, h) => distance(h, g) > distance(best, g) ? h : best, HIDE_SPOTS[0]);
        const northLeg = distance(p, midNorth) + distance(midNorth, spot);
        const southLeg = distance(p, midSouth) + distance(midSouth, spot);
        via = northLeg <= southLeg ? midNorth : midSouth;
        target = spot;
      } else if (gap < 13) {
        const away = { x: Math.max(4, Math.min(26, p.x - (g.x - p.x) * 0.8)), z: Math.max(4, Math.min(18, p.z - (g.z - p.z) * 0.8)) };
        const northLeg = distance(p, midNorth) + distance(midNorth, away);
        const southLeg = distance(p, midSouth) + distance(midSouth, away);
        via = northLeg <= southLeg ? midNorth : midSouth;
        target = away;
      } else {
        target = p;
        via = null;
      }
    }

    if (game.guard.mode === 'chase' && !usedLockdown && game.commandStatus('lockdown').available) {
      if (game.useCommand('lockdown')) usedLockdown = true;
    }
    if (gap < 5.5 && !usedBroadcast && elapsed > 12 && target.x === p.x && game.commandStatus('broadcast').available) {
      if (game.useCommand('broadcast')) usedBroadcast = true;
    }

    const legTarget = via && distance(p, via) > 1.5 ? via : target;
    if (via && distance(p, via) <= 1.5) via = null;
    const dx = legTarget.x - p.x;
    const dz = legTarget.z - p.z;
    const len = Math.hypot(dx, dz);
    const fleeing = gap < 7 || unlocked;
    const canSprint = fleeing && game.player.stamina > 0.25;
    const input: PlayerInput = len > 0.1
      ? { forward: dx / len, right: dz / len, sprint: canSprint, yaw: 0 }
      : NO_INPUT;
    game.tick(1 / 60, input);
  }
  return { result: 'playing', seconds: game.elapsed, commands: game.commandsUsed };
}

describe('可通关性验证：理性玩家策略 × 三档 × 多种子', () => {
  it('一星难度：6 个种子全部逃脱', () => {
    for (const seed of [11, 22, 33, 44, 55, 66]) {
      const r = playRound('intern', seed);
      expect(r.result, `intern seed=${seed} → ${r.result} @${r.seconds.toFixed(0)}s`).toBe('won');
    }
  });

  it('二星难度：8 个种子至少 6 次逃脱', () => {
    let won = 0;
    const details: string[] = [];
    for (const seed of [11, 22, 33, 44, 55, 66, 77, 88]) {
      const r = playRound('standard', seed);
      details.push(`${seed}:${r.result}@${r.seconds.toFixed(0)}s`);
      if (r.result === 'won') won++;
    }
    console.log('STANDARD', details.join(' '));
    expect(won).toBeGreaterThanOrEqual(6);
  });

  it('三星难度：10 个种子至少 6 次逃脱（难但可通过）', () => {
    let won = 0;
    const details: string[] = [];
    for (const seed of [11, 22, 33, 44, 55, 66, 77, 88, 99, 111]) {
      const r = playRound('graveyard', seed);
      details.push(`${seed}:${r.result}@${r.seconds.toFixed(0)}s`);
      if (r.result === 'won') won++;
    }
    console.log('GRAVEYARD', details.join(' '));
    expect(won).toBeGreaterThanOrEqual(6);
  });
});

import { describe, expect, it } from 'vitest';
import { GUARD_BELL_INTERVAL, footstepInterval, secondsUntilFootstep, secondsUntilGuardBell } from '../src/core/ambience';

describe('值班员脚步与追逐铃音节奏', () => {
  it('追逐的脚步比巡逻更密', () => {
    expect(footstepInterval('chase')).toBeLessThan(footstepInterval('patrol'));
  });

  it('脚步按固定周期排程，剩余时间永不超过一个周期', () => {
    for (const t of [0.1, 0.3, 1.7, 9.99]) {
      const wait = secondsUntilFootstep(t, 'patrol', 8);
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(footstepInterval('patrol'));
    }
  });

  it('太远时不算出声源，不排程', () => {
    expect(secondsUntilFootstep(10, 'patrol', 26)).toBe(Infinity);
    expect(secondsUntilFootstep(10, 'patrol', 12)).toBeLessThan(Infinity);
    expect(secondsUntilFootstep(10, 'chase', 18)).toBeLessThan(Infinity);
  });

  it('追逐时每 0.5 秒一次的紧张铃，其他状态不响', () => {
    expect(secondsUntilGuardBell(1.05, 'chase', 5)).toBeCloseTo(GUARD_BELL_INTERVAL - 0.05);
    expect(secondsUntilGuardBell(1.2, 'search', 5)).toBe(Infinity);
    expect(secondsUntilGuardBell(1.2, 'patrol', 5)).toBe(Infinity);
    expect(secondsUntilGuardBell(1.2, 'chase', 25)).toBe(Infinity);
  });
});

import { describe, expect, it } from 'vitest';
import { dangerWindow } from '../src/core/lifecycle';

describe('追逐危险提示只在进入追逐时出现一次', () => {
  it('从巡逻/搜索/广播进入追逐会触发提示', () => {
    expect(dangerWindow('patrol', 'chase', 0, 0)).toBe(1.2);
    expect(dangerWindow('search', 'chase', 5, 0)).toBe(6.2);
    expect(dangerWindow('broadcast', 'chase', 5, 0)).toBe(6.2);
  });

  it('已在追逐中不会每帧重置，避免红框一直闪', () => {
    expect(dangerWindow('chase', 'chase', 3, 0.8)).toBe(0.8);
    expect(dangerWindow('chase', 'chase', 3, 1.2)).toBe(1.2);
  });

  it('离开追逐不会触发新的提示', () => {
    expect(dangerWindow('chase', 'search', 3, 1.2)).toBe(1.2);
    expect(dangerWindow('patrol', 'search', 3, 1.2)).toBe(1.2);
  });
});

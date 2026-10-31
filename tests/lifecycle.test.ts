import { describe, expect, it } from 'vitest';
import { BACKGROUND_PAUSE_GRACE_SECONDS, advanceBackgroundClock, decideBackgroundPause, pauseAfterBackground } from '../src/core/lifecycle';

describe('切后台暂停策略', () => {
  it('真实切走超过短暂窗口才暂停，保持规格要求', () => {
    expect(decideBackgroundPause({ playing: true, hiddenSeconds: BACKGROUND_PAUSE_GRACE_SECONDS + 0.1, focused: false })).toBe('pause');
    expect(decideBackgroundPause({ playing: true, hiddenSeconds: 30, focused: false })).toBe('pause');
  });

  it('瞬间 hidden 抖动与自动化截图不会把一局冻结', () => {
    expect(decideBackgroundPause({ playing: true, hiddenSeconds: 0, focused: false })).toBe('ignore');
    expect(decideBackgroundPause({ playing: true, hiddenSeconds: 0.2, focused: false })).toBe('ignore');
    expect(decideBackgroundPause({ playing: true, hiddenSeconds: 0.2, focused: true })).toBe('ignore');
  });

  it('仅失去焦点不算切后台；暂停中重复触发不会二次暂停', () => {
    expect(decideBackgroundPause({ playing: true, hiddenSeconds: 60, focused: true })).toBe('ignore');
    expect(decideBackgroundPause({ playing: false, hiddenSeconds: 60, focused: false })).toBe('ignore');
  });

  it('恢复前台时按真实隐藏时长判定，不依赖后台被节流的帧', () => {
    const start = 1000;
    expect(pauseAfterBackground({ playing: true, focused: false }, start, start + 1200)).toBe('pause');
    expect(pauseAfterBackground({ playing: true, focused: false }, start, start + 120)).toBe('ignore');
    expect(pauseAfterBackground({ playing: true, focused: false }, null, start + 5000)).toBe('ignore');
    expect(pauseAfterBackground({ playing: false, focused: false }, start, start + 5000)).toBe('ignore');
  });

  it('隐藏与恢复落在同一时刻时，仍在一局中则要求确认后继续', () => {
    expect(pauseAfterBackground({ playing: true, focused: false }, 500, 500)).toBe('pause');
    expect(pauseAfterBackground({ playing: false, focused: false }, 500, 500)).toBe('ignore');
  });

  it('逐帧累积仅用于辅助诊断，不单独触发暂停', () => {
    expect(advanceBackgroundClock(0, true, 0.25)).toBeCloseTo(0.25);
    expect(advanceBackgroundClock(0.25, false, 0.016)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { SPRINT_EXHAUSTED_BELOW, sprintEngaged, stickAxes, TAP_MAX_MS, TAP_MAX_PX, isTap, touchControlsVisible } from '../src/render/touch';

describe('虚拟摇杆映射', () => {
  it('向上推 = 前进，向下推 = 后退，幅度按半径归一', () => {
    expect(stickAxes(0, -60, 60)).toEqual({ forward: 1, right: 0 });
    expect(stickAxes(0, 90, 60)).toEqual({ forward: -1, right: 0 });
    expect(stickAxes(30, 0, 60).right).toBeCloseTo(0.5);
  });

  it('斜向输入限幅在 1，不会比正向更快', () => {
    const diagonal = stickAxes(60, -60, 60);
    expect(Math.hypot(diagonal.forward, diagonal.right)).toBeCloseTo(1);
  });

  it('死区内的轻微抖动视为不动', () => {
    expect(stickAxes(3, -2, 60)).toEqual({ forward: 0, right: 0 });
  });

  it('半径非法时不崩，按最小 1 处理', () => {
    expect(stickAxes(0, -5, 0)).toEqual({ forward: 1, right: 0 });
  });
});

describe('点击与拖动区分', () => {
  it('短距离短时间算点击（点一下画面 = 转镜头前的轻触）', () => {
    expect(isTap(3, 4, 120)).toBe(true);
  });

  it('移动超过阈值或时间过长都不算点击', () => {
    expect(isTap(TAP_MAX_PX + 5, 0, 100)).toBe(false);
    expect(isTap(0, 0, TAP_MAX_MS + 50)).toBe(false);
  });
});

describe('触控按钮是否显示', () => {
  it('粗指针（手机/平板）显示，精确指针（桌面鼠标）隐藏', () => {
    expect(touchControlsVisible('coarse')).toBe(true);
    expect(touchControlsVisible('none')).toBe(true);
    expect(touchControlsVisible('fine')).toBe(false);
  });
});

describe('跑按钮与体力同步', () => {
  it('体力充足时保持按下状态', () => {
    expect(sprintEngaged(true, 1)).toBe(true);
    expect(sprintEngaged(true, 0.5)).toBe(true);
  });

  it('体力耗尽时自动弹起，按钮不再谎称在奔跑', () => {
    expect(sprintEngaged(true, 0.02)).toBe(false);
    expect(sprintEngaged(true, 0)).toBe(false);
    expect(SPRINT_EXHAUSTED_BELOW).toBe(0.03);
  });

  it('没按下时无论体力多少都不算奔跑', () => {
    expect(sprintEngaged(false, 1)).toBe(false);
    expect(sprintEngaged(false, 0)).toBe(false);
  });
});

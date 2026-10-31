/**
 * 体验层的纯逻辑：后台暂停判定与追逐警示窗口。两者都只依赖可测的输入，
 * 渲染与 DOM 只在 main.ts 里读取结果，避免把判定散落在事件回调里。
 */
export const BACKGROUND_PAUSE_GRACE_SECONDS = 0.5;

export type GuardLike = 'patrol' | 'chase' | 'search' | 'broadcast';

export interface BackgroundState {
  playing: boolean;
  /** 本次后台持续时间（秒）；首次隐藏时为 0 */
  hiddenSeconds: number;
  focused: boolean;
}

export function decideBackgroundPause(state: BackgroundState): 'pause' | 'ignore' {
  if (!state.playing || !state.hiddenSeconds || state.focused) return 'ignore';
  return state.hiddenSeconds >= BACKGROUND_PAUSE_GRACE_SECONDS ? 'pause' : 'ignore';
}

/** 按可见性切换逐帧累积的后台计时（诊断辅助，不单独触发暂停）。 */
export function advanceBackgroundClock(seconds: number, hidden: boolean, dt: number): number {
  return hidden ? seconds + Math.max(0, dt) : 0;
}

/**
 * 回前台时的判定：用「隐藏时刻 → 恢复时刻」的真实时间差，而不是在后台被完全节流的帧。
 * 若环境让隐藏与恢复落在同一时刻（自动化或无头浏览器），只要期间确实在游玩，也要求确认后继续。
 */
export function pauseAfterBackground(
  state: Omit<BackgroundState, 'hiddenSeconds'>,
  hiddenAt: number | null,
  resumedAt: number,
): 'pause' | 'ignore' {
  if (hiddenAt === null) return 'ignore';
  const awaySeconds = (resumedAt - hiddenAt) / 1000;
  if (awaySeconds <= 0) return state.playing ? 'pause' : 'ignore';
  return decideBackgroundPause({ ...state, hiddenSeconds: awaySeconds });
}

/**
 * 警示窗口：只有「进入追逐」这一沿才刷新，已在追逐中保持原窗口。
 * 否则每次感知状态抖动都会重新弹一次红框，噪音大于信息。
 */
export const DANGER_WINDOW_SECONDS = 1.2;

export function dangerWindow(
  previous: GuardLike,
  current: GuardLike,
  now: number,
  until: number,
): number {
  return current === 'chase' && previous !== 'chase' ? now + DANGER_WINDOW_SECONDS : until;
}

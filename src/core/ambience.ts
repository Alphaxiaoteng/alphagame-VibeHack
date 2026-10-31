/**
 * 环境音的节奏逻辑：值班员脚步与追逐时的紧张铃。
 * 只回答「这一刻该不该响」，具体音色由 AudioEngine 负责，便于无浏览器环境做行为测试。
 */
export type GuardModeLike = 'patrol' | 'chase' | 'search' | 'broadcast';

/** 脚步间隔（秒）：追逐更密。 */
export function footstepInterval(mode: GuardModeLike): number {
  return mode === 'chase' ? 0.26 : 0.47;
}

/** 可听距离（米）：超过就完全听不到。 */
export function footstepAudibleRange(mode: GuardModeLike): number {
  return mode === 'chase' ? 20 : 16;
}

/** 距下一次脚步还有多少秒；太远时返回 Infinity，调用方据此不排程。 */
export function secondsUntilFootstep(elapsed: number, mode: GuardModeLike, gap: number): number {
  if (gap > footstepAudibleRange(mode)) return Infinity;
  const interval = footstepInterval(mode);
  const phase = elapsed % interval;
  return phase === 0 ? interval : interval - phase;
}

export const GUARD_BELL_INTERVAL = 0.5;

/** 追逐时每 0.5 秒一次的短促铃音；搜索、巡逻、广播都不响。 */
export function secondsUntilGuardBell(elapsed: number, mode: GuardModeLike, gap: number): number {
  if (mode !== 'chase' || gap > 18) return Infinity;
  const phase = elapsed % GUARD_BELL_INTERVAL;
  return phase === 0 ? GUARD_BELL_INTERVAL : GUARD_BELL_INTERVAL - phase;
}

/**
 * 心理微恐压迫心跳节奏：
 * 追逐模式下或与值班员近距离暗处周旋时，心跳随间距急剧加速；
 * 追逐远距 (18m) 约为 80 BPM (0.75s 间隔)，迫近至 2m 时飙升至 185 BPM (0.32s 间隔)；
 * 潜伏周旋近距离 (gap < 6.5m) 保持低速重击心跳 (63 BPM, 0.95s 间隔)。
 */
export function heartbeatInterval(mode: GuardModeLike, gap: number): number {
  if (mode === 'chase' && gap <= 20) {
    const t = Math.max(0, Math.min(1, (gap - 2) / 16));
    return 0.32 + t * 0.43;
  }
  if (gap <= 6.5) {
    return 0.95;
  }
  return Infinity;
}


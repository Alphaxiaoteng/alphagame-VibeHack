/**
 * 触控相关的纯逻辑：把指针位移换算成摇杆轴，并区分「轻触」与「拖动」。
 * 渲染层只负责读取这些结果，便于在无浏览器环境里做行为测试。
 */
const DEAD_ZONE = 0.12;
export const TAP_MAX_PX = 12;
export const TAP_MAX_MS = 320;

export interface StickAxes {
  forward: number;
  right: number;
}

/** 屏幕坐标向下为 +y，因此向上推（dy < 0）应得到 forward = 1。 */
export function stickAxes(dx: number, dy: number, radius: number): StickAxes {
  const r = Math.max(1, radius);
  let forward = -dy / r;
  let right = dx / r;
  const magnitude = Math.hypot(forward, right);
  if (magnitude <= DEAD_ZONE) return { forward: 0, right: 0 };
  if (magnitude > 1) {
    forward /= magnitude;
    right /= magnitude;
  }
  return { forward, right };
}

export function isTap(dx: number, dy: number, durationMs: number): boolean {
  return Math.hypot(dx, dy) <= TAP_MAX_PX && durationMs <= TAP_MAX_MS;
}

/** coarse / none 视为触屏设备；fine 视为鼠标，不显示摇杆以免挡画面。 */
export function touchControlsVisible(pointer: 'coarse' | 'fine' | 'none' | string): boolean {
  return pointer !== 'fine';
}

/** 视为体力耗尽的阈值，与桌面端 staminaHint 的提示阈值保持一致。 */
export const SPRINT_EXHAUSTED_BELOW = 0.03;

/**
 * 触屏「跑」是切换开关，体力耗尽时必须自动弹起：
 * 否则按钮仍显示按下、角色却在走路，状态失真（桌面端的等价操作是松开 Shift）。
 */
export function sprintEngaged(toggled: boolean, stamina: number): boolean {
  return toggled && stamina >= SPRINT_EXHAUSTED_BELOW;
}

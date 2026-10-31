import {
  PLAYER_RADIUS,
  PLAYER_SPAWN,
  RUN_SPEED,
  STAMINA_DRAIN_SECONDS,
  STAMINA_RECOVER_SECONDS,
  WALK_SPEED,
} from './config';
import type { PlayerInput, Point } from './config';
import { moveCircle } from './map';
import type { HospitalMap } from './map';

export class Player {
  position: Point = { ...PLAYER_SPAWN };
  /** 0..1 */
  stamina = 1;
  sprinting = false;
  /** 角色朝向（弧度），渲染层用来转动模型 */
  facing = 0;
  /** 体力耗尽后必须先松开 Shift 才能重新奔跑 */
  private sprintLocked = false;
  /** 浮点余量：低于该值视为已耗尽，避免耗尽瞬间多跑一整帧 */
  private static readonly STAMINA_EPSILON = 1e-6;

  reset(): void {
    this.position = { ...PLAYER_SPAWN };
    this.stamina = 1;
    this.sprinting = false;
    this.facing = 0;
    this.sprintLocked = false;
  }

  update(dt: number, input: PlayerInput, map: HospitalMap): void {
    const yaw = Number.isFinite(input.yaw) ? input.yaw : 0;
    const forwardX = Math.cos(yaw);
    const forwardZ = Math.sin(yaw);
    const rightX = -Math.sin(yaw);
    const rightZ = Math.cos(yaw);

    let directionX = forwardX * input.forward + rightX * input.right;
    let directionZ = forwardZ * input.forward + rightZ * input.right;
    const length = Math.hypot(directionX, directionZ);
    const moving = length > 1e-6;
    if (moving) {
      directionX /= length;
      directionZ /= length;
      this.facing = Math.atan2(directionZ, directionX);
    }

    if (!input.sprint) this.sprintLocked = false;

    let speed = 0;
    if (moving) {
      if (input.sprint && !this.sprintLocked && this.stamina > Player.STAMINA_EPSILON) {
        speed = RUN_SPEED;
        const next = this.stamina - dt / STAMINA_DRAIN_SECONDS;
        this.stamina = next <= Player.STAMINA_EPSILON ? 0 : next;
        this.sprinting = this.stamina > 0;
        if (this.stamina === 0) this.sprintLocked = true;
      } else {
        speed = WALK_SPEED;
        this.sprinting = false;
        this.stamina = Math.min(1, this.stamina + dt / STAMINA_RECOVER_SECONDS);
      }
    } else {
      this.sprinting = false;
      this.stamina = Math.min(1, this.stamina + dt / STAMINA_RECOVER_SECONDS);
    }

    const step = speed * dt;
    if (step > 0) {
      this.position = moveCircle(
        this.position,
        { x: directionX * step, z: directionZ * step },
        PLAYER_RADIUS,
        map,
      );
    }
  }
}

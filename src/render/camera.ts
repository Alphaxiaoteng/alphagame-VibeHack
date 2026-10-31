import * as THREE from 'three';
import type { Point } from '../core/config';

/**
 * 第一人称镜头：位于玩家头部（y≈1.58 m），yaw/pitch 由输入直接驱动。
 * 镜头在玩家碰撞圆内部，天然不会穿墙，不再需要第三人称的贴墙裁剪。
 * yaw 与移动共用：0 朝东（+x），正方向向南（+z）。pitch 正值抬头。
 */
export class FirstPersonCamera {
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.06, 90);
  yaw = 0;
  pitch = 0;
  /** 约 60° 上下限，防止翻转。 */
  private static readonly PITCH_LIMIT = 1.05;
  private readonly look = new THREE.Vector3();

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
  }

  rotate(delta: number): void {
    this.yaw += delta;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
  }

  tilt(delta: number): void {
    this.pitch = Math.max(-FirstPersonCamera.PITCH_LIMIT, Math.min(FirstPersonCamera.PITCH_LIMIT, this.pitch + delta));
  }

  update(player: Point): void {
    this.camera.position.set(player.x, 1.58, player.z);
    this.look.set(
      player.x + Math.cos(this.yaw) * Math.cos(this.pitch),
      1.58 + Math.sin(this.pitch),
      player.z + Math.sin(this.yaw) * Math.cos(this.pitch),
    );
    this.camera.lookAt(this.look);
  }
}

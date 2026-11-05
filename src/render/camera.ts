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
  /** 生理呼吸与脚步重心起伏（Headbob & Breathing Sway 沉浸感核心） */
  private bobStep = 0;
  private bobY = 0;
  private bobX = 0;
  private idleClock = 0;

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.bobStep = 0;
    this.bobY = 0;
    this.bobX = 0;
    this.idleClock = 0;
  }

  rotate(delta: number): void {
    this.yaw += delta;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
  }

  tilt(delta: number): void {
    this.pitch = Math.max(-FirstPersonCamera.PITCH_LIMIT, Math.min(FirstPersonCamera.PITCH_LIMIT, this.pitch + delta));
  }

  update(player: Point, dt = 0.016, isMoving = false, isSprinting = false): void {
    if (isMoving) {
      const freq = isSprinting ? 14.0 : 9.2;
      const ampY = isSprinting ? 0.032 : 0.016;
      const ampX = isSprinting ? 0.016 : 0.008;
      this.bobStep += dt * freq;
      this.bobY = Math.sin(this.bobStep) * ampY;
      this.bobX = Math.cos(this.bobStep * 0.5) * ampX;
    } else {
      // 静止时微弱胸腔呼吸起伏（真实生命体征）
      this.idleClock += dt * 2.0;
      this.bobY += (Math.sin(this.idleClock) * 0.004 - this.bobY) * Math.min(1, dt * 5);
      this.bobX += (0 - this.bobX) * Math.min(1, dt * 5);
    }

    const eyeY = 1.58 + this.bobY;
    const eyeX = player.x + Math.cos(this.yaw + Math.PI / 2) * this.bobX;
    const eyeZ = player.z + Math.sin(this.yaw + Math.PI / 2) * this.bobX;

    this.camera.position.set(eyeX, eyeY, eyeZ);
    this.look.set(
      eyeX + Math.cos(this.yaw) * Math.cos(this.pitch),
      eyeY + Math.sin(this.pitch),
      eyeZ + Math.sin(this.yaw) * Math.cos(this.pitch),
    );
    this.camera.lookAt(this.look);
  }
}

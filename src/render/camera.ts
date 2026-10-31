import * as THREE from 'three';
import type { Point } from '../core/config';

/** 镜头与移动共用 yaw：0 朝东，正方向向南。角色移动不会擅自旋转镜头。 */
export class FollowCamera {
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.06, 90);
  yaw = 0;
  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private initialized = false;

  constructor(private readonly blockers: THREE.Object3D[]) {}

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  reset(): void {
    this.yaw = 0;
    this.initialized = false;
  }

  rotate(delta: number): void {
    this.yaw += delta;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
  }

  update(player: Point, dt: number): void {
    const focus = new THREE.Vector3(player.x, 1.15, player.z);
    const blend = 1 - Math.exp(-12 * Math.max(0, dt));
    if (!this.initialized) this.target.copy(focus);
    else this.target.lerp(focus, blend);
    this.desired.set(
      this.target.x - Math.cos(this.yaw) * 3.8 - Math.sin(this.yaw) * 0.25,
      this.target.y + 1.15,
      this.target.z - Math.sin(this.yaw) * 3.8 + Math.cos(this.yaw) * 0.25,
    );
    this.clipToWalls(this.desired);
    if (!this.initialized) this.camera.position.copy(this.desired);
    else this.camera.position.lerp(this.desired, blend);
    // 平滑移动也必须受墙体限制，不能在拐角插值过程中穿墙。
    this.clipToWalls(this.camera.position);
    this.camera.lookAt(this.target);
    this.initialized = true;
  }

  private clipToWalls(position: THREE.Vector3): void {
    this.direction.copy(position).sub(this.target);
    const length = this.direction.length();
    if (length < 0.001) return;
    this.raycaster.set(this.target, this.direction.normalize());
    this.raycaster.far = length;
    const hits = this.raycaster.intersectObjects(this.blockers, false);
    if (hits.length > 0 && hits[0].distance < length) {
      position.copy(this.target).addScaledVector(this.direction, Math.max(0.28, hits[0].distance - 0.18));
    }
  }
}

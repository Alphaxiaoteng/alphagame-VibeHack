import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clothMaterial } from './materials';

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

/** 约 1.75 m 的人体比例，衣裤、四肢关节、鞋与胸牌均为真实网格；非胶囊碰撞体外观。 */
export class HumanRig {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly isWarden: boolean;
  private readonly arms: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly legs: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  readonly flashlightSpot: THREE.SpotLight | null = null;
  private stride = 0;
  private weight = 0;

  constructor(warden: boolean) {
    this.isWarden = warden;
    const skin = new THREE.MeshStandardMaterial({ color: warden ? 0xc8aa90 : 0xd6b395, roughness: 0.78 });
    const hair = new THREE.MeshStandardMaterial({ color: warden ? 0x18181b : 0x272522, roughness: 0.95 });
    // 守卫/查房值班员采用深色战术医院制服（墨黑长裤 + 深碳灰勤务上衣）
    const shirt = clothMaterial(warden ? 0x1e293b : 0x2f7d70);
    const pants = clothMaterial(warden ? 0x0f172a : 0x22363b);
    const shoes = new THREE.MeshStandardMaterial({ color: warden ? 0x111827 : 0x202623, roughness: 0.5, metalness: 0.2 });
    const badge = new THREE.MeshStandardMaterial({ color: warden ? 0x38bdf8 : 0xe9ece1, roughness: 0.4, metalness: 0.6 });
    // 解剖模型本地朝 +z，转为游戏统一的 +x 朝向。
    this.body.rotation.y = Math.PI / 2;
    this.group.add(this.body);

    const torso = mesh(new THREE.CylinderGeometry(0.19, 0.14, 0.44, 18), shirt, 0, 1.14, 0);
    torso.scale.z = 0.66;
    this.body.add(torso);
    const pelvis = mesh(new RoundedBoxGeometry(0.285, 0.19, 0.19, 2, 0.045), pants, 0, 0.875, 0);
    this.body.add(pelvis);
    this.body.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.092, 12), skin, 0, 1.423, 0));
    const head = mesh(new THREE.SphereGeometry(1, 20, 16), skin, 0, 1.575, 0.008);
    head.scale.set(0.092, 0.123, 0.091);
    this.body.add(head);
    const cap = mesh(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, 0, 1.593, 0);
    cap.scale.set(0.094, 0.112, 0.095);
    this.body.add(cap);
    const nose = mesh(new THREE.SphereGeometry(1, 10, 8), skin, 0, 1.568, 0.098);
    nose.scale.set(0.02, 0.022, 0.027);
    this.body.add(nose);
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.65 });
    for (const side of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(1, 10, 8), skin, side * 0.092, 1.574, 0.005);
      ear.scale.set(0.016, 0.03, 0.022); this.body.add(ear);
      const eye = mesh(new THREE.SphereGeometry(0.0055, 8, 6), eyeMaterial, side * 0.038, 1.594, 0.084);
      this.body.add(eye);
    }
    const pocket = mesh(new RoundedBoxGeometry(0.075, 0.09, 0.014, 2, 0.004), shirt, -0.09, 1.21, 0.124);
    this.body.add(pocket);
    this.body.add(mesh(new THREE.BoxGeometry(0.046, 0.055, 0.012), badge, -0.09, 1.23, 0.137));
    const strap = new THREE.MeshStandardMaterial({ color: warden ? 0x1e293b : 0x30464a, roughness: 0.85 });
    this.body.add(mesh(new THREE.BoxGeometry(0.017, 0.19, 0.013), strap, 0.047, 1.28, 0.125));
    this.body.add(mesh(new THREE.BoxGeometry(0.015, 0.19, 0.013), strap, -0.047, 1.28, 0.125));

    for (const side of [-1, 1]) {
      const arm = new THREE.Group(); arm.position.set(side * 0.205, 1.34, 0);
      arm.rotation.z = side * 0.09;
      arm.add(mesh(new THREE.CylinderGeometry(0.061, 0.048, 0.28, 12), shirt, 0, -0.14, 0));
      const elbow = new THREE.Group(); elbow.position.y = -0.28;
      elbow.add(mesh(new THREE.CylinderGeometry(0.044, 0.032, 0.26, 12), warden ? shirt : skin, 0, -0.13, 0));
      elbow.add(mesh(new RoundedBoxGeometry(0.055, 0.093, 0.041, 2, 0.018), skin, 0, -0.31, 0));
      arm.add(elbow); this.body.add(arm); this.arms.push(arm); this.elbows.push(elbow);

      const leg = new THREE.Group(); leg.position.set(side * 0.09, 0.865, 0);
      leg.add(mesh(new THREE.CylinderGeometry(0.078, 0.057, 0.365, 14), pants, 0, -0.18, 0));
      const knee = new THREE.Group(); knee.position.y = -0.36;
      knee.add(mesh(new THREE.CylinderGeometry(0.057, 0.038, 0.375, 14), pants, 0, -0.19, 0));
      knee.add(mesh(new RoundedBoxGeometry(0.105, 0.085, 0.25, 2, 0.025), shoes, 0, -0.44, 0.066));
      leg.add(knee); this.body.add(leg); this.legs.push(leg); this.knees.push(knee);
    }

    // 守卫右手配备战术巡逻手电筒与动态前向聚光灯
    if (warden && this.elbows.length > 1) {
      const rightElbow = this.elbows[1];
      const flashlight = new THREE.Group();
      flashlight.position.set(0, -0.32, 0.06);
      flashlight.rotation.x = Math.PI / 2;

      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.35, metalness: 0.85 });
      const bezelMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.2, metalness: 0.95 });
      const lensMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8db, emissiveIntensity: 1.8, roughness: 0.1 });

      const handleMesh = mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.16, 12), bodyMat, 0, 0, 0);
      flashlight.add(handleMesh);
      const bezelMesh = mesh(new THREE.CylinderGeometry(0.026, 0.02, 0.04, 12), bezelMat, 0, 0.09, 0);
      flashlight.add(bezelMesh);
      const lensMesh = mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.005, 12), lensMat, 0, 0.11, 0);
      flashlight.add(lensMesh);

      // 动态夜巡光束
      const spot = new THREE.SpotLight(0xfff5d6, 3.8, 16, Math.PI / 6.5, 0.35, 1.2);
      spot.position.set(0, 0.12, 0);
      const spotTarget = new THREE.Object3D();
      spotTarget.position.set(0, 8, 0);
      flashlight.add(spot);
      flashlight.add(spotTarget);
      spot.target = spotTarget;
      this.flashlightSpot = spot;

      rightElbow.add(flashlight);
    }

    this.group.name = warden ? 'human-warden' : 'human-player';
  }

  animate(meters: number, dt: number, running: boolean): void {
    if (dt <= 0) return;
    const moving = meters > 0.0003;
    this.weight += ((moving ? 1 : 0) - this.weight) * Math.min(1, dt * 14);
    this.stride += meters * (running ? 8 : 11);
    const amplitude = (running ? 0.63 : 0.38) * this.weight;
    for (let i = 0; i < 2; i++) {
      const swing = Math.sin(this.stride + i * Math.PI);
      this.legs[i].rotation.x = swing * amplitude;
      this.knees[i].rotation.x = Math.max(0, -swing) * (running ? 0.85 : 0.45) * this.weight;
      this.arms[i].rotation.x = -swing * amplitude * 0.9;
      this.elbows[i].rotation.x = -(running ? 0.65 : 0.16) * this.weight;
    }

    // 守卫手持手电筒时，右手前臂向前抬起照亮前方路径
    if (this.isWarden && this.elbows[1]) {
      this.elbows[1].rotation.x = -0.55 - (running ? 0.25 : 0.08) * this.weight;
      this.arms[1].rotation.x = -0.15 + (this.arms[1].rotation.x * 0.4);
    }

    this.body.position.y = Math.abs(Math.sin(this.stride)) * (running ? 0.035 : 0.015) * this.weight;
  }

  reset(): void {
    this.stride = this.weight = 0;
    this.body.position.y = 0;
    for (const joint of [...this.arms, ...this.elbows, ...this.legs, ...this.knees]) joint.rotation.x = 0;
  }

  /** 窄走廊镜头必须拉近时淡化玩家，不能让人体挡满视野。 */
  setOpacity(opacity: number): void {
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshStandardMaterial;
      material.transparent = opacity < 0.99;
      material.opacity = opacity;
      material.depthWrite = opacity >= 0.99;
    });
  }
}

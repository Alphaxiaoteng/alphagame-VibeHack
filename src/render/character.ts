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
  private readonly shirt: THREE.MeshStandardMaterial;
  private stride = 0;
  private weight = 0;

  constructor(warden: boolean) {
    this.isWarden = warden;
    // 皮肤材质高级调色：守卫采用阴冷青灰暗沉肤质，玩家采用虚弱苍白冷调，彻底告别单调塑料感
    const skin = new THREE.MeshStandardMaterial({
      color: warden ? 0xa89688 : 0xd8c2b0,
      roughness: warden ? 0.72 : 0.76,
      metalness: 0.05
    });
    const hair = new THREE.MeshStandardMaterial({ color: warden ? 0x141416 : 0x22201e, roughness: 0.95 });
    // 守卫/查房值班员采用深色战术医院制服（墨黑长裤 + 深碳灰勤务上衣）
    const shirt = clothMaterial(warden ? 0x18202c : 0x2c6b63);
    this.shirt = shirt;
    const pants = clothMaterial(warden ? 0x0c111c : 0x1e3034);
    const shoes = new THREE.MeshStandardMaterial({ color: warden ? 0x0f172a : 0x1e2422, roughness: 0.45, metalness: 0.3 });
    const badge = new THREE.MeshStandardMaterial({ color: warden ? 0x38bdf8 : 0xe9ece1, roughness: 0.3, metalness: 0.7 });
    // 战术反光带材质（高反射金属微表面，受光照耀闪现微冷银光）
    const reflectiveMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: warden ? 0x38bdf8 : 0x10b981,
      emissiveIntensity: 0.15,
      roughness: 0.2,
      metalness: 0.85
    });
    // 解剖模型本地朝 +z，转为游戏统一的 +x 朝向。
    this.body.rotation.y = Math.PI / 2;
    this.group.add(this.body);

    const torso = mesh(new THREE.CylinderGeometry(0.19, 0.14, 0.44, 18), shirt, 0, 1.14, 0);
    torso.scale.z = 0.66;
    this.body.add(torso);
    const pelvis = mesh(new RoundedBoxGeometry(0.285, 0.19, 0.19, 2, 0.045), pants, 0, 0.875, 0);
    this.body.add(pelvis);
    this.body.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.092, 12), skin, 0, 1.423, 0));
    // 极简艺术化头部与面罩设计（去除廉价突兀的假鼻子/球体耳朵，对标《Inside》与《小小梦魇》暗黑微恐极简审美）
    const head = mesh(new THREE.SphereGeometry(1, 24, 18), skin, 0, 1.575, 0.008);
    head.scale.set(0.092, 0.123, 0.091);
    this.body.add(head);

    // 头发 / 勤务帽
    const cap = mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, 0, 1.593, 0);
    cap.scale.set(0.094, 0.112, 0.095);
    this.body.add(cap);

    if (warden) {
      // 巡查值班员：下压式深色勤务大檐帽 + 黑色勤务面罩 + 金属警徽
      const brim = mesh(new RoundedBoxGeometry(0.17, 0.016, 0.08, 2, 0.004), hair, 0, 1.625, 0.065);
      brim.rotation.x = 0.2;
      this.body.add(brim);

      const capBadgeMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.9, roughness: 0.2 });
      const capBadge = mesh(new THREE.BoxGeometry(0.022, 0.02, 0.006), capBadgeMat, 0, 1.638, 0.088);
      this.body.add(capBadge);

      const wardenMaskMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 });
      const mask = mesh(new RoundedBoxGeometry(0.11, 0.065, 0.06, 2, 0.01), wardenMaskMat, 0, 1.545, 0.065);
      this.body.add(mask);

      // 阴影深处微弱警惕的暗红巡查双眼
      const eyeMat = new THREE.MeshStandardMaterial({
        color: 0xff3b30,
        emissive: 0xcc1111,
        emissiveIntensity: 0.85,
        roughness: 0.3
      });
      for (const side of [-1, 1]) {
        const eye = mesh(new THREE.BoxGeometry(0.016, 0.006, 0.008), eyeMat, side * 0.034, 1.595, 0.082);
        this.body.add(eye);
      }

      // 守卫战术双肩反光标识条
      for (const side of [-1, 1]) {
        const epaulet = mesh(new THREE.BoxGeometry(0.065, 0.012, 0.024), reflectiveMat, side * 0.155, 1.345, 0.01);
        epaulet.rotation.z = side * -0.15;
        this.body.add(epaulet);
      }
    } else {
      // 潜行玩家：极简医用淡青雾面口罩，干净素雅，杜绝生硬五官拼装
      const maskMat = new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.85 });
      const mask = mesh(new RoundedBoxGeometry(0.105, 0.058, 0.055, 2, 0.01), maskMat, 0, 1.542, 0.062);
      this.body.add(mask);

      // 极简微深邃眼眸线（极具克制力与电影感）
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 });
      for (const side of [-1, 1]) {
        const eye = mesh(new THREE.BoxGeometry(0.014, 0.005, 0.006), eyeMat, side * 0.033, 1.592, 0.082);
        this.body.add(eye);
      }

      // 玩家病号服领口滚边
      const trimMat = new THREE.MeshStandardMaterial({ color: 0x1e4942, roughness: 0.7 });
      const collar = mesh(new THREE.TorusGeometry(0.075, 0.008, 8, 16), trimMat, 0, 1.35, 0);
      collar.rotation.x = Math.PI / 2;
      this.body.add(collar);
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

      // 战术体积光雾锥（Volumetric Light Cone 丁达尔效应微尘光柱）
      const beamGeo = new THREE.ConeGeometry(1.2, 5.5, 18, 1, true);
      beamGeo.translate(0, 2.75, 0);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xfff6cf,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const beamMesh = new THREE.Mesh(beamGeo, beamMat);
      beamMesh.position.set(0, 0.12, 0);
      flashlight.add(beamMesh);

      rightElbow.add(flashlight);
    }

    this.group.name = warden ? 'human-warden' : 'human-player';
  }

  /** 换肤：只改衣料颜色，几何与骨架不动。 */
  setCloth(color: number): void {
    this.shirt.color.setHex(color);
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

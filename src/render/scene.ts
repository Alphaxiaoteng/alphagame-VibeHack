import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOORS, EXIT_APPROACH, EXIT_POINT, FURNITURE_RECTS, MAP_DEPTH, MAP_WIDTH, PLAYER_RADIUS } from '../core/config';
import type { DoorId, Point } from '../core/config';
import { distance } from '../core/map';
import type { RoundsGame } from '../core/state';
import { HumanRig } from './character';
import { ceilingMaterial, clothMaterial, plasterMaterial, tileMaterial } from './materials';

const HEIGHT = 2.8;
const metal = new THREE.MeshStandardMaterial({ color: 0xb7bec0, roughness: 0.36, metalness: 0.65 });
const trim = new THREE.MeshStandardMaterial({ color: 0xd3d9d3, roughness: 0.62, metalness: 0.1 });
const sage = new THREE.MeshStandardMaterial({ color: 0xb9c8bb, roughness: 0.78 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x485650, roughness: 0.9 });
const glass = new THREE.MeshStandardMaterial({ color: 0xc7dddd, roughness: 0.2, metalness: 0.12, transparent: true, opacity: 0.28, depthWrite: false });
/** 灯壳比灯面暗一档，避免顶灯变成一条条白光带。 */
const fixtureShell = new THREE.MeshStandardMaterial({ color: 0xc4ccc3, roughness: 0.7, metalness: 0.05 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, bevel = 0): THREE.Mesh {
  const object = new THREE.Mesh(bevel ? new RoundedBoxGeometry(w, h, d, 2, Math.min(bevel, w / 3, h / 3, d / 3)) : new THREE.BoxGeometry(w, h, d), mat);
  object.position.set(x, y, z);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function tube(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat = metal): THREE.Mesh {
  const axis = b.clone().sub(a);
  const object = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, axis.length(), 10), mat);
  object.position.copy(a).add(b).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  object.castShadow = true;
  return object;
}

function signTexture(text: string, subtitle: string, dark = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法绘制医院标识');
  ctx.fillStyle = dark ? '#29463b' : '#eef2ec'; ctx.fillRect(0, 0, 768, 240);
  ctx.fillStyle = dark ? '#f4f6ec' : '#29493e';
  ctx.font = '600 77px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center'; ctx.fillText(text, 384, 123, 720);
  ctx.fillStyle = dark ? '#b7cec2' : '#72897d';
  ctx.font = '28px sans-serif'; ctx.fillText(subtitle, 384, 184, 720);
  ctx.fillStyle = dark ? '#6b9980' : '#91ada0'; ctx.fillRect(20, 216, 728, 3);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function plaque(text: string, subtitle: string, w: number, h: number, dark = false): THREE.Mesh {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: signTexture(text, subtitle, dark) }));
}

/** 清洁、明亮的公立医院。模型比例、地图碰撞与门坐标沿用已有规则，不改路线。 */
export class HospitalRenderer {
  readonly scene = new THREE.Scene();
  readonly blockers: THREE.Object3D[] = [];
  readonly playerHuman = new HumanRig(false);
  readonly guardHuman = new HumanRig(true);
  readonly playerRig = this.playerHuman.group;
  readonly guardRig = this.guardHuman.group;
  private readonly lamps: THREE.PointLight[] = [];
  private readonly doors = new Map<DoorId, { panel: THREE.Mesh; progress: number }>();
  private readonly wardLamps: { lamp: THREE.Mesh; light: THREE.PointLight; point: Point }[] = [];
  private readonly route = new THREE.Group();
  private readonly ambient = new THREE.HemisphereLight(0xf4f6ef, 0x7c8883, 1.05);
  private readonly key = new THREE.DirectionalLight(0xf9fbf1, 1.15);
  /** 开灯效果 0→1 的混合值：实现“啪一下亮起”的短过渡，同时让环境光让位形成光池节奏。 */
  private lightsBlend = 0;
  /** 模型转身的角阻尼状态：逻辑 facing 保持瞬时，模型平滑扫过换向而不是瞬移。 */
  private playerYaw = 0;
  private guardYaw = 0;

  private dampFacing(current: number, target: number, dt: number): number {
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + delta * (1 - Math.exp(-14 * Math.max(0, dt)));
  }
  private readonly routeMaterial = new THREE.MeshBasicMaterial({ color: 0x2fa765, transparent: true, opacity: 0.95, depthWrite: false });
  private readonly arrowGeometry: THREE.ShapeGeometry;
  /** 需要静态合批的容器：构造完成后按材质把小网格合并，减少 draw call。 */
  private readonly staticRoots: THREE.Object3D[] = [];
  private diffuserMaterial = new THREE.MeshStandardMaterial({ color: 0xdfe8dd, emissive: 0xf4fcf0, emissiveIntensity: 0.55, roughness: 0.55 });
  private exitLamp!: THREE.Mesh;
  private exitSign!: THREE.Mesh;
  private exitLabel!: THREE.Mesh;
  private exitBeacon!: THREE.Group;
  private exitChannel!: THREE.Mesh;
  private previousPlayer: Point | null = null;
  private previousGuard: Point | null = null;
  private previousTime = 0;
  private routeUpdate = -1;
  private routeRevision = -1;
  private routeVisible = false;
  /** 搜索地面圈：值班员进入搜索时提示「最后已知位置」，离开即隐藏。 */
  private searchRing!: THREE.Mesh;

  constructor() {
    this.scene.background = new THREE.Color(0xced7d2);
    const arrow = new THREE.Shape();
    arrow.moveTo(-0.11, -0.18); arrow.lineTo(-0.11, 0.03); arrow.lineTo(-0.23, 0.03);
    arrow.lineTo(0, 0.27); arrow.lineTo(0.23, 0.03); arrow.lineTo(0.11, 0.03); arrow.lineTo(0.11, -0.18); arrow.closePath();
    this.arrowGeometry = new THREE.ShapeGeometry(arrow);
    this.buildRoom();
    this.buildLights();
    this.buildDepartments();
    this.buildFurniture();
    this.buildProps();
    this.buildDoors();
    this.mergeStaticGeometry();
    this.scene.add(this.playerRig, this.guardRig, this.route);
    this.searchRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.74, 40),
      new THREE.MeshBasicMaterial({ color: 0xb67a52, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.searchRing.rotation.x = -Math.PI / 2;
    this.searchRing.position.y = 0.02;
    this.searchRing.visible = false;
    this.scene.add(this.searchRing);
  }

  sync(game: RoundsGame, dt: number): void {
    const restarted = game.elapsed < this.previousTime;
    if (restarted) {
      this.playerHuman.reset(); this.guardHuman.reset();
      this.previousPlayer = this.previousGuard = null;
      this.routeUpdate = -1;
    }
    const playerMeters = this.previousPlayer ? distance(this.previousPlayer, game.player.position) : 0;
    const guardMeters = this.previousGuard ? distance(this.previousGuard, game.guard.position) : 0;
    this.playerHuman.animate(playerMeters < 1 ? playerMeters : 0, dt, game.player.sprinting);
    this.guardHuman.animate(guardMeters < 1 ? guardMeters : 0, dt, game.guard.mode === 'chase');
    this.playerRig.position.set(game.player.position.x, 0, game.player.position.z);
    this.guardRig.position.set(game.guard.position.x, 0, game.guard.position.z);
    if (restarted) {
      this.playerYaw = -game.player.facing;
      this.guardYaw = -game.guard.facing;
    }
    this.playerYaw = this.dampFacing(this.playerYaw, -game.player.facing, dt);
    this.guardYaw = this.dampFacing(this.guardYaw, -game.guard.facing, dt);
    this.playerRig.rotation.y = this.playerYaw;
    this.guardRig.rotation.y = this.guardYaw;
    this.previousPlayer = { ...game.player.position };
    this.previousGuard = { ...game.guard.position };
    this.previousTime = game.elapsed;

    for (const [id, entry] of this.doors) {
      const target = game.map.closedDoor === id ? 1 : 0;
      if (restarted) entry.progress = target;
      else entry.progress += (target - entry.progress) * Math.min(1, dt * 10);
      if (Math.abs(target - entry.progress) < 0.003) entry.progress = target;
      entry.panel.scale.y = Math.max(0.001, entry.progress * 2.72);
      entry.panel.visible = entry.progress > 0.005;
    }
    // 开灯反馈必须“看得见来源”：灯管爆亮、环境与主光让位，形成灯下亮、灯间暗的节奏，而不是整屏均匀变白。
    const lightsTarget = game.lightsOn ? 1 : 0;
    this.lightsBlend += (lightsTarget - this.lightsBlend) * Math.min(1, dt * 9);
    if (Math.abs(lightsTarget - this.lightsBlend) < 0.004) this.lightsBlend = lightsTarget;
    const lit = this.lightsBlend;
    // 规格要求“个别灯可轻微闪烁”：护士站旁与安全门附近两盏故障灯，
    // 双正弦拍频模拟镇流器接触不良，幅度 ≤12%，只动这两盏点光不影响整体亮度。
    const flicker = (seed: number): number => {
      const wave = Math.sin(game.elapsed * 13 + seed) * Math.sin(game.elapsed * 7.3 + seed * 2);
      return 1 + wave * 0.12 * Math.max(0, Math.sin(game.elapsed * 0.9 + seed));
    };
    for (let i = 0; i < this.lamps.length; i++) {
      const factor = i === 1 || i === 12 ? flicker(i * 2.7) : 1;
      this.lamps[i].intensity = (8.5 + lit * 13.5) * factor;
    }
    this.diffuserMaterial.emissiveIntensity = 0.55 + lit * 2.65;
    this.ambient.intensity = 1.05 - lit * 0.55;
    this.key.intensity = 1.15 - lit * 0.4;
    for (const ward of this.wardLamps) {
      const target = game.activeEffect?.id === 'broadcast' ? game.activeEffect.target : null;
      const active = !!target && target.x === ward.point.x && target.z === ward.point.z;
      const pulse = active ? 0.6 + Math.sin(game.elapsed * 5) * 0.4 : 0;
      (ward.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05 + pulse * 2;
      ward.light.intensity = pulse * 6;
    }
    const color = game.exitUnlocked ? 0x65c687 : 0xaa594c;
    (this.exitLamp.material as THREE.MeshStandardMaterial).color.setHex(color);
    (this.exitLamp.material as THREE.MeshStandardMaterial).emissive.setHex(color);
    (this.exitSign.material as THREE.MeshBasicMaterial).color.setHex(game.exitUnlocked ? 0xffffff : 0xb9c6bb);
    this.exitLabel.visible = game.exitUnlocked;
    this.exitBeacon.visible = game.exitUnlocked;
    this.exitChannel.visible = game.exitUnlocked;
    (this.exitLamp.material as THREE.MeshStandardMaterial).emissiveIntensity = game.exitUnlocked ? 1.5 : 0.6;
    const showRoute = game.lightsOn || game.exitUnlocked;
    if (showRoute && (!this.routeVisible || this.routeRevision !== game.map.revision || game.elapsed - this.routeUpdate >= 0.35 || restarted)) this.updateRoute(game);
    this.route.visible = showRoute;
    this.routeVisible = showRoute;

    const searching = game.guard.mode === 'search' || game.guard.mode === 'broadcast';
    const marker = game.guard.targetPoint ?? game.guard.position;
    // 追逐中不给搜索圈：那会让玩家误以为值班员已丢失自己。
    this.searchRing.visible = searching && game.phase === 'playing';
    if (this.searchRing.visible) {
      this.searchRing.position.set(marker.x, 0.02, marker.z);
      const pulse = 0.4 + Math.sin(game.elapsed * 3.4) * 0.18;
      (this.searchRing.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
  }

  playerPoint(): Point { return { x: this.playerRig.position.x, z: this.playerRig.position.z }; }

  snapshot() {
    return { humanCharacters: [this.playerRig.name, this.guardRig.name], lampIntensity: this.lamps[0]?.intensity, doors: Object.fromEntries([...this.doors].map(([id, entry]) => [id, entry.progress])), routeArrows: this.route.visible ? this.route.children.length : 0, wardLights: this.wardLamps.map(ward => ward.light.intensity), searchMarker: this.searchRing.visible ? { x: this.searchRing.position.x, z: this.searchRing.position.z } : null };
  }

  private buildRoom(): void {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAP_WIDTH, MAP_DEPTH), tileMaterial());
    floor.rotation.x = -Math.PI / 2; floor.position.set(15, 0, 11); floor.receiveShadow = true;
    this.scene.add(floor);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(MAP_WIDTH, MAP_DEPTH), ceilingMaterial());
    ceiling.rotation.x = Math.PI / 2; ceiling.position.set(15, HEIGHT, 11);
    this.scene.add(ceiling);
    this.blockers.push(ceiling);
    const plaster = plasterMaterial();
    const walls = [
      [30, HEIGHT, 0.25, 15, HEIGHT / 2, 2.875], [30, HEIGHT, 0.25, 15, HEIGHT / 2, 19.125],
      [0.25, HEIGHT, 16, 2.875, HEIGHT / 2, 11], [0.25, HEIGHT, 16, 27.125, HEIGHT / 2, 11],
      [5, HEIGHT, 10, 8.5, HEIGHT / 2, 11], [11, HEIGHT, 10, 18.5, HEIGHT / 2, 11],
      [2, HEIGHT, 8.8, 12, HEIGHT / 2, 11.6],
    ];
    for (const [w,h,d,x,y,z] of walls) {
      const wall = box(w,h,d,plaster,x,y,z); this.scene.add(wall); this.blockers.push(wall);
    }
    // 薄墙裙、防撞护栏、踢脚线都在原有实体边界，不增加走廊瓶颈。
    this.wallFace(15,3.003,24,0); this.wallFace(15,18.997,24,Math.PI);
    this.wallFace(3.003,11,16,Math.PI/2); this.wallFace(26.997,11,16,-Math.PI/2);
    this.wallFace(8.5,5.997,5,Math.PI); this.wallFace(18.5,5.997,11,Math.PI);
    this.wallFace(15,16.003,18,0); this.wallFace(5.997,11,10,-Math.PI/2); this.wallFace(24.003,11,10,Math.PI/2);
    this.wallFace(12,7.197,2,Math.PI);
    // 每 3 m 的竖向墙板缝：让长走廊有真实尺度，而不是一整面灰墙。
    const seamMaterial = new THREE.MeshStandardMaterial({ color: 0xd8ddd3, roughness: 0.9 });
    const seams = new THREE.Group();
    const seam = (x: number, z: number, length: number, horizontal: boolean) => {
      for (let at = -length / 2 + 1.5; at < length / 2; at += 3) {
        const panel = horizontal
          ? box(0.022, 2.62, 0.01, seamMaterial, x + at, 1.42, z)
          : box(0.01, 2.62, 0.022, seamMaterial, x, 1.42, z + at);
        panel.castShadow = false;
        seams.add(panel);
      }
    };
    seam(15, 3.012, 24, true); seam(15, 18.988, 24, true);
    seam(3.012, 11, 16, false); seam(26.988, 11, 16, false);
    seam(8.5, 5.988, 5, true); seam(18.5, 5.988, 11, true);
    seam(15, 16.012, 18, true);
    this.staticRoots.push(seams);
    this.scene.add(seams);
    // 走廊墙上的宣传栏与消防箱，让中远景有可辨认的医院细节。
    const notice = plaque('陪护须知', 'VISITING HOURS 08:00–20:00', 1.05, 0.62);
    notice.position.set(20.2, 1.62, 5.985); notice.rotation.y = Math.PI; this.scene.add(notice);
    const fireBox = box(0.42, 0.62, 0.09, new THREE.MeshStandardMaterial({ color: 0xb45a4c, roughness: 0.5 }), 9.4, 1.35, 5.98, 0.012);
    this.scene.add(fireBox);
    const fireSign = plaque('灭火器', 'FIRE', 0.24, 0.1); fireSign.position.set(9.4, 1.74, 5.925); fireSign.rotation.y = Math.PI; this.scene.add(fireSign);
    const wardNotice = plaque('夜班巡查记录', 'NIGHT ROUNDS / 02:00', 1.1, 0.6);
    wardNotice.position.set(17.4, 1.6, 18.985); wardNotice.rotation.y = Math.PI; this.scene.add(wardNotice);
  }

  private wallFace(x: number, z: number, length: number, yaw: number): void {
    const group = new THREE.Group(); group.position.set(x,0,z); group.rotation.y = yaw;
    group.add(box(length,0.88,0.008,sage,0,0.51,0));
    group.add(box(length,0.042,0.035,trim,0,0.99,0.02,0.008));
    group.add(box(length,0.085,0.016,rubber,0,0.048,0.012));
    this.staticRoots.push(group);
    this.scene.add(group);
  }

  /**
   * 把 staticRoots 容器里的全部静态网格按材质实例合并成少量大网格：
   * 缝、格栅、墙裙、灯壳、床架、药品柜原本各有几十上百个 draw call，
   * 合并后每种材质只剩 1 个。标识（MeshBasicMaterial）与透明玻璃保持独立。
   */
  private mergeStaticGeometry(): void {
    this.scene.updateMatrixWorld(true);
    const buckets = new Map<THREE.Material, { geometries: THREE.BufferGeometry[]; castShadow: boolean }>();
    const removed: THREE.Mesh[] = [];
    for (const root of this.staticRoots) {
      root.updateMatrixWorld(true);
      root.traverse(node => {
        if (!(node instanceof THREE.Mesh) || node.material instanceof THREE.MeshBasicMaterial) return;
        const material = node.material as THREE.Material;
        if (material.transparent) return;
        const bucket = buckets.get(material) ?? { geometries: [], castShadow: false };
        bucket.castShadow ||= node.castShadow;
        // RoundedBoxGeometry 是非索引几何，Box/Cylinder 是索引几何；统一转成非索引才能合并。
        const source = node.geometry.clone();
        source.applyMatrix4(node.matrixWorld);
        const geometry = source.index ? source.toNonIndexed() : source;
        if (geometry !== source) source.dispose();
        bucket.geometries.push(geometry);
        buckets.set(material, bucket);
        removed.push(node);
      });
    }
    for (const mesh of removed) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    for (const [material, bucket] of buckets) {
      const merged = mergeGeometries(bucket.geometries);
      if (!merged) throw new Error('静态几何合并失败');
      for (const geometry of bucket.geometries) geometry.dispose();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  private buildLights(): void {
    this.scene.add(this.ambient);
    const key = this.key;
    key.position.set(17,10,10); key.target.position.set(15,0,11);
    key.castShadow = true; key.shadow.mapSize.set(2048,2048);
    Object.assign(key.shadow.camera, { left: -17, right: 17, top: 13, bottom: -13, near: 0.5, far: 22 });
    key.shadow.bias = -0.0008; key.shadow.normalBias = 0.035; key.shadow.radius = 3;
    this.scene.add(key,key.target);
    const positions: [number,number,boolean][] = [];
    for (const x of [5,10,15,20,25]) { positions.push([x,4.5,true],[x,17.5,true]); }
    for (const z of [8,11,14]) { positions.push([4.5,z,false],[25.5,z,false]); }
    const fixtures = new THREE.Group();
    for (const [x,z,horizontal] of positions) {
      const housing = box(horizontal ? 1.35 : 0.28, 0.055, horizontal ? 0.28 : 1.35, fixtureShell, x, 2.75, z, 0.018);
      const diffuser = box(horizontal ? 1.18 : 0.2, 0.022, horizontal ? 0.2 : 1.18, this.diffuserMaterial, x, 2.712, z, 0.009);
      // 只需向下照亮地面：不投射阴影、不到处反射白光，避免天花出现一条条刺眼白条。
      housing.castShadow = false;
      housing.receiveShadow = false;
      diffuser.castShadow = false;
      diffuser.receiveShadow = false;
      fixtures.add(housing, diffuser);
      const lamp = new THREE.PointLight(0xebf3ef, 8.5, 7.5, 2); lamp.position.set(x, 2.5, z);
      this.lamps.push(lamp); this.scene.add(lamp);
    }
    this.staticRoots.push(fixtures);
    this.scene.add(fixtures);
    // 远处可见的通风格栅，让天花不再是空白盒盖。
    const vents = new THREE.Group();
    for (const x of [7.5,17.5,22.5]) for (const z of [4.5,17.5]) {
      vents.add(box(0.48,0.02,0.32,trim,x,2.786,z));
      for (let i = 0; i < 7; i++) vents.add(box(0.38,0.006,0.013,metal,x,2.769,z - 0.12 + i * 0.04));
    }
    this.staticRoots.push(vents);
    this.scene.add(vents);
  }

  private buildDepartments(): void {
    const nursing = plaque('护士站', 'NURSE STATION / 01', 1.8,0.5,true);
    nursing.position.set(12,2.21,7.18); nursing.rotation.y = Math.PI; this.scene.add(nursing);
    this.scene.add(box(1.9,0.92,0.035,sage,12,0.46,7.177));
    this.scene.add(box(1.98,0.04,0.055,trim,12,0.95,7.168,0.008));
    const window = box(1.75,0.83,0.015,glass,12,1.48,7.17); window.castShadow = false; this.scene.add(window);
    this.scene.add(box(0.018,0.85,0.022,metal,12,1.48,7.155));
    const chart = plaque('值班记录', '02:00 巡查 / 03:00 交班',0.85,0.56);
    chart.position.set(8.3,1.85,5.977); chart.rotation.y = Math.PI; this.scene.add(chart);
    const pharmacy = plaque('药房', 'PHARMACY / 配药窗口',1.8,0.52,true);
    pharmacy.position.set(20,2.17,16.02); this.scene.add(pharmacy);
    const pharmacyWindow = box(1.85,0.85,0.018,glass,20,1.48,16.025); pharmacyWindow.castShadow = false; this.scene.add(pharmacyWindow);
    this.scene.add(box(1.9,0.045,0.04,trim,20,1.02,16.03));
    const directions = plaque('住院部 01    → 安全门', 'INPATIENT DEPARTMENT / EAST EXIT',2.35,0.56,true);
    directions.position.set(9.2,2.1,3.01); this.scene.add(directions);
    const south = plaque('← 病房 01     安全门 →','SOUTH CORRIDOR',2.15,0.51,true);
    south.position.set(18.2,2.17,18.99); south.rotation.y = Math.PI; this.scene.add(south);

    for (const [x,yaw,number,point] of [[5.98,-Math.PI/2,'01',{x:4.5,z:11}],[24.02,Math.PI/2,'02',{x:25.5,z:11}]] as const) {
      const group = new THREE.Group(); group.position.set(x,0,11); group.rotation.y = yaw;
      const wood = new THREE.MeshStandardMaterial({ color:0x98b3a4,roughness:0.72 });
      group.add(box(1.52,2.17,0.016,wood,0,1.085,0));
      group.add(box(1.64,0.1,0.06,trim,0,2.18,0.006));
      for (const side of [-1,1]) group.add(box(0.07,2.2,0.06,trim,side*0.8,1.1,0.006));
      group.add(box(0.29,0.55,0.03,glass,-0.32,1.6,0.02));
      group.add(box(0.14,0.03,0.025,metal,0.49,1.02,0.028));
      const sign = plaque(`病房 ${number}`, 'WARD / 呼叫中心',1.16,0.37,true); sign.position.set(0,2.47,0.018); group.add(sign);
      const lampMat = new THREE.MeshStandardMaterial({ color:0xf0dca0,emissive:0xe9c981,emissiveIntensity:0.05,roughness:0.3 });
      const lamp = box(0.19,0.09,0.06,lampMat,0.65,2.47,0.027,0.018); group.add(lamp);
      const call = plaque('呼叫','CALL',0.16,0.15); call.position.set(0.94,1.3,0.018); group.add(call);
      this.scene.add(group);
      const light = new THREE.PointLight(0xffd890,0,5,2); light.position.set(point.x,2.0,point.z);
      this.scene.add(light); this.wardLamps.push({ lamp,light,point });
    }
  }

  private buildFurniture(): void {
    const linen = clothMaterial(0xe8ede5);
    const sheet = clothMaterial(0xd6e2d7);
    const shell = new THREE.MeshStandardMaterial({ color:0xe1e8df,roughness:0.55,metalness:0.15 });
    const vialColors = [0xd5e8e7,0xdce6c9,0xc7d5df,0xe3cfb4].map(color => new THREE.MeshStandardMaterial({ color, roughness:0.35 }));
    for (const rect of FURNITURE_RECTS) {
      const w = rect.maxX-rect.minX, d = rect.maxZ-rect.minZ;
      const cx = (rect.minX+rect.maxX)/2, cz = (rect.minZ+rect.maxZ)/2;
      if (w > 1.5) {
        const bed = new THREE.Group(); bed.position.set(cx,0,cz);
        bed.add(box(w-0.08,0.08,d-0.08,metal,0,0.49,0,0.016));
        bed.add(box(w-0.14,0.19,d-0.15,linen,0,0.635,0,0.058));
        bed.add(box(0.48,0.12,d-0.24,linen,-0.61,0.78,0,0.042));
        for (const x of [-0.82,0.82]) for (const z of [-0.36,0.36]) {
          bed.add(tube(new THREE.Vector3(x,0.12,z),new THREE.Vector3(x,0.51,z),0.024));
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.078,0.078,0.039,12),rubber);
          wheel.rotation.x = Math.PI/2; wheel.position.set(x,0.085,z); bed.add(wheel);
        }
        for (const z of [-0.46,0.46]) {
          bed.add(tube(new THREE.Vector3(-0.91,0.9,z),new THREE.Vector3(0.91,0.9,z),0.021));
          for (const x of [-0.91,-0.4,0.4,0.91]) bed.add(tube(new THREE.Vector3(x,0.53,z),new THREE.Vector3(x,0.9,z),0.019));
        }
        bed.add(box(1.16,0.035,0.78,sheet,0.33,0.751,0,0.012));
        this.staticRoots.push(bed);
        this.scene.add(bed);
      } else {
        const cabinet = new THREE.Group(); cabinet.position.set(cx,0,cz); cabinet.rotation.y = cx<15 ? Math.PI/2 : -Math.PI/2;
        cabinet.add(box(1,0.08,1,shell,0,0.14,0)); cabinet.add(box(1,0.07,1,shell,0,1.82,0));
        cabinet.add(box(1,1.65,0.04,shell,0,0.96,-0.48));
        for (const side of [-1,1]) {
          const panel = box(0.04,1.66,1,shell,side*0.48,0.965,0); cabinet.add(panel);
        }
        for (let shelf=0;shelf<3;shelf++) {
          const y = 0.42+shelf*0.45;
          cabinet.add(box(0.9,0.032,0.86,metal,0,y,0));
          for (let bottle=0;bottle<4;bottle++) {
            const vial = new THREE.Mesh(new THREE.CylinderGeometry(0.037,0.042,0.17,10),vialColors[bottle]); vial.position.set(-0.3+bottle*0.2,y+0.105,0.25); cabinet.add(vial);
            cabinet.add(box(0.056,0.055,0.005,trim,-0.3+bottle*0.2,y+0.1,0.294));
          }
        }
        const front = box(0.92,1.55,0.01,glass,0,1.01,0.49); front.castShadow=false; cabinet.add(front);
        cabinet.add(box(0.02,1.6,0.03,metal,0,1.01,0.48));
        cabinet.add(box(0.025,0.19,0.04,metal,0.058,1.0,0.49));
        const label = plaque('药品柜','MEDICINE',0.57,0.14); label.position.set(0,1.73,0.502); cabinet.add(label);
        this.staticRoots.push(cabinet);
        this.scene.add(cabinet);
        const blocker = box(w,1.85,d,new THREE.MeshBasicMaterial({ visible:false }),cx,0.925,cz);
        this.blockers.push(blocker); this.scene.add(blocker);
      }
    }
  }

  /**
   * 走廊内容加密：悬挂指示牌、挂钟、海报、输液架、洗手液、绿植、摄像头与地面导引条。
   * 全部是纯视觉件，不进碰撞与导航——贴墙件厚度 ≤0.3 m，落在玩家中心半径（0.35 m）够不到的死区，
   * 不会出现穿模；新材质进入 staticRoots 后照常按材质合批。
   */
  private buildProps(): void {
    const clockFace = new THREE.MeshStandardMaterial({ color: 0xf5f5ee, roughness: 0.4 });
    const clockDark = new THREE.MeshStandardMaterial({ color: 0x3a423c, roughness: 0.5 });
    const plantLeaf = new THREE.MeshStandardMaterial({ color: 0x4d7d55, roughness: 0.95, flatShading: true });
    const ivBag = new THREE.MeshStandardMaterial({ color: 0xeff2e6, roughness: 0.55 });
    const guide = new THREE.MeshStandardMaterial({ color: 0x86a891, roughness: 0.85 });

    // 地面导引条：出生点 → 北走廊 → 东走廊 → 安全门，第一次游玩也能顺着绿线找到门。
    const stripA = box(13.4, 0.004, 0.14, guide, 17.9, 0.0065, 3.78);
    const stripB = box(0.14, 0.004, 7.2, guide, 24.55, 0.0065, 7.35);
    for (const strip of [stripA, stripB]) { strip.castShadow = false; strip.receiveShadow = true; this.scene.add(strip); }
    const props = new THREE.Group();

    // 挂钟 ×2：中央建筑南北墙面。
    for (const [x, z, flip] of [[8, 5.955, 1], [22, 16.045, -1]] as const) {
      const clock = new THREE.Group(); clock.position.set(x, 2.02, z);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 24), trim);
      rim.rotation.x = Math.PI / 2; rim.castShadow = true; clock.add(rim);
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.132, 0.132, 0.034, 24), clockFace);
      face.rotation.x = Math.PI / 2; face.castShadow = false; clock.add(face);
      const minute = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.006), clockDark);
      minute.position.set(0, 0.04 * flip, 0.021 * flip); minute.rotation.z = -0.7; clock.add(minute);
      const hour = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.065, 0.006), clockDark);
      hour.position.set(0, 0.028 * flip, 0.021 * flip); hour.rotation.z = 2.1; clock.add(hour);
      props.add(clock);
    }

    // 悬挂指示牌 ×2：走廊中途，双面可读，指向安全门。
    const hang = (x: number, z: number, alongZ: boolean, text: string, sub: string): void => {
      const group = new THREE.Group(); group.position.set(x, 2.02, z);
      const width = 1.35, height = 0.3;
      for (const side of [-1, 1]) {
        const face = plaque(text, sub, width, height, true);
        face.rotation.y = alongZ ? (side > 0 ? 0 : Math.PI) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        face.position.x = alongZ ? 0 : side * 0.028;
        face.position.z = alongZ ? side * 0.028 : 0;
        group.add(face);
      }
      group.add(box(width, 0.035, 0.07, trim, 0, height / 2 + 0.02, 0, 0.012));
      for (const side of [-1, 1]) {
        const rod = box(0.018, 0.62, 0.018, metal, alongZ ? side * width * 0.35 : 0, height / 2 + 0.34, alongZ ? 0 : side * width * 0.35);
        group.add(rod);
      }
      props.add(group);
    };
    hang(16.5, 4.5, false, '安全门 →', 'SAFETY EXIT / EAST');
    hang(25.5, 8.2, true, '安全门 ↑', 'EXIT AHEAD');

    // 输液架 ×3：病房门旁贴墙。
    const ivStand = (x: number, z: number, lean: number): void => {
      const group = new THREE.Group(); group.position.set(x, 0, z); group.rotation.y = lean;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.72, 10), metal);
      pole.position.y = 0.9; pole.castShadow = true; group.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.025, 16), metal);
      base.position.y = 0.012; base.castShadow = true; group.add(base);
      group.add(box(0.24, 0.016, 0.016, metal, 0, 1.71, 0));
      group.add(box(0.016, 0.05, 0.016, metal, 0.11, 1.68, 0));
      const bag = box(0.075, 0.15, 0.032, ivBag, 0.105, 1.58, 0, 0.012);
      group.add(bag);
      props.add(group);
    };
    ivStand(5.8, 10.15, 0);
    ivStand(5.8, 11.85, Math.PI);
    ivStand(24.2, 10.3, 0);

    // 洗手液 ×2：病房门侧墙面。
    for (const [x, z, flip] of [[5.955, 9.35, 1], [24.045, 12.6, -1]] as const) {
      const group = new THREE.Group(); group.position.set(x, 1.22, z);
      group.add(box(0.09, 0.3, 0.13, sage, 0, 0, 0, 0.02));
      group.add(box(0.02, 0.24, 0.08, clockDark, 0.045 * flip, 0, 0));
      props.add(group);
    }

    // 绿植 ×3：护士站凹间两侧与东北角。
    const plant = (x: number, z: number): void => {
      const group = new THREE.Group(); group.position.set(x, 0, z);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.078, 0.24, 14), sage);
      pot.position.y = 0.12; pot.castShadow = true; group.add(pot);
      const lower = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), plantLeaf);
      lower.position.y = 0.36; lower.castShadow = true; group.add(lower);
      const upper = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), plantLeaf);
      upper.position.set(0.04, 0.52, 0.02); upper.castShadow = true; group.add(upper);
      props.add(group);
    };
    plant(11.35, 7.0);
    plant(12.65, 7.0);
    plant(26.45, 3.5);

    // 摄像头 ×2：走廊两角俯瞰。
    const camera = (x: number, z: number, yaw: number): void => {
      const group = new THREE.Group(); group.position.set(x, 2.62, z); group.rotation.y = yaw;
      group.add(box(0.028, 0.028, 0.2, metal, 0, 0.1, -0.06));
      group.add(box(0.1, 0.075, 0.24, fixtureShell, 0, 0, 0.06, 0.015));
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 12), clockDark);
      lens.rotation.x = Math.PI / 2; lens.position.set(0, 0, 0.19); group.add(lens);
      props.add(group);
    };
    camera(26.85, 3.2, Math.PI * 0.75);
    camera(3.15, 18.8, -Math.PI * 0.25);

    this.staticRoots.push(props);
    this.scene.add(props);

    // 海报 ×3：外墙面（含安全门旁的消防疏散图）。
    const hygiene = plaque('勤洗手 · 手卫生', 'HAND HYGIENE / 5 MOMENTS', 0.72, 0.5);
    hygiene.position.set(13.5, 1.7, 3.015); this.scene.add(hygiene);
    const evacuation = plaque('消防安全疏散图', 'EVACUATION MAP / EAST EXIT', 0.66, 0.56);
    evacuation.position.set(26.985, 1.6, 12.3); evacuation.rotation.y = -Math.PI / 2; this.scene.add(evacuation);
    const admission = plaque('住院须知', 'ADMISSION GUIDE', 0.72, 0.5);
    admission.position.set(8.5, 1.7, 18.985); admission.rotation.y = Math.PI; this.scene.add(admission);
  }

  private buildDoors(): void {
    const shutterTexture = new THREE.CanvasTexture((() => {
      const canvas = document.createElement('canvas'); canvas.width=128; canvas.height=512;
      const ctx=canvas.getContext('2d')!; ctx.fillStyle='#bfc7c2'; ctx.fillRect(0,0,128,512);
      for (let y=0;y<512;y+=24) { ctx.fillStyle='#8c9992'; ctx.fillRect(0,y,128,2); ctx.fillStyle='#dce3dc'; ctx.fillRect(0,y+2,128,1); }
      return canvas;
    })()); shutterTexture.colorSpace=THREE.SRGBColorSpace;
    const shutter = new THREE.MeshStandardMaterial({ map:shutterTexture,roughness:0.5,metalness:0.4 });
    for (const id of ['A','B'] as const) {
      const door = DOORS[id], z=door.center.z;
      const frame = new THREE.Group();
      frame.add(box(0.28,0.17,3,metal,15,2.715,z));
      for (const side of [-1,1]) frame.add(box(0.22,2.65,0.10,metal,15,1.325,z+side*1.45));
      this.staticRoots.push(frame);
      this.scene.add(frame);
      const geometry = new THREE.BoxGeometry(0.2,1,3); geometry.translate(0,-0.5,0);
      const panel = new THREE.Mesh(geometry,shutter); panel.position.set(15,2.72,z); panel.scale.y=0.001; panel.visible=false;
      panel.castShadow=panel.receiveShadow=true; this.scene.add(panel); this.blockers.push(panel);
      this.doors.set(id,{ panel,progress:0 });
      for (const side of [-1,1]) {
        const tag=plaque(`防火门 ${id}`,'FIRE DOOR / 自动关闭',1.1,0.27,true); tag.position.set(15+side*0.145,2.56,z); tag.rotation.y=side*Math.PI/2; this.scene.add(tag);
      }
    }
    const exit = new THREE.Group(); exit.position.set(EXIT_POINT.x-0.01,0,EXIT_POINT.z); exit.rotation.y=-Math.PI/2;
    const doorMaterial=new THREE.MeshStandardMaterial({ color:0xc2d6c4,roughness:0.7,metalness:0.06 });
    exit.add(box(1.85,2.27,0.035,doorMaterial,0,1.135,0));
    for (const side of [-1,1]) {
      exit.add(box(0.09,2.3,0.06,trim,side*0.96,1.15,0.025));
      exit.add(box(0.67,0.04,0.06,metal,side*0.46,1.05,0.052,0.012));
      exit.add(box(0.3,0.53,0.02,glass,side*0.47,1.7,0.022));
    }
    exit.add(box(2,0.09,0.08,trim,0,2.3,0.02));
    this.exitSign=plaque('安全出口','EMERGENCY EXIT',1.48,0.37,true); this.exitSign.position.set(0,2.57,0.03); exit.add(this.exitSign);
    this.exitLamp=box(0.08,0.08,0.04,new THREE.MeshStandardMaterial({ color:0xaa594c,emissive:0xaa594c,emissiveIntensity:0.6 }),1.1,1.52,0.035,0.01); exit.add(this.exitLamp);
    // 通电后：门框绿色导引灯条 + 门内柔和光，让「已通电」在远处就能看出来。
    this.exitBeacon = new THREE.Group();
    const beaconColor = new THREE.MeshStandardMaterial({ color: 0x62c987, emissive: 0x4cc574, emissiveIntensity: 2.2, roughness: 0.35 });
    this.exitBeacon.add(box(0.05, 2.05, 0.05, beaconColor, 1.02, 1.14, 0.03, 0.01));
    this.exitBeacon.add(box(0.05, 2.05, 0.05, beaconColor, 1.02, 1.14, -0.03, 0.01));
    const innerLight = new THREE.PointLight(0x8fe3a6, 3.4, 4.2, 2);
    innerLight.position.set(0.5, 1.75, 0);
    this.exitBeacon.add(innerLight);
    exit.add(this.exitBeacon);
    this.exitChannel = box(0.72, 0.015, 1.9, new THREE.MeshBasicMaterial({ color: 0x7edb97, transparent: true, opacity: 0.5, depthWrite: false }), 0.38, 0.014, 0);
    exit.add(this.exitChannel);
    this.exitLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.34), new THREE.MeshBasicMaterial({ map: signTexture('已解锁', 'EXIT OPEN') }));
    this.exitLabel.position.set(0.02, 1.9, 0.024);
    exit.add(this.exitLabel);
    this.exitBeacon.visible = this.exitChannel.visible = this.exitLabel.visible = false;
    this.scene.add(exit);
  }

  private updateRoute(game: RoundsGame): void {
    this.route.clear();
    const path=game.map.findPath(game.player.position,EXIT_APPROACH,PLAYER_RADIUS);
    let start=game.player.position;
    for (const point of path) {
      const length=distance(start,point);
      for (let at=1.1;at<length;at+=1.25) {
        const arrow=new THREE.Mesh(this.arrowGeometry,this.routeMaterial);
        arrow.position.set(start.x+(point.x-start.x)*at/length,0.017,start.z+(point.z-start.z)*at/length);
        arrow.rotation.set(-Math.PI/2,0,Math.atan2(point.x-start.x,-(point.z-start.z)));
        this.route.add(arrow);
      }
      start=point;
    }
    this.routeUpdate=game.elapsed; this.routeRevision=game.map.revision;
  }
}

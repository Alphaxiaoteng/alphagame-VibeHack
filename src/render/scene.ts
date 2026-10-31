import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DOORS, EXIT_APPROACH, EXIT_POINT, FURNITURE_RECTS, MAP_DEPTH, MAP_WIDTH, PLAYER_RADIUS } from '../core/config';
import type { DoorId, Point } from '../core/config';
import { distance } from '../core/map';
import type { RoundsGame } from '../core/state';
import { HumanRig } from './character';
import { ceilingMaterial, clothMaterial, plasterMaterial, tileMaterial } from './materials';
import type { SkinDef, ThemeId } from '../core/economy';
import { AssetRegistry } from '../core/assetRegistry';
import type { AssetCategory, AssetEntry } from '../core/assetRegistry';
import { ModelLoaderService } from './modelLoader';

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
  /** 静态地面导引条：安全门通电后让位给动态路线箭头。 */
  private readonly guideStrips: THREE.Mesh[] = [];
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

  readonly bedSlots: Array<{ slot: THREE.Group; procedural: THREE.Group }> = [];
  readonly cabinetSlots: Array<{ slot: THREE.Group; procedural: THREE.Group }> = [];
  nurseCounterSlot: { slot: THREE.Group; procedural: THREE.Group } | null = null;
  private wardenModelInstance: THREE.Group | null = null;
  exitDoorLeft: THREE.Group | null = null;
  exitDoorRight: THREE.Group | null = null;
  outdoorLight: THREE.PointLight | null = null;
  outdoorSunlight: THREE.Mesh | null = null;
  private wardenMixer: THREE.AnimationMixer | null = null;
  private wardenWalkAction: THREE.AnimationAction | null = null;
  private wardenIdleAction: THREE.AnimationAction | null = null;
  wardenAnimatedModel: THREE.Group | null = null;
  wardenFlashlightSpot: THREE.SpotLight | null = null;

  /** 异步加载并接入 Tripo 生成的带骨骼与 walk/idle 动画的高精 3D 值班员 */
  private async loadAnimatedWarden(): Promise<void> {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync('/models/warden_animated.glb');
      const model = gltf.scene;

      // 归一化缩放到真人身高 1.82m
      const bbox = new THREE.Box3().setFromObject(model);
      const size = bbox.getSize(new THREE.Vector3());
      const targetHeight = 1.82;
      const scale = targetHeight / Math.max(size.y, 0.001);
      model.scale.setScalar(scale);

      // 脚底吸附到 Y = 0，中心对齐
      const center = bbox.getCenter(new THREE.Vector3());
      model.position.set(-center.x * scale, -bbox.min.y * scale, -center.z * scale);
      // 游戏内 guardRig 统一以本地 +X 为面朝前进方向，Tripo 角色旋转 -Math.PI / 2 对齐到 +X
      model.rotation.y = -Math.PI / 2;

      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // 骨骼动画初始化
      if (gltf.animations && gltf.animations.length > 0) {
        this.wardenMixer = new THREE.AnimationMixer(model);
        const walkClip = gltf.animations.find((a) => a.name.toLowerCase().includes('walk')) || gltf.animations[1] || gltf.animations[0];
        const idleClip = gltf.animations.find((a) => a.name.toLowerCase().includes('idle')) || gltf.animations[0];

        if (walkClip) {
          this.wardenWalkAction = this.wardenMixer.clipAction(walkClip);
          this.wardenWalkAction.play();
          this.wardenWalkAction.setEffectiveWeight(0);
        }
        if (idleClip) {
          this.wardenIdleAction = this.wardenMixer.clipAction(idleClip);
          this.wardenIdleAction.play();
          this.wardenIdleAction.setEffectiveWeight(1.0);
        }
      }

      // 战术巡逻手电筒动态前向光束
      const spot = new THREE.SpotLight(0xfff5d6, 4.2, 18, Math.PI / 6.5, 0.35, 1.2);
      spot.position.set(0.2, 1.15, 0.1);
      const spotTarget = new THREE.Object3D();
      spotTarget.position.set(8.0, 0.2, 0); // 前向投射到走廊地面
      this.guardRig.add(spot);
      this.guardRig.add(spotTarget);
      spot.target = spotTarget;
      this.wardenFlashlightSpot = spot;

      // 挂载至 guardRig 并隐藏兜底的程序化身体
      this.wardenAnimatedModel = model;
      this.guardRig.add(model);
      this.guardHuman.body.visible = false;
      console.log('Tripo 3D 骨骼动画值班员成功装配至场景！');
    } catch (err) {
      console.warn('Tripo 动画值班员加载备用回退:', err);
    }
  }

  /** 异步加载并接入 Tripo 生成的高精 3D 医用抢救推车（贴北墙死角放置，通道留白极大，零阻挡走廊行动） */
  private loadCrashCart(): void {
    const cartGroup = new THREE.Group();
    // 贴北走廊北墙死角 (x=10.2, z=3.35, yaw=Math.PI)，深度仅 0.45m，走廊净宽度超过 2.3m
    cartGroup.position.set(10.2, 0, 3.35);
    cartGroup.rotation.y = Math.PI;

    const loader = new GLTFLoader();
    loader.load(
      '/models/crash_cart.glb',
      (gltf) => {
        const model = gltf.scene;
        const bbox = new THREE.Box3().setFromObject(model);
        const size = bbox.getSize(new THREE.Vector3());
        const targetHeight = 0.95; // 真实医疗抢救车标准台面高度 0.95m
        const scale = targetHeight / Math.max(size.y, 0.001);
        model.scale.setScalar(scale);

        const center = bbox.getCenter(new THREE.Vector3());
        model.position.set(-center.x * scale, -bbox.min.y * scale, -center.z * scale);

        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        cartGroup.add(model);
        console.log('Tripo 3D 医用抢救推车成功装配至场景！');
      },
      undefined,
      (err) => console.warn('Crash cart model loading fallback:', err)
    );

    this.scene.add(cartGroup);
  }

  public applyTheme(): void {
    const theme = AssetRegistry.get().getActiveTheme();
    this.scene.background = new THREE.Color(theme.wallColor);
    this.ambient.color.set(theme.wallColor);
    this.ambient.groundColor.set(theme.floorColor);
  }

  public async equipAsset(category: AssetCategory, asset: AssetEntry): Promise<void> {
    try {
      const model = await ModelLoaderService.get().loadNormalizedModel(asset.glbUrl, category);
      if (category === 'bed') {
        for (const b of this.bedSlots) {
          b.slot.clear();
          b.slot.add(model.clone(true));
        }
      } else if (category === 'cabinet') {
        for (const c of this.cabinetSlots) {
          c.slot.clear();
          c.slot.add(model.clone(true));
        }
      } else if (category === 'nurse_counter') {
        if (this.nurseCounterSlot) {
          this.nurseCounterSlot.slot.clear();
          this.nurseCounterSlot.slot.add(model.clone(true));
        }
      } else if (category === 'warden') {
        // 守卫采用包含肢体摆动、屈膝与巡逻手电筒的 HumanRig 骨架，保持动作生动自然
        this.guardHuman.body.visible = true;
        if (this.wardenModelInstance) {
          this.wardenModelInstance.removeFromParent();
          this.wardenModelInstance = null;
        }
      }
    } catch (e) {
      console.error(`Failed to equip ${category} (${asset.name}):`, e);
      throw e;
    }
  }

  public async syncEffectiveAssets(): Promise<void> {
    const registry = AssetRegistry.get();
    const categories: AssetCategory[] = ['bed', 'cabinet', 'nurse_counter', 'warden'];
    for (const cat of categories) {
      try {
        const asset = registry.getEffectiveAsset(cat);
        if (asset) {
          await this.equipAsset(cat, asset);
        }
      } catch (e) {
        console.warn('Sync asset failed:', cat, e);
      }
    }
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
    this.applyTheme();
    AssetRegistry.get().subscribe(() => this.applyTheme());
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
    // 注册资产热切换监听
    AssetRegistry.get().subscribe(() => {
      this.syncEffectiveAssets().catch((e) => console.warn('Asset change sync failed:', e));
    });
    // 首帧程序化网格 0ms 瞬间渲染，随后后台空闲异步自动将真实 3D 模型装配至插槽，零白屏且恒定 60 FPS
    setTimeout(() => {
      this.syncEffectiveAssets().catch((e) => console.warn('Asset initial sync failed:', e));
    }, 120);
    this.searchRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.74, 40),
      new THREE.MeshBasicMaterial({ color: 0xb67a52, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.searchRing.rotation.x = -Math.PI / 2;
    this.searchRing.position.y = 0.02;
    this.searchRing.visible = false;
    this.scene.add(this.searchRing);
    // 异步加载 Tripo 导出的带真实骨骼与行走动画的 3D 值班员模型
    this.loadAnimatedWarden();
    // 异步加载 Tripo 导出的高精 3D 医用抢救推车（贴北墙放置，零阻挡通道）
    this.loadCrashCart();
  }

  sync(game: RoundsGame, dt: number): void {
    const restarted = game.elapsed < this.previousTime;
    if (restarted) {
      this.resetExitDoor();
      this.playerHuman.reset(); this.guardHuman.reset();
      this.previousPlayer = this.previousGuard = null;
      this.routeUpdate = -1;
    }
    const playerMeters = this.previousPlayer ? distance(this.previousPlayer, game.player.position) : 0;
    const guardMeters = this.previousGuard ? distance(this.previousGuard, game.guard.position) : 0;
    this.playerHuman.animate(playerMeters < 1 ? playerMeters : 0, dt, game.player.sprinting);
    
    // 驱动 Tripo 3D 骨骼动画值班员
    if (this.wardenMixer) {
      this.wardenMixer.update(dt);
      const isMoving = guardMeters > 0.0003;
      const isChase = game.guard.mode === 'chase';
      if (this.wardenWalkAction && this.wardenIdleAction) {
        const targetWalk = isMoving ? 1.0 : 0.0;
        const targetIdle = isMoving ? 0.0 : 1.0;
        this.wardenWalkAction.weight += (targetWalk - this.wardenWalkAction.weight) * Math.min(1, dt * 10);
        this.wardenIdleAction.weight += (targetIdle - this.wardenIdleAction.weight) * Math.min(1, dt * 10);
        this.wardenWalkAction.timeScale = isChase ? 1.4 : 1.0;
      }
    } else {
      this.guardHuman.animate(guardMeters < 1 ? guardMeters : 0, dt, game.guard.mode === 'chase');
    }
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
    for (const strip of this.guideStrips) strip.visible = !game.exitUnlocked;

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

  applySkin(skin: SkinDef, _theme?: ThemeId): void {
    for (const lamp of this.lamps) lamp.color.setHex(skin.lamp);
    for (const ward of this.wardLamps) ward.light.color.setHex(skin.lamp);
    this.playerHuman.setCloth(skin.cloth);
  }

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
      // 中央建筑两块实体：病房凹间（z 9.7–12.3）与药房凹间（x 18.7–21.3, z 15–16）从走廊侧挖开口。
      [5, HEIGHT, 3.7, 8.5, HEIGHT / 2, 7.85], [5, HEIGHT, 3.7, 8.5, HEIGHT / 2, 14.15],
      [11, HEIGHT, 3.7, 18.5, HEIGHT / 2, 7.85],
      [5.7, HEIGHT, 3.7, 15.85, HEIGHT / 2, 14.15], [2.7, HEIGHT, 3.7, 22.65, HEIGHT / 2, 14.15],
      [2, HEIGHT, 8.8, 12, HEIGHT / 2, 11.6],
      // 病房凹间的侧墙与后墙：厚度 0.25，全部落在不可行走区，不产生新的视觉/碰撞错位。
      [2.6, HEIGHT, 0.25, 7.3, HEIGHT / 2, 9.575], [2.6, HEIGHT, 0.25, 7.3, HEIGHT / 2, 12.425],
      [0.25, HEIGHT, 2.85, 8.475, HEIGHT / 2, 11],
      [2.6, HEIGHT, 0.25, 22.7, HEIGHT / 2, 9.575], [2.6, HEIGHT, 0.25, 22.7, HEIGHT / 2, 12.425],
      [0.25, HEIGHT, 2.85, 21.525, HEIGHT / 2, 11],
      // 药房凹间：北墙（后墙）+ 两侧短墙，z 15–16 落在中央建筑实体内。
      [2.6, HEIGHT, 0.25, 20, HEIGHT / 2, 15.0],
      [0.25, HEIGHT, 1.0, 18.7, HEIGHT / 2, 15.5], [0.25, HEIGHT, 1.0, 21.3, HEIGHT / 2, 15.5],
    ];
    for (const [w,h,d,x,y,z] of walls) {
      const wall = box(w,h,d,plaster,x,y,z); this.scene.add(wall); this.blockers.push(wall);
    }
    // 薄墙裙、防撞护栏、踢脚线都在原有实体边界，不增加走廊瓶颈。
    this.wallFace(15,3.003,24,0); this.wallFace(15,18.997,24,Math.PI);
    this.wallFace(3.003,11,16,Math.PI/2); this.wallFace(26.997,11,16,-Math.PI/2);
    this.wallFace(8.5,5.997,5,Math.PI); this.wallFace(18.5,5.997,11,Math.PI);
    this.wallFace(15,16.003,18,0);
    // 西/东走廊内墙带在病房凹间处断开，凹间自身三面补齐墙裙；南走廊内墙带在药房开口处断开。
    this.wallFace(5.997,7.85,3.7,-Math.PI/2); this.wallFace(5.997,14.15,3.7,-Math.PI/2);
    this.wallFace(24.003,7.85,3.7,Math.PI/2); this.wallFace(24.003,14.15,3.7,Math.PI/2);
    this.wallFace(7.3,9.697,2.6,Math.PI); this.wallFace(7.3,12.303,2.6,0);
    this.wallFace(8.473,11,2.6,-Math.PI/2);
    this.wallFace(22.7,9.697,2.6,Math.PI); this.wallFace(22.7,12.303,2.6,0);
    this.wallFace(21.527,11,2.6,Math.PI/2);
    // 药房凹间三面墙裙 + 南走廊内墙带按开口劈段。
    this.wallFace(12.35,16.003,12.7,0); this.wallFace(22.65,16.003,2.7,0);
    this.wallFace(20,15.127,2.6,Math.PI); this.wallFace(18.827,15.5,1.0,-Math.PI/2); this.wallFace(21.173,15.5,1.0,Math.PI/2);
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
    // 走廊墙上的真实三维道具：3D 消防箱、真实夜班查房病历板与高一致性科室导向标识
    const wardSign = plaque('住院部二病区', 'WARD 02 / NIGHT OBSERVATION', 1.15, 0.42);
    wardSign.position.set(20.2, 1.65, 5.985);
    wardSign.rotation.y = Math.PI;
    this.scene.add(wardSign);

    // 超写实 3D 灭火器与壁挂式消防栓总成 (替代原先的假扁平红盒子)
    this.buildRealisticFireStation(9.4, 1.35, 5.98, Math.PI);

    // 超写实 3D 夜班巡查病历板 (挂于南走廊独立开阔墙面，真实笔迹与勾选表单)
    this.buildRealisticChart(14.5, 1.45, 18.985, Math.PI);

    // 壁挂式 AED 自动体外除颤急救箱（挂于东走廊疏散通道侧墙，高识别度急救绿+脉冲微光）
    this.buildRealisticAED(26.985, 1.42, 14.5, -Math.PI / 2);

    // 走廊高处双头应急照明灯（消防备用微光探照，不占用任何地面行走空间）
    this.buildEmergencyLight(3.015, 2.52, 7.5, Math.PI / 2);
    this.buildEmergencyLight(18.5, 2.52, 3.015, 0);
    this.buildEmergencyLight(11.5, 2.52, 18.985, Math.PI);

    // 病房 01 / 02 床头医疗设备带（贴于病床后墙，含氧气/吸引/压缩空气端子与呼叫面板）
    this.buildBedHeadPanel(7.3, 1.35, 9.6, 0);
    this.buildBedHeadPanel(22.7, 1.35, 9.6, 0);

    // 护士站对面：夜间值班排班责任与院感防控告示大屏
    this.buildHospitalBulletinBoard(12.0, 1.55, 3.015, 0);
  }

  /** 壁挂式独立防烟钢制消防箱，内置真实 3D 灭火器模型与规范巡检指引标牌 */
  private buildRealisticFireStation(x: number, y: number, z: number, yaw: number): void {
    const station = new THREE.Group();
    station.position.set(x, y, z);
    station.rotation.y = yaw;

    const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.7 });
    const silverTrimMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.25, metalness: 0.85 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.02,
      metalness: 0.05,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });

    // 柜体空心箱身（后板 + 顶板 + 底板 + 左板 + 右板，中空通透，绝不遮挡内部 3D 灭火器）
    const backWall = box(0.58, 0.82, 0.015, new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95 }), 0, 0, -0.09);
    station.add(backWall);
    const topPlate = box(0.58, 0.018, 0.18, cabinetMat, 0, 0.40, 0);
    station.add(topPlate);
    const bottomPlate = box(0.58, 0.018, 0.18, cabinetMat, 0, -0.40, 0);
    station.add(bottomPlate);
    const leftPlate = box(0.018, 0.82, 0.18, cabinetMat, -0.285, 0, 0);
    station.add(leftPlate);
    const rightPlate = box(0.018, 0.82, 0.18, cabinetMat, 0.285, 0, 0);
    station.add(rightPlate);

    // 门框镂空中空边框（上、下、左、右 4 根细边压条，中心敞亮透视）
    const frameTop = box(0.56, 0.05, 0.012, silverTrimMat, 0, 0.365, 0.09);
    const frameBottom = box(0.56, 0.05, 0.012, silverTrimMat, 0, -0.365, 0.09);
    const frameLeft = box(0.05, 0.68, 0.012, silverTrimMat, -0.255, 0, 0.09);
    const frameRight = box(0.05, 0.68, 0.012, silverTrimMat, 0.255, 0, 0.09);
    station.add(frameTop, frameBottom, frameLeft, frameRight);

    // 观察窗超清钢化玻璃门
    const glassWindow = box(0.48, 0.70, 0.003, glassMat, 0, 0, 0.092);
    station.add(glassWindow);

    // 箱内顶部暖白微光探灯（照亮 3D 灭火器大红金属罐体与气压表）
    const cabinetLight = new THREE.PointLight(0xffedd5, 1.8, 1.5);
    cabinetLight.position.set(0, 0.32, 0.02);
    station.add(cabinetLight);

    // 不锈钢把手
    const handle = box(0.018, 0.12, 0.024, silverTrimMat, 0.24, 0, 0.105, 0.004);
    station.add(handle);

    // 真实 3D 灭火器总成（首帧使用高保真 3D 网格，同时异步载入 Tripo P2 游戏级 GLB）
    const extGroup = new THREE.Group();
    extGroup.position.set(0, -0.37, 0.0);

    const loader = new GLTFLoader();
    loader.load(
      '/models/fire_extinguisher.glb',
      (gltf) => {
        const model = gltf.scene;
        const bbox = new THREE.Box3().setFromObject(model);
        const size = bbox.getSize(new THREE.Vector3());
        const targetHeight = 0.54;
        const scale = targetHeight / Math.max(size.y, 0.001);
        model.scale.setScalar(scale);
        const center = bbox.getCenter(new THREE.Vector3());
        // 模型居中并调整朝向让气压表与手柄正对观察窗
        model.position.set(-center.x * scale, -bbox.min.y * scale, -center.z * scale);
        model.rotation.y = Math.PI / 2;
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        extGroup.clear();
        extGroup.add(model);
      },
      undefined,
      (err) => {
        console.warn('GLB 灭火器备用加载，已由程序化 3D 网格兜底:', err);
      }
    );

    // 程序化 3D 灭火器网格（保证首帧 0ms 立显，鲜艳大红罐体 + 黑色软管 + 铜阀门 + 压力表）
    const redPaint = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.2, metalness: 0.25 });
    const rubberHose = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.85 });
    const brassValve = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.35, metalness: 0.8 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.2, metalness: 0.95 });

    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.35, 18), redPaint);
    tank.position.set(0, 0.175, 0); tank.castShadow = true; extGroup.add(tank);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.082, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), redPaint);
    dome.position.set(0, 0.35, 0); dome.castShadow = true; extGroup.add(dome);
    const baseBoot = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.035, 18), rubberHose);
    baseBoot.position.set(0, 0.0175, 0); baseBoot.castShadow = true; extGroup.add(baseBoot);

    const valveNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.045, 12), brassValve);
    valveNeck.position.set(0, 0.44, 0); extGroup.add(valveNeck);
    const valveBody = box(0.045, 0.04, 0.05, brassValve, 0, 0.475, 0);
    extGroup.add(valveBody);
    const leverTop = box(0.016, 0.012, 0.15, chrome, 0, 0.505, 0.04);
    leverTop.rotation.x = -0.15; extGroup.add(leverTop);
    const leverBottom = box(0.016, 0.012, 0.14, chrome, 0, 0.475, 0.05);
    extGroup.add(leverBottom);
    const pin = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.003, 8, 16), chrome);
    pin.position.set(0.028, 0.48, 0); pin.rotation.y = Math.PI / 2; extGroup.add(pin);
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 12), chrome);
    gauge.position.set(0, 0.46, 0.038); gauge.rotation.x = Math.PI / 2; extGroup.add(gauge);
    const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.38, 10), rubberHose);
    hose.position.set(-0.09, 0.24, 0.03); hose.rotation.z = -0.05; extGroup.add(hose);

    station.add(extGroup);

    // 柜体上方张贴真实的消防器材巡检与 P.A.S.S. 操作指引标牌贴图
    const labelTex = new THREE.TextureLoader().load('/textures/fire_label.png');
    labelTex.colorSpace = THREE.SRGBColorSpace;
    const signBoard = new THREE.Mesh(
      new THREE.PlaneGeometry(0.38, 0.22),
      new THREE.MeshBasicMaterial({ map: labelTex })
    );
    signBoard.position.set(0, 0.56, 0.015);
    station.add(signBoard);

    this.scene.add(station);
  }

  /** 壁挂式 3D 医用查房病历夹板与真实床位观察表 */
  private buildRealisticChart(x: number, y: number, z: number, yaw: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = yaw;

    const boardMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.65, metalness: 0.1 });
    const board = box(0.68, 0.94, 0.015, boardMat, 0, 0, 0, 0.01);
    group.add(board);

    // 真实高清病区夜班巡查记录表
    const chartTex = new THREE.TextureLoader().load('/textures/hospital_chart.png');
    chartTex.colorSpace = THREE.SRGBColorSpace;
    const chartPaper = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.86),
      new THREE.MeshStandardMaterial({ map: chartTex, roughness: 0.88 })
    );
    chartPaper.position.set(0, -0.015, 0.009);
    group.add(chartPaper);

    const clampMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.2, metalness: 0.9 });
    const clamp = box(0.24, 0.055, 0.022, clampMat, 0, 0.42, 0.02, 0.005);
    group.add(clamp);
    const clampPin = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 10), clampMat);
    clampPin.position.set(0, 0.44, 0.022);
    clampPin.rotation.z = Math.PI / 2;
    group.add(clampPin);

    this.scene.add(group);
  }

  /** 壁挂式 AED 自动体外除颤急救箱：高辨识度医疗急救箱体、观察窗与绿光待机指示灯 */
  private buildRealisticAED(x: number, y: number, z: number, yaw: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = yaw;

    const caseMat = new THREE.MeshStandardMaterial({ color: 0x059669, roughness: 0.35, metalness: 0.3 }); // 国际急救绿
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });

    // 箱体主壳
    group.add(box(0.44, 0.54, 0.16, caseMat, 0, 0, 0, 0.015));
    // 白色对比前框
    group.add(box(0.40, 0.50, 0.01, whiteMat, 0, 0, 0.082, 0.008));
    // 钢化玻璃观察视窗
    group.add(box(0.32, 0.36, 0.004, glassMat, 0, 0.04, 0.088));

    // 箱内 3D AED 主机模块（鲜红/亮黄外壳 + 提手 + 电极贴片舱）
    const aedBody = box(0.24, 0.26, 0.09, new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 }), 0, 0.03, 0.02, 0.015);
    const aedHandle = box(0.08, 0.024, 0.02, new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 }), 0, 0.145, 0.05);
    group.add(aedBody, aedHandle);

    // 状态自检脉冲闪烁指示灯（真实 AED 标配，暗走廊中微微发亮）
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 0.8,
      roughness: 0.2,
    });
    const statusLed = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 12), ledMat);
    statusLed.position.set(0.08, 0.12, 0.089);
    const ledLight = new THREE.PointLight(0x10b981, 0.6, 2.4);
    ledLight.position.set(0.08, 0.12, 0.12);
    group.add(statusLed, ledLight);

    // 双语标识铭牌
    const plaqueMesh = plaque('AED 自动体外除颤器', 'EMERGENCY DEFIBRILLATOR', 0.4, 0.11, true);
    plaqueMesh.position.set(0, -0.18, 0.09);
    group.add(plaqueMesh);

    this.scene.add(group);
  }

  /** 壁挂式双头应急照明灯：公立医院消防标配，停电或夜间备用微光照明 */
  private buildEmergencyLight(x: number, y: number, z: number, yaw: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = yaw;

    const baseShell = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5 });
    const chromeTrim = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.25, metalness: 0.85 });
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xfef08a,
      emissiveIntensity: 0.35,
      roughness: 0.2,
    });

    // 蓄电池底座机身
    group.add(box(0.34, 0.14, 0.08, baseShell, 0, 0, 0, 0.01));
    // 状态指示灯（绿灯正常充电，红灯故障）
    const greenLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.005, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x22c55e })
    );
    greenLed.position.set(-0.11, 0.02, 0.042);
    const redLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.005, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    );
    redLed.position.set(-0.08, 0.02, 0.042);
    group.add(greenLed, redLed);

    // 两个可调节双头射灯筒（左右各一，向走廊地面倾斜）
    for (const side of [-1, 1]) {
      const lampHead = new THREE.Group();
      lampHead.position.set(side * 0.11, 0.07, 0.035);
      lampHead.rotation.x = Math.PI / 4.5; // 向下俯照 40 度
      lampHead.rotation.y = side * 0.15;

      const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.046, 0.04, 16), chromeTrim);
      cylinder.rotation.x = Math.PI / 2;
      lampHead.add(cylinder);

      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.006, 16), lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.022;
      lampHead.add(lens);

      group.add(lampHead);
    }

    // 暖光指示待机微晕
    const standbyGlow = new THREE.PointLight(0xfef08a, 0.3, 3.2);
    standbyGlow.position.set(0, -0.05, 0.15);
    group.add(standbyGlow);

    this.scene.add(group);
  }

  /** 现代医院床头医疗设备带：集中氧气、负压吸引、压缩空气端子与呼叫插座 */
  private buildBedHeadPanel(x: number, y: number, z: number, yaw: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = yaw;

    const brushedAlu = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.3, metalness: 0.7 });
    const darkSkirting = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.6 });

    // 铝合金连续设备带横梁 (长度 2.2m，厚度仅 0.035m，完全贴墙不挡路)
    group.add(box(2.2, 0.22, 0.035, brushedAlu, 0, 0, 0, 0.008));
    // 上下静音防撞条
    group.add(box(2.2, 0.015, 0.04, darkSkirting, 0, 0.115, 0.004));
    group.add(box(2.2, 0.015, 0.04, darkSkirting, 0, -0.115, 0.004));

    // 医疗气体端子（氧气绿、吸引黄、空气蓝）
    const gasPorts = [
      { color: 0x15803d },
      { color: 0xd97706 },
      { color: 0x2563eb },
    ];
    gasPorts.forEach((p, idx) => {
      const port = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.02, 14),
        new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.3, metalness: 0.5 })
      );
      port.rotation.x = Math.PI / 2;
      port.position.set(-0.6 + idx * 0.12, 0.01, 0.022);
      group.add(port);
    });

    // 呼叫对讲器与红按钮
    const callUnit = box(0.09, 0.12, 0.018, new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }), 0.55, 0.01, 0.022);
    const redButton = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.012, 12),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 })
    );
    redButton.rotation.x = Math.PI / 2;
    redButton.position.set(0.55, 0.03, 0.034);
    group.add(callUnit, redButton);

    // 暖色床头夜灯阅读灯条
    const readingStrip = box(0.5, 0.025, 0.025, new THREE.MeshStandardMaterial({ color: 0xffedd5, emissive: 0xffedd5, emissiveIntensity: 0.4 }), 0, 0.075, 0.02);
    const readingLight = new THREE.PointLight(0xffedd5, 0.55, 2.2);
    readingLight.position.set(0, 0.05, 0.15);
    group.add(readingStrip, readingLight);

    this.scene.add(group);
  }

  /** 走廊亚克力医护人员公示与院感管理告示牌 */
  private buildHospitalBulletinBoard(x: number, y: number, z: number, yaw: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = yaw;

    const acrylicMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.1,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
    });
    const standoffMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.15, metalness: 0.9 });

    // 悬浮亚克力看板主体
    group.add(box(1.4, 0.85, 0.012, acrylicMat, 0, 0, 0, 0.01));

    // 四角不锈钢金属固定广告钉
    for (const sx of [-0.64, 0.64]) {
      for (const sy of [-0.38, 0.38]) {
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12), standoffMat);
        pin.rotation.x = Math.PI / 2;
        pin.position.set(sx, sy, 0.008);
        group.add(pin);
      }
    }

    // 真实告示版面喷绘贴图
    const boardTex = new THREE.CanvasTexture((() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 620;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 1024, 620);

      // 顶部深绿医疗标头
      ctx.fillStyle = '#065f46';
      ctx.fillRect(0, 0, 1024, 110);
      ctx.fillStyle = '#ecfdf5';
      ctx.font = 'bold 36px "PingFang SC", sans-serif';
      ctx.fillText('住院部二病区 · 夜间值班责任与感染防控告示', 40, 70);

      // 左侧值班责任栏
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(30, 130, 460, 450);
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('夜间值班守则 (02:00 - 06:00)', 50, 175);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '20px sans-serif';
      ctx.fillText('· 责任护士每 30 分钟巡查病室一次', 50, 225);
      ctx.fillText('· 重点观察病房：01 病房、02 病房', 50, 265);
      ctx.fillText('· 听见异响保持肃静，避免正面接触', 50, 305);
      ctx.fillText('· 紧急情况拉响广播或避入配药凹间', 50, 345);

      // 右侧安全疏散指引
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(520, 130, 470, 450);
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('应急疏散与门禁联动', 540, 175);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '20px sans-serif';
      ctx.fillText('· 防火卷帘门 A/B：联动指令即时封锁', 540, 225);
      ctx.fillText('· 东侧安全疏散门：备用电源充电后开启', 540, 265);
      ctx.fillText('· 严禁私自阻挡常闭式防火疏散通道', 540, 305);
      ctx.fillText('· 院内紧急呼叫热线：内线 1201', 540, 345);

      return canvas;
    })());
    boardTex.colorSpace = THREE.SRGBColorSpace;

    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(1.34, 0.80),
      new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.85 })
    );
    poster.position.set(0, 0, 0.008);
    group.add(poster);

    this.scene.add(group);
  }

  /** 现代公立医院双分色墙裙、铝合金防撞饰边与 38mm 连续安全防撞扶手 */
  private wallFace(x: number, z: number, length: number, yaw: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = yaw;

    const slateWainscot = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.72 });
    const aluSeam = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.75 });
    const darkKickplate = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 });
    const handrailPipe = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.1 });
    const handrailBracket = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.3, metalness: 0.85 });

    // 护墙裙板 (深灰中性色调，摆脱纯绿)
    group.add(box(length, 0.88, 0.008, slateWainscot, 0, 0.51, 0));
    // 铝合金过渡饰条
    group.add(box(length, 0.038, 0.025, aluSeam, 0, 0.96, 0.012, 0.004));
    // 地面重型深碳色踢脚线
    group.add(box(length, 0.09, 0.018, darkKickplate, 0, 0.045, 0.01));

    // 医院标配 38mm 连续防撞防滑扶手 (0.85m 高度)
    group.add(box(length, 0.038, 0.038, handrailPipe, 0, 0.85, 0.045, 0.016));
    // 扶手金属固定支架
    for (let offset = -length / 2 + 0.8; offset < length / 2; offset += 2.4) {
      const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.045, 8), handrailBracket);
      bracket.position.set(offset, 0.835, 0.024);
      bracket.rotation.x = Math.PI / 2;
      group.add(bracket);
    }

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
    const pharmacyCasings = new THREE.Group(); pharmacyCasings.position.set(20, 0, 16.0); pharmacyCasings.rotation.y = Math.PI;
    // 药房门套：与病房同一套语言（横楣 + 边框 + 号码牌）。
    pharmacyCasings.add(box(2.72, 0.1, 0.06, trim, 0, 2.18, 0.006));
    for (const side of [-1, 1]) pharmacyCasings.add(box(0.07, 2.2, 0.06, trim, side * 1.31, 1.1, 0.006));
    const pharmacySign = plaque('药房', 'PHARMACY / 配药窗口', 1.16, 0.37, true); pharmacySign.position.set(0, 2.47, 0.018); pharmacyCasings.add(pharmacySign);
    this.scene.add(pharmacyCasings);
    // 凹间内的配药台与层架：贴北墙，深度 0.35 m 落在玩家碰撞半径之外。
    const counterGroup = new THREE.Group();
    counterGroup.add(box(2.3, 0.9, 0.35, sage, 0, 0.45, 0, 0.012));
    counterGroup.add(box(2.34, 0.04, 0.38, trim, 0, 0.92, 0));
    const counterSign = plaque('取药窗口', 'MEDICATION PICKUP', 0.7, 0.2); counterSign.position.set(0, 1.62, 0.012); counterSign.rotation.y = Math.PI; counterGroup.add(counterSign);
    const vials = [0xd5e8e7, 0xdce6c9, 0xc7d5df, 0xe3cfb4];
    for (let i = 0; i < 6; i++) {
      const vial = box(0.05, 0.11, 0.05, new THREE.MeshStandardMaterial({ color: vials[i % 4], roughness: 0.35 }), -0.9 + i * 0.36, 1.0, 0.02, 0.008);
      counterGroup.add(vial);
    }
    const counterSlot = new THREE.Group(); counterSlot.position.set(20, 0, 15.18);
    counterSlot.add(counterGroup);
    this.nurseCounterSlot = { slot: counterSlot, procedural: counterGroup };
    this.scene.add(counterSlot);
    const directions = plaque('住院部 01    → 安全门', 'INPATIENT DEPARTMENT / EAST EXIT',2.35,0.56,true);
    directions.position.set(9.2,2.1,3.01); this.scene.add(directions);
    const south = plaque('← 病房 01     安全门 →','SOUTH CORRIDOR',2.15,0.51,true);
    south.position.set(18.2,2.17,18.99); south.rotation.y = Math.PI; this.scene.add(south);

    for (const [x,yaw,number,point] of [[5.98,-Math.PI/2,'01',{x:4.5,z:11}],[24.02,Math.PI/2,'02',{x:25.5,z:11}]] as const) {
      // 病房现在是真正的凹间：门面只保留门套（横楣 + 边框 + 号码牌），不再有封死开口的木板与玻璃。
      const group = new THREE.Group(); group.position.set(x,0,11); group.rotation.y = yaw;
      group.add(box(2.72,0.1,0.06,trim,0,2.18,0.006));
      for (const side of [-1,1]) group.add(box(0.07,2.2,0.06,trim,side*1.31,1.1,0.006));
      const sign = plaque(`病房 ${number}`, 'WARD / 呼叫中心',1.16,0.37,true); sign.position.set(0,2.47,0.018); group.add(sign);
      const lampMat = new THREE.MeshStandardMaterial({ color:0xf0dca0,emissive:0xe9c981,emissiveIntensity:0.05,roughness:0.3 });
      const lamp = box(0.19,0.09,0.06,lampMat,1.18,2.47,0.027,0.018); group.add(lamp);
      const call = plaque('呼叫','CALL',0.16,0.15); call.position.set(1.18,1.3,0.018); group.add(call);
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
        const bedSlot = new THREE.Group(); bedSlot.position.set(cx,0,cz);
        bedSlot.add(bed);
        this.bedSlots.push({ slot: bedSlot, procedural: bed });
        this.scene.add(bedSlot);
      } else {
        const cabinet = new THREE.Group();
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
        const cabSlot = new THREE.Group(); cabSlot.position.set(cx,0,cz);
        cabSlot.rotation.y = cx<15 ? Math.PI/2 : -Math.PI/2;
        cabSlot.add(cabinet);
        this.cabinetSlots.push({ slot: cabSlot, procedural: cabinet });
        this.scene.add(cabSlot);
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
    // 安全门通电后隐藏：动态路线箭头会按玩家实时位置与门状态指路，静态条继续亮着会与它打架。
    const stripA = box(13.4, 0.004, 0.14, guide, 17.9, 0.0065, 3.78);
    const stripB = box(0.14, 0.004, 7.2, guide, 24.55, 0.0065, 7.35);
    for (const strip of [stripA, stripB]) { strip.castShadow = false; strip.receiveShadow = true; this.scene.add(strip); this.guideStrips.push(strip); }
    // 躲避指示：病房 / 药房 / 护士站门口横贴一条浅绿地面标记，第一眼看出“这里能躲”。
    const hideMark = new THREE.MeshStandardMaterial({ color: 0x9dbfa8, roughness: 0.88 });
    const hideStrip = (x: number, z: number, w: number, d: number): void => {
      const strip = box(w, 0.004, d, hideMark, x, 0.0075, z);
      strip.castShadow = false; strip.receiveShadow = true; this.scene.add(strip);
    };
    hideStrip(7.05, 10.0, 2.4, 0.34); // 病房 01 开口
    hideStrip(22.95, 10.0, 2.4, 0.34); // 病房 02 开口
    hideStrip(20, 16.6, 2.4, 0.34); // 药房开口
    hideStrip(12, 6.6, 1.8, 0.34); // 护士站凹间
    const props = new THREE.Group();

    // 医用屏风 ×3：贴墙隔断，医疗防菌冷白织物布面 + 不锈钢金属框架 + 底部脚轮
    const screenFrame = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.4, metalness: 0.6 });
    const screenCloth = clothMaterial(0xf1f5f9);
    const medicalScreen = (cx: number, cz: number, w: number, d: number, alongX: boolean): void => {
      const group = new THREE.Group(); group.position.set(cx, 0, cz);
      const long = alongX ? w : d;
      const short = alongX ? d : w;
      // 三片折叠屏：布面以 0.02 m 内收避免与碰撞矩形边缘穿模。
      for (let panel = 0; panel < 3; panel++) {
        const segLong = (long - 0.06) / 3;
        const center = -long / 2 + segLong * (panel + 0.5) + 0.03;
        const px = alongX ? center : 0;
        const pz = alongX ? 0 : center;
        const cw = alongX ? segLong : short - 0.06;
        const cd = alongX ? short - 0.06 : segLong;
        group.add(box(cw, 1.62, cd, screenCloth, px, 1.02, pz, 0.01));
        if (alongX) {
          group.add(box(0.03, 1.78, 0.03, screenFrame, center, 0.95, 0));
          group.add(box(0.035, 1.66, short - 0.02, screenFrame, center - segLong / 2 + 0.015, 0.95, 0));
        } else {
          group.add(box(0.03, 1.78, 0.03, screenFrame, 0, 0.95, center));
          group.add(box(short - 0.02, 1.66, 0.035, screenFrame, 0, 0.95, center - segLong / 2 + 0.015));
        }
      }
      // 顶部滚边与底部脚轮。
      group.add(alongX ? box(long - 0.04, 0.05, 0.05, screenFrame, 0, 1.86, 0) : box(0.05, 0.05, long - 0.04, screenFrame, 0, 1.86, 0));
      for (const side of [-1, 1]) {
        const wx = alongX ? side * (long / 2 - 0.08) : 0;
        const wz = alongX ? 0 : side * (long / 2 - 0.08);
        for (const offset of [-short / 2 + 0.12, short / 2 - 0.12]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 10), screenFrame);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(alongX ? wx : offset, 0.05, alongX ? offset : wz);
          wheel.castShadow = true;
          group.add(wheel);
        }
      }
      props.add(group);
    };
    medicalScreen(26.5, 7.4, 1.0, 1.8, false); // 东走廊屏风
    medicalScreen(6.5, 18.1, 2.0, 1.8, true); // 南走廊屏风
    medicalScreen(3.9, 14.5, 1.8, 2.0, false); // 西走廊屏风

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
    ivStand(5.8, 8.9, 0);
    ivStand(5.8, 13.1, Math.PI);
    ivStand(24.2, 13.1, 0);

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
    const doorMaterial=new THREE.MeshStandardMaterial({ color:0xc2d6c4,roughness:0.65,metalness:0.08 });
    
    // 双扇防火防烟安全门（左门扇轴心在 x=-0.92，右门扇轴心在 x=+0.92，可向外真实旋转推开）
    this.exitDoorLeft = new THREE.Group();
    this.exitDoorLeft.position.set(-0.92, 0, 0);
    // 左门板
    this.exitDoorLeft.add(box(0.91, 2.25, 0.04, doorMaterial, 0.455, 1.125, 0));
    // 观察窗与压条
    this.exitDoorLeft.add(box(0.28, 0.54, 0.02, glass, 0.455, 1.65, 0.022));
    this.exitDoorLeft.add(box(0.72, 0.045, 0.05, metal, 0.455, 1.05, 0.05, 0.012)); // 逃生推杆
    exit.add(this.exitDoorLeft);

    this.exitDoorRight = new THREE.Group();
    this.exitDoorRight.position.set(0.92, 0, 0);
    // 右门板
    this.exitDoorRight.add(box(0.91, 2.25, 0.04, doorMaterial, -0.455, 1.125, 0));
    // 观察窗与压条
    this.exitDoorRight.add(box(0.28, 0.54, 0.02, glass, -0.455, 1.65, 0.022));
    this.exitDoorRight.add(box(0.72, 0.045, 0.05, metal, -0.455, 1.05, 0.05, 0.012)); // 逃生推杆
    exit.add(this.exitDoorRight);

    // 门框立柱与门楣（静止固定）
    for (const side of [-1,1]) {
      exit.add(box(0.09,2.3,0.06,trim,side*0.96,1.15,0.025));
    }
    exit.add(box(2,0.09,0.08,trim,0,2.3,0.02));

    // 室外晨光与逃出生天的泛光（门推开时向走廊喷涌）
    this.outdoorLight = new THREE.PointLight(0xfff5e6, 0, 9, 1.5);
    this.outdoorLight.position.set(0, 1.5, -1.0);
    exit.add(this.outdoorLight);

    this.outdoorSunlight = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ color: 0xfffbf0, transparent: true, opacity: 0, depthWrite: false })
    );
    this.outdoorSunlight.position.set(0, 1.4, -0.45);
    this.outdoorSunlight.visible = false;
    exit.add(this.outdoorSunlight);

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

  /** 平滑驱动安全门推开动画 (progress: 0 关闭 -> 1 完全推开，室外晨光喷涌) */
  public openExitDoor(progress: number): void {
    const clamped = Math.max(0, Math.min(1, progress));
    const angle = clamped * (Math.PI * 0.44); // 约 80 度
    if (this.exitDoorLeft) this.exitDoorLeft.rotation.y = -angle;
    if (this.exitDoorRight) this.exitDoorRight.rotation.y = angle;
    if (this.outdoorLight) this.outdoorLight.intensity = clamped * 6.5;
    if (this.outdoorSunlight) {
      this.outdoorSunlight.visible = clamped > 0.02;
      (this.outdoorSunlight.material as THREE.MeshBasicMaterial).opacity = Math.min(1, clamped * 1.4);
    }
  }

  /** 重启或复位安全门 */
  public resetExitDoor(): void {
    if (this.exitDoorLeft) this.exitDoorLeft.rotation.y = 0;
    if (this.exitDoorRight) this.exitDoorRight.rotation.y = 0;
    if (this.outdoorLight) this.outdoorLight.intensity = 0;
    if (this.outdoorSunlight) {
      this.outdoorSunlight.visible = false;
      (this.outdoorSunlight.material as THREE.MeshBasicMaterial).opacity = 0;
    }
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
        // 推导：rotation.x=-π/2 后，箭头尖端的世界方向 = (-sinφ, 0, -cosφ)。
        // 要让尖端指向线段方向 (dx̂, dẑ)，必须 φ = atan2(-dx, -dz)；
        // 旧公式 atan2(dx, -dz) 让东西向恰好反向 π（南北向碰巧正确），逃生箭头因此指回玩家。
        arrow.rotation.set(-Math.PI/2,0,Math.atan2(-(point.x-start.x),-(point.z-start.z)));
        this.route.add(arrow);
      }
      start=point;
    }
    this.routeUpdate=game.elapsed; this.routeRevision=game.map.revision;
  }
}

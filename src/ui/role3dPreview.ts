/**
 * 大厅内角色 3D 动态预览组件。
 * 在玩家点击选中出勤干员时，在 3D 画布中实时渲染带有行走动作的模型。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { SkinId } from '../core/economy';
import { ROLE_IDLE_GLB_URLS } from '../render/gltfCharacter';

export class Role3DPreview {
  readonly domElement: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private mixer: THREE.AnimationMixer | null = null;
  private currentModel: THREE.Object3D | null = null;
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<SkinId, { model: THREE.Object3D; clip: THREE.AnimationClip; scale: number; center: THREE.Vector3 }>();
  private active = false;
  private currentSkin: SkinId = 'standard';

  constructor(width = 160, height = 160) {
    this.domElement = document.createElement('canvas');
    this.domElement.className = 'role-3d-canvas';
    this.domElement.width = width;
    this.domElement.height = height;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.domElement,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 20);
    this.camera.position.set(0, 0.16, 2.5);
    this.camera.lookAt(0, 0.1, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x667766, 3.2);
    // 正前方主光源：保证面部、胸牌与正面服装细节清亮通透
    const frontLight = new THREE.DirectionalLight(0xffffff, 4.0);
    frontLight.position.set(0, 1.5, 3.5);
    const key = new THREE.DirectionalLight(0xfff5e6, 2.8);
    key.position.set(2, 2.5, 2.5);
    const rim = new THREE.DirectionalLight(0x99ccff, 2.2);
    rim.position.set(-2, 1.5, -1.5);
    this.scene.add(hemi, frontLight, key, rim);

    this.loop = this.loop.bind(this);
  }

  show(skinId: SkinId): void {
    this.currentSkin = skinId;
    this.loadSkin(skinId);
    if (!this.active) {
      this.active = true;
      requestAnimationFrame(this.loop);
    }
  }

  hide(): void {
    this.active = false;
  }

  private async loadSkin(skinId: SkinId): Promise<void> {
    if (this.cache.has(skinId)) {
      this.applyModel(skinId);
      return;
    }

    const url = ROLE_IDLE_GLB_URLS[skinId];
    if (!url) return;

    try {
      const gltf = await this.loader.loadAsync(url);
      const model = gltf.scene;
      
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const scale = size.y > 0 ? 1.25 / size.y : 1;

      const clip = gltf.animations.find(a => a.name.toLowerCase().includes('idle')) ?? gltf.animations[0];
      if (clip) {
        this.cache.set(skinId, { model, clip, scale, center });
        if (this.currentSkin === skinId) {
          this.applyModel(skinId);
        }
      }
    } catch (e) {
      console.warn('[Role3DPreview] 加载角色失败:', e);
    }
  }

  private applyModel(skinId: SkinId): void {
    const cached = this.cache.get(skinId);
    if (!cached) return;

    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.mixer?.stopAllAction();
    }

    // 关键修复：骨骼带权重的模型必须使用 SkeletonUtils.clone，���则克隆出的骨骼节点与 SkinnedMesh 脱钩卡死在 T-Pose
    const clone = SkeletonUtils.clone(cached.model) as THREE.Group;
    clone.scale.setScalar(cached.scale);
    clone.position.set(0, -cached.center.y * cached.scale, 0);

    const pivot = new THREE.Group();
    pivot.add(clone);
    // 固定正面朝向镜头（微侧 0.08 弧度增���三维层次感，永远正面展示）
    pivot.rotation.y = -Math.PI / 2;
    this.currentModel = pivot;
    this.scene.add(pivot);

    // 驱动自然的呼吸待命（Idle）动作，双臂自然下垂，绝无位移，绝无十字架 T-Pose
    this.mixer = new THREE.AnimationMixer(clone);
    const action = this.mixer.clipAction(cached.clip);
    action.reset();
    action.setEffectiveTimeScale(1.0);
    action.setEffectiveWeight(1.0);
    action.play();

    this.renderFrame();
  }

  private readonly bbox = new THREE.Box3();
  private readonly targetCenter = new THREE.Vector3();
  private lastTime = performance.now();

  private renderFrame(): void {
    if (this.currentModel) {
      this.bbox.setFromObject(this.currentModel);
      this.bbox.getCenter(this.targetCenter);
      this.camera.position.set(this.targetCenter.x, this.targetCenter.y + 0.08, this.targetCenter.z + 2.15);
      this.camera.lookAt(this.targetCenter.x, this.targetCenter.y + 0.04, this.targetCenter.z);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private loop(now: number): void {
    if (!this.active) return;
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.mixer) this.mixer.update(dt);
    this.renderFrame();
    requestAnimationFrame(this.loop);
  }
}

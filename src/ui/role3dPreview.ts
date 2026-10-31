/**
 * 大厅内角色 3D 动态预览组件。
 * 在玩家点击选中出勤干员时，在 3D 画布中实时渲染带有行走动作的模型。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { SkinId } from '../core/economy';
import { ROLE_GLB_URLS } from '../render/gltfCharacter';

export class Role3DPreview {
  readonly domElement: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private mixer: THREE.AnimationMixer | null = null;
  private currentModel: THREE.Object3D | null = null;
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<SkinId, { model: THREE.Object3D; clip: THREE.AnimationClip }>();
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
    this.camera.position.set(0, 0.16, 2.55);
    this.camera.lookAt(0, 0.12, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x889988, 3.5);
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(1.5, 2.5, 2.5);
    const rim = new THREE.DirectionalLight(0xddeeff, 2.8);
    rim.position.set(-1.5, 1.5, -1.5);
    this.scene.add(hemi, key, rim);

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

    const url = ROLE_GLB_URLS[skinId];
    if (!url) return;

    try {
      const gltf = await this.loader.loadAsync(url);
      const model = gltf.scene;
      
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const scale = size.y > 0 ? 1.4 / size.y : 1;
      model.scale.setScalar(scale);

      // 把模型中心点居中在 (0, 0, 0)
      const pivot = new THREE.Group();
      model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      pivot.add(model);

      const clip = gltf.animations.find(a => a.name.toLowerCase().includes('walk')) ?? gltf.animations[0];
      if (clip) {
        this.cache.set(skinId, { model: pivot, clip });
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

    const clone = cached.model.clone();
    clone.position.set(0, 0, 0);
    clone.rotation.y = Math.PI * 0.15; // 微侧身面对镜头
    this.currentModel = clone;
    this.scene.add(clone);

    this.mixer = new THREE.AnimationMixer(clone);
    const action = this.mixer.clipAction(cached.clip);
    action.setEffectiveTimeScale(1.0);
    action.play();
  }

  private lastTime = performance.now();
  private loop(now: number): void {
    if (!this.active) return;
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.mixer) this.mixer.update(dt);
    if (this.currentModel) {
      this.currentModel.rotation.y += dt * 0.45; // 缓慢自转展示
    }

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  }
}

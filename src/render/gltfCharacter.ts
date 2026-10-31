/**
 * Tripo 3D 生成的角色模型加载与动画控制器。
 * 支持标准外科医师、夜行潜行干员、卷轴封印特派三位角色的骨骼与动作驱动。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { SkinId } from '../core/economy';

import standardGlb from '../../assets/art/models/role_standard_walk.glb?url';
import indigoGlb from '../../assets/art/models/role_indigo_walk.glb?url';
import vermilionGlb from '../../assets/art/models/role_vermilion_walk.glb?url';

export const ROLE_GLB_URLS: Record<SkinId, string> = {
  'standard': standardGlb,
  'shinobi-indigo': indigoGlb,
  'scroll-vermilion': vermilionGlb,
};

export class GltfCharacterRig {
  readonly group = new THREE.Group();
  private currentSkin: SkinId = 'standard';
  private currentModel: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<SkinId, { model: THREE.Object3D; clip: THREE.AnimationClip }>();

  constructor() {
    this.group.name = 'gltf-character-rig';
  }

  async loadSkin(skinId: SkinId): Promise<void> {
    this.currentSkin = skinId;
    if (this.cache.has(skinId)) {
      this.applyCached(skinId);
      return;
    }

    const url = ROLE_GLB_URLS[skinId];
    if (!url) return;

    try {
      const gltf = await this.loader.loadAsync(url);
      const model = gltf.scene;
      
      // 归一化角色高度到大约 1.75 米，并确保面向正确
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = size.y > 0 ? 1.75 / size.y : 1;
      model.scale.setScalar(scale);

      // 阴影投射与材质优化
      model.traverse(node => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });

      const clip = gltf.animations.find(a => a.name.toLowerCase().includes('walk')) ?? gltf.animations[0];
      if (clip) {
        this.cache.set(skinId, { model, clip });
        if (this.currentSkin === skinId) {
          this.applyCached(skinId);
        }
      }
    } catch (e) {
      console.warn(`[GltfCharacterRig] 加载 3D 角色模型失败: ${skinId}`, e);
    }
  }

  private applyCached(skinId: SkinId): void {
    const cached = this.cache.get(skinId);
    if (!cached) return;

    if (this.currentModel) {
      this.group.remove(this.currentModel);
      this.mixer?.stopAllAction();
    }

    const clone = cached.model.clone();
    this.currentModel = clone;
    this.group.add(clone);

    this.mixer = new THREE.AnimationMixer(clone);
    this.walkAction = this.mixer.clipAction(cached.clip);
    this.walkAction.setLoop(THREE.LoopRepeat, Infinity);
    this.walkAction.play();
  }

  animate(moving: boolean, dt: number, speedScale = 1): void {
    if (!this.mixer) return;
    if (moving) {
      this.walkAction?.setEffectiveTimeScale(speedScale);
      this.walkAction?.setEffectiveWeight(1);
    } else {
      this.walkAction?.setEffectiveWeight(0.2); // 怠速微动
      this.walkAction?.setEffectiveTimeScale(0.3);
    }
    this.mixer.update(dt);
  }
}

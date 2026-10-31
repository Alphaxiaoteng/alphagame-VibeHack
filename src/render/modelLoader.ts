/**
 * 《查房》(Rounds) 3D 模型加载器与尺寸归一化装配服务
 * 使用 Three.js GLTFLoader 异步加载真实 .glb 资产，自动归一化尺寸与对齐脚底中心
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AssetCategory } from '../core/assetRegistry';

export interface TargetDimensions {
  targetWidth?: number;  // X 轴目标跨度 (米)
  targetHeight?: number; // Y 轴目标高度 (米)
  targetDepth?: number;  // Z 轴目标深度 (米)
}

const CATEGORY_TARGET_DIMS: Record<AssetCategory, TargetDimensions> = {
  bed: { targetWidth: 1.95, targetHeight: 0.85, targetDepth: 0.92 },
  cabinet: { targetWidth: 1.0, targetHeight: 1.85, targetDepth: 0.48 },
  nurse_counter: { targetWidth: 3.0, targetHeight: 1.15, targetDepth: 1.2 },
  fire_door: { targetWidth: 2.4, targetHeight: 2.6, targetDepth: 0.25 },
  exit_door: { targetWidth: 1.2, targetHeight: 2.2, targetDepth: 0.2 },
  wheelchair: { targetWidth: 0.72, targetHeight: 0.92, targetDepth: 0.95 },
  warden: { targetHeight: 1.82 }
};

export class ModelLoaderService {
  private static instance: ModelLoaderService;
  private loader = new GLTFLoader();
  private cache = new Map<string, THREE.Group>();
  private loadingPromises = new Map<string, Promise<THREE.Group>>();

  public static get(): ModelLoaderService {
    if (!ModelLoaderService.instance) {
      ModelLoaderService.instance = new ModelLoaderService();
    }
    return ModelLoaderService.instance;
  }

  /**
   * 加载并按目标规格自适应缩放归一化模型
   */
  public async loadNormalizedModel(
    url: string,
    category: AssetCategory
  ): Promise<THREE.Group> {
    const rawGroup = await this.loadRaw(url);
    const cloned = rawGroup.clone(true);

    // 重新开启材质与阴影
    cloned.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });

    // 归一化缩放与中心对齐
    this.normalizeModel(cloned, category);
    return cloned;
  }

  private loadRaw(url: string): Promise<THREE.Group> {
    if (this.cache.has(url)) {
      return Promise.resolve(this.cache.get(url)!);
    }
    if (this.loadingPromises.has(url)) {
      return this.loadingPromises.get(url)!;
    }

    const promise = new Promise<THREE.Group>((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          this.cache.set(url, gltf.scene);
          this.loadingPromises.delete(url);
          resolve(gltf.scene);
        },
        undefined,
        (err) => {
          this.loadingPromises.delete(url);
          reject(err);
        }
      );
    });

    this.loadingPromises.set(url, promise);
    return promise;
  }

  private normalizeModel(group: THREE.Group, category: AssetCategory): void {
    const target = CATEGORY_TARGET_DIMS[category];
    if (!target) return;

    // 计算当前包围盒
    const bbox = new THREE.Box3().setFromObject(group);
    const size = bbox.getSize(new THREE.Vector3());

    if (size.x === 0 || size.y === 0 || size.z === 0) return;

    // 计算缩放比例：根据目标高度或各轴进行比例缩放
    let scale = 1.0;
    if (target.targetHeight && target.targetHeight > 0) {
      scale = target.targetHeight / size.y;
    } else if (target.targetWidth && target.targetWidth > 0) {
      scale = target.targetWidth / size.x;
    }

    // 针对特型物品进行微调适配与长轴自适应旋转对齐
    if (category === 'bed') {
      // 若原始模型长轴沿 Z 轴而目标长轴沿 X 轴，先让模型绕 Y 轴旋转 90 度以对齐长轴
      if (size.z > size.x * 1.3) {
        group.rotation.y = Math.PI / 2;
        group.updateMatrixWorld(true);
        const reBbox = new THREE.Box3().setFromObject(group);
        const reSize = reBbox.getSize(new THREE.Vector3());
        size.copy(reSize);
      }
      const scaleX = target.targetWidth ? target.targetWidth / size.x : scale;
      const scaleY = target.targetHeight ? target.targetHeight / size.y : scale;
      const scaleZ = target.targetDepth ? target.targetDepth / size.z : scale;
      scale = Math.min(scaleX, scaleY, scaleZ);
    } else if (category === 'wheelchair') {
      const scaleX = target.targetWidth ? target.targetWidth / size.x : scale;
      const scaleY = target.targetHeight ? target.targetHeight / size.y : scale;
      const scaleZ = target.targetDepth ? target.targetDepth / size.z : scale;
      scale = Math.min(scaleX, scaleY, scaleZ);
    }

    group.scale.set(scale, scale, scale);

    // 重新计算缩放后的包围盒并把底部对齐到 Y=0，中心对齐到 (0,0)
    const scaledBbox = new THREE.Box3().setFromObject(group);
    const scaledCenter = scaledBbox.getCenter(new THREE.Vector3());
    const minY = scaledBbox.min.y;

    group.position.x -= scaledCenter.x;
    group.position.y -= minY; // 脚底吸附到 Y=0
    group.position.z -= scaledCenter.z;
  }
}

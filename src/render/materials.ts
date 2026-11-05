import * as THREE from 'three';

/** 本地确定性材质，不依赖 CDN；颜色贴图用 sRGB，粗糙度/凹凸贴图用线性空间。 */
export function paintTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  color = true
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建材质画布');
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 2;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function grain(ctx: CanvasRenderingContext2D, size: number, amount: number, seed: number): void {
  let state = seed >>> 0;
  const count = Math.min(amount, 4500);
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const x = state % size;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const y = state % size;
    const alpha = 0.035 + (state % 7) / 160;
    ctx.fillStyle = `rgba(${i % 2 ? '255,255,255' : '90,95,102'},${alpha})`;
    ctx.fillRect(x, y, 2, 2);
  }
}

/**
 * 真实公立医院地面：
 * 采用 600×600 无缝抛光医疗 PVC 水磨石地坪。
 * 浅灰中性色调，微小石英斑点，中等粗糙度呈现医用地板蜡的柔和高光倒影。
 */
export function tileMaterial(): THREE.MeshStandardMaterial {
  const albedo = paintTexture(256, (ctx) => {
    ctx.fillStyle = '#56646e';
    ctx.fillRect(0, 0, 256, 256);
    for (let z = 0; z < 2; z++) {
      for (let x = 0; x < 2; x++) {
        // 深夜住院部冷青灰水磨石色阶（对齐主封面 04:00 AM 湿润反光地面质感，兼具清晰路感）
        ctx.fillStyle = ['#5e6d78', '#566570', '#5a6974', '#52606b'][z * 2 + x];
        ctx.fillRect(x * 128 + 1, z * 128 + 1, 126, 126);
        // 极细拼缝
        ctx.strokeStyle = '#3b4750';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x * 128, z * 128, 128, 128);
        // 微弱高光边
        ctx.strokeStyle = '#70808c';
        ctx.lineWidth = 1;
        ctx.strokeRect(x * 128 + 1, z * 128 + 1, 126, 126);
      }
    }
    // 水磨石微小石英骨料颗粒
    grain(ctx, 256, 3600, 88);
  });

  // 物理凹凸 Bump 贴图：刻画地砖接缝微凹陷与水磨石微骨料立体起伏
  const bump = paintTexture(256, (ctx) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let z = 0; z < 2; z++) {
      for (let x = 0; x < 2; x++) {
        ctx.strokeStyle = '#202020'; // 接缝深凹
        ctx.lineWidth = 2;
        ctx.strokeRect(x * 128, z * 128, 128, 128);
        ctx.strokeStyle = '#a0a0a0'; // 接缝微倒角高光
        ctx.lineWidth = 1;
        ctx.strokeRect(x * 128 + 1, z * 128 + 1, 126, 126);
      }
    }
    grain(ctx, 256, 2000, 142);
  }, false);

  // 粗糙度 Roughness 贴图：接缝消光不反光（亮白），瓷砖中央打蜡区柔和微倒影（暗灰）
  const roughness = paintTexture(256, (ctx) => {
    ctx.fillStyle = '#555555';
    ctx.fillRect(0, 0, 256, 256);
    for (let z = 0; z < 2; z++) {
      for (let x = 0; x < 2; x++) {
        ctx.strokeStyle = '#cccccc'; // 接缝高粗糙度
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x * 128, z * 128, 128, 128);
      }
    }
    grain(ctx, 256, 1800, 99);
  }, false);

  albedo.repeat.set(30 / 1.2, 22 / 1.2);
  bump.repeat.set(30 / 1.2, 22 / 1.2);
  roughness.repeat.set(30 / 1.2, 22 / 1.2);

  return new THREE.MeshStandardMaterial({
    map: albedo,
    bumpMap: bump,
    bumpScale: 0.016,
    roughnessMap: roughness,
    roughness: 0.44, // 医疗水磨石消光蜡面，结合贴图实现非均匀微表面散射
    metalness: 0.06
  });
}

/**
 * 真实公立医院墙面（深夜冷调电影感分级）：
 * 上部（1.0m 以上）：冷灰青雾面抗菌墙漆（压暗刺眼白光，保留空间轮廓）
 * 下部（1.0m 以下）：深板岩防撞裙板与金属防撞带
 */
export function plasterMaterial(): THREE.MeshStandardMaterial {
  const texture = paintTexture(256, (ctx) => {
    // 上部冷青灰（彻底告别白昼泛白，还原封面 04:00 AM 暗调走廊质感）
    ctx.fillStyle = '#6c7c85';
    ctx.fillRect(0, 0, 256, 256);

    // 下部 1/3 防撞护墙板颜色（深冷灰板岩）
    ctx.fillStyle = '#47555e';
    ctx.fillRect(0, 170, 256, 86);

    // 防撞过渡分界线（深灰铝合金条）
    ctx.fillStyle = '#36424a';
    ctx.fillRect(0, 167, 256, 3);
    ctx.fillStyle = '#1f272c';
    ctx.fillRect(0, 170, 256, 1);

    grain(ctx, 256, 3200, 312);
  });

  // 墙面乳胶漆微粒与防撞压条立体 Bump
  const bump = paintTexture(256, (ctx) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#b0b0b0'; // 防撞条凸起
    ctx.fillRect(0, 167, 256, 3);
    grain(ctx, 256, 2800, 415);
  }, false);

  return new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: bump,
    bumpScale: 0.012,
    roughness: 0.84 // 消光抗菌防撞墙板，沉稳压暗
  });
}

/**
 * 现代医院天花板：
 * 600×600 嵌入式防尘吸音铝扣板网格，深夜压暗色调，避免顶棚泛白。
 */
export function ceilingMaterial(): THREE.MeshStandardMaterial {
  const texture = paintTexture(256, (ctx) => {
    ctx.fillStyle = '#4e5c64';
    ctx.fillRect(0, 0, 256, 256);
    grain(ctx, 256, 2400, 199);
    ctx.strokeStyle = '#354148';
    ctx.lineWidth = 2;
    for (let x = 0; x < 2; x++) {
      for (let z = 0; z < 2; z++) {
        ctx.strokeRect(x * 128, z * 128, 128, 128);
      }
    }
  });
  texture.repeat.set(15, 11);
  return new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.88,
    side: THREE.DoubleSide
  });
}

export function clothMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85
  });
}

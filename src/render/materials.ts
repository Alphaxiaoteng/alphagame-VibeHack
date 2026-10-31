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
  texture.anisotropy = 8;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function grain(ctx: CanvasRenderingContext2D, size: number, amount: number, seed: number): void {
  let state = seed >>> 0;
  for (let i = 0; i < amount; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const x = state % size;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const y = state % size;
    const alpha = 0.035 + (state % 7) / 160;
    ctx.fillStyle = `rgba(${i % 2 ? '255,255,255' : '90,95,102'},${alpha})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

/**
 * 真实公立医院地面：
 * 采用 600×600 无缝抛光医疗 PVC 水磨石地坪。
 * 浅灰中性色调，微小石英斑点，中等粗糙度（0.38）呈现医用地板蜡的柔和高光倒影。
 */
export function tileMaterial(): THREE.MeshStandardMaterial {
  const albedo = paintTexture(512, (ctx) => {
    ctx.fillStyle = '#56646e';
    ctx.fillRect(0, 0, 512, 512);
    for (let z = 0; z < 2; z++) {
      for (let x = 0; x < 2; x++) {
        // 深夜住院部冷青灰水磨石色阶（对齐主封面 04:00 AM 湿润反光地面质感，兼具清晰路感）
        ctx.fillStyle = ['#5e6d78', '#566570', '#5a6974', '#52606b'][z * 2 + x];
        ctx.fillRect(x * 256 + 2, z * 256 + 2, 252, 252);
        // 极细拼缝
        ctx.strokeStyle = '#3b4750';
        ctx.lineWidth = 2;
        ctx.strokeRect(x * 256, z * 256, 256, 256);
        // 微弱高光边
        ctx.strokeStyle = '#70808c';
        ctx.lineWidth = 1;
        ctx.strokeRect(x * 256 + 2, z * 256 + 2, 252, 252);
      }
    }
    // 水磨石微小石英骨料颗粒
    grain(ctx, 512, 28000, 88);
  });

  const height = paintTexture(
    512,
    (ctx) => {
      ctx.fillStyle = '#dddddd';
      ctx.fillRect(0, 0, 512, 512);
      ctx.strokeStyle = '#777777';
      ctx.lineWidth = 3;
      for (let z = 0; z < 2; z++) {
        for (let x = 0; x < 2; x++) {
          ctx.strokeRect(x * 256, z * 256, 256, 256);
        }
      }
      grain(ctx, 512, 8000, 88);
    },
    false
  );

  const roughness = paintTexture(
    512,
    (ctx) => {
      // 深夜打蜡水磨石地面：适度镜面反射，承接值班员手电光束与走廊顶灯倒影
      ctx.fillStyle = '#42484d';
      ctx.fillRect(0, 0, 512, 512);
      grain(ctx, 512, 12000, 150);
    },
    false
  );

  for (const texture of [albedo, height, roughness]) {
    texture.repeat.set(30 / 1.2, 22 / 1.2);
  }

  return new THREE.MeshStandardMaterial({
    map: albedo,
    bumpMap: height,
    bumpScale: 0.008,
    roughnessMap: roughness,
    roughness: 0.22,
    metalness: 0.18
  });
}

/**
 * 真实公立医院墙面（深夜冷调电影感分级）：
 * 上部（1.0m 以上）：冷灰青雾面抗菌墙漆（压暗刺眼白光，保留空间轮廓）
 * 下部（1.0m 以下）：深板岩防撞裙板与金属防撞带
 */
export function plasterMaterial(): THREE.MeshStandardMaterial {
  const texture = paintTexture(512, (ctx) => {
    // 上部冷青灰（彻底告别白昼泛白，还原封面 04:00 AM 暗调走廊质感）
    ctx.fillStyle = '#6c7c85';
    ctx.fillRect(0, 0, 512, 512);

    // 下部 1/3 防撞护墙板颜色（深冷灰板岩）
    ctx.fillStyle = '#47555e';
    ctx.fillRect(0, 340, 512, 172);

    // 防撞过渡分界线（深灰铝合金条）
    ctx.fillStyle = '#36424a';
    ctx.fillRect(0, 335, 512, 6);
    ctx.fillStyle = '#1f272c';
    ctx.fillRect(0, 341, 512, 2);

    grain(ctx, 512, 16000, 312);
  });

  const height = paintTexture(
    512,
    (ctx) => {
      ctx.fillStyle = '#bbbbbb';
      ctx.fillRect(0, 0, 512, 512);
      ctx.fillStyle = '#888888';
      ctx.fillRect(0, 335, 512, 8);
      grain(ctx, 512, 18000, 312);
    },
    false
  );

  return new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: height,
    bumpScale: 0.005,
    roughness: 0.78
  });
}

/**
 * 现代医院天花板：
 * 600×600 嵌入式防尘吸音铝扣板网格，深夜压暗色调，避免顶棚泛白。
 */
export function ceilingMaterial(): THREE.MeshStandardMaterial {
  const texture = paintTexture(512, (ctx) => {
    ctx.fillStyle = '#4e5c64';
    ctx.fillRect(0, 0, 512, 512);
    grain(ctx, 512, 12000, 199);
    ctx.strokeStyle = '#354148';
    ctx.lineWidth = 3;
    for (let x = 0; x < 2; x++) {
      for (let z = 0; z < 2; z++) {
        ctx.strokeRect(x * 256, z * 256, 256, 256);
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
  const weave = paintTexture(
    128,
    (ctx) => {
      ctx.fillStyle = '#b0b0b0';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = '#909090';
      ctx.lineWidth = 1;
      for (let i = 0; i < 128; i += 4) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 128);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(128, i);
        ctx.stroke();
      }
    },
    false
  );
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    bumpMap: weave,
    bumpScale: 0.0025
  });
}

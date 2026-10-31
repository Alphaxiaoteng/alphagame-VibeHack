import * as THREE from 'three';

/** 本地确定性材质，不依赖 CDN；颜色贴图用 sRGB，粗糙度/凹凸贴图用线性空间。 */
export function paintTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void, color = true): THREE.CanvasTexture {
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
    ctx.fillStyle = `rgba(${i % 2 ? '255,255,255' : '72,75,68'},${alpha})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

export function tileMaterial(): THREE.MeshStandardMaterial {
  const albedo = paintTexture(512, ctx => {
    ctx.fillStyle = '#dedfd8';
    ctx.fillRect(0, 0, 512, 512);
    for (let z = 0; z < 2; z++) for (let x = 0; x < 2; x++) {
      ctx.fillStyle = ['#e0e0d9', '#d8dbd5', '#ddded7', '#dadcd5'][z * 2 + x];
      ctx.fillRect(x * 256 + 2, z * 256 + 2, 252, 252);
      ctx.strokeStyle = '#c4c9c1';
      ctx.lineWidth = 3;
      ctx.strokeRect(x * 256, z * 256, 256, 256);
      ctx.strokeStyle = '#f0eee6';
      ctx.lineWidth = 1;
      ctx.strokeRect(x * 256 + 3, z * 256 + 3, 250, 250);
    }
    grain(ctx, 512, 32000, 72);
  });
  const height = paintTexture(512, ctx => {
    ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#666666'; ctx.lineWidth = 4;
    for (let z = 0; z < 2; z++) for (let x = 0; x < 2; x++) ctx.strokeRect(x * 256, z * 256, 256, 256);
    grain(ctx, 512, 10000, 72);
  }, false);
  const roughness = paintTexture(512, ctx => {
    ctx.fillStyle = '#b5b5b5'; ctx.fillRect(0, 0, 512, 512);
    grain(ctx, 512, 16000, 135);
  }, false);
  for (const texture of [albedo, height, roughness]) texture.repeat.set(30 / 1.2, 22 / 1.2);
  return new THREE.MeshStandardMaterial({ map: albedo, bumpMap: height, bumpScale: 0.014, roughnessMap: roughness, roughness: 0.72, metalness: 0.04 });
}

export function plasterMaterial(): THREE.MeshStandardMaterial {
  const texture = paintTexture(256, ctx => {
    ctx.fillStyle = '#e9e8e0'; ctx.fillRect(0, 0, 256, 256);
    grain(ctx, 256, 19000, 231);
  });
  const height = paintTexture(256, ctx => {
    ctx.fillStyle = '#aaaaaa'; ctx.fillRect(0, 0, 256, 256);
    grain(ctx, 256, 28000, 231);
  }, false);
  return new THREE.MeshStandardMaterial({ map: texture, bumpMap: height, bumpScale: 0.006, roughness: 0.88 });
}

export function ceilingMaterial(): THREE.MeshStandardMaterial {
  const texture = paintTexture(512, ctx => {
    ctx.fillStyle = '#eeeee7'; ctx.fillRect(0, 0, 512, 512);
    grain(ctx, 512, 17000, 120);
    ctx.strokeStyle = '#c9cdc6'; ctx.lineWidth = 4;
    for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) ctx.strokeRect(x * 256, z * 256, 256, 256);
  });
  texture.repeat.set(15, 11);
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.94, side: THREE.DoubleSide });
}

export function clothMaterial(color: number): THREE.MeshStandardMaterial {
  const weave = paintTexture(128, ctx => {
    ctx.fillStyle = '#a0a0a0'; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#808080'; ctx.lineWidth = 1;
    for (let i = 0; i < 128; i += 4) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke(); }
  }, false);
  return new THREE.MeshStandardMaterial({ color, roughness: 0.93, bumpMap: weave, bumpScale: 0.0025 });
}

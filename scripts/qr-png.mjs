// 生成公网地址的二维码 PNG，供路演 PPT、小红书笔记与打印物料直接使用。
// 用法：npm run qr:png
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import QRCode from 'qrcode';

const URL = process.env.PAGES_URL ?? 'https://alphaxiaoteng.github.io/escape-45s/';
const targets = [
  'assets/art/ui/qr-deploy.png',
  'public/qr-game.png',
  'public/textures/qr-game.png',
];

for (const out of targets) {
  mkdirSync(dirname(out), { recursive: true });
  await QRCode.toFile(out, URL, {
    width: 720,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#233c32', light: '#f2f4ec' },
  });
  console.log(`✓ ${out} → ${URL}`);
}


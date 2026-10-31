// 生成公网地址的二维码 PNG，供路演 PPT、小红书笔记与打印物料直接使用。
// 用法：npm run qr:png
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import QRCode from 'qrcode';

const URL = process.env.PAGES_URL ?? 'https://alphaxiaoteng.github.io/midnight-duty/';
const OUT = 'assets/art/ui/qr-deploy.png';

mkdirSync(dirname(OUT), { recursive: true });
await QRCode.toFile(OUT, URL, {
  width: 720,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#233c32', light: '#f2f4ec' },
});

console.log(`✓ ${OUT} → ${URL}`);

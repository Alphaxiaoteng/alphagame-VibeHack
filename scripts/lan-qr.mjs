// 打印当前局域网访问地址的二维码，配合 `npm run serve:lan` 使用（现场断网兜底）。
import { networkInterfaces } from 'node:os';
import qrcode from 'qrcode-terminal';

const PORT = process.env.PORT ?? '4173';

const lanIP = Object.values(networkInterfaces())
  .flat()
  .filter((nic) => nic && nic.family === 'IPv4' && !nic.internal)
  .map((nic) => nic.address)[0];

if (!lanIP) {
  console.error('未找到局域网 IPv4 地址：请先连接 Wi-Fi 或开热点。');
  process.exit(1);
}

const url = `http://${lanIP}:${PORT}/`;
console.log(`\n局域网地址（手机需与电脑同一 Wi-Fi/热点）：\n  ${url}\n`);
qrcode.generate(url, { small: true }, (qr) => console.log(qr));

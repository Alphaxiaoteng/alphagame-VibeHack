// 构建 dist 并推送到 GitHub Pages 专用仓库，然后打印可扫码的访问地址。
// 用法：npm run deploy
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import qrcode from 'qrcode-terminal';

const OWNER = process.env.PAGES_OWNER ?? 'Alphaxiaoteng';
const REPO = process.env.PAGES_REPO ?? 'midnight-duty';
const BRANCH = 'main';
const URL = `https://${OWNER.toLowerCase()}.github.io/${REPO}/`;

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

console.log('▶ 构建 dist …');
run('npm', ['run', 'build'], process.cwd());

console.log('▶ 准备 Pages 仓库内容 …');
const staging = mkdtempSync(join(tmpdir(), 'pages-'));
try {
  cpSync('dist', staging, { recursive: true });
  // 绕过 Jekyll，避免下划线开头的产物被吞
  writeFileSync(join(staging, '.nojekyll'), '');

  const git = (...args) => run('git', args, staging);
  git('init', '-q', '-b', BRANCH);
  git('add', '-A');
  git('-c', 'user.name=Codely', '-c', 'user.email=codely@local', 'commit', '-q', '-m', `deploy ${new Date().toISOString()}`);
  git('remote', 'add', 'origin', `https://github.com/${OWNER}/${REPO}.git`);
  console.log('▶ 推送 …');
  git('push', '-f', '-q', 'origin', `${BRANCH}:${BRANCH}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log(`\n✓ 已推送。公网地址（Pages 首次生效约 1 分钟）：\n  ${URL}\n`);
qrcode.generate(URL, { small: true }, (qr) => console.log(qr));

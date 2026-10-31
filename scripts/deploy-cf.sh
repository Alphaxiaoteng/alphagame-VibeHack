#!/usr/bin/env bash
set -euo pipefail

cd /Users/albert/Documents/project/alphagame-VibeHack

echo "1. 同步最新路演 PPT 页面到 public/..."
cp /Users/albert/Documents/Alpha-Notes/00_Workspace/Excalidraw/PPT_20261031_查房_3D心理微恐解密游戏路演_本地演示.html public/PPT_20261031_查房_3D心理微恐解密游戏路演_本地演示.html
cp /Users/albert/Documents/Alpha-Notes/00_Workspace/Excalidraw/PPT_20261031_查房_3D心理微恐解密游戏路演_本地演示.html public/pitch.html

echo "2. 执行静态检查与生产构建..."
npm run typecheck
npm run build

echo "3. 清理超出 Cloudflare Pages 25MB 限制的未压缩原始模型缓存..."
rm -rf dist/assets/art/models

echo "4. 调用 Cloudflare Wrangler CLI 推送至线上 (rounds-game -> game.alphaintelligence.ltd)..."
npx wrangler pages deploy dist --project-name rounds-game --branch main --commit-dirty=true

echo "5. 部署完成！线上地址："
echo "   - 游戏主页: https://game.alphaintelligence.ltd"
echo "   - 路演PPT:  https://game.alphaintelligence.ltd/pitch.html"

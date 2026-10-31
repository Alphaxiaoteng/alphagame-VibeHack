import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { waffoApiPlugin } from './src/server/apiPlugin';

export default defineConfig(({ mode }) => ({
  // 相对路径打包：同一份 dist 既能部署到 GitHub Pages 子路径，也能本地局域网直接访问
  base: './',
  // 空前缀＝读全量变量：Waffo 私钥只有 Node 侧中间件用得到，绝不能带 VITE_ 前缀暴露给浏览器
  plugins: [waffoApiPlugin(loadEnv(mode, process.cwd(), ''))],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
  },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  build: {
    assetsInlineLimit: 0,
    // three.js 是唯一的重量级依赖（约 560 kB），单独成块后可被浏览器长缓存，
    // 游戏逻辑与场景改动不会让玩家的 three 缓存失效。
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
    // three 单独成块后，业务代码块远小于阈值；保留此提示阈值以便发现回归。
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    maxWorkers: 2,
  },
}));

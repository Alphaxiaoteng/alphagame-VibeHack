# 《查房》(Rounds) 智能体作业规则 (AGENTS.md)

## 1. 核心路径索引 (Key Paths)

- **工程根目录**：[`/Users/albert/Documents/project/alphagame-VibeHack`](file:///Users/albert/Documents/project/alphagame-VibeHack)
- **游戏策划案 (GDD)**：[`docs/GAME_DESIGN.md`](file:///Users/albert/Documents/project/alphagame-VibeHack/docs/GAME_DESIGN.md)
- **《查房》AI 详细开发说明（核心规格）**：[`docs/查房_AI开发说明.md`](file:///Users/albert/Documents/project/alphagame-VibeHack/docs/查房_AI开发说明.md)
- **《查房》三阶段开发流水线提示词**：[`docs/查房_三阶段AI开发提示词.md`](file:///Users/albert/Documents/project/alphagame-VibeHack/docs/查房_三阶段AI开发提示词.md)
- **《查房》玩法 20 秒速读**：[`docs/查房_玩法速读.md`](file:///Users/albert/Documents/project/alphagame-VibeHack/docs/查房_玩法速读.md)
- **比赛规则一页速览**：[`docs/比赛规则_一页速览.md`](file:///Users/albert/Documents/project/alphagame-VibeHack/docs/比赛规则_一页速览.md)
- **开发与玩家验收规范 (Skill)**：[`.codely-cli/skills/midnight-game-qa/SKILL.md`](file:///Users/albert/Documents/project/alphagame-VibeHack/.codely-cli/skills/midnight-game-qa/SKILL.md)
- **工具 API 参考手册**：[`docs/TOOLS_API_REFERENCE.md`](file:///Users/albert/Documents/project/alphagame-VibeHack/docs/TOOLS_API_REFERENCE.md)
- **赛事完整手册**：[`docs/VIBE_HACKS_06_GUIDE.md`](file:///Users/albert/Documents/project/alphagame-VibeHack/docs/VIBE_HACKS_06_GUIDE.md)
- **美术资产目录**：[`assets/art/`](file:///Users/albert/Documents/project/alphagame-VibeHack/assets/art)（模型 `models/`、贴图 `textures/`、参考图 `concepts/`、界面 `ui/`）
- **音频资产目录**：[`assets/audio/`](file:///Users/albert/Documents/project/alphagame-VibeHack/assets/audio)（背景音乐 `bgm/`、音效 `sfx/`、语音 `voices/`）
- **提示词目录**：[`assets/prompts/`](file:///Users/albert/Documents/project/alphagame-VibeHack/assets/prompts)

---

## 2. 防上下文污染规则 (Anti-Context Pollution)

- **严禁全量长文本轰炸**：禁止向会话上下文中一次性倾倒大段代码、冗余文档或未剪裁日志，一律按需切片读取。
- **渐进式加载**：优先根据上述路径索引按需加载，杜绝盲目全局通扫。
- **保持输出高信噪比**：终端命令输出必须限制截流（如 `head -n 50`），交付回复结论先行、直入主题。

---

## 3. 生成与凭据要求 (Generation & Credential Guidelines)

- **生成风格统一**：
  - 遵循《查房》写实取向、明亮可读、气氛克制的 3D 医院美学，模型比例（`1 Unit = 1m`）与真实材质统一，禁止写实与卡通风格割裂混搭。
  - 音频调性统一（脚步声、巡逻节奏、广播音与冷峻压迫感氛围音效）。
- **凭据双轨注入规范（严禁代码硬编码）**：
  - **专用 CLI 工具（如 Tripo CLI）**：使用官方受控凭据系统存储（如 `~/.tripo/config.json`，权限 `0600`，由 `tripo login` 隔离维护）。
  - **业务代码与运行时 API（如 硅基流动 / 智谱）**：通过本地项目环境文件 `.env.local`（已在 `.gitignore` 阻断提交）注入 `process.env`，绝不随 Git 仓库提交。

---

## 4. 部署与现场试玩 (Deploy & Demo)

- **公网地址**：<https://alphaxiaoteng.github.io/midnight-duty/>（GitHub Pages；`Alphaxiaoteng/midnight-duty` 只存构建产物，源码仓库保持私有）。
- **重新部署**：`npm run deploy` — 构建 `dist/`、推送并打印二维码，首次生效约 1 分钟。
- **现场兜底（不依赖外网）**：终端 A 跑 `npm run serve:lan`，终端 B 跑 `npm run qr:lan` 打印局域网二维码，手机连同一 Wi-Fi 或热点扫码进入。
- **打包约束**：`vite.config.ts` 使用 `base: './'`，同一份 `dist/` 同时适配 Pages 子路径与局域网直连。
- **二维码物料**：`npm run qr:png` 生成 `assets/art/ui/qr-deploy.png`，可直接贴进路演 PPT 与小红书笔记。

## 5. 进度同步纪律

- **文档即真相源**：每完成一个可验收节点（验证通过、修复落地、部署完成、试玩反馈收集），当次随手同步进 `IMPLEMENTATION_STATUS.md` 与 `README.md` 的对应数字与记录；交接只引用文档与行号，不贴大段内容刷屏。

# 项目智能体作业规则 (AGENTS.md)

## 1. 核心路径索引 (Key Paths)

- **工程根目录**：[`/Users/albert/Documents/project/apps/alphagame-VibeHack`](file:///Users/albert/Documents/project/apps/alphagame-VibeHack)
- **赛事完整手册**：[`docs/VIBE_HACKS_06_GUIDE.md`](file:///Users/albert/Documents/project/apps/alphagame-VibeHack/docs/VIBE_HACKS_06_GUIDE.md)
- **工具 API 参考**：[`docs/TOOLS_API_REFERENCE.md`](file:///Users/albert/Documents/project/apps/alphagame-VibeHack/docs/TOOLS_API_REFERENCE.md)
- **游戏策划案**：[`docs/GAME_DESIGN.md`](file:///Users/albert/Documents/project/apps/alphagame-VibeHack/docs/GAME_DESIGN.md)
- **美术资产目录**：[`assets/art/`](file:///Users/albert/Documents/project/apps/alphagame-VibeHack/assets/art)（模型 `models/`、贴图 `textures/`、参考图 `concepts/`、界面 `ui/`）
- **音频资产目录**：[`assets/audio/`](file:///Users/albert/Documents/project/apps/alphagame-VibeHack/assets/audio)（背景音乐 `bgm/`、音效 `sfx/`、语音 `voices/`）
- **提示词目录**：[`assets/prompts/`](file:///Users/albert/Documents/project/apps/alphagame-VibeHack/assets/prompts)

---

## 2. 防上下文污染规则 (Anti-Context Pollution)

- **严禁全量长文本轰炸**：禁止向会话上下文中一次性倾倒大段代码、冗余文档或未剪裁日志，一律按需切片读取。
- **渐进式加载**：优先根据上述路径索引按需加载，杜绝盲目全局通扫。
- **保持输出高信噪比**：终端命令输出必须限制截流（如 `head -n 50`），交付回复结论先行、直入主题。

---

## 3. 生成与凭据要求 (Generation & Credential Guidelines)

- **生成风格统一**：
  - 3D 模型风格统一（统一 Low-Poly / Stylized 等同一流派），模型面数与尺度比例（`1 Unit = 1m`）保持一致，禁止写实与卡通风格割裂混搭。
  - 音频调性统一（BGM 与音效风格匹配当前游戏世界观设定）。
- **凭据双轨注入规范（严禁代码硬编码）**：
  - **专用 CLI 工具（如 Tripo CLI）**：使用官方受控凭据系统存储（如 `~/.tripo/config.json`，权限 `0600`，由 `tripo login` 隔离维护）。
  - **业务代码与运行时 API（如 MiniMax / 智谱）**：通过本地项目环境文件 `.env.local`（已在 `.gitignore` 阻断提交）注入 `process.env`，绝不随 Git 仓库提交。

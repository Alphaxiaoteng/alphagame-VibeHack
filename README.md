# 《查房》(Rounds)

> VibeHacks #06 (Vibe Coding for 3D 游戏世界) 参赛作品

**一句话定位**：在主电源中断的公立医院躲避巡查值班员，利用三条不可逆的“值班指令”临时改写医院规则与路线，在回字形走廊中周旋并坚持存活 60 秒，最终冲向通电的安全门逃脱。

---

## 游戏核心机制

- **目标**：存活 60 秒直至安全门通电亮起，亲自冲到门口获胜；被值班员碰到立即失败。
- **三条值班指令（改写规则，承受代价）**：
  1. `[1] 全院开灯`：看清出口路线与值班员走廊，代价是值班员视野同样扩大。
  2. `[2] 封锁走廊`：防火门落下阻断追捕通道，代价是玩家也无法穿过。
  3. `[3] 广播查房`：将病房灯光点亮引走值班员，代价是广播后值班员搜索范围与警觉度大幅提升。
- **操作方式**：`WASD` 移动 · 按住 `Shift` 奔跑 · 鼠标右键拖动视角 · `1/2/3` 发动指令 · `Esc` 暂停 · `R` 重新开始。

---

## 核心文档索引 (全部归口于 docs/)

- [智能体作业契约 (AGENTS.md)](AGENTS.md)
- [《查房》游戏详细设计案 (docs/GAME_DESIGN.md)](docs/GAME_DESIGN.md)
- [《查房》AI 详细开发说明 (docs/查房_AI开发说明.md)](docs/查房_AI开发说明.md)
- [《查房》三阶段开发流水线提示词 (docs/查房_三阶段AI开发提示词.md)](docs/查房_三阶段AI开发提示词.md)
- [《查房》玩法 20 秒速读 (docs/查房_玩法速读.md)](docs/查房_玩法速读.md)
- [比赛规则一页速览 (docs/比赛规则_一页速览.md)](docs/比赛规则_一页速览.md)
- [工具 API 调用参考手册 (docs/TOOLS_API_REFERENCE.md)](docs/TOOLS_API_REFERENCE.md)
- [VibeHacks #06 赛事总览指南 (docs/VIBE_HACKS_06_GUIDE.md)](docs/VIBE_HACKS_06_GUIDE.md)

---

## 技术架构

- **渲染引擎**：Three.js + TypeScript + Vite（纯前端 WebGL 单页，扫码即玩）
- **3D 资产管线**：Tripo 3D 官方 CLI（模型、贴图、骨骼绑定）
- **AI 动态注入**：硅基流动 SiliconFlow（`zai-org/GLM-5.3-Flash` 驱动 NPC 对白与关卡逻辑）

# 官方赞助工具与 3D / 生图平台接入全景手册

本文档基于 [VibeHacks #06 官方 Token 赞助页面](https://vibecafe.ai/hacks/6?tab=tokens) 整理，汇总所有可用 3D 模型生成平台与非硅基流动的生图/多模态平台使用方法（所有私密兑换码与 API Key 已遵循安全红线脱敏隔离）。

---

## 1. 官方可用的 3D 模型生成平台（共 2 个）

| 平台名称 | 官方赞助权益 | 核心能力 | 当前状态与使用方式 |
| :--- | :--- | :--- | :--- |
| **Tripo 3D** | Pro 会员 + 3,000 积分 | Text-to-3D、Image-to-3D、自动骨骼绑定 (Rigging)、导出 GLB/FBX | **已配置就绪并跑通**。终端直接运行 `tripo make`，单模型仅耗费 20 积分。 |
| **Hyper3D (Rodin)** | 4 天 Business 会员（支持 API 与 MCP） | 文字或参考图生成高精度 3D 模型 | **可用**。前往 [hyper3d.ai](https://hyper3d.ai) 账户兑换码入口激活，支持 [MCP 接入](https://hyper3d.ai/features/mcp)。 |

### Tripo 3D 终端生成实操命令
```bash
# 1. 生成医院推床模型（耗费 20 积分，直接产出 GLB）
tripo make "low poly stylized hospital bed with white mattress and metal frame, clean geometry, game asset" --model tripo-v3.1 -o ./assets/art/models/hospital_bed --yes

# 2. 生成医用药柜模型
tripo make "low poly stylized metallic hospital medicine cabinet, glass door, clean geometry, game asset" --model tripo-v3.1 -o ./assets/art/models/medicine_cabinet --yes

# 3. 生成角色并自动绑定骨骼
tripo make "stylized security guard warden with coat and flashlight, T-pose, game character" --model tripo-v3.1 --then rig -o ./assets/art/models/warden --yes
```

---

## 2. 官方可用的生图与多模态平台（不使用硅基流动）

在官方 [领取 Token 页面](https://vibecafe.ai/hacks/6?tab=tokens) 中，除硅基流动外，以下 **4 个官方赞助平台**可直接用于 2D 概念图、贴图与原画生成：

| 平台名称 | 官方赞助额度 | 核心生图与模型能力 | 官方入口与接入方式 |
| :--- | :--- | :--- | :--- |
| **VibeToken** | 每人 30 元独立额度 | 兼容 OpenAI 接口格式，支持**图像生成**、视频与对话大模型调用 | [vibecafe.ai](https://vibecafe.ai) 账户内输入专属兑换码激活，创建 API Key 后按标准 OpenAI SDK 调用。 |
| **小宿科技 FUMO** | 每人 \$50 礼品卡 | 提供 **Fusion Model（推荐 Fusion Max 2.0）**，支持高质量视觉生图与多模态生成 | 前往 [fumolab.ai](https://fumolab.ai) 登录并在 Billing 页面兑换 \$50 额度。 |
| **V2FUN** | 1 个月 Pro 会员 + 每队 5,000 API 积分 | 专注 AI 图像与艺术资产生成，支持网页端创作与 API 调用 | 前往 [v2fun.art](https://v2fun.art) 注册并兑换 Pro 会员与团队 API 积分。 |
| **Paean** | 每份 5,000 Credits（价值 \$50） | 创意工作流与多模态生成底座 | 前往 Paean 官网兑换页面输入兑换码激活 5,000 积分。 |

---

## 3. 其他官方赞助开发工具与算力

| 平台名称 | 赞助内容 | 适用场景 |
| :--- | :--- | :--- |
| **Unity (团结 Codely)** | Codely 积分兑换权益（有效期 3 天） | 团结引擎内 AI 辅助编码（兑换入口：[codely.tuanjie.cn/topup](https://codely.tuanjie.cn/topup)） |
| **MiniMax** | 10,000 积分（有效期 30 天） | M 系列全模型调用、海螺语音合成（已用于生成本项目 8 段医院广播语音） |
| **智谱 GLM Coding Plan** | 7 天体验卡（含 2,000 体验积分） | 编码与 Agent 工具专用套餐（[open.bigmodel.cn](https://open.bigmodel.cn)） |
| **AI Ping** | 68 元～668 元 Token 算力支持 | 模型 API 聚合调用（[aiping.cn](https://www.aiping.cn)） |
| **七牛云** | 2,500 万 Token 体验套餐（1 个月） | 大模型推理与云端存储分发 |
| **商汤小浣熊** | 3,500 积分 | 桌面端智能代码助手 |
| **three.js** | 开源免费 | 本项目核心 Web 3D 渲染底座（[threejs.org](https://threejs.org)） |

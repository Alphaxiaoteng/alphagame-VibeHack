# 技术合作伙伴工具 API 调用与接入全景手册

本文档归口汇总 [VibeHacks #06](https://vibecafe.ai/hacks/6) 赛事核心技术合作伙伴的接入指南、账号状态与真实 API 调用代码示例。

---

## 1. 核心供应商账号与凭据准备现状

| 供应商 / 工具 | 核心用途 | 官方控制台入口 | 账号登录与 Key 就绪状态 | 接入形式 |
| :--- | :--- | :--- | :--- | :--- |
| **Tripo 3D** | 3D 资产生成 (Text/Image to 3D, Rigging) | [developers.tripo3d.ai](https://developers.tripo3d.ai) | **已就绪** (账号 `chenpaiteng@gmail.com`，额度 3,000 点，已注入 CLI) | 终端 CLI / Node SDK |
| **MiniMax** | NPC 对白、海螺多模态、角色语音 (TTS) | [api.minimax.chat](https://api.minimax.chat) | **浏览器已登录** (需在控制台创建 Key 并填入 `.env.local`) | REST API |
| **智谱 AI (ZAI)** | GLM-4 剧情推进、NPC 嘴遁、动态事件 | [open.bigmodel.cn](https://open.bigmodel.cn) | **待确认 Key** (建议登录开放平台领取免费体验额度) | REST API / SDK |
| **硅基流动 (SiliconFlow)** | 开源模型与生图加速 (Qwen, DeepSeek, Flux) | [cloud.siliconflow.cn](https://cloud.siliconflow.cn) | **待确认 Key** (注册即赠送免费额度，支持统一 OpenAI 格式) | REST API (OpenAI 兼容) |
| **three.js** | 浏览器轻量 WebGL 3D 游戏引擎 | [threejs.org](https://threejs.org) | **开源库无需账号** (直接本地 npm 安装接入) | 本地运行包 |

---

## 2. 各工具标准 API 调用代码范式

### 2.1 Tripo 3D 资产生成

#### 方式 A：终端 CLI（最推荐，零代码快速批量产出）
```bash
# 1. 文本生成 3D (统一风格: Low-Poly)
tripo make "low poly fantasy crystal tower, stylized, clean geometry" --for ar-web -o ./assets/art/models

# 2. 单张概念图生 3D + 自动骨骼绑定 (Rigging)
tripo make ./assets/art/concepts/hero.png --then texture,rig -o ./assets/art/models
```

#### 方式 B：TypeScript / Node SDK 代码调用
```bash
npm install @vastai/tripo-sdk
```
```typescript
import { TripoClient } from "@vastai/tripo-sdk";

const tripo = new TripoClient({
  apiKey: process.env.TRIPO_API_KEY!,
});

// 发起 Text-to-3D 任务
const task = await tripo.createTask({
  type: "text_to_model",
  prompt: "stylized low-poly floating island with small tree",
  model_version: "v3.1-20260211",
});

// 轮询并获取结果 GLB 下载链接
const result = await tripo.waitTask(task.task_id);
console.log("模型下载地址:", result.output.model);
```

---

### 2.2 MiniMax 语音合成 (TTS，用于 NPC 实时配音)

MiniMax TTS 具备丰富的情绪表达与音色库，适合在 3D 游戏中为 NPC 注入生动配音：

```typescript
// Node.js (fetch) 调用示例
async function generateNpcVoice(text: string, voiceId = "male-qn-qingse") {
  const response = await fetch(
    `https://api.minimax.chat/v1/t2a_v2?GroupId=${process.env.MINIMAX_GROUP_ID}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.MINIMAX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "speech-01-turbo",
        text: text,
        stream: false,
        voice_setting: {
          voice_id: voiceId,
          speed: 1.0,
          vol: 1.0,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
        },
      }),
    }
  );

  const data = await response.json();
  // 提取 base64 音频并保存为 mp3 到 assets/audio/voices/
  const audioBuffer = Buffer.from(data.data.audio, "hex");
  return audioBuffer;
}
```

---

### 2.3 智谱 GLM-4 对话与 NPC 状态机驱动

用于玩家与 3D 场景 NPC 的自然语言交互（如“嘴遁通关”机制）：

```typescript
async function chatWithNpc(playerInput: string, npcPersona: string) {
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.ZHIPUAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "glm-4-flash", // 免费/高响应模型
      messages: [
        {
          role: "system",
          content: `你是一个 3D 游戏里的守门 NPC。人设：${npcPersona}。回答简短（50字内），根据玩家的话判定是否同意开门，并在末尾输出 JSON：{"allow_pass": true/false}`,
        },
        { role: "user", content: playerInput },
      ],
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  return data.choices[0].message.content;
}
```

---

### 2.4 硅基流动 (SiliconFlow) 开源模型加速网关

硅基流动全量兼容 OpenAI SDK，调用 DeepSeek、Qwen2.5 或生图模型仅需切换 BaseURL：

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.SILICONFLOW_API_KEY,
  baseURL: "https://api.siliconflow.cn/v1",
});

async function generateGameStory(theme: string) {
  const completion = await client.chat.completions.create({
    model: "Qwen/Qwen2.5-7B-Instruct",
    messages: [
      { role: "system", content: "你是一位 3D 独立游戏剧情策划。" },
      { role: "user", content: `为主题【${theme}】构思一个包含3个关卡的简短游戏循环。` },
    ],
  });

  return completion.choices[0].message.content;
}
```

---

### 2.5 three.js 场景中加载 Tripo 产出的 GLB 模型

在前端使用 `GLTFLoader` 快速挂载模型：

```typescript
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const scene = new THREE.Scene();
const loader = new GLTFLoader();

// 加载 assets/art/models/ 下的模型
loader.load(
  "/assets/art/models/hero.glb",
  (gltf) => {
    const model = gltf.scene;
    // 强制缩放到标准尺度 (根据 AGENTS.md 规范)
    model.scale.set(1, 1, 1);
    scene.add(model);

    // 如果模型带有动画 (通过 Tripo 绑骨生成)
    if (gltf.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(gltf.animations[0]);
      action.play();
    }
  },
  undefined,
  (error) => {
    console.error("加载模型出错:", error);
  }
);
```

---

## 3. 本地开发准备建议清单

1. **立项前**：确定游戏的美学流派（如 Low-Poly）并在 `AGENTS.md` 中约束。
2. **凭据准备**：
   - Tripo 已就绪，可随时通过终端命令生图。
   - 如需 NPC 语音，打开 [MiniMax 开放平台](https://api.minimax.chat) 复制 API Key 和 Group ID，保存到 `.env.local`。
   - 如需大模型对话，可选用智谱或硅基流动，将 Key 保存到 `.env.local`。
3. **极速验证**：使用 `tripo make ... --dry-run` 先行验证 3D 模型生成结构，不消耗任何额度。

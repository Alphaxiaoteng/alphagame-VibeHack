# 技术合作伙伴工具 API 调用与接入全景手册

本文档汇总已实测验证通过的核心合作伙伴工具调用范式与环境状态。

---

## 1. 核心可用工具与模型矩阵 (Verified Toolset)

| 能力领域 | 服务商 | 官方模型标识 | 验证状态 | 用途与优势 |
| :--- | :--- | :--- | :--- | :--- |
| **3D 资产生成** | **Tripo 3D** | `v3.1-20260211` / `P2-20260801` | **已就绪** (3,000 点可用) | 终端 CLI 批量生成 GLB 模型、带贴图与自动骨骼绑定 |
| **旗舰语言模型** | **硅基流动 (SiliconFlow)** | `zai-org/GLM-5.3-Flash` | **实测 200 OK** | 智谱最新前沿模型，用于 NPC 对白、动态关卡事件推演 |
| **极速 2D 生图** | **硅基流动 (SiliconFlow)** | `Tongyi-MAI/Z-Image-Turbo` | **实测 200 OK** | 秒学生成白底概念原画（Image-to-3D 前置）与游戏 UI 图标 |
| **备用开源大模型** | **硅基流动 (SiliconFlow)** | `deepseek-ai/DeepSeek-V3` / `Qwen3.5` | **实测 200 OK** | 代码补全、长文本剧情规划 |
| **3D 游戏引擎** | **three.js** | 社区最新稳定版 | **已就绪** | 纯 Web 3D 渲染，评委现场扫码即玩，零摩擦 |

---

## 2. 官方标准 API 调用示例代码

### 2.1 语言模型：GLM-5.3-Flash 调用范式
```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.SILICONFLOW_API_KEY,
  baseURL: "https://api.siliconflow.cn/v1",
});

export async function chatWithNpc(userPrompt: string) {
  const completion = await client.chat.completions.create({
    model: "zai-org/GLM-5.3-Flash",
    messages: [
      { role: "system", content: "你是一个 3D 游戏里的守关 NPC，请保持风格幽默与短句回答。" },
      { role: "user", content: userPrompt },
    ],
  });

  return completion.choices[0].message.content;
}
```

### 2.2 2D 生图：Z-Image-Turbo 极速概念图生成
```typescript
export async function generateConceptArt(prompt: string): Promise<string> {
  const res = await fetch("https://api.siliconflow.cn/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "Tongyi-MAI/Z-Image-Turbo",
      prompt: `${prompt}, low poly stylized 3d game asset, isolated on pure white background`,
      image_size: "1024x1024",
    }),
  });

  const data = await res.json();
  return data.images[0].url; // 返回生成的高清图 URL，可直接传入 Tripo 生成 3D
}
```

### 2.3 3D 模型生成：Tripo CLI 极速产出
```bash
# 文本生 3D 模型 (统一 Low-Poly 风格)
tripo make "low poly fantasy crystal tower" --for ar-web -o ./assets/art/models

# 概念图转 3D + 自动骨骼绑定
tripo make ./assets/art/concepts/hero.png --then texture,rig -o ./assets/art/models
```

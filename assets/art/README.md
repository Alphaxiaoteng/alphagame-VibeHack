# 美术资产规范与目录说明 (Art Assets Pipeline)

本目录用于存放 VibeHacks #06 3D 游戏项目所需的所有视觉与三维资产。

---

## 目录结构划分

- **`models/`**：3D 游戏模型资产（主推 `.glb` 格式，亦支持 `.fbx`、`.obj`）
  - 面数控制：推荐单模型三角面数在 5,000～30,000 之间，保证 WebGL / 移动端实时渲染流畅（60 FPS）。
  - Tripo CLI 自动产出命令示例：
    ```bash
    tripo make "low poly cyberpunk motorcycle" --for ar-web -o ./assets/art/models
    ```
- **`textures/`**：材质与纹理贴图（BaseColor、Normal、Roughness、Metallic、AO）
  - 规格推荐：1024x1024 或 512x512 PNG/WebP，兼顾加载速度与画质。
- **`concepts/`**：概念原画与参考图
  - 用于配合 Tripo CLI 执行 Image-to-3D 任务：
    ```bash
    tripo make ./assets/art/concepts/hero.png --then texture,rig,convert:fbx -o ./assets/art/models
    ```
- **`ui/`**：界面 2D 资产、HUD 控件与矢量图标
  - 遵循统一视觉风格，纯单色线性矢量优先（推荐 Lucide / Radix 风格），严禁廉价装饰性图标。

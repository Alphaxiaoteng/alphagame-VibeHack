# 《查房》(Rounds) 3D 资产与道具 AI 生成提示词规范库 (Industrial Grade)

> 适用引擎：Three.js WebGL (Low-Poly Realistic PBR，面数 3,000~15,000，米制单位，中心轴 Y=0)\
> 适配生成平台：**V2Fun 3D** (`gpt-image-2.5` 生图转 3D)、**Tripo 3D** (CLI / Web 文生3D)、**Hyper3D (Rodin)**\
> 设计原则：写实取向、明亮可读、气氛克制，浅米、冷灰白、低饱和淡绿真实公立医院配色，杜绝血腥脏污与卡通感。

---

## 一、全局统一风格锚点 (Universal Style Anchors)

为了确保 12 组核心道具在放入同一走廊、护士站与病房时**绝不出现风格打架**，所有提示词必须强制继承以下风格锚点：

### 1. 统一正向质感前缀 (Positive Prefix)
```text
Clean modern public hospital asset, realistic low-poly 3D game asset, subtle PBR materials, muted hospital off-white, light pale mint green and brushed stainless steel, clean geometric silhouette, authentic medical institutional scale, neutral soft studio lighting, sharp edges, game ready, isolated on pure solid gray background, photorealistic medical prop
```

### 2. 统一全局负向排除词 (Universal Negative Prompts)
```text
horror, blood, gore, dirty stains, rust, grime, decay, scratched paint, broken parts, post-apocalyptic, cartoon, anime, chibi, stylized low poly flat shading, fantasy, glowing magic, disfigured, floating elements, text, watermark, dramatic cinematic shadows, overexposed, ambient clutter, complex background
```

### 3. V2Fun `gpt-image-2.5` 选型建议
- **首选模型**：**`gpt-image-2.5-flare`**（边缘锐利、高光受控、结构规整，最适宜“生图转 3D 模型”）。
- **比例建议**：单体道具推荐 **1:1** 或 **3:4**，角色推荐 **9:16**。
- **背景控制**：必须带 `isolated on pure neutral solid background`，避免生成复杂地砖或墙面干扰后续转 3D 时的自动抠图。

---

## 二、12 组核心道具与角色标准提示词卡

### 1. 医用推床 / 急救病床 (Hospital Gurney / Bed) [风格基准样本]
- **空间规格**：`2.1m (宽) × 0.9m (深) × 0.85m (高)`
- **游戏功能**：走廊核心掩体，阻挡视线与巡查路径，玩家可绕行。
- **英文提示词 (Tripo / Hyper3D / V2Fun)**：
  ```text
  A modern mobile hospital patient bed gurney, realistic institutional medical equipment, stainless steel tubular frame, adjustable headrest, clean pale mint green waterproof medical mattress, foldable chrome safety side rails, four heavy-duty gray rubber swivel caster wheels with foot brakes, IV pole socket on the corner, clean muted colors, realistic PBR texture, game ready low-poly 3D asset, isolated on neutral studio background
  ```
- **中文提示词 (V2Fun 中文)**：
  ```text
  现代公立医院转运病床，真实医疗设备质感，不锈钢管状床架，淡薄荷绿防水医用床垫，可折叠镀铬金属护栏，四个带刹车的医用万向轮，床角带输液架插槽，干净无污渍，低多边形写实PBR游戏资产，纯色背景
  ```
- **PBR 材质调优**：金属护栏金属度 `0.85`、粗糙度 `0.2`；床垫粗糙度 `0.6`、金属度 `0.0`。

---

### 2. 立式双门医用玻璃药柜 (Medical Glass Cabinet)
- **空间规格**：`1.0m (宽) × 0.45m (深) × 1.9m (高)`
- **游戏功能**：南长走廊与药房高掩体，提供完全阻断视线的站立遮挡。
- **英文提示词**：
  ```text
  A tall freestanding hospital medical cabinet, dual glass doors on upper half with metal latch, solid double steel doors on lower half, powder-coated hospital cream off-white sheet metal body, tempered clear glass panes showing neatly arranged medicine boxes and saline bottles on shelves, stainless steel keyhole locks, sturdy base legs, clean public hospital pharmacy furniture, realistic PBR materials, isolated on neutral gray background
  ```
- **中文提示词**：
  ```text
  立式双开门公立医院药柜，上半部为双开透明钢化玻璃门，下半部为米白色冷轧钢烤漆铁门，柜内有多层隔板整齐摆放医用药盒与药瓶，带不锈钢锁扣与把手，底部带稳固支脚，写实公立医院药房家具，PBR材质，纯净背景
  ```
- **特定避坑词**：`wooden antique, transparent entire body, shattered glass, neon bottles`

---

### 3. 护士站前台组合柜 (Nurse Station Reception Counter)
- **空间规格**：`3.2m (宽) × 1.2m (深) × 1.15m (高)`
- **游戏功能**：中央核心转角掩体，半矮墙阻挡下半身，内侧可穿行。
- **英文提示词**：
  ```text
  An L-shaped public hospital nurse station reception desk counter, modular architectural furniture, seamless light grey synthetic stone countertop, pale sage green and matte white melamine panels, raised privacy transaction ledge, built-in recessed cable grommets, minimalist public hospital interior design, authentic institutional scale, clean subtle PBR texture, game ready 3D asset, isolated on neutral background
  ```
- **中文提示词**：
  ```text
  公立医院护士站L型接待前台导医台，浅灰色人造石台面，哑光白色与淡灰绿色防火板饰面，外侧带抬高的接待遮挡挡板，内侧为办公抽屉与走线孔，现代克制公立医院风格，规整建筑构件，PBR材质，纯色背景
  ```

---

### 4. 重型医院防火卷帘门套件 (Hospital Fire Shutter Door)
- **空间规格**：`2.4m (跨度) × 0.25m (厚) × 2.6m (高)`
- **游戏功能**：核心玩法机制，南北走廊闭合隔离门，通体金属阻断巡查与通行。
- **英文提示词**：
  ```text
  A heavy-duty commercial hospital overhead roll-up fire shutter security door, galvanized industrial steel horizontal interlocking slats, dark charcoal gray baked enamel finish with subtle pale yellow and black hazard warning stripes at bottom edge, heavy vertical wall guide tracks on both sides, top motorized overhead coiled shutter box, realistic industrial hospital architecture, game ready 3D model, isolated on neutral background
  ```
- **中文提示词**：
  ```text
  重型医院防火卷帘隔离门，水平联锁镀锌钢板卷帘，深灰哑光防锈漆，底梁带黄黑反光警示斜纹，两侧带粗壮嵌入式导轨，顶部为方形卷帘机械箱，真实工业逃生门质感，PBR硬表面资产，纯色背景
  ```

---

### 5. 紧急出口安全门套件 (Emergency Exit Door with Green Sign)
- **空间规格**：`1.2m (宽) × 0.15m (厚) × 2.2m (高)`
- **游戏功能**：终局通关判定区，门上方带绿色发光安全出口标牌。
- **英文提示词**：
  ```text
  A single leaf institutional hospital emergency exit door, heavy steel fire door painted in muted hospital light sage green, horizontal stainless steel panic push bar handle, door closer arm on top frame, reinforced door hinge plates, glowing green illuminated acrylic emergency exit sign box mounted directly above doorframe with running man pictogram, clean modern hospital corridor exit, realistic PBR asset, isolated on neutral background
  ```
- **中文提示词**：
  ```text
  公立医院单开紧急疏散逃生安全门，浅灰绿烤漆重型钢制防火门，横向不锈钢推杠逃生锁（Panic Bar），顶部带液压闭门器，门框正上方挂有发绿光的亚克力安全出口指示灯箱（奔跑小人标识），现代医院逃生门，PBR材质，纯色背景
  ```

---

### 6. 移动立式医用输液架 (IV Drip Stand Pole)
- **空间规格**：`0.55m (宽) × 0.55m (深) × 1.85m (高)`
- **游戏功能**：轻型阻挡物与视线穿透物，走廊点缀掩体。
- **英文提示词**：
  ```text
  A mobile hospital IV infusion drip stand pole, telescopic brushed stainless steel central vertical rod with blue plastic height adjustment knob, 4 circular metal top hanging hooks holding two clear plastic saline drip bags, stable 5-star weighted cast aluminum rolling base with five small black swivel wheels, realistic hospital ward equipment, game ready low poly PBR, isolated on pure neutral background
  ```
- **中文提示词**：
  ```text
  移动式医用不锈钢输液架，伸缩升降杆带蓝色高度调节旋钮，顶部四爪金属挂钩悬挂两只透明生理盐水输液袋与导管，底部为五星加重铝合金底座配5个黑色万向轮，真实病房设备，PBR材质，纯色背景
  ```

---

### 7. 折叠医用轮椅 (Hospital Wheelchair)
- **空间规格**：`0.68m (宽) × 0.95m (深) × 0.92m (高)`
- **游戏功能**：转角中低矮掩体，提供局部蹲伏或视线死角。
- **英文提示词**：
  ```text
  A standard hospital manual transport wheelchair, chromed tubular steel folding frame, durable dark navy blue vinyl cushioned seat and backrest, two large 24-inch rear spoke wheels with gray solid rubber tires and hand push rims, two small front swivel casters, swing-away composite footrests, black rubber hand grips behind backrest, clean public hospital equipment, realistic PBR, isolated on solid studio background
  ```
- **中文提示词**：
  ```text
  公立医院折叠医用轮椅，镀铬钢管折叠车架，深蓝抗撕裂皮革座垫与靠背，两侧24寸手摇大轮配实心橡胶胎，前置小导向万向轮，可旋转拆卸塑料脚踏板，背后带黑色橡胶推手，写实医院器械，PBR材质，纯色背景
  ```

---

### 8. 医用氧气瓶推车 (Medical Oxygen Cylinder Cart)
- **空间规格**：`0.45m (宽) × 0.45m (深) × 1.35m (高)`
- **游戏功能**：重型金属点缀掩体，工业管线质感。
- **英文提示词**：
  ```text
  A dual medical oxygen cylinder transport hand cart, light blue steel tube dolly frame with safety retention chains, two tall seamless steel oxygen gas cylinders painted in sky blue and hospital grey, brass pressure regulator gauge valves and green flowmeter dial on top, two heavy rubber wheels at base, realistic public hospital respiratory equipment, game ready PBR model, isolated on neutral background
  ```
- **中文提示词**：
  ```text
  医用双瓶氧气瓶手推车，浅蓝色钢管小推车带防倾倒安全铁链，车上立有两只天蓝色医用无缝钢瓶，瓶顶带黄铜减压阀、压力表与湿化瓶，底部两个实心橡胶轮，真实医院急救设备，PBR材质，纯色背景
  ```

---

### 9. 走廊应急广播喇叭 / 壁挂对讲机 (Corridor PA Speaker / Intercom)
- **空间规格**：`0.28m (宽) × 0.12m (深) × 0.35m (高)`
- **游戏功能**：指令 3（广播查房）视觉触发实体，安装于墙壁中上方。
- **英文提示词**：
  ```text
  A wall-mounted public hospital corridor emergency intercom station and PA speaker, rectangular off-white fireproof ABS plastic casing, perforated metal speaker grille on upper half, red emergency push button, small status LED indicator lights (red and amber), clean institutional wall terminal device, realistic subtle PBR texture, game ready low poly 3D asset, isolated on neutral background
  ```
- **中文提示词**：
  ```text
  公立医院走廊壁挂式应急对讲分机与广播扬声器，长方形阻燃ABS米白塑料外壳，上半部为金属网孔喇叭罩，带红色紧急求助按钮与双色状态LED指示灯，写实弱电安防终端，PBR材质，纯色背景
  ```

---

### 10. 医院天花板悬挂科室导向牌 (Ceiling Directional Signboard)
- **空间规格**：`1.4m (宽) × 0.08m (厚) × 0.45m (高)`
- **游戏功能**：悬挂于南北走廊天花板，提供科室导向（西病区、东病区、急诊药房、护士站）。
- **英文提示词**：
  ```text
  A ceiling-suspended public hospital corridor directional wayfinding signage board, horizontal aluminum frame painted in hospital beige, dark teal accent header bar, crisp white bilingual typography and directional arrows indicating 'West Ward', 'East Ward', 'Pharmacy', dual thin steel suspension cables extending upward, realistic public hospital interior architectural prop, clean PBR material, isolated on neutral background
  ```
- **中文提示词**：
  ```text
  公立医院走廊吊顶科室导向标识牌，铝合金横向长方形标牌，米灰底色带深青绿科室条带，清晰白色中英双语标识与方向箭头（包含西病区、东病区、药房、护士站），顶部带双根极细钢丝吊索，写实医院导视牌，PBR材质，纯色背景
  ```

---

### 11. 巡查值班员 (Hospital Rounds Warden - 核心敌对 AI)
- **空间规格**：`0.6m (宽) × 0.4m (深) × 1.82m (高)`
- **游戏功能**：巡逻与追逐 AI 实体，需要标准 A-Pose 以便在 V2Fun 或 Mixamo 中直接自动绑骨与加载动画。
- **英文提示词**：
  ```text
  A realistic hospital rounds patrol warden security staff, adult male, natural athletic human proportions, wearing a buttoned long-sleeved dark slate gray institutional duty jacket over a collared shirt, dark trousers, sturdy black rubber-soled work shoes, a realistic staff ID card badge clipped on chest pocket, holding a heavy-duty black LED patrol flashlight in right hand, alert posture in standard clean A-pose with relaxed fingers, no weapons, realistic face with tired professional expression, authentic low-poly game character mesh ready for rigging, isolated on solid studio background
  ```
- **中文提示词**：
  ```text
  公立医院夜班巡查值班员，成年男性，标准真实人体比例，身穿深灰青色规整医院值班工装夹克与深色长裤，黑色防滑皮鞋，胸前夹有带照片的医院工作胸牌，右手握着一支黑色巡更强光手电筒，标准A-Pose姿态便于绑定骨骼，面部写实沉稳微倦，无武器无血腥，写实游戏角色，纯色背景
  ```
- **特定避坑词**：`zombie, monster, bloody apron, weapon, distorted face, t-pose hands touching body, high poly sculpted wrinkles`

---

### 12. 玩家角色 (Player Character - 第一/第三人称通用)
- **空间规格**：`0.55m (宽) × 0.35m (深) × 1.74m (高)`
- **游戏功能**：玩家实体（或第一人称手臂），身着低调公立医院病患/访客服饰。
- **英文提示词**：
  ```text
  A civilian hospital patient or visiting intern, young adult of neutral athletic build, wearing comfortable light heather grey long-sleeve cotton crewneck shirt and muted dark olive canvas trousers, beige slip-on canvas shoes, wearing a simple white paper hospital wristband on left wrist, neutral alert stance in clean symmetrical A-pose, authentic human anatomy proportions, game ready low-poly character model suitable for rigging and animation, isolated on neutral gray background
  ```
- **中文提示词**：
  ```text
  公立医院年轻病患或见习人员，真实普通人体比例，身穿浅麻灰色纯棉长袖上衣与哑光深橄榄绿工装休闲裤，脚穿米色帆布鞋，左手手腕戴有白色医用识别手环，对称标准A-Pose站姿便于骨骼绑定，低多边形写实游戏角色，纯色背景
  ```

---

## 三、各平台实操落地流水线 (Actionable Generation SOP)

### 方案 A：V2Fun 2D 生图转 3D 流水线（用户当前在用，限免 x5）
1. 打开 **V2Fun 工作区**：`https://v2fun.art/workspace?tab=image`。
2. 模型选择：下拉选择 **`gpt-image-2.5-flare`**（当前限免 x5 极高性价比）。
3. 尺寸比例：道具选择 **1:1**，角色选择 **9:16**。
4. 粘贴上方对应的**中文或英文提示词**，生成出高精度白底/灰底参考图。
5. 切换到 `https://v2fun.art/workspace?tab=model`（图片生成 3D），拖入刚刚生成的参考图。
6. 勾选 **PBR 贴图**，点击“立即生成”，下载导出为 `.glb` 格式。
7. 角色资产下载后，可直接在 V2Fun 的“绑骨动画”选项卡或 Mixamo 一键自动绑骨（Auto-Rig）。

### 方案 B：Tripo 3D 终端极速批量产出（已打通 CLI，剩余 2,980 积分）
在项目根目录运行单行命令即可直接产出可用 `.glb`（单次消耗仅 20 积分）：
```bash
# 示例：生成立式医用药柜
tripo make "A tall freestanding hospital medical cabinet, dual glass doors, clean hospital off-white metal body, game ready low-poly PBR" --model tripo-v3.1 --output-dir assets/art/models/medicine_cabinet/
```
产出后复制到 `assets/art/models/medicine_cabinet.glb` 即可被 Three.js 引擎直接挂载。

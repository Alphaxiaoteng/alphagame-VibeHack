/**
 * 《查房》(Rounds) 3D 资产管理注册表与配置管理服务
 * 支持多套风格主题热切换、单道具独立挂载及持久化存储
 */

export type ThemeId = 'modern' | 'vintage' | 'lowpoly' | 'industrial';

export type AssetCategory =
  | 'bed'
  | 'cabinet'
  | 'nurse_counter'
  | 'fire_door'
  | 'exit_door'
  | 'wheelchair'
  | 'warden';

export interface AssetSpec {
  dimensions: string; // 宽 x 深 x 高 (米)
  colliderRadius?: number;
  description: string;
}

export interface AssetEntry {
  id: string;
  name: string;
  theme: ThemeId;
  category: AssetCategory;
  glbUrl: string;
  previewUrl: string;
  spec: AssetSpec;
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  subtitle: string;
  description: string;
  wallColor: string;
  floorColor: string;
  accentColor: string;
  lightingTone: string;
  assetIds: string[];
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  modern: {
    id: 'modern',
    name: '标准现代公立 (Standard Modern)',
    subtitle: '写实克制 · 浅米淡灰绿',
    description: '真实三甲公立医院标准配色，拉丝不锈钢床架与淡灰绿防水床垫，冷白备用照明。',
    wallColor: '#ebe8e1',
    floorColor: '#4f5e58',
    accentColor: '#3a7d65',
    lightingTone: '4500K 冷白荧光',
    assetIds: [
      'modern_hospital_bed',
      'modern_medicine_cabinet',
      'modern_nurse_counter',
      'modern_fire_door',
      'modern_exit_door',
      'modern_wheelchair',
      'modern_warden'
    ]
  },
  vintage: {
    id: 'vintage',
    name: '80年代经典复古 (Classic Vintage 80s)',
    subtitle: '老式水磨石 · 军绿半截墙',
    description: '经典老式公立医院风貌，米黄铸铁摇杆病床、老式军绿铁皮药柜与做旧皮质轮椅。',
    wallColor: '#dfd8c8',
    floorColor: '#444c42',
    accentColor: '#4d6950',
    lightingTone: '3200K 暖黄旧日光灯',
    assetIds: [
      'vintage_retro_hospital_bed',
      'vintage_retro_medicine_cabinet',
      'vintage_retro_wheelchair'
    ]
  },
  lowpoly: {
    id: 'lowpoly',
    name: '经典极简低多边形 (Classic Low-Poly)',
    subtitle: '多边形硬表面 · 纯粹几何切面',
    description: '经典 Low-Poly 艺术设计，清晰的高饱和几何切面，高可读性与复古独立游戏质感。',
    wallColor: '#e0e4e7',
    floorColor: '#3d4a54',
    accentColor: '#2b8a78',
    lightingTone: '5000K 纯净无衰减',
    assetIds: [
      'lowpoly_hospital_bed',
      'lowpoly_nurse_counter',
      'lowpoly_fire_door'
    ]
  },
  industrial: {
    id: 'industrial',
    name: '经典硬核工业医疗 (Classic Industrial)',
    subtitle: '深灰碳素钢 · 警示斜纹防爆',
    description: '工业加固防爆防护规格，碳钢重型药柜、气压升降防爆安全门与高亮反光值班员。',
    wallColor: '#cfd2d6',
    floorColor: '#2c3035',
    accentColor: '#c49a2a',
    lightingTone: '4000K 工业高照度探照',
    assetIds: [
      'industrial_medicine_cabinet',
      'industrial_fire_door',
      'industrial_warden'
    ]
  }
};

export const ASSET_CATALOG: AssetEntry[] = [
  // 现代公立套系
  {
    id: 'modern_hospital_bed',
    name: '现代急救转运病床',
    theme: 'modern',
    category: 'bed',
    glbUrl: '/assets/art/models/modern/hospital_bed.glb',
    previewUrl: '/assets/art/models/modern/hospital_bed_preview.png',
    spec: {
      dimensions: '2.1m × 0.9m × 0.85m',
      colliderRadius: 0.5,
      description: '不锈钢管状床架，淡薄荷绿防水医用床垫，可折叠镀铬护栏。'
    }
  },
  {
    id: 'modern_medicine_cabinet',
    name: '立式双门玻璃药柜',
    theme: 'modern',
    category: 'cabinet',
    glbUrl: '/assets/art/models/modern/medicine_cabinet.glb',
    previewUrl: '/assets/art/models/modern/medicine_cabinet_preview.png',
    spec: {
      dimensions: '1.0m × 0.45m × 1.9m',
      colliderRadius: 0.5,
      description: '上半部透明钢化玻璃，下半部米白色冷轧钢烤漆，内置药盒药瓶。'
    }
  },
  {
    id: 'modern_nurse_counter',
    name: '护士站前台组合柜',
    theme: 'modern',
    category: 'nurse_counter',
    glbUrl: '/assets/art/models/modern/nurse_counter.glb',
    previewUrl: '/assets/art/models/modern/nurse_counter_preview.png',
    spec: {
      dimensions: '3.2m × 1.2m × 1.15m',
      colliderRadius: 1.2,
      description: 'L型导医前台，浅灰人造石台面，哑光白色与淡灰绿防火板饰面。'
    }
  },
  {
    id: 'modern_fire_door',
    name: '重型防火卷帘门',
    theme: 'modern',
    category: 'fire_door',
    glbUrl: '/assets/art/models/modern/fire_door.glb',
    previewUrl: '/assets/art/models/modern/fire_door_preview.png',
    spec: {
      dimensions: '2.4m × 0.25m × 2.6m',
      colliderRadius: 0.6,
      description: '镀锌钢板联锁卷帘，深灰哑光防锈漆，底梁带黄黑反光警示斜纹。'
    }
  },
  {
    id: 'modern_exit_door',
    name: '紧急出口安全逃生门',
    theme: 'modern',
    category: 'exit_door',
    glbUrl: '/assets/art/models/modern/exit_door.glb',
    previewUrl: '/assets/art/models/modern/exit_door_preview.png',
    spec: {
      dimensions: '1.2m × 0.15m × 2.2m',
      colliderRadius: 0.6,
      description: '浅灰绿防火钢门配横向不锈钢推杠锁，门头自带高亮绿色安全指示灯箱。'
    }
  },
  {
    id: 'modern_wheelchair',
    name: '折叠医用轮椅',
    theme: 'modern',
    category: 'wheelchair',
    glbUrl: '/assets/art/models/modern/wheelchair.glb',
    previewUrl: '/assets/art/models/modern/wheelchair_preview.png',
    spec: {
      dimensions: '0.68m × 0.95m × 0.92m',
      colliderRadius: 0.45,
      description: '镀铬钢管折叠架，深蓝抗撕裂皮革座垫，24寸手摇实心后轮。'
    }
  },
  {
    id: 'modern_warden',
    name: '夜班巡查值班员',
    theme: 'modern',
    category: 'warden',
    glbUrl: '/assets/art/models/modern/warden.glb',
    previewUrl: '/assets/art/models/modern/warden_preview.png',
    spec: {
      dimensions: '0.6m × 0.4m × 1.82m',
      colliderRadius: 0.4,
      description: '深灰青色规整工装制服配胸前工牌，右手手持高亮巡更手电筒。'
    }
  },

  // 经典复古 80s 套系
  {
    id: 'vintage_retro_hospital_bed',
    name: '80年代经典复古铸铁病床',
    theme: 'vintage',
    category: 'bed',
    glbUrl: '/assets/art/models/vintage/retro_hospital_bed.glb',
    previewUrl: '/assets/art/models/vintage/retro_hospital_bed_preview.png',
    spec: {
      dimensions: '2.1m × 0.9m × 0.9m',
      colliderRadius: 0.5,
      description: '米黄铸铁床架，经典苔绿色人造革床垫，床尾带金属手动摇杆。'
    }
  },
  {
    id: 'vintage_retro_medicine_cabinet',
    name: '经典军绿双门铁皮药柜',
    theme: 'vintage',
    category: 'cabinet',
    glbUrl: '/assets/art/models/vintage/retro_medicine_cabinet.glb',
    previewUrl: '/assets/art/models/vintage/retro_medicine_cabinet_preview.png',
    spec: {
      dimensions: '1.0m × 0.45m × 1.85m',
      colliderRadius: 0.5,
      description: '军绿防锈烤漆，复古黄铜把手与锁扣，陈列经典棕色药瓶。'
    }
  },
  {
    id: 'vintage_retro_wheelchair',
    name: '经典老式棕皮折叠轮椅',
    theme: 'vintage',
    category: 'wheelchair',
    glbUrl: '/assets/art/models/vintage/retro_wheelchair.glb',
    previewUrl: '/assets/art/models/vintage/retro_wheelchair_preview.png',
    spec: {
      dimensions: '0.7m × 0.95m × 0.9m',
      colliderRadius: 0.45,
      description: '深棕色复古皮质坐垫与靠背，加厚镀铬轮圈与铸铁脚踏。'
    }
  },

  // 经典极简低多边形套系
  {
    id: 'lowpoly_hospital_bed',
    name: '极简低多边形几何病床',
    theme: 'lowpoly',
    category: 'bed',
    glbUrl: '/assets/art/models/lowpoly/lowpoly_hospital_bed.glb',
    previewUrl: '/assets/art/models/lowpoly/lowpoly_hospital_bed_preview.png',
    spec: {
      dimensions: '2.1m × 0.9m × 0.8m',
      colliderRadius: 0.5,
      description: '纯粹 Low-Poly 艺术风格，清晰青绿与纯白多边形切面。'
    }
  },
  {
    id: 'lowpoly_nurse_counter',
    name: '极简低多边形护士台',
    theme: 'lowpoly',
    category: 'nurse_counter',
    glbUrl: '/assets/art/models/lowpoly/lowpoly_nurse_counter.glb',
    previewUrl: '/assets/art/models/lowpoly/lowpoly_nurse_counter_preview.png',
    spec: {
      dimensions: '3.0m × 1.2m × 1.1m',
      colliderRadius: 1.2,
      description: '模块化几何多边形拼装前台，硬朗切角，薄荷绿与哑光白分色。'
    }
  },
  {
    id: 'lowpoly_fire_door',
    name: '极简低多边形防火门',
    theme: 'lowpoly',
    category: 'fire_door',
    glbUrl: '/assets/art/models/lowpoly/lowpoly_fire_door.glb',
    previewUrl: '/assets/art/models/lowpoly/lowpoly_fire_door_preview.png',
    spec: {
      dimensions: '2.4m × 0.25m × 2.6m',
      colliderRadius: 0.6,
      description: '大色块几何折线卷帘门，底端亮黄黑高对比警示斜纹。'
    }
  },

  // 经典重工业防爆套系
  {
    id: 'industrial_medicine_cabinet',
    name: '重工业防爆加固药品柜',
    theme: 'industrial',
    category: 'cabinet',
    glbUrl: '/assets/art/models/industrial/industrial_medicine_cabinet.glb',
    previewUrl: '/assets/art/models/industrial/industrial_medicine_cabinet_preview.png',
    spec: {
      dimensions: '1.05m × 0.5m × 1.95m',
      colliderRadius: 0.55,
      description: '炭黑防爆防弹钢板，夹丝防砸钢化玻璃，机械旋转保险门栓。'
    }
  },
  {
    id: 'industrial_fire_door',
    name: '重工业气压升降防爆门',
    theme: 'industrial',
    category: 'fire_door',
    glbUrl: '/assets/art/models/industrial/industrial_fire_door.glb',
    previewUrl: '/assets/art/models/industrial/industrial_fire_door_preview.png',
    spec: {
      dimensions: '2.4m × 0.3m × 2.6m',
      colliderRadius: 0.6,
      description: 'X型钢架加固铸钢门板，两侧外露高压气动柱，高反光工业警示涂装。'
    }
  },
  {
    id: 'industrial_warden',
    name: '重工战术安保巡查员',
    theme: 'industrial',
    category: 'warden',
    glbUrl: '/assets/art/models/industrial/industrial_warden.glb',
    previewUrl: '/assets/art/models/industrial/industrial_warden_preview.png',
    spec: {
      dimensions: '0.65m × 0.45m × 1.85m',
      colliderRadius: 0.42,
      description: '战术重型防护夹克配荧光反光条，战术腰带与大功率探照手电。'
    }
  }
];

export interface AssetConfigState {
  activeTheme: ThemeId;
  individualOverrides: Partial<Record<AssetCategory, string>>; // category -> assetId
}

const STORAGE_KEY = 'rounds_asset_config_v1';

export class AssetRegistry {
  private static instance: AssetRegistry;
  private state: AssetConfigState = {
    activeTheme: 'modern',
    individualOverrides: {}
  };

  private listeners: Array<(state: AssetConfigState) => void> = [];

  private constructor() {
    this.load();
  }

  public static get(): AssetRegistry {
    if (!AssetRegistry.instance) {
      AssetRegistry.instance = new AssetRegistry();
    }
    return AssetRegistry.instance;
  }

  public getState(): AssetConfigState {
    return { ...this.state, individualOverrides: { ...this.state.individualOverrides } };
  }

  public getActiveTheme(): ThemeDefinition {
    return THEMES[this.state.activeTheme];
  }

  public setTheme(themeId: ThemeId): void {
    if (!THEMES[themeId]) return;
    this.state.activeTheme = themeId;
    this.save();
    this.notify();
  }

  public setOverride(category: AssetCategory, assetId: string): void {
    this.state.individualOverrides[category] = assetId;
    this.save();
    this.notify();
  }

  public clearOverride(category: AssetCategory): void {
    delete this.state.individualOverrides[category];
    this.save();
    this.notify();
  }

  public resetAll(): void {
    this.state = {
      activeTheme: 'modern',
      individualOverrides: {}
    };
    this.save();
    this.notify();
  }

  public getEffectiveAsset(category: AssetCategory): AssetEntry {
    const overrideId = this.state.individualOverrides[category];
    if (overrideId) {
      const found = ASSET_CATALOG.find((a) => a.id === overrideId);
      if (found) return found;
    }

    // 从当前套系找
    const theme = this.state.activeTheme;
    const themeAsset = ASSET_CATALOG.find((a) => a.theme === theme && a.category === category);
    if (themeAsset) return themeAsset;

    // 兜底从 modern 套系找
    return ASSET_CATALOG.find((a) => a.theme === 'modern' && a.category === category)!;
  }

  public subscribe(fn: (state: AssetConfigState) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn(this.getState());
      } catch (e) {
        console.error('AssetRegistry listener error', e);
      }
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // 忽略
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.activeTheme && THEMES[parsed.activeTheme as ThemeId]) {
          this.state.activeTheme = parsed.activeTheme as ThemeId;
        }
        if (parsed.individualOverrides) {
          this.state.individualOverrides = parsed.individualOverrides;
        }
      }
    } catch {
      // 忽略
    }
  }
}

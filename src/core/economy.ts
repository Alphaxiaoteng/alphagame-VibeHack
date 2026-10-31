/**
 * 买断制商品目录与权益判定。
 *
 * 纯逻辑：不依赖 DOM、Three.js 与网络，前端 UI 与服务端 Webhook 共用同一份目录，
 * 避免「前端显示的价格」与「服务端解锁的范围」各写一套后互相漂移。
 * 本文件里的价格只是展示串（Waffo 要求金额用展示格式，如 "0.99"），权威价格以店铺商品为准。
 */

import type { CommandId, RoundRules } from './config';

/**
 * 建筑题材。这栋楼表面是公立医院，02 起被「夜隐寮」占为据点：
 * 医院本体（墙裙、标识、护士站）是免费关卡的基准，也是付费关卡的掩护外壳；
 * 忍者题材在它之上叠加木构梁柱、和纸提灯与结界符，不改地图几何与碰撞。
 */
export type ThemeId = 'hospital' | 'shinobi';
export type LevelId = 'ward-01' | 'dojo-02' | 'vault-03';
export type SkinId = 'standard' | 'shinobi-indigo' | 'scroll-vermilion';
export type ProductSku = 'LEVEL_DOJO' | 'LEVEL_VAULT' | 'SKIN_PACK' | 'BUNDLE_ALL';

export type { RoundRules };

export interface LevelDef {
  id: LevelId;
  /** 界面上的科室编号 */
  index: string;
  name: string;
  /** 科室铭牌副标题 */
  ward: string;
  /** 免费关卡无需任何权益 */
  free: boolean;
  /** 该关卡的建筑题材：决定走廊里是病房构件还是忍者据点的木构与提灯 */
  theme: ThemeId;
  rules: RoundRules;
  /** 该科室的推荐皮肤，进入关卡时自动套用（未解锁则回落标准皮肤） */
  skin: SkinId;
}

export interface SkinDef {
  id: SkinId;
  name: string;
  free: boolean;
  /** 界面色板用主色 */
  swatch: number;
  /** 角色衣料主色 */
  cloth: number;
  /** 走廊墙裙主色 */
  wallSkirt: number;
  /** 顶灯色温 */
  lamp: number;
}

export interface ProductDef {
  sku: ProductSku;
  name: string;
  description: string;
  /** Waffo 展示格式金额，如 "0.99" */
  price: string;
  currency: string;
  /** 付款成功后解锁的范围 */
  grants: { levels: LevelId[]; skins: SkinId[] };
}

/**
 * 三个关卡的规则只在三个数字上分档，地图几何与碰撞完全一致：
 * 01 是免费基准局；02 把时长和守卫速度一起抬上去，考的是耐力；
 * 03 把指令冷却压到 8 秒，逼玩家靠忍术而不是靠跑位活下来。
 */
export const LEVELS: readonly LevelDef[] = [
  {
    id: 'ward-01',
    index: '01',
    name: '住院部',
    ward: '夜间巡查',
    free: true,
    theme: 'hospital',
    rules: { timeLimit: 45, commandCooldown: 12, patrolSpeed: 2.8 },
    skin: 'standard',
  },
  {
    id: 'dojo-02',
    index: '02',
    name: '夜隐寮',
    ward: '影巡潜入',
    free: false,
    theme: 'shinobi',
    rules: { timeLimit: 60, commandCooldown: 12, patrolSpeed: 3.2 },
    skin: 'shinobi-indigo',
  },
  {
    id: 'vault-03',
    index: '03',
    name: '封印殿',
    ward: '禁术封锁',
    free: false,
    theme: 'shinobi',
    rules: { timeLimit: 50, commandCooldown: 8, patrolSpeed: 3.0 },
    skin: 'scroll-vermilion',
  },
];

export const SKINS: readonly SkinDef[] = [
  { id: 'standard', name: '标准外科', free: true, swatch: 0x2f7d70, cloth: 0x2f7d70, wallSkirt: 0xb9c8bb, lamp: 0xebf3ef },
  { id: 'shinobi-indigo', name: '夜行装束', free: false, swatch: 0x2b3a52, cloth: 0x2b3a52, wallSkirt: 0x5a6a7c, lamp: 0xe6eff7 },
  { id: 'scroll-vermilion', name: '卷轴朱印', free: false, swatch: 0x8c3a2e, cloth: 0x8c3a2e, wallSkirt: 0x8a6a4a, lamp: 0xf7e2b4 },
];

/** 全部买断，无订阅：单买关卡 / 单买皮肤 / 一次性全院解锁包。 */
export const PRODUCTS: readonly ProductDef[] = [
  {
    sku: 'LEVEL_DOJO',
    name: '02 夜隐寮',
    description: '60 秒耐力局，守卫巡逻更快',
    price: '0.99',
    currency: 'USD',
    grants: { levels: ['dojo-02'], skins: [] },
  },
  {
    sku: 'LEVEL_VAULT',
    name: '03 封印殿',
    description: '50 秒高压局，忍术冷却缩短到 8 秒',
    price: '0.99',
    currency: 'USD',
    grants: { levels: ['vault-03'], skins: [] },
  },
  {
    sku: 'SKIN_PACK',
    name: '夜隐联动外观包',
    description: '夜行装束 + 卷轴朱印，含对应走廊主题',
    price: '0.99',
    currency: 'USD',
    grants: { levels: [], skins: ['shinobi-indigo', 'scroll-vermilion'] },
  },
  {
    sku: 'BUNDLE_ALL',
    name: '夜隐全解锁包',
    description: '一次买断 02 / 03 关卡与全部联动外观',
    price: '1.99',
    currency: 'USD',
    grants: { levels: ['dojo-02', 'vault-03'], skins: ['shinobi-indigo', 'scroll-vermilion'] },
  },
];

export interface CommandCopy {
  name: string;
  cost: string;
}

/**
 * 同一个指令在不同题材下的说法。逻辑（时长、作用范围、冷却）始终以 config 的 COMMANDS 为准，
 * 这里只覆盖玩家读到的字，避免「换题材」被迫改玩法常量。
 */
export const COMMAND_COPY: Record<ThemeId, Record<CommandId, CommandCopy>> = {
  hospital: {
    lights: { name: '全院开灯', cost: '你也更容易暴露' },
    lockdown: { name: '封锁走廊', cost: '你也需要绕路' },
    broadcast: { name: '广播查房', cost: '先躲开视线才能引开' },
  },
  shinobi: {
    lights: { name: '照明符', cost: '你也更容易暴露' },
    lockdown: { name: '岩壁封锁', cost: '你也需要绕路' },
    broadcast: { name: '替身诱敌', cost: '先躲开视线才能引开' },
  },
};

export interface Entitlements {
  /** 已解锁的付费关卡（免费关卡不列在此处） */
  levels: LevelId[];
  /** 已解锁的付费皮肤 */
  skins: SkinId[];
  /** 已购买的订单 SKU，便于服务端核对 */
  skus: ProductSku[];
}

export function isProductSku(value: string): value is ProductSku {
  return PRODUCTS.some(product => product.sku === value);
}

export function productBySku(sku: string): ProductDef | undefined {
  return PRODUCTS.find(product => product.sku === sku);
}

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find(level => level.id === id);
}

export function skinById(id: string): SkinDef | undefined {
  return SKINS.find(skin => skin.id === id);
}

/** 关卡题材对应的指令文案。关卡不存在时回落医院默认，保证 HUD 永远有字可写。 */
export function commandCopyFor(levelId: string): Record<CommandId, CommandCopy> {
  return COMMAND_COPY[levelById(levelId)?.theme ?? 'hospital'];
}

/**
 * 找出能解锁该关卡的买断商品：商店的锁定项靠它挂购买按钮。
 * 目录里同一权益可能被多个商品覆盖（单买与全院包），返回目录顺序里的第一个，即最便宜的单买项。
 */
export function productForLevel(levelId: LevelId): ProductDef | undefined {
  return PRODUCTS.find(product => product.grants.levels.includes(levelId));
}

export function productForSkin(skinId: SkinId): ProductDef | undefined {
  return PRODUCTS.find(product => product.grants.skins.includes(skinId));
}

/**
 * 把「已买断的 SKU 列表」折算成权益。未知 SKU 忽略而不是报错：
 * 目录里删掉的旧商品不应让老玩家的权益判定整体崩掉。
 */
export function resolveEntitlements(ownedSkus: readonly string[]): Entitlements {
  const levels = new Set<LevelId>();
  const skins = new Set<SkinId>();
  const skus: ProductSku[] = [];
  for (const raw of ownedSkus) {
    if (!isProductSku(raw)) continue;
    if (skus.includes(raw)) continue;
    skus.push(raw);
    const product = productBySku(raw);
    if (!product) continue;
    for (const level of product.grants.levels) levels.add(level);
    for (const skin of product.grants.skins) skins.add(skin);
  }
  return { levels: [...levels], skins: [...skins], skus };
}

export function canPlayLevel(levelId: string, entitlements: Entitlements): boolean {
  const level = levelById(levelId);
  if (!level) return false;
  return level.free || entitlements.levels.includes(level.id);
}

export function canUseSkin(skinId: string, entitlements: Entitlements): boolean {
  const skin = skinById(skinId);
  if (!skin) return false;
  return skin.free || entitlements.skins.includes(skin.id);
}

/** 未解锁时回落到标准皮肤，保证任何情况下都有可渲染的配色。 */
export function resolveSkin(levelId: string, entitlements: Entitlements): SkinDef {
  const level = levelById(levelId) ?? LEVELS[0];
  return canUseSkin(level.skin, entitlements) ? (skinById(level.skin) as SkinDef) : (SKINS[0] as SkinDef);
}

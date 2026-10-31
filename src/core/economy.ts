/**
 * 买断制商品目录与权益判定。
 *
 * 纯逻辑：不依赖 DOM、Three.js 与网络，前端 UI 与服务端 Webhook 共用同一份目录，
 * 避免「前端显示的价格」与「服务端解锁的范围」各写一套后互相漂移。
 * 本文件里的价格只是展示串（Waffo 要求金额用展示格式，如 "0.99"），权威价格以店铺商品为准。
 */

import type { RoundRules } from './config';

export type LevelId = 'ward-01' | 'icu-02' | 'pharmacy-03';
export type SkinId = 'standard' | 'chief-white' | 'hazmat-amber';
export type ProductSku = 'LEVEL_ICU' | 'LEVEL_PHARMACY' | 'SKIN_PACK' | 'BUNDLE_ALL';

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

export const LEVELS: readonly LevelDef[] = [
  {
    id: 'ward-01',
    index: '01',
    name: '住院部',
    ward: '夜间巡查',
    free: true,
    rules: { timeLimit: 45, commandCooldown: 12, patrolSpeed: 2.8 },
    skin: 'standard',
  },
  {
    id: 'icu-02',
    index: '02',
    name: '重症监护室',
    ward: '重点监护',
    free: false,
    rules: { timeLimit: 60, commandCooldown: 12, patrolSpeed: 3.1 },
    skin: 'chief-white',
  },
  {
    id: 'pharmacy-03',
    index: '03',
    name: '地下药库',
    ward: '夜间盘库',
    free: false,
    rules: { timeLimit: 50, commandCooldown: 10, patrolSpeed: 2.6 },
    skin: 'hazmat-amber',
  },
];

export const SKINS: readonly SkinDef[] = [
  { id: 'standard', name: '标准外科', free: true, swatch: 0x2f7d70, cloth: 0x2f7d70, wallSkirt: 0xb9c8bb, lamp: 0xebf3ef },
  { id: 'chief-white', name: '主任白大褂', free: false, swatch: 0xf1f4ef, cloth: 0xf1f4ef, wallSkirt: 0xb4c7d4, lamp: 0xe6f2fa },
  { id: 'hazmat-amber', name: '特护巡检服', free: false, swatch: 0xcad6dc, cloth: 0xcad6dc, wallSkirt: 0xc5c2b8, lamp: 0xf7ead2 },
];

/** 全部买断，无订阅：单买关卡 / 单买皮肤 / 一次性全院解锁包。 */
export const PRODUCTS: readonly ProductDef[] = [
  {
    sku: 'LEVEL_ICU',
    name: '02 重症监护室',
    description: '60 秒高压局，值班员巡查更快',
    price: '0.99',
    currency: 'USD',
    grants: { levels: ['icu-02'], skins: [] },
  },
  {
    sku: 'LEVEL_PHARMACY',
    name: '03 地下药库',
    description: '50 秒紧凑局，指令冷却缩短',
    price: '0.99',
    currency: 'USD',
    grants: { levels: ['pharmacy-03'], skins: [] },
  },
  {
    sku: 'SKIN_PACK',
    name: '夜班联动皮肤包',
    description: '主任白大褂 + 特护巡检服，含对应走廊主题',
    price: '0.99',
    currency: 'USD',
    grants: { levels: [], skins: ['chief-white', 'hazmat-amber'] },
  },
  {
    sku: 'BUNDLE_ALL',
    name: '全院解锁包',
    description: '一次买断 02 / 03 关卡与全部联动皮肤',
    price: '1.99',
    currency: 'USD',
    grants: { levels: ['icu-02', 'pharmacy-03'], skins: ['chief-white', 'hazmat-amber'] },
  },
];

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

/**
 * Waffo Pancake 买断制收款的服务端封装。
 *
 * 只在 Node 侧运行（Vite 配置与 preview 中间件），私钥绝不进入前端 bundle。
 * 本文件不做 HTTP 路由，只提供可测试的纯函数/薄封装，路由见 apiPlugin.ts。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { TaxCategory, WaffoPancake, verifyWebhook } from '@waffo/pancake-ts';
import type { WebhookEvent, WebhookEventData } from '@waffo/pancake-ts';
import { PRODUCTS, isProductSku } from '../core/economy';
import type { ProductSku } from '../core/economy';

export interface WaffoEnv {
  merchantId: string;
  storeId: string;
  /** RSA 私钥 PEM，仅存于 .env.local */
  privateKey: string;
  environment: 'test' | 'prod';
}

const REQUIRED_KEYS = ['WAFFO_MERCHANT_ID', 'WAFFO_STORE_ID', 'WAFFO_PRIVATE_KEY'] as const;

/**
 * 读取并校验环境变量。缺任何一个都直接抛错而不是静默降级：
 * 静默降级会让「没配密钥」表现为「支付总是失败」，比启动即报错更难排查。
 */
export function readWaffoEnv(env: Record<string, string | undefined> = process.env): WaffoEnv {
  const missing = REQUIRED_KEYS.filter(key => !env[key]);
  if (missing.length > 0) {
    throw new Error(`缺少 Waffo 环境变量：${missing.join(', ')}（写入 .env.local，参考 .env.example）`);
  }
  const raw = env.WAFFO_ENV ?? 'test';
  if (raw !== 'test' && raw !== 'prod') throw new Error(`WAFFO_ENV 只能是 test 或 prod，当前为 ${raw}`);
  // 私钥在 .env 里通常是单行带 \n 转义的形态，还原成 PEM 多行文本
  const privateKey = env.WAFFO_PRIVATE_KEY!.includes('\\n')
    ? env.WAFFO_PRIVATE_KEY!.replace(/\\n/g, '\n')
    : env.WAFFO_PRIVATE_KEY!;
  return { merchantId: env.WAFFO_MERCHANT_ID!, storeId: env.WAFFO_STORE_ID!, privateKey, environment: raw };
}

export function createWaffoClient(config: WaffoEnv): WaffoPancake {
  return new WaffoPancake({
    merchantId: config.merchantId,
    privateKey: config.privateKey,
    environment: config.environment,
  });
}

/** 每笔买断记录在本地账本里，key 是前端生成的玩家标识，value 是已付款的 SKU 列表。 */
export interface Ledger {
  purchases: Record<string, ProductSku[]>;
  /** 已处理过的 Webhook 投递 ID（event.id），用于幂等去重 */
  handledEvents: string[];
  /** metadata.sku → 店铺商品 ID 的映射，避免每次请求都查一遍 GraphQL */
  products: Record<string, string>;
}

export function emptyLedger(): Ledger {
  return { purchases: {}, handledEvents: [], products: {} };
}

export function readLedger(path: string): Ledger {
  if (!existsSync(path)) return emptyLedger();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Ledger>;
    return {
      purchases: parsed.purchases ?? {},
      handledEvents: parsed.handledEvents ?? [],
      products: parsed.products ?? {},
    };
  } catch {
    // 账本损坏时从空账本继续，而不是让整个收款链路 500；已付款记录另有 Waffo 后台可查。
    return emptyLedger();
  }
}

export function writeLedger(path: string, ledger: Ledger): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

export function defaultLedgerPath(cwd: string = process.cwd()): string {
  return resolve(cwd, '.waffo-ledger.json');
}

/**
 * 幂等入账：同一个 ref 重复买同一个 SKU 不产生重复记录。
 * 返回 true 表示本次确实新增了权益。
 */
export function grant(ledger: Ledger, ref: string, sku: ProductSku): boolean {
  const owned = ledger.purchases[ref] ?? [];
  if (owned.includes(sku)) return false;
  ledger.purchases[ref] = [...owned, sku];
  return true;
}

export function ownedSkus(ledger: Ledger, ref: string): ProductSku[] {
  return ledger.purchases[ref] ?? [];
}

interface ProductsQuery {
  onetimeProducts: Array<{ id: string; name: string; status: string; metadata?: Record<string, unknown> | null }>;
}

/**
 * 保证目录里每个 SKU 在店铺中都有对应商品。
 *
 * SDK 没有 list 方法，只能走 GraphQL 按 `metadata.sku` 查重：先查店铺现有商品，
 * 缺哪个建哪个，建完立即 publish（未发布的商品无法开收银台）。
 */
export async function ensureProducts(client: WaffoPancake, storeId: string, ledger: Ledger): Promise<Record<string, string>> {
  const result = await client.graphql.query<ProductsQuery>({
    query: `query ($storeId: String!) {
      onetimeProducts(storeId: $storeId) { id name status metadata }
    }`,
    variables: { storeId },
  });
  const existing: Record<string, string> = {};
  for (const product of result.data?.onetimeProducts ?? []) {
    const sku = product.metadata?.sku;
    if (typeof sku === 'string' && isProductSku(sku)) existing[sku] = product.id;
  }

  const resolved: Record<string, string> = { ...existing };
  for (const product of PRODUCTS) {
    if (resolved[product.sku]) continue;
    const { product: created } = await client.onetimeProducts.create({
      storeId,
      name: product.name,
      description: product.description,
      prices: { [product.currency]: { amount: product.price, taxCategory: TaxCategory.DigitalGoods } },
      metadata: { sku: product.sku },
    });
    await client.onetimeProducts.publish({ id: created.id });
    resolved[product.sku] = created.id;
  }
  ledger.products = resolved;
  return resolved;
}

export interface CheckoutInput {
  productId: string;
  sku: ProductSku;
  /** 玩家标识，回写进订单，Webhook 靠它把权益还给人 */
  ref: string;
  /** 付款成功后跳回游戏的地址 */
  successUrl: string;
}

export async function createCheckout(client: WaffoPancake, input: CheckoutInput): Promise<{ checkoutUrl: string; sessionId: string }> {
  const product = PRODUCTS.find(item => item.sku === input.sku);
  if (!product) throw new Error(`未知 SKU：${input.sku}`);
  const session = await client.checkout.anonymous.create({
    productId: input.productId,
    currency: product.currency,
    orderMerchantExternalId: input.ref,
    metadata: { sku: input.sku },
    successUrl: input.successUrl,
  });
  return { checkoutUrl: session.checkoutUrl, sessionId: session.sessionId };
}

export interface WebhookOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * 校验并处理 Webhook。
 *
 * 必须传**原始文本体**：签名是对 `timestamp.rawBody` 做的，先 JSON.parse 再序列化会改变
 * 空白与键序，导致签名永远对不上。
 */
export function handleWebhook(
  rawBody: string,
  signature: string | undefined,
  config: WaffoEnv,
  ledger: Ledger,
): WebhookOutcome {
  let event: WebhookEvent<WebhookEventData>;
  try {
    event = verifyWebhook<WebhookEventData>(rawBody, signature, { environment: config.environment });
  } catch (error) {
    return { status: 400, body: { error: (error as Error).message } };
  }

  // 幂等：同一投递 ID 重复到达（Waffo 会重试）只处理一次
  if (ledger.handledEvents.includes(event.id)) {
    return { status: 200, body: { ok: true, duplicate: true } };
  }
  ledger.handledEvents.push(event.id);

  if (event.eventType !== 'order.completed') {
    return { status: 200, body: { ok: true, ignored: event.eventType } };
  }

  const data = event.data;
  const rawSku = data.productMetadata?.sku ?? data.orderMetadata?.sku;
  const ref = data.orderMerchantExternalId;
  if (!rawSku || !isProductSku(rawSku) || !ref) {
    // 不是本店目录里的商品，或订单没带玩家标识：记下投递 ID 但不发权益
    return { status: 200, body: { ok: true, ignored: 'unmatched-order' } };
  }

  const granted = grant(ledger, ref, rawSku);
  return { status: 200, body: { ok: true, sku: rawSku, ref, granted } };
}

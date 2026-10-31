/**
 * 把 Waffo 收款接口挂在 Vite dev / preview 中间件上。
 *
 * 同源部署的意义：收银台跳转不需要 CORS，也不需要在浏览器里持有任何密钥；
 * 私钥只存在于这个 Node 进程里，前端只能看到商品目录与自己的权益。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { LEVELS, PRODUCTS, SKINS, isProductSku, resolveEntitlements } from '../core/economy';
import type { ProductSku } from '../core/economy';
import {
  createCheckout,
  createWaffoClient,
  defaultLedgerPath,
  ensureProducts,
  handleWebhook,
  ownedSkus,
  readLedger,
  readWaffoEnv,
  writeLedger,
} from './waffo';
import type { Ledger, WaffoEnv } from './waffo';

/** 前端生成的玩家标识：形如 `p_` + 32 位十六进制，防止被当成任意字符串写进账本。 */
const REF_PATTERN = /^p_[0-9a-f]{8,64}$/;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(payload);
}

export interface ApiState {
  /** 环境变量缺失时为 null：目录仍可读，但下单接口返回 503 而不是崩服务 */
  config: WaffoEnv | null;
  configError: string | null;
  ledgerPath: string;
  ledger: Ledger;
  /** 商品初始化只跑一次，并发请求共享同一个 promise */
  productsReady: Promise<Record<string, string>> | null;
}

function createState(env: Record<string, string | undefined>): ApiState {
  try {
    const config = readWaffoEnv(env);
    const ledgerPath = defaultLedgerPath();
    return { config, configError: null, ledgerPath, ledger: readLedger(ledgerPath), productsReady: null };
  } catch (error) {
    const ledgerPath = defaultLedgerPath();
    return { config: null, configError: (error as Error).message, ledgerPath, ledger: readLedger(ledgerPath), productsReady: null };
  }
}

/** 惰性初始化商品并落盘映射：第一次下单时才建商品，dev 启动不为支付慢一秒。 */
async function productIds(state: ApiState): Promise<Record<string, string>> {
  if (!state.config) throw new Error(state.configError ?? 'Waffo 未配置');
  if (!state.productsReady) {
    state.productsReady = ensureProducts(createWaffoClient(state.config), state.config.storeId, state.ledger)
      .then(ids => {
        writeLedger(state.ledgerPath, state.ledger);
        return ids;
      })
      .catch(error => {
        state.productsReady = null;
        throw error;
      });
  }
  return state.productsReady;
}

function originOf(req: IncomingMessage, fallback?: string): string {
  if (fallback) return fallback.replace(/\/+$/, '');
  const host = req.headers.host ?? '127.0.0.1:5174';
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? 'http';
  return `${proto}://${host}`;
}

async function route(state: ApiState, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  if (!path.startsWith('/api/')) return false;

  // 目录：前端渲染商店用，不需要密钥也能返回（离线可看商品，点购买才报错）
  if (path === '/api/catalog' && req.method === 'GET') {
    sendJson(res, 200, {
      levels: LEVELS,
      skins: SKINS,
      products: PRODUCTS,
      ready: !!state.config,
      error: state.configError,
    });
    return true;
  }

  // 权益：前端每次进入关卡/商店前查一次
  if (path === '/api/entitlements' && req.method === 'GET') {
    const ref = url.searchParams.get('ref') ?? '';
    if (!REF_PATTERN.test(ref)) {
      sendJson(res, 400, { error: '缺少合法的 ref' });
      return true;
    }
    sendJson(res, 200, { ref, skus: ownedSkus(state.ledger, ref), entitlements: resolveEntitlements(ownedSkus(state.ledger, ref)) });
    return true;
  }

  // 下单：返回收银台地址，由前端在点击事件里同步跳转
  if (path === '/api/checkout' && req.method === 'POST') {
    let payload: { sku?: string; ref?: string; origin?: string };
    try {
      payload = JSON.parse(await readBody(req)) as typeof payload;
    } catch {
      sendJson(res, 400, { error: '请求体不是合法 JSON' });
      return true;
    }
    const sku = payload.sku ?? '';
    const ref = payload.ref ?? '';
    // 先校验入参再看配置：否则未配密钥时「SKU 打错」会伪装成「服务未配置」
    if (!isProductSku(sku)) {
      sendJson(res, 400, { error: `未知 SKU：${sku}` });
      return true;
    }
    if (!REF_PATTERN.test(ref)) {
      sendJson(res, 400, { error: '缺少合法的 ref' });
      return true;
    }
    if (!state.config) {
      sendJson(res, 503, { error: state.configError ?? 'Waffo 未配置' });
      return true;
    }
    try {
      const ids = await productIds(state);
      const productId = ids[sku];
      if (!productId) {
        sendJson(res, 500, { error: `商品未初始化：${sku}` });
        return true;
      }
      const session = await createCheckout(createWaffoClient(state.config), {
        productId,
        sku: sku as ProductSku,
        ref,
        successUrl: `${originOf(req, payload.origin)}/?paid=1`,
      });
      sendJson(res, 200, session);
    } catch (error) {
      sendJson(res, 502, { error: (error as Error).message });
    }
    return true;
  }

  // Webhook：必须拿原始文本体验签，所以这里不走 JSON 解析中间件
  if (path === '/api/webhooks' && req.method === 'POST') {
    if (!state.config) {
      sendJson(res, 503, { error: state.configError ?? 'Waffo 未配置' });
      return true;
    }
    const raw = await readBody(req);
    const signature = (req.headers['x-waffo-signature'] as string | undefined) ?? undefined;
    const outcome = handleWebhook(raw, signature, state.config, state.ledger);
    if (outcome.status === 200) writeLedger(state.ledgerPath, state.ledger);
    sendJson(res, outcome.status, outcome.body);
    return true;
  }

  sendJson(res, 404, { error: `未知接口：${req.method} ${path}` });
  return true;
}

/**
 * Vite 的 `loadEnv` 不会把 .env.local 写进 process.env（只认 VITE_ 前缀并注入前端），
 * 所以由 vite.config.ts 用空前缀读全量环境变量再传进来。
 */
export function waffoApiPlugin(env: Record<string, string | undefined> = process.env): Plugin {
  const state = createState(env);
  if (state.configError) {
    console.warn(`[waffo] ${state.configError}`);
  }
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    void route(state, req, res).then(handled => {
      if (!handled) next();
    }).catch(error => {
      sendJson(res, 500, { error: (error as Error).message });
    });
  };
  return {
    name: 'waffo-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

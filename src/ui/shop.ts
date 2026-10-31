/**
 * 最小商店 UI：科室（关卡）与外观（皮肤）两组选项，锁定的选项给出对应买断商品按钮。
 *
 * 只负责 DOM 与网络请求；解锁判定全部复用 core/economy，避免前端与 Webhook 各写一套规则后漂移。
 * 本模块不持有任何密钥：下单只把 SKU 与玩家标识发给同源 /api/checkout，私钥始终留在 Node 侧。
 */
import { LEVELS, SKINS, canPlayLevel, canUseSkin, productBySku, productForLevel, productForSkin, resolveEntitlements } from '../core/economy';
import type { Entitlements, LevelId, ProductSku, SkinId } from '../core/economy';

const REF_KEY = 'rounds.payer-ref';
const REF_PATTERN = /^p_[0-9a-f]{32}$/;

export interface ShopHooks {
  /** 选中的科室可玩：把该关规则与外观交给游戏 */
  onSelect(levelId: LevelId, skinId: SkinId): void;
  /** 提示（下单失败、服务未配置支付等） */
  onNotice(text: string): void;
}

export interface Shop {
  /** 拉取目录与权益并重绘；进入页面与支付返回后各调一次 */
  refresh(): Promise<void>;
  levelId(): LevelId;
  skinId(): SkinId;
}

function randomRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `p_${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 玩家标识：无账号体系，用一个浏览器本地随机串代表这台机器的玩家。
 * 它只用于把 Webhook 里的订单认回本地账本，不含任何个人信息。
 */
export function payerRef(): string {
  try {
    const existing = localStorage.getItem(REF_KEY);
    if (existing && REF_PATTERN.test(existing)) return existing;
    const created = randomRef();
    localStorage.setItem(REF_KEY, created);
    return created;
  } catch {
    // 隐私模式下 localStorage 可能不可用：退化为会话内临时身份，本次可买，刷新后权益不再跟随。
    return randomRef();
  }
}

function chip(className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  return button;
}

/**
 * 锁定状态只换副标题文案，不用图标：
 * 游戏内其余界面也没有 emoji，一处小锁会把整块排版拉出调性。
 */
function paintSubtitle(button: HTMLButtonElement, locked: boolean): void {
  const subtitle = button.querySelector('small');
  if (!subtitle) return;
  if (!subtitle.dataset.sub) subtitle.dataset.sub = subtitle.textContent ?? '';
  subtitle.textContent = locked ? '未解锁' : subtitle.dataset.sub;
}

export function mountShop(root: HTMLElement, hooks: ShopHooks): Shop {
  const ref = payerRef();
  let entitlements: Entitlements = resolveEntitlements([]);
  /** 支付服务是否就绪：未配密钥时目录照常展示，但下单按钮要说明原因 */
  let ready = false;
  let levelId: LevelId = 'ward-01';
  let skinId: SkinId = 'standard';

  const levelRow = document.createElement('div');
  levelRow.className = 'shop-row';
  const skinRow = document.createElement('div');
  skinRow.className = 'shop-row';
  const buy = chip('shop-buy');
  buy.hidden = true;
  const note = document.createElement('p');
  note.className = 'shop-note';
  const levelLabel = document.createElement('span');
  levelLabel.className = 'shop-label';
  levelLabel.textContent = '科室';
  const skinLabel = document.createElement('span');
  skinLabel.className = 'shop-label';
  skinLabel.textContent = '外观';

  const group = document.createElement('div');
  group.className = 'shop-group';
  group.append(levelLabel, levelRow);
  const skinGroup = document.createElement('div');
  skinGroup.className = 'shop-group';
  skinGroup.append(skinLabel, skinRow);

  root.replaceChildren(group, skinGroup, buy, note);

  /** 当前选中项被锁时，挂上它对应的买断商品 */
  function pendingProduct(): ProductSku | null {
    if (!canPlayLevel(levelId, entitlements)) return productForLevel(levelId)?.sku ?? null;
    if (!canUseSkin(skinId, entitlements)) return productForSkin(skinId)?.sku ?? null;
    return null;
  }

  function paint(): void {
    for (const button of levelRow.querySelectorAll<HTMLButtonElement>('button')) {
      const id = button.dataset.level as LevelId;
      const locked = !canPlayLevel(id, entitlements);
      button.classList.toggle('locked', locked);
      button.classList.toggle('active', id === levelId);
      button.setAttribute('aria-pressed', String(id === levelId));
      paintSubtitle(button, locked);
    }
    for (const button of skinRow.querySelectorAll<HTMLButtonElement>('button')) {
      const id = button.dataset.skin as SkinId;
      const locked = !canUseSkin(id, entitlements);
      button.classList.toggle('locked', locked);
      button.classList.toggle('active', id === skinId);
      button.setAttribute('aria-pressed', String(id === skinId));
      paintSubtitle(button, locked);
    }

    const sku = pendingProduct();
    const product = sku ? productBySku(sku) : undefined;
    buy.hidden = !product;
    if (product) {
      buy.textContent = `解锁 ${product.name} · $${product.price}`;
      buy.disabled = !ready;
    }
    note.textContent = !ready
      ? '支付暂未开通，免费科室可正常游玩。'
      : (product ? product.description : '本局配置已就绪。');
    note.classList.toggle('warn', !ready);
  }

  function selectLevel(id: LevelId): void {
    levelId = id;
    // 换科室时自动套用该科室的推荐外观；未解锁则回落标准皮肤（resolveSkin 的同一套判定）。
    const level = LEVELS.find(item => item.id === id);
    const preferred = level?.skin ?? 'standard';
    skinId = canUseSkin(preferred, entitlements) ? preferred : 'standard';
    paint();
    if (canPlayLevel(levelId, entitlements)) hooks.onSelect(levelId, skinId);
  }

  function selectSkin(id: SkinId): void {
    skinId = id;
    paint();
    if (canPlayLevel(levelId, entitlements) && canUseSkin(skinId, entitlements)) hooks.onSelect(levelId, skinId);
  }

  for (const level of LEVELS) {
    const button = chip('shop-chip');
    button.dataset.level = level.id;
    const swatch = document.createElement('i');
    swatch.className = 'shop-swatch';
    swatch.style.background = `#${(SKINS.find(skin => skin.id === level.skin)?.swatch ?? 0xb9c8bb).toString(16).padStart(6, '0')}`;
    const text = document.createElement('span');
    text.innerHTML = `<strong>${level.index} ${level.name}</strong><small>${level.ward}</small>`;
    button.append(swatch, text);
    button.addEventListener('click', () => { selectLevel(level.id); button.blur(); });
    levelRow.append(button);
  }

  for (const skin of SKINS) {
    const button = chip('shop-chip');
    button.dataset.skin = skin.id;
    const swatch = document.createElement('i');
    swatch.className = 'shop-swatch';
    swatch.style.background = `#${skin.swatch.toString(16).padStart(6, '0')}`;
    const text = document.createElement('span');
    text.innerHTML = `<strong>${skin.name}</strong><small>走廊主题</small>`;
    button.append(swatch, text);
    button.addEventListener('click', () => { selectSkin(skin.id); button.blur(); });
    skinRow.append(button);
  }

  buy.addEventListener('click', () => {
    const sku = pendingProduct();
    if (!sku) return;
    buy.disabled = true;
    void checkout(sku);
  });

  async function checkout(sku: ProductSku): Promise<void> {
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku, ref, origin: location.origin }),
      });
      const payload = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !payload.checkoutUrl) {
        // 503 是服务端没配好支付（缺密钥等）：给玩家看人话，原始原因留在控制台。
        if (response.status === 503) console.error('[shop] 支付未配置：', payload.error);
        const message = response.status === 503
          ? '支付暂未开通，免费科室可正常游玩。'
          : (payload.error ?? `下单失败（HTTP ${response.status}）`);
        throw new Error(message);
      }
      // 同标签跳转收银台：await 之后 window.open 会被浏览器拦截，location.href 不受影响。
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      buy.disabled = false;
      hooks.onNotice(error instanceof Error ? error.message : '下单失败');
    }
  }

  async function refresh(): Promise<void> {
    try {
      const [catalog, owned] = await Promise.all([
        fetch('/api/catalog').then(response => response.json() as Promise<{ ready?: boolean }>),
        fetch(`/api/entitlements?ref=${encodeURIComponent(ref)}`).then(response => response.json() as Promise<{ skus?: string[] }>),
      ]);
      ready = !!catalog.ready;
      entitlements = resolveEntitlements(owned.skus ?? []);
      // 重绘后保证当前选择仍合法：已买的关卡解锁，未买的关卡回落免费科室。
      if (!canPlayLevel(levelId, entitlements)) levelId = 'ward-01';
      if (!canUseSkin(skinId, entitlements)) skinId = 'standard';
      paint();
      hooks.onSelect(levelId, skinId);
    } catch {
      ready = false;
      paint();
    }
  }

  paint();
  return { refresh, levelId: () => levelId, skinId: () => skinId };
}

/** 支付返回标记：`?paid=1` 只用来提示，不参与任何解锁判定（解锁只认服务端账本）。 */
export function paidReturnNotice(): string | null {
  const params = new URLSearchParams(location.search);
  if (params.get('paid') !== '1') return null;
  params.delete('paid');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  return '支付已完成，正在核对权益…';
}

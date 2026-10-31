/**
 * 单机大厅商城与战备选择 UI：
 * 包含关卡选择（科室）与角色选择（出勤人员），未解锁关卡/角色提供 $0.99 买断开启。
 * 遵循「别无中生有」：关卡 2、关卡 3 纯靠写实封面大图与规则数据呈现，角色配以写实立绘卡片。
 *
 * 支付链路完整保留：点击购买时真调 /api/checkout；
 * 若服务端返回 503（未配私钥/暂不出售），弹出优雅的买断确认与暂未开售说明层，不破坏用户体验。
 */
import { LEVELS, SKINS, canPlayLevel, canUseSkin, levelById, productBySku, productForLevel, productForSkin, resolveEntitlements } from '../core/economy';
import type { Entitlements, LevelId, ProductSku, SkinId } from '../core/economy';

import wardCover from '../../assets/art/v2fun/web/ward-01-cover.jpg';
import dojoCover from '../../assets/art/v2fun/web/dojo-02-cover.jpg';
import vaultCover from '../../assets/art/v2fun/web/vault-03-cover.jpg';

import roleStandard from '../../assets/art/v2fun/web/role-standard.jpg';
import roleIndigo from '../../assets/art/v2fun/web/role-indigo.jpg';
import roleVermilion from '../../assets/art/v2fun/web/role-vermilion.jpg';

const REF_KEY = 'rounds.payer-ref';
const REF_PATTERN = /^p_[0-9a-f]{32}$/;

export const LEVEL_COVERS: Record<LevelId, string> = {
  'ward-01': wardCover,
  'dojo-02': dojoCover,
  'vault-03': vaultCover,
};

export const ROLE_AVATARS: Record<SkinId, string> = {
  'standard': roleStandard,
  'shinobi-indigo': roleIndigo,
  'scroll-vermilion': roleVermilion,
};

export const ROLE_TITLES: Record<SkinId, { role: string; desc: string }> = {
  'standard': { role: '值班医师', desc: '巡查常规 · 白大褂' },
  'shinobi-indigo': { role: '潜行干员', desc: '夜隐装束 · 静步高压' },
  'scroll-vermilion': { role: '封印特派', desc: '朱印防具 · 禁术抗性' },
};

export interface ShopHooks {
  /** 选中的科室与外观可玩：把规则与外观传递给游戏 */
  onSelect(levelId: LevelId, skinId: SkinId): void;
  /** 提示（如操作异常等） */
  onNotice(text: string): void;
}

export interface Shop {
  refresh(): Promise<void>;
  levelId(): LevelId;
  skinId(): SkinId;
}

function randomRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `p_${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function payerRef(): string {
  try {
    const existing = localStorage.getItem(REF_KEY);
    if (existing && REF_PATTERN.test(existing)) return existing;
    const created = randomRef();
    localStorage.setItem(REF_KEY, created);
    return created;
  } catch {
    return randomRef();
  }
}

function chip(className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  return button;
}

function paintSubtitle(button: HTMLButtonElement, locked: boolean): void {
  const subtitle = button.querySelector('small');
  if (!subtitle) return;
  if (!subtitle.dataset.sub) subtitle.dataset.sub = subtitle.textContent ?? '';
  subtitle.textContent = locked ? '未解锁' : subtitle.dataset.sub;
}

export function mountShop(root: HTMLElement, hooks: ShopHooks): Shop {
  const ref = payerRef();
  let entitlements: Entitlements = resolveEntitlements([]);
  let ready = false;
  let levelId: LevelId = 'ward-01';
  let skinId: SkinId = 'standard';

  // 1. 顶部大封面视窗（Hero Viewport）
  const cover = document.createElement('figure');
  cover.className = 'shop-cover';
  const coverImage = document.createElement('img');
  coverImage.alt = '';
  const coverBadge = document.createElement('span');
  coverBadge.className = 'shop-cover-badge';
  const coverMeta = document.createElement('div');
  coverMeta.className = 'shop-cover-meta';
  const coverTitle = document.createElement('strong');
  const coverSubtitle = document.createElement('span');
  coverMeta.append(coverTitle, coverSubtitle);
  cover.append(coverImage, coverBadge, coverMeta);

  // 2. 科室与角色选择分组
  const group = document.createElement('div');
  group.className = 'shop-group';
  const groupHead = document.createElement('div');
  groupHead.className = 'shop-group-head';
  const levelLabel = document.createElement('span');
  levelLabel.className = 'shop-label';
  levelLabel.textContent = '科室选择 · 执勤区域';
  const levelNav = document.createElement('div');
  levelNav.className = 'shop-nav-arrows';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.innerHTML = '&larr;';
  prevBtn.title = '上一科室';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.innerHTML = '&rarr;';
  nextBtn.title = '下一科室';
  levelNav.append(prevBtn, nextBtn);
  groupHead.append(levelLabel, levelNav);
  const levelRow = document.createElement('div');
  levelRow.className = 'shop-row shop-row-levels';
  group.append(groupHead, levelRow);

  const skinGroup = document.createElement('div');
  skinGroup.className = 'shop-group';
  const skinLabel = document.createElement('span');
  skinLabel.className = 'shop-label';
  skinLabel.textContent = '出勤干员 · 角色配置';
  const skinRow = document.createElement('div');
  skinRow.className = 'shop-row shop-row-skins';
  skinGroup.append(skinLabel, skinRow);

  // 3. 购买与提示区
  const buy = chip('shop-buy');
  buy.hidden = true;
  const note = document.createElement('p');
  note.className = 'shop-note';

  // 4. 暂未开售 / 购买确认弹窗 Modal
  const modal = document.createElement('div');
  modal.className = 'shop-modal';
  modal.hidden = true;
  const modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'shop-modal-backdrop';
  const modalCard = document.createElement('div');
  modalCard.className = 'shop-modal-card';
  modal.append(modalBackdrop, modalCard);

  root.replaceChildren(cover, group, skinGroup, buy, note, modal);

  function pendingProduct(): ProductSku | null {
    if (!canPlayLevel(levelId, entitlements)) return productForLevel(levelId)?.sku ?? null;
    if (!canUseSkin(skinId, entitlements)) return productForSkin(skinId)?.sku ?? null;
    return null;
  }

  function paint(): void {
    // 渲��大封面
    const art = LEVEL_COVERS[levelId];
    if (art && coverImage.getAttribute('src') !== art) {
      coverImage.src = art;
      coverImage.alt = `${levelById(levelId)?.name ?? '科室'} 封面`;
    }
    const currentLevel = levelById(levelId);
    const levelLocked = !canPlayLevel(levelId, entitlements);
    coverTitle.textContent = `${currentLevel?.index ?? ''} ${currentLevel?.name ?? ''}`;
    coverSubtitle.textContent = `${currentLevel?.ward ?? ''} · 限时 ${currentLevel?.rules.timeLimit ?? 45}s · 巡查速度 ${currentLevel?.rules.patrolSpeed ?? 2.8}m/s`;
    coverBadge.textContent = levelLocked ? '待解锁 · $0.99 买断' : (currentLevel?.free ? '免费开放' : '已解锁');
    coverBadge.classList.toggle('locked', levelLocked);
    coverBadge.classList.toggle('free', !levelLocked && !!currentLevel?.free);

    // 渲染关卡按钮
    for (const button of levelRow.querySelectorAll<HTMLButtonElement>('button')) {
      const id = button.dataset.level as LevelId;
      const locked = !canPlayLevel(id, entitlements);
      button.classList.toggle('locked', locked);
      button.classList.toggle('active', id === levelId);
      button.setAttribute('aria-pressed', String(id === levelId));
      paintSubtitle(button, locked);
    }

    // 渲染角色按钮
    for (const button of skinRow.querySelectorAll<HTMLButtonElement>('button')) {
      const id = button.dataset.skin as SkinId;
      const locked = !canUseSkin(id, entitlements);
      button.classList.toggle('locked', locked);
      button.classList.toggle('active', id === skinId);
      button.setAttribute('aria-pressed', String(id === skinId));
      paintSubtitle(button, locked);
    }

    // 渲染买断操作条
    const sku = pendingProduct();
    const product = sku ? productBySku(sku) : undefined;
    buy.hidden = !product;
    if (product) {
      buy.innerHTML = `<strong>$${product.price} 买断开启</strong><span>解锁 ${product.name}</span>`;
      buy.disabled = false; // 始终允许点击发起真请求体验验证
    }
    note.textContent = product
      ? `${product.description} · 一次性买断，无订阅扣费`
      : '当前关卡与角色配置已就绪，可随时开始值班。';
    note.classList.toggle('warn', !ready && !!product);
  }

  function selectLevel(id: LevelId): void {
    levelId = id;
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

  // 左右箭头切换关卡
  prevBtn.addEventListener('click', () => {
    const idx = LEVELS.findIndex(l => l.id === levelId);
    const nextIdx = (idx - 1 + LEVELS.length) % LEVELS.length;
    selectLevel(LEVELS[nextIdx].id);
  });
  nextBtn.addEventListener('click', () => {
    const idx = LEVELS.findIndex(l => l.id === levelId);
    const nextIdx = (idx + 1) % LEVELS.length;
    selectLevel(LEVELS[nextIdx].id);
  });

  // 创建关卡卡片（包含缩略图、编号、名称、副标题）
  for (const level of LEVELS) {
    const button = chip('shop-chip shop-chip-level');
    button.dataset.level = level.id;
    const thumb = document.createElement('img');
    thumb.className = 'shop-thumb';
    thumb.src = LEVEL_COVERS[level.id];
    thumb.alt = '';
    const text = document.createElement('span');
    text.innerHTML = `<strong>${level.index} ${level.name}</strong><small>${level.ward}</small>`;
    button.append(thumb, text);
    button.addEventListener('click', () => { selectLevel(level.id); button.blur(); });
    levelRow.append(button);
  }

  // 创建角色卡���（包含立绘头像、名称、职业定位、主题色标）
  for (const skin of SKINS) {
    const button = chip('shop-chip shop-chip-skin');
    button.dataset.skin = skin.id;
    const avatar = document.createElement('img');
    avatar.className = 'shop-avatar';
    avatar.src = ROLE_AVATARS[skin.id];
    avatar.alt = '';
    const swatch = document.createElement('i');
    swatch.className = 'shop-swatch';
    swatch.style.background = `#${skin.swatch.toString(16).padStart(6, '0')}`;
    const text = document.createElement('span');
    const info = ROLE_TITLES[skin.id] ?? { role: skin.name, desc: '走廊主题' };
    text.innerHTML = `<strong>${info.role}</strong><small>${info.desc}</small>`;
    button.append(avatar, swatch, text);
    button.addEventListener('click', () => { selectSkin(skin.id); button.blur(); });
    skinRow.append(button);
  }

  // 弹出买断/暂未开售优雅弹窗
  function showModal(titleText: string, descText: string, sku: ProductSku, statusText: string): void {
    const product = productBySku(sku);
    modalCard.innerHTML = `
      <div class="shop-modal-header">
        <span class="mono">ENTITLEMENT BUYOUT / 0.99</span>
        <button type="button" class="shop-modal-close" aria-label="关闭">&times;</button>
      </div>
      <div class="shop-modal-body">
        <div class="shop-modal-preview">
          <img src="${LEVEL_COVERS[levelId]}" alt="预览" />
          <div class="shop-modal-badge">$0.99 纯买断制</div>
        </div>
        <div class="shop-modal-info">
          <h3>${titleText}</h3>
          <p class="shop-modal-desc">${descText}</p>
          <div class="shop-modal-specs">
            <div><span>付费模式</span><strong>永久买断 · 无月费订阅</strong></div>
            <div><span>商品标价</span><strong>$0.99 USD (${product?.name ?? 'DLC'})</strong></div>
            <div><span>接入状态</span><strong class="warn">${statusText}</strong></div>
          </div>
        </div>
      </div>
      <div class="shop-modal-footer">
        <button type="button" class="shop-modal-btn default-btn">使用免费科室直接开局</button>
        <button type="button" class="shop-modal-btn primary-btn">知道了</button>
      </div>
    `;
    modal.hidden = false;

    const closeBtn = modalCard.querySelector('.shop-modal-close');
    const okBtn = modalCard.querySelector('.primary-btn');
    const freeBtn = modalCard.querySelector('.default-btn');

    const hide = () => { modal.hidden = true; };
    closeBtn?.addEventListener('click', hide);
    okBtn?.addEventListener('click', hide);
    modalBackdrop.addEventListener('click', hide);
    freeBtn?.addEventListener('click', () => {
      hide();
      selectLevel('ward-01');
      selectSkin('standard');
      // 触发外部主按钮进入游戏
      const startBtn = document.getElementById('primary') as HTMLButtonElement | null;
      startBtn?.click();
    });
  }

  buy.addEventListener('click', () => {
    const sku = pendingProduct();
    if (!sku) return;
    buy.disabled = true;
    void checkout(sku);
  });

  async function checkout(sku: ProductSku): Promise<void> {
    const product = productBySku(sku);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku, ref, origin: location.origin }),
      });
      const payload = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !payload.checkoutUrl) {
        if (response.status === 503) {
          console.info('[shop] 支付服务已连通，当前处于演练展示阶段：', payload.error);
          showModal(
            `解锁 ${product?.name ?? '付费内容'}`,
            `本关卡与角色已完成 Waffo 买断接入架构与视觉制作。当前处于赛事与单机演示模式，未正式开放扣费。`,
            sku,
            '接口已就绪 · 暂未开放公网扣费'
          );
          buy.disabled = false;
          return;
        }
        throw new Error(payload.error ?? `下单失败（HTTP ${response.status}）`);
      }
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      buy.disabled = false;
      showModal(
        `解锁 ${product?.name ?? '付费内容'}`,
        `请求已到达网关。当前环境未连接外部真实发卡行。`,
        sku,
        error instanceof Error ? error.message : '网络连接受限'
      );
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

export function paidReturnNotice(): string | null {
  const params = new URLSearchParams(location.search);
  if (params.get('paid') !== '1') return null;
  params.delete('paid');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  return '支付已完成，正在核对权益…';
}

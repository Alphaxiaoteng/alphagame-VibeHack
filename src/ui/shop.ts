/**
 * 战备与关卡选择模块：
 * 首页主面板保持纯净极简（只呈现轻量状态摘要胶囊），
 * 关卡与 3D 角色配置独立在「战备整备舱」弹窗中，支持 3D 动作角色实时走动与 $0.99 买断开启。
 */
import { LEVELS, SKINS, canPlayLevel, canUseSkin, levelById, productBySku, productForLevel, productForSkin, resolveEntitlements } from '../core/economy';
import type { Entitlements, LevelId, ProductSku, SkinId } from '../core/economy';
import { Role3DPreview } from './role3dPreview';

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
  onSelect(levelId: LevelId, skinId: SkinId): void;
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

  // 1. 首页轻量战备状态条（胶囊型）
  const summaryBar = document.createElement('div');
  summaryBar.className = 'shop-summary-bar';
  summaryBar.innerHTML = `
    <div class="shop-summary-info">
      <span class="shop-summary-tag">出勤配置</span>
      <strong class="shop-summary-level">01 住院部</strong>
      <span class="shop-summary-role">· 值班医师</span>
    </div>
    <button type="button" class="shop-summary-btn">
      <span>配置</span>
    </button>
  `;
  const summaryLevel = summaryBar.querySelector('.shop-summary-level') as HTMLElement;
  const summaryRole = summaryBar.querySelector('.shop-summary-role') as HTMLElement;
  const openConfigBtn = summaryBar.querySelector('.shop-summary-btn') as HTMLButtonElement;

  // 2. 独立弹窗：战备整备舱（Modal）
  const configModal = document.createElement('div');
  configModal.className = 'modal-layer shop-config-layer';
  configModal.hidden = true;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  
  const modalCard = document.createElement('div');
  modalCard.className = 'modal-card shop-config-card';

  // 弹窗头部
  const modalHead = document.createElement('div');
  modalHead.className = 'modal-head';
  modalHead.innerHTML = `
    <div class="config-title-block">
      <strong>战备整备舱 · 关卡与干员选择</strong>
      <span class="badge-mini">3D 动作已载入</span>
    </div>
    <button type="button" class="modal-close" title="完成">&times;</button>
  `;
  const closeConfigBtn = modalHead.querySelector('.modal-close') as HTMLButtonElement;

  // 弹窗内容容器
  const modalContent = document.createElement('div');
  modalContent.className = 'shop-modal-content';

  // 大封面与 3D 动作角色视窗
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

  // 3D 角色动作视窗
  const role3dContainer = document.createElement('div');
  role3dContainer.className = 'shop-role-3d-box';
  const role3dBadge = document.createElement('span');
  role3dBadge.className = 'shop-role-3d-label';
  role3dBadge.textContent = '3D 动态';
  const role3d = new Role3DPreview(124, 124);
  role3dContainer.append(role3d.domElement, role3dBadge);

  cover.append(coverImage, role3dContainer, coverBadge, coverMeta);

  // 科室选择行
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

  // 干员选择行
  const skinGroup = document.createElement('div');
  skinGroup.className = 'shop-group';
  const skinLabel = document.createElement('span');
  skinLabel.className = 'shop-label';
  skinLabel.textContent = '出勤干员 · 角色配置 (全部免费)';
  const skinRow = document.createElement('div');
  skinRow.className = 'shop-row shop-row-skins';
  skinGroup.append(skinLabel, skinRow);

  // 购买条与提示
  const buy = chip('shop-buy');
  buy.hidden = true;
  const note = document.createElement('p');
  note.className = 'shop-note';

  // 弹窗底部操作
  const modalFooter = document.createElement('div');
  modalFooter.className = 'shop-config-footer';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'primary config-confirm-btn';
  confirmBtn.innerHTML = '<span>保存并返回</span><span class="arrow-icon">&rarr;</span>';
  modalFooter.append(confirmBtn);

  modalContent.append(cover, group, skinGroup, buy, note);
  modalCard.append(modalHead, modalContent, modalFooter);
  configModal.append(backdrop, modalCard);

  // 3. 买断详情弹窗（嵌套层）
  const buyModal = document.createElement('div');
  buyModal.className = 'shop-modal';
  buyModal.hidden = true;
  const buyModalBackdrop = document.createElement('div');
  buyModalBackdrop.className = 'shop-modal-backdrop';
  const buyModalCard = document.createElement('div');
  buyModalCard.className = 'shop-modal-card';
  buyModal.append(buyModalBackdrop, buyModalCard);

  root.replaceChildren(summaryBar);
  document.body.append(configModal, buyModal);

  function pendingProduct(): ProductSku | null {
    if (!canPlayLevel(levelId, entitlements)) return productForLevel(levelId)?.sku ?? null;
    if (!canUseSkin(skinId, entitlements)) return productForSkin(skinId)?.sku ?? null;
    return null;
  }

  function paint(): void {
    const currentLevel = levelById(levelId);
    const levelLocked = !canPlayLevel(levelId, entitlements);
    const currentSkin = SKINS.find(s => s.id === skinId);
    const roleInfo = ROLE_TITLES[skinId] ?? { role: currentSkin?.name ?? '', desc: '' };

    // 同步首页摘要胶囊
    summaryLevel.textContent = `${currentLevel?.index ?? ''} ${currentLevel?.name ?? ''}`;
    summaryRole.textContent = `· ${roleInfo.role} (${levelLocked ? '待解锁' : '免费就绪'})`;

    // 渲染大视窗
    const art = LEVEL_COVERS[levelId];
    if (art && coverImage.getAttribute('src') !== art) {
      coverImage.src = art;
      coverImage.alt = `${currentLevel?.name ?? '科室'} 封面`;
    }
    coverTitle.textContent = `${currentLevel?.index ?? ''} ${currentLevel?.name ?? ''}`;
    coverSubtitle.textContent = `${currentLevel?.ward ?? ''} · 限时 ${currentLevel?.rules.timeLimit ?? 45}s · 速度 ${currentLevel?.rules.patrolSpeed ?? 2.8}m/s`;
    coverBadge.textContent = levelLocked ? '待解锁 · $0.99 买断' : (currentLevel?.free ? '免费开放' : '已解锁');
    coverBadge.classList.toggle('locked', levelLocked);
    coverBadge.classList.toggle('free', !levelLocked && !!currentLevel?.free);

    // 更新 3D 动作角色动态展示
    role3d.show(skinId);

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

    // 购买按钮
    const sku = pendingProduct();
    const product = sku ? productBySku(sku) : undefined;
    buy.hidden = !product;
    if (product) {
      buy.innerHTML = `<strong>$${product.price} 买断开启</strong><span>解锁 ${product.name}</span>`;
      buy.disabled = false;
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

  // 弹窗开关控制
  const openModal = () => {
    document.body.dataset.configOpen = 'true';
    configModal.hidden = false;
    role3d.show(skinId);
  };
  const closeModal = () => {
    delete document.body.dataset.configOpen;
    configModal.hidden = true;
    role3d.hide();
  };
  openConfigBtn.addEventListener('click', openModal);
  closeConfigBtn.addEventListener('click', closeModal);
  confirmBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);

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

  // 创建关卡卡片
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

  // 创建干员卡片
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
    text.innerHTML = `<strong>${info.role}</strong><small>免费选用 · 备勤中</small>`;
    button.append(avatar, swatch, text);
    button.addEventListener('click', () => { selectSkin(skin.id); button.blur(); });
    skinRow.append(button);
  }

  // 买断确认弹窗
  function showBuyModal(titleText: string, descText: string, sku: ProductSku, statusText: string): void {
    const product = productBySku(sku);
    buyModalCard.innerHTML = `
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
    buyModal.hidden = false;

    const closeBtn = buyModalCard.querySelector('.shop-modal-close');
    const okBtn = buyModalCard.querySelector('.primary-btn');
    const freeBtn = buyModalCard.querySelector('.default-btn');

    const hide = () => { buyModal.hidden = true; };
    closeBtn?.addEventListener('click', hide);
    okBtn?.addEventListener('click', hide);
    buyModalBackdrop.addEventListener('click', hide);
    freeBtn?.addEventListener('click', () => {
      hide();
      closeModal();
      selectLevel('ward-01');
      selectSkin('standard');
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
        throw new Error(payload.error ?? `下单失败（HTTP ${response.status}）`);
      }
      // 成功获得收银台 URL，立即触发页面跳转！
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      buy.disabled = false;
      showBuyModal(
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

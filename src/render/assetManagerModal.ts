/**
 * 《查房》(Rounds) 3D 资产管理与风格配置后台面板 UI
 * 允许用户在游戏内自由预览、切换 4 套经典风格主题与查看单件 3D 模型规格
 */

import { AssetRegistry, ASSET_CATALOG, THEMES } from '../core/assetRegistry';
import type { ThemeId, AssetCategory } from '../core/assetRegistry';

export class AssetManagerModal {
  private container: HTMLDivElement;
  private isOpen = false;
  private currentFilter: 'all' | ThemeId = 'all';
  private registry = AssetRegistry.get();
  private onPauseRequest?: (pause: boolean) => void;

  constructor(options?: { onPauseRequest?: (pause: boolean) => void }) {
    this.onPauseRequest = options?.onPauseRequest;
    this.container = document.createElement('div');
    this.container.id = 'asset-manager-modal';
    this.container.className = 'asset-modal-overlay hidden';
    document.body.appendChild(this.container);

    this.registry.subscribe(() => {
      if (this.isOpen) {
        this.render();
      }
    });

    this.bindEvents();
    this.createTriggerButton();
  }

  public open(): void {
    this.isOpen = true;
    this.container.classList.remove('hidden');
    this.onPauseRequest?.(true);
    this.render();
  }

  public close(): void {
    this.isOpen = false;
    this.container.classList.add('hidden');
    this.onPauseRequest?.(false);
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private createTriggerButton(): void {
    const btn = document.createElement('button');
    btn.id = 'btn-open-asset-manager';
    btn.className = 'btn-asset-manager-trigger';
    btn.innerHTML = `
      <span class="trigger-icon">🏛</span>
      <span class="trigger-label">资产后台 [G]</span>
    `;
    btn.title = '打开 3D 资产管理与风格配置后台 (快捷键 G)';
    btn.addEventListener('click', () => this.toggle());
    document.body.appendChild(btn);
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'g' || e.key === 'G') {
        const activeTag = (document.activeElement?.tagName || '').toLowerCase();
        if (activeTag !== 'input' && activeTag !== 'textarea') {
          e.preventDefault();
          this.toggle();
        }
      } else if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) {
        this.close();
      }
    });
  }

  private render(): void {
    const state = this.registry.getState();
    const activeTheme = this.registry.getActiveTheme();
    const allThemes = Object.values(THEMES);

    const filteredAssets =
      this.currentFilter === 'all'
        ? ASSET_CATALOG
        : ASSET_CATALOG.filter((a) => a.theme === this.currentFilter);

    this.container.innerHTML = `
      <div class="asset-modal-dialog">
        <!-- 头部 -->
        <div class="asset-modal-header">
          <div>
            <div class="asset-modal-title">《查房》3D 资产管理与风格配置后台</div>
            <div class="asset-modal-subtitle">
              当前生效套系：<strong>${activeTheme.name}</strong> · 已收录 4 套风格 / 16 件 PBR 工业级模型
            </div>
          </div>
          <button class="asset-modal-close" id="btn-asset-modal-close" title="关闭 (Esc)">✕</button>
        </div>

        <div class="asset-modal-body">
          <!-- 区域 1：四套经典风格切换大卡 -->
          <div class="asset-section-title">
            <span>风格套系一键切换 (Theme Packs)</span>
            <span class="asset-section-hint">点击卡片即可在全场景热切换对应风格资产与空间配色</span>
          </div>
          <div class="theme-cards-grid">
            ${allThemes
              .map((theme) => {
                const isActive = state.activeTheme === theme.id;
                return `
                <div class="theme-card ${isActive ? 'active' : ''}" data-theme-id="${theme.id}">
                  <div class="theme-card-header">
                    <span class="theme-name">${theme.name}</span>
                    ${isActive ? '<span class="badge-active">当前生效中</span>' : ''}
                  </div>
                  <div class="theme-subtitle">${theme.subtitle}</div>
                  <div class="theme-desc">${theme.description}</div>
                  <div class="theme-meta">
                    <div class="theme-palette">
                      <span class="color-dot" style="background:${theme.wallColor}" title="墙面色"></span>
                      <span class="color-dot" style="background:${theme.floorColor}" title="地面色"></span>
                      <span class="color-dot" style="background:${theme.accentColor}" title="重点点缀色"></span>
                    </div>
                    <span class="theme-light-label">${theme.lightingTone}</span>
                  </div>
                  <button class="btn-apply-theme ${isActive ? 'btn-disabled' : ''}" data-apply-theme="${theme.id}">
                    ${isActive ? '已在场景中生效' : '应用此风格套系'}
                  </button>
                </div>
              `;
              })
              .join('')}
          </div>

          <!-- 区域 2：资产分类与筛选条 -->
          <div class="asset-section-title" style="margin-top: 24px;">
            <span>3D 资产货架与单件配置 (Asset Shelf)</span>
            <div class="asset-filter-tabs">
              <button class="filter-tab ${this.currentFilter === 'all' ? 'active' : ''}" data-filter="all">全部资产 (${ASSET_CATALOG.length})</button>
              <button class="filter-tab ${this.currentFilter === 'modern' ? 'active' : ''}" data-filter="modern">现代公立 (${ASSET_CATALOG.filter((a) => a.theme === 'modern').length})</button>
              <button class="filter-tab ${this.currentFilter === 'vintage' ? 'active' : ''}" data-filter="vintage">80年代复古 (${ASSET_CATALOG.filter((a) => a.theme === 'vintage').length})</button>
              <button class="filter-tab ${this.currentFilter === 'lowpoly' ? 'active' : ''}" data-filter="lowpoly">极简低模 (${ASSET_CATALOG.filter((a) => a.theme === 'lowpoly').length})</button>
              <button class="filter-tab ${this.currentFilter === 'industrial' ? 'active' : ''}" data-filter="industrial">硬核工业 (${ASSET_CATALOG.filter((a) => a.theme === 'industrial').length})</button>
            </div>
          </div>

          <!-- 区域 3：资产卡片流 -->
          <div class="asset-cards-grid">
            ${filteredAssets
              .map((asset) => {
                const currentEquipped = this.registry.getEffectiveAsset(asset.category);
                const isEquipped = currentEquipped.id === asset.id;
                const isOverridden = state.individualOverrides[asset.category] === asset.id;

                return `
                <div class="asset-card ${isEquipped ? 'equipped' : ''}">
                  <div class="asset-preview-container">
                    <img src="${asset.previewUrl}" alt="${asset.name}" class="asset-preview-img" onerror="this.src='/assets/art/models/hospital_bed_preview.png'" />
                    <span class="asset-theme-tag tag-${asset.theme}">${THEMES[asset.theme].name.split(' ')[0]}</span>
                    ${isEquipped ? '<span class="asset-equipped-badge">已挂载到场景</span>' : ''}
                  </div>
                  <div class="asset-info">
                    <div class="asset-title-row">
                      <span class="asset-name">${asset.name}</span>
                      <span class="asset-category-pill">${asset.category}</span>
                    </div>
                    <div class="asset-dimensions">规格尺寸：${asset.spec.dimensions}</div>
                    <div class="asset-desc">${asset.spec.description}</div>
                    <div class="asset-footer">
                      <span class="asset-format-badge">GLB · PBR</span>
                      ${
                        isEquipped
                          ? `<button class="btn-asset-action btn-equipped" disabled>当前使用中</button>`
                          : `<button class="btn-asset-action btn-equip" data-equip-id="${asset.id}" data-equip-cat="${asset.category}">单独装备此模型</button>`
                      }
                      ${
                        isOverridden
                          ? `<button class="btn-reset-override" data-clear-cat="${asset.category}" title="恢复跟随默认套系">恢复跟随</button>`
                          : ''
                      }
                    </div>
                  </div>
                </div>
              `;
              })
              .join('')}
          </div>
        </div>

        <!-- 底部说明与重置 -->
        <div class="asset-modal-footer">
          <div class="footer-tip">
            提示：选中的套系和单件道具配置将自动持久化保存在本地，重开新局依然生效。
          </div>
          <button class="btn-reset-all" id="btn-asset-reset-all">恢复默认配置</button>
        </div>
      </div>
    `;

    // 绑定内部交互事件
    this.container
      .querySelector('#btn-asset-modal-close')
      ?.addEventListener('click', () => this.close());

    // 应用套系
    this.container.querySelectorAll('[data-apply-theme]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const themeId = (e.currentTarget as HTMLElement).getAttribute(
          'data-apply-theme'
        ) as ThemeId;
        if (themeId) {
          this.registry.setTheme(themeId);
          this.render();
        }
      });
    });

    // 筛选 Tab
    this.container.querySelectorAll('[data-filter]').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        this.currentFilter = (e.currentTarget as HTMLElement).getAttribute(
          'data-filter'
        ) as any;
        this.render();
      });
    });

    // 单件装备
    this.container.querySelectorAll('[data-equip-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const assetId = (e.currentTarget as HTMLElement).getAttribute('data-equip-id')!;
        const cat = (e.currentTarget as HTMLElement).getAttribute(
          'data-equip-cat'
        )! as AssetCategory;
        this.registry.setOverride(cat, assetId);
        this.render();
      });
    });

    // 清除单件覆盖
    this.container.querySelectorAll('[data-clear-cat]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const cat = (e.currentTarget as HTMLElement).getAttribute(
          'data-clear-cat'
        )! as AssetCategory;
        this.registry.clearOverride(cat);
        this.render();
      });
    });

    // 恢复全量默认
    this.container.querySelector('#btn-asset-reset-all')?.addEventListener('click', () => {
      this.registry.resetAll();
      this.render();
    });
  }
}

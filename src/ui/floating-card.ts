import { store, AI_PROVIDER_PRESETS } from '../store';
import { PANEL_STYLES } from './style';
import { AppConfig, EnabledQuestionTypes } from '../types';
import { fetchRemoteModels, getModelSupportedReasoningEfforts } from '../adapters/ai-solver/client';

export class FloatingCard extends HTMLElement {
  private shadow: ShadowRoot;
  private currentTab: 'log' | 'setting' | 'about' = 'log';
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private cardStartX = 0;
  private cardStartY = 0;
  private renderedMinimized = false;
  private isManualModelInput = false;
  private isFetchingModels = false;
  private lastRenderedLogKey = '';
  private lastRenderedPinnedKey = '';
  private storeUnsubscribe: (() => void) | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.applyHostStyles();
    this.render();
    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
    }
    this.storeUnsubscribe = store.subscribe(() => this.onStoreUpdate());
  }

  disconnectedCallback() {
    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
    }
  }

  private applyHostStyles() {
    this.style.position = 'fixed';
    this.style.zIndex = '2147483647';
    this.style.display = 'block';
    this.style.pointerEvents = 'auto';

    const { x, y } = store.config.panelPosition;
    const maxX = Math.max(10, window.innerWidth - 350);
    const maxY = Math.max(10, window.innerHeight - 80);
    this.style.left = `${Math.max(10, Math.min(maxX, x))}px`;
    this.style.top = `${Math.max(10, Math.min(maxY, y))}px`;
  }

  private render() {
    const isMinimized = store.config.panelMinimized;
    this.renderedMinimized = isMinimized;

    const styleEl = document.createElement('style');
    styleEl.textContent = PANEL_STYLES;

    const container = document.createElement('div');
    container.id = 'root-container';

    const pinnedCount = store.pinnedErrors.length;
    const badgeText = pinnedCount > 99 ? '99+' : String(pinnedCount);

    if (isMinimized) {
      container.innerHTML = `
        <div class="minimized-ball" id="drag-handle" title="点击展开 Kasa 学习通助手" role="button" aria-label="展开 Kasa 学习通助手">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
            <path d="M6 12v5c3 3 9 3 12 0v-5"></path>
          </svg>
          <span class="minimized-alert-dot" style="${pinnedCount === 0 ? 'display:none;' : ''}">${badgeText}</span>
        </div>
      `;
      this.shadow.replaceChildren(styleEl, container);
      this.setupDragging(container.querySelector('#drag-handle') as HTMLElement, true);
    } else {
      const isRunning = store.isQuizRunning;
      const isPaused = store.progress.status === 'paused';
      const btnText = isRunning ? '暂停答题' : (isPaused ? '继续答题' : '开始答题');
      const btnStateClass = isRunning ? 'pause' : (isPaused ? 'resume' : 'start');

      container.innerHTML = `
        <div class="kasa-card">
          <div class="kasa-header" id="drag-handle">
            <div class="kasa-title-group">
              <span class="kasa-badge">v1.3</span>
              <span class="kasa-title">Kasa 学习通助手</span>
            </div>
            <div class="kasa-actions">
              <button class="kasa-btn-quiz ${btnStateClass}" id="btn-start-quiz" title="${btnText}">${btnText}</button>
              <button class="kasa-btn-icon" id="btn-minimize" title="最小化" aria-label="最小化面板">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            </div>
          </div>

          <div class="kasa-progress-box" id="kasa-progress-box">
            <div class="kasa-progress-header">
              <span class="kasa-progress-title" id="kasa-prog-title">${this.escapeHtml(store.progress.title)}</span>
              <span class="kasa-progress-status ${store.progress.status}" id="kasa-prog-status">${this.getStatusLabel(store.progress.status)}</span>
            </div>
            <div class="kasa-progress-track">
              <div class="kasa-progress-bar" id="kasa-prog-bar" style="width: ${store.progress.percent}%"></div>
            </div>
            <div class="kasa-progress-footer">
              <span id="kasa-prog-time">${this.formatProgressTime(store.progress.currentTime, store.progress.duration)}</span>
              <span id="kasa-prog-percent" style="font-weight:600;color:var(--kasa-primary);">${store.progress.percent}%</span>
            </div>
          </div>

          <div class="kasa-tabs">
            <div class="kasa-tab ${this.currentTab === 'log' ? 'active' : ''}" data-tab="log">
              <span>运行日志</span>
              <span class="tab-badge" id="tab-alert-badge" style="${pinnedCount === 0 ? 'display:none;' : ''}">${badgeText}</span>
            </div>
            <div class="kasa-tab ${this.currentTab === 'setting' ? 'active' : ''}" data-tab="setting">AI 设置</div>
            <div class="kasa-tab ${this.currentTab === 'about' ? 'active' : ''}" data-tab="about">说明</div>
          </div>

          <div class="kasa-body" id="tab-content">
            ${this.getTabContentHtml()}
          </div>
        </div>
      `;
      if (this.currentTab === 'log') {
        this.lastRenderedLogKey = `${store.logs.length}:${store.logs[0]?.id || ''}:${pinnedCount > 0 ? 'p' : 'e'}`;
        this.lastRenderedPinnedKey = store.pinnedErrors.map((p) => `${p.id}:${p.time}:${p.count || 1}`).join('|');
      }
      this.shadow.replaceChildren(styleEl, container);
      this.bindCardEvents(container);
      this.setupDragging(container.querySelector('#drag-handle') as HTMLElement, false);
    }
  }

  private onStoreUpdate() {
    if (store.config.panelMinimized !== this.renderedMinimized) {
      this.render();
      return;
    }

    const pinnedCount = store.pinnedErrors.length;
    const badgeText = pinnedCount > 99 ? '99+' : String(pinnedCount);

    if (this.renderedMinimized) {
      const alertDot = this.shadow.querySelector('.minimized-alert-dot') as HTMLElement | null;
      if (alertDot) {
        if (pinnedCount > 0) {
          alertDot.style.display = 'flex';
          alertDot.textContent = badgeText;
        } else {
          alertDot.style.display = 'none';
        }
      }
      return;
    }

    // Update progress widget
    const progTitle = this.shadow.querySelector('#kasa-prog-title');
    const progStatus = this.shadow.querySelector('#kasa-prog-status');
    const progBar = this.shadow.querySelector('#kasa-prog-bar') as HTMLElement;
    const progTime = this.shadow.querySelector('#kasa-prog-time');
    const progPercent = this.shadow.querySelector('#kasa-prog-percent');

    if (progTitle) progTitle.textContent = store.progress.title;
    if (progStatus) {
      progStatus.className = `kasa-progress-status ${store.progress.status}`;
      progStatus.textContent = this.getStatusLabel(store.progress.status);
    }
    if (progBar) progBar.style.width = `${store.progress.percent}%`;
    if (progTime) progTime.textContent = this.formatProgressTime(store.progress.currentTime, store.progress.duration);
    if (progPercent) progPercent.textContent = `${store.progress.percent}%`;

    // Update start/pause quiz button
    const startQuizBtn = this.shadow.querySelector('#btn-start-quiz') as HTMLElement | null;
    if (startQuizBtn) {
      const isRunning = store.isQuizRunning;
      const isPaused = store.progress.status === 'paused';
      const btnText = isRunning ? '暂停答题' : (isPaused ? '继续答题' : '开始答题');
      const btnStateClass = isRunning ? 'pause' : (isPaused ? 'resume' : 'start');
      startQuizBtn.textContent = btnText;
      startQuizBtn.title = btnText;
      startQuizBtn.className = `kasa-btn-quiz ${btnStateClass}`;
    }

    // Update Tab alert badge
    const tabBadge = this.shadow.querySelector('#tab-alert-badge') as HTMLElement | null;
    if (tabBadge) {
      if (pinnedCount > 0) {
        tabBadge.style.display = 'inline-flex';
        tabBadge.textContent = badgeText;
      } else {
        tabBadge.style.display = 'none';
      }
    }

    // Independent granular incremental refresh for log tab
    if (this.currentTab === 'log') {
      const pinnedContainer = this.shadow.querySelector('#kasa-pinned-alerts') as HTMLElement | null;
      const logListContainer = this.shadow.querySelector('#kasa-log-list') as HTMLElement | null;

      if (!pinnedContainer || !logListContainer) {
        const tabContent = this.shadow.querySelector('#tab-content');
        if (tabContent) {
          tabContent.innerHTML = this.getTabContentHtml();
          this.lastRenderedLogKey = `${store.logs.length}:${store.logs[0]?.id || ''}:${pinnedCount > 0 ? 'p' : 'e'}`;
          this.lastRenderedPinnedKey = store.pinnedErrors.map((p) => `${p.id}:${p.time}:${p.count || 1}`).join('|');
        }
        return;
      }

      // 1. Only re-render pinned container when pinnedErrors change
      const currentPinnedKey = store.pinnedErrors.map((p) => `${p.id}:${p.time}:${p.count || 1}`).join('|');
      if (currentPinnedKey !== this.lastRenderedPinnedKey) {
        this.lastRenderedPinnedKey = currentPinnedKey;
        if (pinnedCount > 0) {
          pinnedContainer.style.display = '';
          pinnedContainer.innerHTML = this.getPinnedAlertsHtml();
        } else {
          pinnedContainer.style.display = 'none';
          pinnedContainer.innerHTML = '';
        }
      }

      // 2. Only re-render log stream when logs change (never swallow click on pinned alerts)
      const currentLogKey = `${store.logs.length}:${store.logs[0]?.id || ''}:${pinnedCount > 0 ? 'p' : 'e'}`;
      if (currentLogKey !== this.lastRenderedLogKey) {
        this.lastRenderedLogKey = currentLogKey;
        logListContainer.innerHTML = this.getLogListHtml();
      }
    }
  }

  private formatProgressTime(currentTime?: string, duration?: string): string {
    const cur = (currentTime || '').trim();
    const dur = (duration || '').trim();
    if (dur) {
      return `${cur} / ${dur}`;
    }
    return cur;
  }

  private getStatusLabel(status: string): string {
    switch (status) {
      case 'playing': {
        const title = store.progress.title || '';
        const isQuiz =
          /(作业|测验|考试|题)/.test(title) ||
          (store.questions && store.questions.length > 0);
        const isDoc = /(文档|课件|资料|阅读)/.test(title);
        if (isQuiz) return '作答中';
        if (isDoc) return '阅读中';
        return '播放中';
      }
      case 'paused': return '已暂停';
      case 'finished': return '已完成';
      default: return '待机中';
    }
  }

  private getPinnedAlertsHtml(): string {
    const list = store.pinnedErrors;
    if (!list.length) return '';
    return `
      <div class="pinned-header">
        <div class="pinned-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;" aria-hidden="true">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>待复核关键告警 (${list.length})</span>
        </div>
        <button type="button" class="pinned-btn-ack-all" id="btn-ack-all" title="忽略并确认所有告警">全部确认</button>
      </div>
      <ul class="pinned-list">
        ${list.map((p) => `
          <li class="pinned-item">
            <div class="pinned-item-content">
              <span class="pinned-item-time">[${p.time}]</span>
              <span>${this.escapeHtml(p.message)}</span>
              ${(p.count && p.count > 1) ? `<span class="pinned-item-badge">×${p.count}</span>` : ''}
            </div>
            <button type="button" class="kasa-ack-btn" data-ack-id="${p.id}" title="确认并移除该项告警" aria-label="确认告警">确认</button>
          </li>
        `).join('')}
      </ul>
    `;
  }

  private getLogListHtml(): string {
    if (!store.logs.length) {
      if (store.pinnedErrors.length > 0) {
        return '';
      }
      return `<div style="text-align:center;color:var(--kasa-text-muted);padding:24px 0;font-size:12px;">等待任务开始...</div>`;
    }
    return `
      <div class="log-container">
        ${store.logs
          .map(
            (log) => `
          <div class="log-item">
            <span class="log-time">[${log.time}]</span>
            <span class="log-msg ${log.level}">${this.escapeHtml(log.message)}</span>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  private getTabContentHtml(): string {
    if (this.currentTab === 'log') {
      const hasPinned = store.pinnedErrors.length > 0;
      return `
        <div id="kasa-pinned-alerts" class="kasa-pinned-alerts" role="alert" aria-live="assertive" style="${hasPinned ? '' : 'display:none;'}">
          ${this.getPinnedAlertsHtml()}
        </div>
        <div id="kasa-log-list">
          ${this.getLogListHtml()}
        </div>
      `;
    }

    if (this.currentTab === 'setting') {
      const cfg = store.config;
      const cachedModels = cfg.cachedModelList || [];
      const hasCachedModels = cachedModels.length > 0;
      const showDropdown = hasCachedModels && !this.isManualModelInput;

      return `
        <div class="setting-item">
          <div class="setting-label">
            <span>自动下一章节</span>
            <label class="toggle-switch">
              <input type="checkbox" id="cfg-next-chapter" ${cfg.autoNextChapter ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span>答完自动提交（关闭则仅暂存）</span>
            <label class="toggle-switch">
              <input type="checkbox" id="cfg-auto-submit" ${cfg.autoSubmitWork ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span>AI 服务提供商</span>
          </div>
          <select class="setting-select" id="cfg-provider">
            <option value="deepseek" ${cfg.aiProvider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
            <option value="custom" ${cfg.aiProvider === 'custom' ? 'selected' : ''}>自定义接口</option>
          </select>
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span>AI API Key</span>
          </div>
          <input type="password" class="setting-input" id="cfg-api-key" placeholder="填入你的 API Key" value="${this.escapeHtml(cfg.aiApiKey)}">
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span>Base URL</span>
          </div>
          <input type="text" class="setting-input" id="cfg-base-url" value="${this.escapeHtml(cfg.aiBaseUrl)}">
          <button type="button" class="kasa-btn-fetch" id="btn-fetch-models" ${this.isFetchingModels ? 'disabled' : ''}>
            ${this.isFetchingModels ? '正在获取模型列表...' : '获取模型列表'}
          </button>
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span>模型名称 (Model)</span>
            ${hasCachedModels ? `
              <button type="button" class="kasa-link-btn" id="btn-toggle-model-input">
                ${showDropdown ? '手动输入' : `下拉选择 (${cachedModels.length})`}
              </button>
            ` : ''}
          </div>
          ${showDropdown ? `
            <select class="setting-select" id="cfg-model-select">
              ${!cachedModels.includes(cfg.aiModel) && cfg.aiModel ? `
                <option value="${this.escapeHtml(cfg.aiModel)}" selected>${this.escapeHtml(cfg.aiModel)} (当前配置)</option>
              ` : ''}
              ${cachedModels.map(m => `
                <option value="${this.escapeHtml(m)}" ${m === cfg.aiModel ? 'selected' : ''}>${this.escapeHtml(m)}</option>
              `).join('')}
            </select>
          ` : `
            <input type="text" class="setting-input" id="cfg-model" placeholder="例如 deepseek-flash" value="${this.escapeHtml(cfg.aiModel)}">
          `}
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span>思考强度 (Reasoning Effort)</span>
          </div>
          <select class="setting-select" id="cfg-reasoning-effort">
            <option value="none">默认/关闭</option>
            <option value="low">低 (low)</option>
            <option value="medium">中 (medium)</option>
            <option value="high">高 (high)</option>
            <option value="max">最大 (max / 100)</option>
          </select>
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span>作答题型范围</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px 12px;padding:4px 0;font-size:12px;color:var(--kasa-text-secondary);">
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="cfg-type-single" ${cfg.enabledQuestionTypes?.single !== false ? 'checked' : ''}> 单选</label>
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="cfg-type-multiple" ${cfg.enabledQuestionTypes?.multiple !== false ? 'checked' : ''}> 多选</label>
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="cfg-type-judge" ${cfg.enabledQuestionTypes?.judge !== false ? 'checked' : ''}> 判断</label>
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="cfg-type-fill" ${cfg.enabledQuestionTypes?.fill !== false ? 'checked' : ''}> 填空</label>
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="cfg-type-essay" ${cfg.enabledQuestionTypes?.essay !== false ? 'checked' : ''}> 简答</label>
          </div>
        </div>

        <div style="margin-top: 16px; margin-bottom: 6px;">
          <button type="button" class="kasa-btn-save" id="btn-save-config">保存设置</button>
        </div>
      `;
    }

    return `
      <div style="font-size:12px;color:var(--kasa-text-secondary);line-height:1.7;">
        <div style="font-weight:600;margin-bottom:6px;color:var(--kasa-text);">使用说明</div>
        <p style="margin:4px 0;">• <strong>课程学习</strong>：进入章节后自动原速播放音视频、浏览课件，完成后自动跳转下一节。</p>
        <p style="margin:4px 0;">• <strong>作业与测验</strong>：在「AI 设置」中填好 API Key 与模型，点击右上角「开始答题」即可自动作答。</p>
        <p style="margin:4px 0;">• <strong>数据安全</strong>：配置与 Key 仅保存在当前浏览器本地，直接请求服务商接口。</p>
        <div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--kasa-border);color:var(--kasa-text-muted);font-size:11px;">
          提示：遇到遮挡可点击右上角最小化面板 · v1.3.0
        </div>
      </div>
    `;
  }

  private refreshSettingTab(tabContent: Element) {
    tabContent.innerHTML = this.getTabContentHtml();
    this.bindSettingEvents(tabContent);
  }

  private updateReasoningEffortUI(tabContent: Element) {
    const reasoningEffortSelect = tabContent.querySelector('#cfg-reasoning-effort') as HTMLSelectElement | null;
    if (!reasoningEffortSelect) return;

    const modelSelect = tabContent.querySelector('#cfg-model-select') as HTMLSelectElement | null;
    const modelInput = tabContent.querySelector('#cfg-model') as HTMLInputElement | null;
    const currentModel = (modelSelect ? modelSelect.value : (modelInput ? modelInput.value : store.config.aiModel)) || '';
    
    const efforts = getModelSupportedReasoningEfforts(currentModel);
    const currentEffort = store.config.reasoningEffort || 'none';

    reasoningEffortSelect.disabled = false;
    reasoningEffortSelect.innerHTML = efforts
      .map((eff) => {
        let label = eff;
        if (eff === 'none') label = '默认/关闭';
        else if (eff === 'low') label = '低 (low)';
        else if (eff === 'medium') label = '中 (medium)';
        else if (eff === 'high') label = '高 (high)';
        else if (eff === 'max') label = '最大 (max / 100)';
        const isSelected = eff === currentEffort || (!currentEffort && eff === 'none');
        return `<option value="${this.escapeHtml(eff)}" ${isSelected ? 'selected' : ''}>${this.escapeHtml(label)}</option>`;
      })
      .join('');
  }

  private bindCardEvents(container: Element) {
    container.querySelector('#btn-minimize')?.addEventListener('click', (e) => {
      e.stopPropagation();
      store.updateConfig({ panelMinimized: true });
    });

    const startQuizBtn = container.querySelector('#btn-start-quiz');
    startQuizBtn?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
    startQuizBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('kasa:toggle-quiz'));
    });

    container.querySelectorAll('.kasa-tab').forEach((tabEl) => {
      tabEl.addEventListener('click', (e) => {
        const tab = (e.currentTarget as HTMLElement).dataset.tab as any;
        if (tab && this.currentTab !== tab) {
          this.currentTab = tab;
          container.querySelectorAll('.kasa-tab').forEach((t) => {
            t.classList.toggle('active', (t as HTMLElement).dataset.tab === tab);
          });
          const tabContent = container.querySelector('#tab-content');
          if (tabContent) {
            tabContent.innerHTML = this.getTabContentHtml();
            if (tab === 'log') {
              const pCount = store.pinnedErrors.length;
              this.lastRenderedLogKey = `${store.logs.length}:${store.logs[0]?.id || ''}:${pCount > 0 ? 'p' : 'e'}`;
              this.lastRenderedPinnedKey = store.pinnedErrors.map((p) => `${p.id}:${p.time}:${p.count || 1}`).join('|');
            } else if (tab === 'setting') {
              this.bindSettingEvents(tabContent);
            }
          }
        }
      });
    });

    const tabContent = container.querySelector('#tab-content');
    if (tabContent) {
      // Event delegation for pinned alert acknowledgement
      tabContent.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const ackBtn = target.closest<HTMLElement>('[data-ack-id]');
        if (ackBtn) {
          e.stopPropagation();
          const ackId = ackBtn.dataset.ackId;
          if (ackId) {
            store.acknowledgeError(ackId);
          }
          return;
        }

        const ackAllBtn = target.closest<HTMLElement>('#btn-ack-all');
        if (ackAllBtn) {
          e.stopPropagation();
          store.acknowledgeAllErrors();
          return;
        }
      });

      if (this.currentTab === 'setting') {
        this.bindSettingEvents(tabContent);
      }
    }
  }

  private bindSettingEvents(tabContent: Element) {
    const nextChapterCheck = tabContent.querySelector('#cfg-next-chapter') as HTMLInputElement | null;
    nextChapterCheck?.addEventListener('change', () => {
      store.updateConfig({ autoNextChapter: nextChapterCheck.checked });
    });

    const autoSubmitCheck = tabContent.querySelector('#cfg-auto-submit') as HTMLInputElement | null;
    autoSubmitCheck?.addEventListener('change', () => {
      store.updateConfig({ autoSubmitWork: autoSubmitCheck.checked });
    });

    const providerSelect = tabContent.querySelector('#cfg-provider') as HTMLSelectElement | null;
    providerSelect?.addEventListener('change', () => {
      const provider = providerSelect.value as AppConfig['aiProvider'];
      const preset = AI_PROVIDER_PRESETS[provider];
      store.updateConfig({
        aiProvider: provider,
        aiBaseUrl: preset.baseUrl,
        aiModel: preset.model
      });
      this.refreshSettingTab(tabContent);
    });

    const apiKeyInput = tabContent.querySelector('#cfg-api-key') as HTMLInputElement | null;
    apiKeyInput?.addEventListener('input', () => {
      store.config.aiApiKey = apiKeyInput.value.trim();
      store.saveConfig();
    });

    const baseUrlInput = tabContent.querySelector('#cfg-base-url') as HTMLInputElement | null;
    baseUrlInput?.addEventListener('input', () => {
      store.config.aiBaseUrl = baseUrlInput.value.trim();
      store.saveConfig();
    });

    const modelInput = tabContent.querySelector('#cfg-model') as HTMLInputElement | null;
    modelInput?.addEventListener('input', () => {
      store.config.aiModel = modelInput.value.trim();
      store.saveConfig();
      this.updateReasoningEffortUI(tabContent);
    });

    const modelSelect = tabContent.querySelector('#cfg-model-select') as HTMLSelectElement | null;
    modelSelect?.addEventListener('change', () => {
      store.config.aiModel = modelSelect.value;
      store.saveConfig();
      this.updateReasoningEffortUI(tabContent);
    });

    const reasoningEffortSelect = tabContent.querySelector('#cfg-reasoning-effort') as HTMLSelectElement | null;
    reasoningEffortSelect?.addEventListener('change', () => {
      store.config.reasoningEffort = reasoningEffortSelect.value;
      store.saveConfig();
    });

    // 初始化思考强度 UI 状态联动
    this.updateReasoningEffortUI(tabContent);

    const toggleModelBtn = tabContent.querySelector('#btn-toggle-model-input') as HTMLButtonElement | null;
    toggleModelBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      this.isManualModelInput = !this.isManualModelInput;
      this.refreshSettingTab(tabContent);
    });

    const fetchBtn = tabContent.querySelector('#btn-fetch-models') as HTMLButtonElement | null;
    fetchBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const currentApiKey = (apiKeyInput?.value || store.config.aiApiKey || '').trim();
      const currentBaseUrl = (baseUrlInput?.value || store.config.aiBaseUrl || '').trim();

      if (!currentBaseUrl) {
        store.addLog('获取模型列表失败: 请先填写 Base URL', 'warning');
        return;
      }

      this.isFetchingModels = true;
      if (fetchBtn) {
        fetchBtn.disabled = true;
        fetchBtn.textContent = '正在获取模型列表中...';
      }

      try {
        const models = await fetchRemoteModels(currentBaseUrl, currentApiKey);
        if (models && models.length > 0) {
          store.updateConfig({ cachedModelList: models });
          store.addLog(`成功拉取到 ${models.length} 个模型！`, 'success');
          this.isManualModelInput = false;
        } else {
          store.addLog('未拉取到可用模型，请检查 Base URL / Key 是否有效', 'warning');
        }
      } catch (err) {
        store.addLog(`拉取模型列表出错: ${String(err)}`, 'error');
      } finally {
        this.isFetchingModels = false;
        this.refreshSettingTab(tabContent);
      }
    });

    const saveBtn = tabContent.querySelector('#btn-save-config') as HTMLButtonElement | null;
    saveBtn?.addEventListener('click', (e) => {
      e.preventDefault();

      const nextChapter = nextChapterCheck ? nextChapterCheck.checked : store.config.autoNextChapter;
      const autoSubmit = autoSubmitCheck ? autoSubmitCheck.checked : store.config.autoSubmitWork;
      const provider = providerSelect ? (providerSelect.value as AppConfig['aiProvider']) : store.config.aiProvider;
      const apiKey = apiKeyInput ? apiKeyInput.value.trim() : store.config.aiApiKey;
      const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : store.config.aiBaseUrl;

      let model = store.config.aiModel;
      if (modelSelect) {
        model = modelSelect.value;
      } else if (modelInput) {
        model = modelInput.value.trim();
      }

      const reasoning = reasoningEffortSelect
        ? (reasoningEffortSelect.value as AppConfig['reasoningEffort'])
        : (store.config.reasoningEffort || 'none');

      const typeSingle = tabContent.querySelector('#cfg-type-single') as HTMLInputElement | null;
      const typeMultiple = tabContent.querySelector('#cfg-type-multiple') as HTMLInputElement | null;
      const typeJudge = tabContent.querySelector('#cfg-type-judge') as HTMLInputElement | null;
      const typeFill = tabContent.querySelector('#cfg-type-fill') as HTMLInputElement | null;
      const typeEssay = tabContent.querySelector('#cfg-type-essay') as HTMLInputElement | null;

      const enabledQuestionTypes: EnabledQuestionTypes = {
        single: typeSingle ? typeSingle.checked : (store.config.enabledQuestionTypes?.single !== false),
        multiple: typeMultiple ? typeMultiple.checked : (store.config.enabledQuestionTypes?.multiple !== false),
        judge: typeJudge ? typeJudge.checked : (store.config.enabledQuestionTypes?.judge !== false),
        fill: typeFill ? typeFill.checked : (store.config.enabledQuestionTypes?.fill !== false),
        essay: typeEssay ? typeEssay.checked : (store.config.enabledQuestionTypes?.essay !== false)
      };

      store.updateConfig({
        autoNextChapter: nextChapter,
        autoSubmitWork: autoSubmit,
        aiProvider: provider,
        aiApiKey: apiKey,
        aiBaseUrl: baseUrl,
        aiModel: model,
        reasoningEffort: reasoning,
        enabledQuestionTypes
      });

      store.addLog('AI 配置已成功保存！', 'success');

      if (saveBtn) {
        saveBtn.classList.add('saved');
        saveBtn.textContent = '已保存设置！';
        setTimeout(() => {
          if (saveBtn) {
            saveBtn.classList.remove('saved');
            saveBtn.textContent = '保存设置';
          }
        }, 2000);
      }
    });
  }

  private setupDragging(handle: HTMLElement, isBall: boolean) {
    if (!handle) return;

    let hasMoved = false;

    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;

      this.isDragging = true;
      hasMoved = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;

      const rect = this.getBoundingClientRect();
      this.cardStartX = rect.left;
      this.cardStartY = rect.top;

      try {
        handle.setPointerCapture(e.pointerId);
      } catch {}

      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.isDragging) return;

      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true;
      }

      const cardWidth = isBall ? 50 : 340;
      const cardHeight = isBall ? 50 : 80;

      const newX = Math.max(5, Math.min(window.innerWidth - cardWidth, this.cardStartX + dx));
      const newY = Math.max(5, Math.min(window.innerHeight - cardHeight, this.cardStartY + dy));

      this.style.left = `${newX}px`;
      this.style.top = `${newY}px`;
    });

    const onPointerEnd = (e: PointerEvent) => {
      if (this.isDragging) {
        this.isDragging = false;
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {}

        const rect = this.getBoundingClientRect();
        store.updateConfig({ panelPosition: { x: rect.left, y: rect.top } });

        // If it was just a click on the minimized ball without drag, expand it
        if (isBall && !hasMoved) {
          store.updateConfig({ panelMinimized: false });
        }
      }
    };

    handle.addEventListener('pointerup', onPointerEnd);
    handle.addEventListener('pointercancel', onPointerEnd);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

customElements.define('kasa-helper-panel', FloatingCard);

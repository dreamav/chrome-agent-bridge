/**
 * Chrome Agent Bridge — Full-Screen Session & Tab Groups Manager Controller
 * Pure Vanilla JS, Event-Driven, 0% CPU footprint.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // --- DOM Elements ---
  const wsStatusBadge = document.getElementById('wsStatusBadge');
  const wsStatusText = document.getElementById('wsStatusText');
  const searchInput = document.getElementById('searchInput');
  const btnClearSearch = document.getElementById('btnClearSearch');
  const btnSaveCurrent = document.getElementById('btnSaveCurrent');
  const btnImportJson = document.getElementById('btnImportJson');
  const importFileInput = document.getElementById('importFileInput');

  const liveSessionCard = document.getElementById('liveSessionCard');
  const liveWindowCountBadge = document.getElementById('liveWindowCountBadge');
  const liveTabCountBadge = document.getElementById('liveTabCountBadge');
  const liveGroupCountBadge = document.getElementById('liveGroupCountBadge');
  const savedCountBadge = document.getElementById('savedCountBadge');
  const savedSessionsList = document.getElementById('savedSessionsList');
  const sessionsSortSelect = document.getElementById('sessionsSortSelect');
  const btnClearSessions = document.getElementById('btnClearSessions');

  const sidebar = document.querySelector('.sidebar');
  const btnToggleSidebar = document.getElementById('btnToggleSidebar');
  const btnExpandAll = document.getElementById('btnExpandAll');
  const btnCollapseAll = document.getElementById('btnCollapseAll');

  const selectedSessionTitle = document.getElementById('selectedSessionTitle');
  const selectedSessionTag = document.getElementById('selectedSessionTag');
  const metaDate = document.getElementById('metaDate');
  const metaStats = document.getElementById('metaStats');

  const btnRestoreAll = document.getElementById('btnRestoreAll');
  const btnExportCurrent = document.getElementById('btnExportCurrent');
  const btnSaveLiveAsNew = document.getElementById('btnSaveLiveAsNew');
  const btnDeleteCurrent = document.getElementById('btnDeleteCurrent');
  const btnRefreshLive = document.getElementById('btnRefreshLive');

  const searchBanner = document.getElementById('searchBanner');
  const searchMatchCount = document.getElementById('searchMatchCount');
  const searchQueryText = document.getElementById('searchQueryText');
  const btnResetFilter = document.getElementById('btnResetFilter');

  const sessionContent = document.getElementById('sessionContent');
  const toast = document.getElementById('toast');

  // --- Chrome Group Colors ---
  const CHROME_GROUP_COLORS = {
    grey: '#9aa0a6',
    blue: '#8ab4f8',
    red: '#f28b82',
    yellow: '#fdd663',
    green: '#81c995',
    pink: '#ff8bcb',
    purple: '#c58af9',
    cyan: '#78d9ec',
    orange: '#fcad70'
  };

  // --- State ---
  let liveSession = null;
  let savedSessions = [];
  let activeSession = null; // Either liveSession or a saved session
  let searchQuery = '';
  const collapsedGroups = new Set(); // Group keys collapsed by user
  const collapsedWindows = new Set(); // Window keys collapsed by user

  // --- Helpers ---
  function showToast(message, duration = 3000) {
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, duration);
  }

  function getFormattedNow() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `Сессия ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function extractDomain(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  function downloadJson(filename, jsonText) {
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- Status & Data Fetching ---
  async function checkWsStatus() {
    chrome.runtime.sendMessage({ action: 'get_status' }, (res) => {
      if (res && res.connected) {
        wsStatusBadge.classList.add('connected');
        wsStatusText.textContent = 'Connected';
      } else {
        wsStatusBadge.classList.remove('connected');
        wsStatusText.textContent = 'Offline';
      }
    });
  }

  async function fetchLiveSession() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'get_live_session' }, (res) => {
        if (res && res.success && res.result) {
          liveSession = res.result;
          liveWindowCountBadge.textContent = `${liveSession.windowCount} ок.`;
          liveTabCountBadge.textContent = `${liveSession.tabCount} вкл.`;
          liveGroupCountBadge.textContent = `${liveSession.groupCount} гр.`;
        }
        resolve(liveSession);
      });
    });
  }

  async function fetchSavedSessions() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'list_sessions' }, (res) => {
        if (res && res.success && Array.isArray(res.result)) {
          savedSessions = res.result;
          savedCountBadge.textContent = savedSessions.length;
        } else {
          savedSessions = [];
          savedCountBadge.textContent = '0';
        }
        resolve(savedSessions);
      });
    });
  }

  // --- Sessions Sorting State & Helper ---
  let currentSortOrder = localStorage.getItem('chrome_bridge_sort_order') || 'date_desc';

  if (sessionsSortSelect) {
    sessionsSortSelect.value = currentSortOrder;
    sessionsSortSelect.addEventListener('change', () => {
      currentSortOrder = sessionsSortSelect.value;
      localStorage.setItem('chrome_bridge_sort_order', currentSortOrder);
      renderSidebarSessions();
    });
  }

  if (btnClearSessions) {
    btnClearSessions.addEventListener('click', async () => {
      if (!savedSessions || savedSessions.length === 0) {
        showToast('Список сохранённых сессий уже пуст.');
        return;
      }
      const imported = savedSessions.filter(s => s && s.id && s.id.startsWith('sb_'));
      const native = savedSessions.filter(s => s && s.id && !s.id.startsWith('sb_'));

      if (imported.length > 0 && native.length > 0) {
        const choice = confirm(
          `Найдено:\n` +
          `• ${imported.length} импортированных сессий из Session Buddy\n` +
          `• ${native.length} ваших родных сессий Chrome Bridge\n\n` +
          `Нажмите «OK», чтобы удалить ТОЛЬКО сессии из Session Buddy (${imported.length} шт.), сохранив вашу родную сессию!\n\n` +
          `Нажмите «Отмена», чтобы отменить.`
        );
        if (!choice) return;

        await chrome.storage.local.set({ saved_sessions: native });
        savedSessions = native;
        showToast(`🧹 Удалено ${imported.length} сессий Session Buddy. Ваша родная сессия сохранена!`);
      } else {
        const count = savedSessions.length;
        const choice = confirm(`🗑️ Удалить все сохранённые сессии (${count} шт.)?`);
        if (!choice) return;

        await chrome.storage.local.set({ saved_sessions: [] });
        savedSessions = [];
        showToast(`История очищена.`);
      }

      if (activeSession && !activeSession.isLive && !savedSessions.find(s => s.id === activeSession.id)) {
        if (savedSessions.length > 0) {
          selectSession(savedSessions[0]);
        } else if (liveSession) {
          selectSession(liveSession);
        }
      }
      renderSidebarSessions();
    });
  }

  function getSortedSessions(sessionsList) {
    const list = [...(sessionsList || [])];
    switch (currentSortOrder) {
      case 'date_asc':
        return list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      case 'name_asc':
        return list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru', { numeric: true, sensitivity: 'base' }));
      case 'name_desc':
        return list.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'ru', { numeric: true, sensitivity: 'base' }));
      case 'tabs_desc':
        return list.sort((a, b) => (b.tabCount || 0) - (a.tabCount || 0));
      case 'tabs_asc':
        return list.sort((a, b) => (a.tabCount || 0) - (b.tabCount || 0));
      case 'date_desc':
      default:
        return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }
  }

  // --- Render Sidebar Saved Sessions ---
  function renderSidebarSessions() {
    if (savedSessions.length === 0) {
      savedSessionsList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 16px;">
          Нет сохранённых сессий.<br>Нажмите «Сохранить состояние».
        </div>
      `;
      savedCountBadge.textContent = '0';
      return;
    }

    savedCountBadge.textContent = savedSessions.length;
    const sorted = getSortedSessions(savedSessions);

    savedSessionsList.innerHTML = '';
    sorted.forEach((session) => {
      const isSelected = activeSession && activeSession.id === session.id;
      const card = document.createElement('div');
      card.className = `session-nav-item ${isSelected ? 'active' : ''}`;
      card.setAttribute('data-id', session.id);

      const sDate = new Date(session.timestamp || Date.now());
      const isCurrentYear = sDate.getFullYear() === new Date().getFullYear();
      const dateStr = sDate.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: isCurrentYear ? undefined : 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      card.innerHTML = `
        <div class="session-nav-icon">💾</div>
        <div class="session-nav-info">
          <div class="session-nav-title" title="${session.name}">${session.name}</div>
          <div class="session-nav-meta">
            <span class="session-nav-date">${dateStr}</span>
            <span class="meta-pill">${session.windowCount || 1} ок.</span>
            <span class="meta-pill">${session.tabCount || 0} вкл.</span>
            <span class="meta-pill">${session.groupCount || 0} гр.</span>
          </div>
        </div>
        <div class="session-nav-actions">
          <button class="btn-icon-mini btn-quick-restore" title="Восстановить сессию" data-id="${session.id}">⚡</button>
          <button class="btn-icon-mini btn-export-sidebar" title="Экспорт JSON" data-id="${session.id}">📥</button>
          <button class="btn-icon-mini btn-delete btn-delete-sidebar" title="Удалить" data-id="${session.id}">🗑️</button>
        </div>
      `;

      // Select session on card click
      card.addEventListener('click', (e) => {
        if (e.target.closest('.session-nav-actions')) return;
        selectSession(session);
      });

      // Quick Restore button
      card.querySelector('.btn-quick-restore').addEventListener('click', (e) => {
        e.stopPropagation();
        restoreFullSession(session);
      });

      // Export button
      card.querySelector('.btn-export-sidebar').addEventListener('click', (e) => {
        e.stopPropagation();
        exportSession(session);
      });

      // Delete button
      card.querySelector('.btn-delete-sidebar').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSession(session);
      });

      savedSessionsList.appendChild(card);
    });
  }

  // --- Select Active Session ---
  function selectSession(session) {
    activeSession = session;

    // Update active highlight in sidebar
    if (session.isLive) {
      liveSessionCard.classList.add('active');
      document.querySelectorAll('#savedSessionsList .session-nav-item').forEach(el => el.classList.remove('active'));
    } else {
      liveSessionCard.classList.remove('active');
      document.querySelectorAll('#savedSessionsList .session-nav-item').forEach(el => {
        if (el.getAttribute('data-id') === session.id) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      });
    }

    renderActiveSessionDetails();
  }

  // --- Render Active Session Details Panel ---
  function renderActiveSessionDetails() {
    if (!activeSession) return;

    // Header updates
    selectedSessionTitle.textContent = activeSession.name;
    if (activeSession.isLive) {
      selectedSessionTag.textContent = 'LIVE';
      selectedSessionTag.className = 'session-tag live';
      metaDate.textContent = 'Живое состояние браузера';
      btnSaveLiveAsNew.classList.remove('hidden');
      btnDeleteCurrent.classList.add('hidden');
      btnRefreshLive.classList.remove('hidden');
      btnRestoreAll.style.display = 'none'; // Already open
    } else {
      selectedSessionTag.textContent = 'SAVED';
      selectedSessionTag.className = 'session-tag saved';
      const dateStr = new Date(activeSession.timestamp).toLocaleString('ru-RU', {
        dateStyle: 'long',
        timeStyle: 'short'
      });
      metaDate.textContent = dateStr;
      btnSaveLiveAsNew.classList.add('hidden');
      btnDeleteCurrent.classList.remove('hidden');
      btnRefreshLive.classList.add('hidden');
      btnRestoreAll.style.display = 'inline-flex';
    }

    metaStats.textContent = `${activeSession.windowCount || 1} окон, ${activeSession.tabCount || 0} вкладок, ${activeSession.groupCount || 0} групп`;

    // Render Windows and Groups
    renderWindowsAndGroups();
  }

  // --- Render Windows and Groups with Search Filtering ---
  function renderWindowsAndGroups() {
    sessionContent.innerHTML = '';

    const filter = searchQuery.trim().toLowerCase();
    let totalMatches = 0;

    const windows = activeSession.data || [];

    if (windows.length === 0) {
      sessionContent.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 40px;">
          В этой сессии нет открытых окон или вкладок.
        </div>
      `;
      return;
    }

    windows.forEach((win, winIndex) => {
      const winTabs = win.tabs || [];
      const winGroups = win.groups || [];

      // Group tabs by groupId
      const groupedTabsMap = new Map();
      const ungroupedTabs = [];

      winTabs.forEach(tab => {
        if (tab.groupId && tab.groupId > 0) {
          if (!groupedTabsMap.has(tab.groupId)) {
            groupedTabsMap.set(tab.groupId, []);
          }
          groupedTabsMap.get(tab.groupId).push(tab);
        } else {
          ungroupedTabs.push(tab);
        }
      });

      // Filter tabs if search is active
      const matchesTab = (t) => {
        if (!filter) return true;
        const text = `${t.title || ''} ${t.url || ''}`.toLowerCase();
        return text.includes(filter);
      };

      const filteredUngrouped = ungroupedTabs.filter(matchesTab);
      let winMatchingTabsCount = filteredUngrouped.length;

      const filteredGroups = [];
      winGroups.forEach(g => {
        const tabsInGroup = groupedTabsMap.get(g.id) || [];
        const filteredGroupTabs = tabsInGroup.filter(matchesTab);
        if (filteredGroupTabs.length > 0 || !filter) {
          filteredGroups.push({
            groupDef: g,
            tabs: filteredGroupTabs
          });
          winMatchingTabsCount += filteredGroupTabs.length;
        }
      });

      // If search query is active and this window has 0 matching tabs, skip window
      if (filter && winMatchingTabsCount === 0) {
        return;
      }

      totalMatches += winMatchingTabsCount;

      // Create Window Card DOM
      const winKey = `${activeSession.id}_win_${winIndex}`;
      const isWinCollapsed = collapsedWindows.has(winKey);

      const winCard = document.createElement('div');
      winCard.className = `window-card ${isWinCollapsed ? 'collapsed' : ''}`;

      const winTitle = `Окно ${winIndex + 1}`;
      const winBadge = `${winTabs.length} вкладок, ${winGroups.length} групп`;

      winCard.innerHTML = `
        <div class="window-header" title="Кликните, чтобы свернуть/развернуть окно">
          <div class="window-title-group">
            <span class="window-toggle-arrow">▼</span>
            <span class="window-icon">🪟</span>
            <span class="window-title">${winTitle}</span>
            <span class="window-stats">(${winBadge})</span>
          </div>
          <button class="btn-mini-action btn-restore-window" data-win-idx="${winIndex}" title="Восстановить только это окно">
            ⚡ Восстановить окно
          </button>
        </div>
        <div class="window-body"></div>
      `;

      // Window collapse/expand toggle
      winCard.querySelector('.window-header').addEventListener('click', (e) => {
        if (e.target.closest('.btn-restore-window')) return;
        if (winCard.classList.contains('collapsed')) {
          winCard.classList.remove('collapsed');
          collapsedWindows.delete(winKey);
        } else {
          winCard.classList.add('collapsed');
          collapsedWindows.add(winKey);
        }
      });

      const winBody = winCard.querySelector('.window-body');

      // 1. Render Colored Tab Groups
      filteredGroups.forEach(({ groupDef, tabs }) => {
        const groupColor = (groupDef.color || 'grey').toLowerCase();
        const colorHex = CHROME_GROUP_COLORS[groupColor] || '#9aa0a6';
        const groupKey = `${activeSession.id}_win${winIndex}_grp${groupDef.id}`;
        const isCollapsed = collapsedGroups.has(groupKey) || (Boolean(groupDef.collapsed) && !collapsedGroups.has(`exp_${groupKey}`));

        const groupCard = document.createElement('div');
        groupCard.className = `tab-group-card color-${groupColor} ${isCollapsed ? 'collapsed' : ''}`;

        groupCard.innerHTML = `
          <div class="tab-group-header">
            <div class="tab-group-left">
              <span class="group-toggle-arrow">▼</span>
              <span class="group-color-chip" style="background: ${colorHex};"></span>
              <span class="group-title">${groupDef.title || 'Без названия'}</span>
              <span class="group-count">${tabs.length} вкл.</span>
            </div>
            <button class="btn-mini-action btn-restore-group" title="Восстановить только эту группу в текущее окно">
              ⚡ Восстановить группу
            </button>
          </div>
          <div class="tab-group-items"></div>
        `;

        // Toggle collapse/expand on header click
        groupCard.querySelector('.tab-group-header').addEventListener('click', (e) => {
          if (e.target.closest('.btn-restore-group')) return;
          if (groupCard.classList.contains('collapsed')) {
            groupCard.classList.remove('collapsed');
            collapsedGroups.delete(groupKey);
            collapsedGroups.add(`exp_${groupKey}`);
          } else {
            groupCard.classList.add('collapsed');
            collapsedGroups.add(groupKey);
            collapsedGroups.delete(`exp_${groupKey}`);
          }
        });

        // Restore single group button
        groupCard.querySelector('.btn-restore-group').addEventListener('click', (e) => {
          e.stopPropagation();
          restoreGroup(groupDef);
        });

        const groupItemsContainer = groupCard.querySelector('.tab-group-items');
        tabs.forEach(tab => {
          groupItemsContainer.appendChild(createTabItemElement(tab, {
            groupTitle: groupDef.title,
            groupColor,
            windowTitle: winTitle
          }));
        });

        winBody.appendChild(groupCard);
      });

      // 2. Render Ungrouped Tabs
      if (filteredUngrouped.length > 0) {
        const ungroupedCard = document.createElement('div');
        ungroupedCard.className = 'ungrouped-card';
        ungroupedCard.innerHTML = `
          <div class="ungrouped-title">Вне групп (${filteredUngrouped.length})</div>
        `;
        filteredUngrouped.forEach(tab => {
          ungroupedCard.appendChild(createTabItemElement(tab, {
            isUngrouped: true,
            windowTitle: winTitle
          }));
        });
        winBody.appendChild(ungroupedCard);
      }

      // Restore Window Handler
      winCard.querySelector('.btn-restore-window').addEventListener('click', () => {
        restoreWindow(winIndex);
      });

      sessionContent.appendChild(winCard);
    });

    // Update search banner visibility
    if (filter) {
      searchBanner.classList.remove('hidden');
      searchMatchCount.textContent = totalMatches;
      searchQueryText.textContent = filter;
    } else {
      searchBanner.classList.add('hidden');
    }
  }

  // ==========================================================================
  // TAB HOVER PREVIEW CONTROLLER (Glassmorphism & YouTube Posters)
  // ==========================================================================
  // ==========================================================================
  // TAB HOVER PREVIEW CONTROLLER (Glassmorphism & YouTube Posters)
  // ==========================================================================
  const tabHoverPreview = document.getElementById('tabHoverPreview');
  let hoverShowTimer = null;
  let hoverHideTimer = null;
  let isMouseOverCard = false;
  let activePreviewItem = null;
  const HOVER_SHOW_DELAY = 220; // 220ms delay prevents flickering
  const HOVER_HIDE_GRACE = 380; // 380ms grace period so cursor can smoothly transition into the card

  function extractYouTubeVideoId(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();

      if (host === 'youtube.com' || host === 'm.youtube.com') {
        if (u.pathname === '/watch') {
          return u.searchParams.get('v');
        }
        if (u.pathname.startsWith('/shorts/')) {
          const parts = u.pathname.split('/');
          return parts[2] || null;
        }
        if (u.pathname.startsWith('/embed/')) {
          const parts = u.pathname.split('/');
          return parts[2] || null;
        }
        if (u.pathname.startsWith('/live/')) {
          const parts = u.pathname.split('/');
          return parts[2] || null;
        }
      } else if (host === 'youtu.be') {
        const id = u.pathname.replace(/^\//, '').split(/[?#&]/)[0];
        return id || null;
      }
    } catch (e) {
      // Fallback regex
    }
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/))([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  function showTabHoverPreview(tab, context, itemEl) {
    if (!tabHoverPreview || !tab || !tab.url) return;

    activePreviewItem = itemEl;
    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }

    const domain = extractDomain(tab.url);
    const ytVideoId = extractYouTubeVideoId(tab.url);
    const faviconUrl = tab.favIconUrl || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : '');

    // Context badges
    let groupBadge = '';
    if (context && context.groupTitle) {
      const chipColor = CHROME_GROUP_COLORS[context.groupColor] || '#38bdf8';
      groupBadge = `
        <span class="hover-preview-pill pill-group" title="Группа вкладок Chrome">
          <span style="width: 7px; height: 7px; border-radius: 50%; background: ${chipColor}; display: inline-block;"></span>
          ${escapeHtml(context.groupTitle)}
        </span>
      `;
    } else if (context && context.isUngrouped) {
      groupBadge = `<span class="hover-preview-pill" title="Вне групп">Вне групп</span>`;
    }

    const pinnedBadge = tab.pinned ? `<span class="hover-preview-pill" title="Закреплённая вкладка">📌 Закреплена</span>` : '';
    const activeBadge = tab.active ? `<span class="hover-preview-pill pill-live" title="Активная вкладка">★ Активная</span>` : '';
    const winBadge = context?.windowTitle ? `<span class="hover-preview-pill" title="Окно Chrome">${escapeHtml(context.windowTitle)}</span>` : '';
    const sessionTypeBadge = activeSession?.isLive
      ? `<span class="hover-preview-pill pill-live" title="Текущая живая сессия">🟢 Live</span>`
      : `<span class="hover-preview-pill" title="Сохранённая сессия">💾 Сохранено</span>`;

    let mediaHtml = '';
    let headerHtml = '';
    let openBtnText = '<span>🌐</span> Открыть вкладку';

    if (ytVideoId) {
      openBtnText = '<span>▶</span> Смотреть видео';
      const posterUrl = `https://img.youtube.com/vi/${ytVideoId}/mqdefault.jpg`;
      mediaHtml = `
        <div class="hover-preview-media" title="Кликните, чтобы открыть видео в Chrome">
          <img src="${posterUrl}" alt="Превью YouTube" onerror="this.parentElement.style.display='none';">
          <div class="hover-preview-yt-badge">
            <span>▶</span> YouTube Video
          </div>
          <div class="hover-preview-play-icon">▶</div>
        </div>
      `;
    } else {
      const faviconImg = faviconUrl
        ? `<img src="${faviconUrl}" alt="" onerror="this.parentElement.textContent='🌐';">`
        : '🌐';
      headerHtml = `
        <div class="hover-preview-header-generic">
          <div class="hover-preview-favicon-box">
            ${faviconImg}
          </div>
          <div class="hover-preview-domain-info">
            <span class="hover-preview-domain">🔒 ${escapeHtml(domain || 'Веб-страница')}</span>
            <span class="hover-preview-domain-sub">Полное превью ссылки</span>
          </div>
        </div>
      `;
    }

    tabHoverPreview.innerHTML = `
      <button class="btn-preview-close" type="button" title="Закрыть превью">✕</button>
      ${mediaHtml}
      ${headerHtml}
      <div class="hover-preview-body">
        <div class="hover-preview-title">${escapeHtml(tab.title || tab.url || 'Без названия')}</div>
        <div class="hover-preview-url">${escapeHtml(tab.url)}</div>
        <div class="hover-preview-meta-row">
          ${sessionTypeBadge}
          ${winBadge}
          ${groupBadge}
          ${pinnedBadge}
          ${activeBadge}
        </div>
      </div>
      <div class="hover-preview-footer">
        <button class="btn-preview-open" type="button" title="Открыть в Chrome">
          ${openBtnText}
        </button>
        <button class="btn-preview-copy" type="button" title="Скопировать ссылку в буфер">
          <span>🔗</span> Скопировать ссылку
        </button>
      </div>
    `;

    // Connect Close Button
    const btnClose = tabHoverPreview.querySelector('.btn-preview-close');
    if (btnClose) {
      btnClose.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTabHoverPreview(true);
      });
    }

    // Connect Click on Media Poster
    const mediaEl = tabHoverPreview.querySelector('.hover-preview-media');
    if (mediaEl) {
      mediaEl.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.tabs.create({ url: tab.url, active: true });
        showToast(`Видео открыто → ${tab.title || domain}`);
        hideTabHoverPreview(true);
      });
    }

    // Connect Action Buttons in Hover Card
    tabHoverPreview.querySelector('.btn-preview-open').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.create({ url: tab.url, active: true });
      showToast(`Вкладка открыта → ${tab.title || domain}`);
      hideTabHoverPreview(true);
    });

    const btnCopy = tabHoverPreview.querySelector('.btn-preview-copy');
    btnCopy.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(tab.url);
      btnCopy.innerHTML = '<span>✓</span> Ссылка скопирована!';
      btnCopy.style.borderColor = 'var(--cyan-neon)';
      btnCopy.style.color = '#fff';
      showToast('URL скопирован в буфер обмена!');
      setTimeout(() => {
        if (btnCopy) {
          btnCopy.innerHTML = '<span>🔗</span> Скопировать ссылку';
          btnCopy.style.borderColor = '';
          btnCopy.style.color = '';
        }
      }, 1500);
    });

    // Positioning anchored directly to the tab item row
    const itemRect = itemEl ? itemEl.getBoundingClientRect() : { left: 100, right: 300, top: 100, bottom: 140 };
    const cardWidth = 380;
    const cardPadding = 16;

    // Horizontal: align slightly indented from tab start, clamped to window bounds
    let targetX = itemRect.left + 80;
    if (targetX + cardWidth > window.innerWidth - cardPadding) {
      targetX = window.innerWidth - cardWidth - cardPadding;
    }
    if (targetX < cardPadding) {
      targetX = cardPadding;
    }

    // Measure real height
    tabHoverPreview.style.left = `${Math.round(targetX)}px`;
    tabHoverPreview.style.top = '-9999px';
    tabHoverPreview.classList.remove('hidden');

    const cardHeight = tabHoverPreview.offsetHeight || 260;
    let targetY;

    // Check if fits below tab item
    if (itemRect.bottom + cardHeight + cardPadding <= window.innerHeight) {
      // Place right below tab item with tight 6px margin
      targetY = itemRect.bottom + 6;
    } else {
      // Place right above tab item with tight 6px margin
      targetY = itemRect.top - cardHeight - 6;
      if (targetY < cardPadding) {
        targetY = Math.max(cardPadding, window.innerHeight - cardHeight - cardPadding);
      }
    }

    tabHoverPreview.style.left = `${Math.round(targetX)}px`;
    tabHoverPreview.style.top = `${Math.round(targetY)}px`;
    tabHoverPreview.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => {
      tabHoverPreview.classList.add('visible');
    });
  }

  function hideTabHoverPreview(immediate = false) {
    if (hoverShowTimer) {
      clearTimeout(hoverShowTimer);
      hoverShowTimer = null;
    }
    if (!tabHoverPreview) return;

    if (immediate) {
      if (hoverHideTimer) {
        clearTimeout(hoverHideTimer);
        hoverHideTimer = null;
      }
      isMouseOverCard = false;
      activePreviewItem = null;
      tabHoverPreview.classList.remove('visible');
      tabHoverPreview.classList.add('hidden');
      tabHoverPreview.setAttribute('aria-hidden', 'true');
    } else {
      // Grace period: DO NOT remove .visible immediately!
      // This gives user 380ms to smoothly glide the mouse into the card.
      if (hoverHideTimer) clearTimeout(hoverHideTimer);
      hoverHideTimer = setTimeout(() => {
        if (!isMouseOverCard) {
          tabHoverPreview.classList.remove('visible');
          tabHoverPreview.classList.add('hidden');
          tabHoverPreview.setAttribute('aria-hidden', 'true');
          activePreviewItem = null;
        }
      }, HOVER_HIDE_GRACE);
    }
  }

  // Preview card interactive behavior
  if (tabHoverPreview) {
    tabHoverPreview.addEventListener('mouseenter', () => {
      isMouseOverCard = true;
      if (hoverHideTimer) {
        clearTimeout(hoverHideTimer);
        hoverHideTimer = null;
      }
    });

    tabHoverPreview.addEventListener('mouseleave', () => {
      isMouseOverCard = false;
      hideTabHoverPreview(false);
    });
  }

  // Auto-dismiss preview on scroll, window blur, or click outside
  sessionContent.addEventListener('scroll', () => hideTabHoverPreview(true), { passive: true });
  window.addEventListener('scroll', () => hideTabHoverPreview(true), { passive: true });
  window.addEventListener('blur', () => hideTabHoverPreview(true));
  document.addEventListener('click', (e) => {
    if (tabHoverPreview && !tabHoverPreview.contains(e.target) && !e.target.closest('.tab-item')) {
      hideTabHoverPreview(true);
    }
  });

  // --- Create Tab Item DOM Element (Surgical Click-to-Open + Hover Preview) ---
  function createTabItemElement(tab, context = {}) {
    const item = document.createElement('div');
    item.className = 'tab-item';

    const domain = extractDomain(tab.url);
    const faviconUrl = tab.favIconUrl || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '');

    const faviconHtml = faviconUrl
      ? `<img src="${faviconUrl}" alt="" onerror="this.src=''; this.parentElement.textContent='🌐'">`
      : '🌐';

    const pinnedBadge = tab.pinned ? '<span class="tab-badge pinned">📌 PIN</span>' : '';
    const activeBadge = tab.active ? '<span class="tab-badge active-badge">★ ACTIVE</span>' : '';

    item.innerHTML = `
      <div class="tab-favicon">${faviconHtml}</div>
      <div class="tab-details">
        <span class="tab-title">${escapeHtml(tab.title || tab.url || 'Новая вкладка')}</span>
        <span class="tab-domain">${escapeHtml(domain)}</span>
      </div>
      <div class="tab-badges-group">
        ${pinnedBadge}
        ${activeBadge}
        <button class="tab-hover-btn btn-copy-url" title="Скопировать ссылку">🔗</button>
      </div>
    `;

    item.addEventListener('mouseenter', (e) => {
      // If user is currently interacting with the open preview card, don't interrupt!
      if (isMouseOverCard) return;

      if (item === activePreviewItem) {
        // Re-entered the current item from nearby, keep card open!
        if (hoverHideTimer) {
          clearTimeout(hoverHideTimer);
          hoverHideTimer = null;
        }
        return;
      }

      if (hoverHideTimer) {
        clearTimeout(hoverHideTimer);
        hoverHideTimer = null;
      }

      if (hoverShowTimer) clearTimeout(hoverShowTimer);
      hoverShowTimer = setTimeout(() => {
        if (!isMouseOverCard) {
          showTabHoverPreview(tab, context, item);
        }
      }, HOVER_SHOW_DELAY);
    });

    item.addEventListener('mouseleave', () => {
      if (hoverShowTimer) {
        clearTimeout(hoverShowTimer);
        hoverShowTimer = null;
      }
      // Start grace countdown so user can move into the card!
      hideTabHoverPreview(false);
    });

    // Click handler: Point opening (opens ONLY this tab directly in Chrome!)
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-copy-url')) return;
      if (!tab.url) return;
      hideTabHoverPreview(true);
      chrome.tabs.create({ url: tab.url, active: true });
      showToast(`Вкладка открыта → ${tab.title || domain}`);
    });

    // Copy URL button
    const btnCopy = item.querySelector('.btn-copy-url');
    if (btnCopy) {
      btnCopy.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTabHoverPreview(true);
        if (tab.url) {
          navigator.clipboard.writeText(tab.url);
          showToast('URL скопирован в буфер обмена!');
        }
      });
    }

    return item;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Restoration Actions ---

  // 1. Restore entire session
  function restoreFullSession(session = activeSession) {
    if (!session) return;
    if (session.isLive) {
      showToast('Это живая сессия — все вкладки уже открыты в браузере.');
      return;
    }

    showToast(`Восстановление сессии «${session.name}»...`);
    chrome.runtime.sendMessage({
      action: 'restore_session',
      params: { sessionId: session.id }
    }, (res) => {
      if (res && res.success) {
        showToast(`✨ Сессия восстановлена! (${res.result.tabs_restored} вкл., ${res.result.groups_restored} групп)`);
        fetchLiveSession();
      } else {
        showToast(`Ошибка восстановления: ${res?.error || 'Неизвестная ошибка'}`);
      }
    });
  }

  // 2. Restore single window
  function restoreWindow(winIndex) {
    if (!activeSession) return;
    showToast(`Восстановление Окна #${winIndex + 1}...`);
    chrome.runtime.sendMessage({
      action: 'restore_session',
      params: {
        sessionId: activeSession.id,
        targetWindowIndex: winIndex
      }
    }, (res) => {
      if (res && res.success) {
        showToast(`✨ Окно #${winIndex + 1} успешно восстановлено!`);
        fetchLiveSession();
      } else {
        showToast(`Ошибка: ${res?.error || 'Не удалось восстановить окно'}`);
      }
    });
  }

  // 3. Restore single group
  function restoreGroup(groupDef) {
    if (!activeSession) return;
    showToast(`Восстановление группы «${groupDef.title || 'Группа'}»...`);
    chrome.runtime.sendMessage({
      action: 'restore_session',
      params: {
        sessionId: activeSession.id,
        targetGroupId: groupDef.id
      }
    }, (res) => {
      if (res && res.success) {
        showToast(`✨ Группа «${groupDef.title}» восстановлена в текущее окно!`);
        fetchLiveSession();
      } else {
        showToast(`Ошибка восстановления группы: ${res?.error || ''}`);
      }
    });
  }

  // --- Export & Delete Handlers ---

  function exportSession(session = activeSession) {
    if (!session) return;
    chrome.runtime.sendMessage({
      action: 'export_session_json',
      params: { sessionId: session.id }
    }, (res) => {
      if (res && res.success && res.result.json) {
        const safeName = session.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_');
        const filename = `chrome_session_${safeName}_${session.timestamp || Date.now()}.json`;
        downloadJson(filename, res.result.json);
        showToast('Сессия экспортирована в JSON файл →');
      } else {
        // Fallback for live session export
        const json = JSON.stringify(session, null, 2);
        downloadJson(`chrome_session_live_${Date.now()}.json`, json);
        showToast('Сессия экспортирована в JSON →');
      }
    });
  }

  function deleteSession(session = activeSession) {
    if (!session || session.isLive) return;
    if (!confirm(`Удалить сохранённую сессию «${session.name}»?`)) return;

    chrome.runtime.sendMessage({
      action: 'delete_session',
      params: { sessionId: session.id }
    }, async (res) => {
      if (res && res.success) {
        showToast(`Сессия «${session.name}» удалена.`);
        await fetchSavedSessions();
        renderSidebarSessions();
        selectSession(liveSession);
      } else {
        showToast(`Ошибка удаления: ${res?.error || ''}`);
      }
    });
  }

  // --- Search & Input Handlers ---
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    if (searchQuery) {
      btnClearSearch.classList.remove('hidden');
    } else {
      btnClearSearch.classList.add('hidden');
    }
    renderWindowsAndGroups();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    btnClearSearch.classList.add('hidden');
    renderWindowsAndGroups();
  });

  btnResetFilter.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    btnClearSearch.classList.add('hidden');
    renderWindowsAndGroups();
  });

  // --- Header Action Buttons ---
  btnRestoreAll.addEventListener('click', () => {
    restoreFullSession(activeSession);
  });

  btnExportCurrent.addEventListener('click', () => {
    exportSession(activeSession);
  });

  btnDeleteCurrent.addEventListener('click', () => {
    deleteSession(activeSession);
  });

  btnRefreshLive.addEventListener('click', async () => {
    btnRefreshLive.style.transform = 'rotate(360deg)';
    btnRefreshLive.style.transition = 'transform 0.5s ease';
    await fetchLiveSession();
    setTimeout(() => {
      btnRefreshLive.style.transform = '';
      btnRefreshLive.style.transition = '';
    }, 500);

    if (activeSession && activeSession.isLive) {
      selectSession(liveSession);
    }
    showToast('Живой список вкладок обновлен!');
  });

  // Save current live state as new saved session
  async function handleSaveCurrent() {
    const defaultName = getFormattedNow();
    const name = prompt('Введите название сессии:', defaultName);
    if (name === null) return; // User cancelled

    const finalName = name.trim() || defaultName;
    chrome.runtime.sendMessage({
      action: 'save_session',
      params: { name: finalName }
    }, async (res) => {
      if (res && res.success) {
        const saved = res.result;
        showToast(`Сессия «${saved.name}» сохранена (${saved.tabCount} вкл., ${saved.groupCount} групп)!`);
        await fetchSavedSessions();
        renderSidebarSessions();
        selectSession(saved);
      } else {
        showToast('Ошибка сохранения сессии.');
      }
    });
  }

  btnSaveCurrent.addEventListener('click', handleSaveCurrent);
  btnSaveLiveAsNew.addEventListener('click', handleSaveCurrent);

  // ==========================================================================
  // SESSION BUDDY OFFICIAL BACKUP IMPORT (nxs.json.v2)
  // Exact created timestamps (ms), collections -> folders -> links
  // ==========================================================================
  async function importSessionBuddyBackup(file) {
    let text;
    try {
      text = await file.text();
    } catch (e) {
      alert('Ошибка чтения файла: ' + e.message);
      return;
    }

    // Strip BOM if present
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      alert('Ошибка чтения JSON: ' + err.message);
      return;
    }

    // Поддерживаем официальный бэкап nxs.json.v2 (data.collections), прямой json.collections или массив
    const rawCollections = (json.data && Array.isArray(json.data.collections))
      ? json.data.collections
      : (Array.isArray(json.collections) ? json.collections : (Array.isArray(json) ? json : []));
    if (!rawCollections || !rawCollections.length) {
      alert('В файле не найдены коллекции Session Buddy.');
      return;
    }

    const CHROME_COLORS = ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'grey'];

    const importedSessions = rawCollections.map((col, idx) => {
      // 1. Точное время создания из бэкапа (если нет - берем Date.now())
      const createdAt = typeof col.created === 'number'
        ? col.created
        : (Date.parse(col.created) || (Date.now() - idx * 1000));

      const sessionTitle = col.title || ('Сессия от ' + new Date(createdAt).toLocaleDateString('ru-RU'));

      // 2. Окна и группы вкладок
      let totalTabs = 0;
      let totalGroups = 0;

      const windows = (col.folders || []).map((folder, fIdx) => {
        const hasGroupTitle = Boolean(folder.title && folder.title.trim());
        const groupId = hasGroupTitle ? (fIdx + 1) : -1;
        const color = CHROME_COLORS[fIdx % CHROME_COLORS.length];

        const tabs = (folder.links || []).map((link, lIdx) => {
          totalTabs++;
          return {
            id: lIdx + 1,
            index: lIdx,
            title: link.title || link.url || 'Вкладка без названия',
            url: link.url || '',
            favIconUrl: link.favIconUrl || '',
            pinned: Boolean(link.pinned),
            groupId: groupId
          };
        });

        const groups = hasGroupTitle ? [{
          id: groupId,
          title: folder.title.trim(),
          color: color,
          collapsed: false
        }] : [];

        if (hasGroupTitle) {
          totalGroups++;
        }

        return {
          windowId: fIdx + 1,
          focused: false,
          state: folder.state || 'normal',
          groups: groups,
          tabs: tabs
        };
      });

      // Если есть ссылки верхнего уровня вне папок
      if (Array.isArray(col.links) && col.links.length > 0) {
        const rootTabs = col.links.map((link, lIdx) => {
          totalTabs++;
          return {
            id: totalTabs,
            index: lIdx,
            title: link.title || link.url || 'Вкладка без названия',
            url: link.url || '',
            favIconUrl: link.favIconUrl || '',
            pinned: Boolean(link.pinned),
            groupId: -1
          };
        });
        windows.unshift({
          windowId: 0,
          focused: false,
          state: 'normal',
          groups: [],
          tabs: rootTabs
        });
      }

      return {
        id: col.id ? ('sb_' + col.id) : ('sb_' + createdAt + '_' + idx),
        name: sessionTitle,
        title: sessionTitle,
        timestamp: createdAt,
        createdAt: createdAt,
        windowCount: windows.length || 1,
        tabCount: totalTabs,
        groupCount: totalGroups,
        data: windows
      };
    });

    // 3. Сортируем: САМЫЕ СВЕЖИЕ СВЕРХУ (от новых к старым)
    importedSessions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // 4. Сохраняем в chrome.storage.local
    chrome.storage.local.get(['saved_sessions'], async (res) => {
      const existing = Array.isArray(res.saved_sessions) ? res.saved_sessions : [];

      // Предотвращаем дубли по id
      const existingIds = new Set(existing.map(s => s.id));
      const newUnique = importedSessions.filter(s => !existingIds.has(s.id));

      if (newUnique.length === 0) {
        showToast('Все сессии из этого бэкапа уже присутствуют в списке.');
        return;
      }

      const merged = [...newUnique, ...existing];
      // Общая сортировка по дате
      merged.sort((a, b) => (b.createdAt || b.timestamp || 0) - (a.createdAt || a.timestamp || 0));

      await chrome.storage.local.set({ saved_sessions: merged });

      await fetchSavedSessions();
      renderSidebarSessions();
      if (newUnique.length > 0) {
        selectSession(newUnique[0]);
      }

      showToast(`✨ Успешно импортировано ${newUnique.length} сессий из бэкапа Session Buddy!`, 4000);
      alert(`Успешно импортировано ${newUnique.length} сессий из Session Buddy!`);
    });
  }

  // --- Session Buddy Import Button Handler ---
  const importSessionBuddyBtn = document.getElementById('importSessionBuddyBtn');
  const sessionBuddyFileInput = document.getElementById('sessionBuddyFileInput');

  if (importSessionBuddyBtn && sessionBuddyFileInput) {
    importSessionBuddyBtn.addEventListener('click', () => {
      sessionBuddyFileInput.value = '';
      sessionBuddyFileInput.click();
    });

    sessionBuddyFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      await importSessionBuddyBackup(file);
    });
  }

  // Sidebar Import JSON file (with Session Buddy fallback)
  btnImportJson.addEventListener('click', () => {
    importFileInput.value = '';
    importFileInput.click();
  });

  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const jsonContent = event.target.result;
        const data = JSON.parse(jsonContent);

        // Smart check: If file is Session Buddy backup format, import directly!
        if (data && (data.collections || (data.data && data.data.collections) || data.sessions || (data.folders && !data.data))) {
          await importSessionBuddyBackup(file);
          return;
        }

        // Native session JSON import
        chrome.runtime.sendMessage({
          action: 'import_session_json',
          params: { json: jsonContent }
        }, async (res) => {
          if (res && res.success) {
            const imported = res.result.session;
            showToast(`Сессия «${imported.name}» успешно импортирована!`);
            await fetchSavedSessions();
            renderSidebarSessions();
            selectSession(imported);
          } else {
            showToast(`Ошибка импорта: ${res?.error || 'Неверный формат JSON'}`);
          }
        });
      } catch (err) {
        showToast(`Ошибка чтения файла: ${err.message}`);
      }
    };
    reader.readAsText(file);
  });

  // Live session card click in sidebar
  liveSessionCard.addEventListener('click', () => {
    if (liveSession) {
      selectSession(liveSession);
    }
  });

  // --- Sidebar Toggle and View Controls ---
  if (btnToggleSidebar) {
    btnToggleSidebar.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  }

  if (btnExpandAll) {
    btnExpandAll.addEventListener('click', () => {
      collapsedWindows.clear();
      collapsedGroups.clear();
      (activeSession?.data || []).forEach((win, winIndex) => {
        (win.groups || []).forEach(g => {
          const groupKey = `${activeSession.id}_win${winIndex}_grp${g.id}`;
          collapsedGroups.delete(groupKey);
          collapsedGroups.add(`exp_${groupKey}`);
        });
      });
      renderWindowsAndGroups();
      showToast('Все окна и группы развернуты');
    });
  }

  if (btnCollapseAll) {
    btnCollapseAll.addEventListener('click', () => {
      collapsedWindows.clear();
      collapsedGroups.clear();
      (activeSession?.data || []).forEach((win, winIndex) => {
        collapsedWindows.add(`${activeSession.id}_win_${winIndex}`);
        (win.groups || []).forEach(g => {
          const groupKey = `${activeSession.id}_win${winIndex}_grp${g.id}`;
          collapsedGroups.add(groupKey);
        });
      });
      renderWindowsAndGroups();
      showToast('Все окна и группы свернуты');
    });
  }

  // --- Keyboard Shortcuts ---
  document.addEventListener('keydown', (e) => {
    // Ctrl+B toggles sidebar
    if (e.ctrlKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      sidebar.classList.toggle('collapsed');
    }
    // '/' or Ctrl+F focuses search input
    if ((e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'f')) && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
    // Escape clears search
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.value = '';
      searchQuery = '';
      btnClearSearch.classList.add('hidden');
      renderWindowsAndGroups();
      searchInput.blur();
    }
  });

  // --- Initial Bootstrap ---
  checkWsStatus();
  await fetchLiveSession();
  await fetchSavedSessions();

  // Однократная очистка старой ошибочной истории Session Buddy (выполняется ровно 1 раз до нового импорта)
  if (!localStorage.getItem('chrome_bridge_old_sb_cleared_v2')) {
    const stored = await chrome.storage.local.get(['saved_sessions']);
    const allSaved = Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
    const nativeOnly = allSaved.filter(s => s && s.id && !s.id.startsWith('sb_'));
    const sbCount = allSaved.length - nativeOnly.length;
    if (sbCount > 0) {
      await chrome.storage.local.set({ saved_sessions: nativeOnly });
      savedSessions = nativeOnly;
      showToast(`🧹 Удалено ${sbCount} старых сессий Session Buddy. Ваша родная сессия сохранена!`, 4000);
    }
    localStorage.setItem('chrome_bridge_old_sb_cleared_v2', 'true');
  }

  renderSidebarSessions();

  // Select first saved session if exists, otherwise live session
  if (savedSessions.length > 0) {
    selectSession(savedSessions[0]);
  } else if (liveSession) {
    selectSession(liveSession);
  }
});

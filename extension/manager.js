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

  // --- Render Sidebar Saved Sessions ---
  function renderSidebarSessions() {
    if (savedSessions.length === 0) {
      savedSessionsList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 16px;">
          Нет сохранённых сессий.<br>Нажмите «Сохранить текущее состояние».
        </div>
      `;
      return;
    }

    savedSessionsList.innerHTML = '';
    savedSessions.forEach((session) => {
      const isSelected = activeSession && activeSession.id === session.id;
      const card = document.createElement('div');
      card.className = `session-nav-item ${isSelected ? 'active' : ''}`;
      card.setAttribute('data-id', session.id);

      const dateStr = new Date(session.timestamp).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
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
          groupItemsContainer.appendChild(createTabItemElement(tab));
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
          ungroupedCard.appendChild(createTabItemElement(tab));
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

  // --- Create Tab Item DOM Element (Killer Feature: Surgical Click-to-Open) ---
  function createTabItemElement(tab) {
    const item = document.createElement('div');
    item.className = 'tab-item';
    item.title = `Кликните, чтобы открыть в браузере:\n${tab.url}`;

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

    // Click handler: Point opening (opens ONLY this tab directly in Chrome!)
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-copy-url')) return;
      if (!tab.url) return;
      chrome.tabs.create({ url: tab.url, active: true });
      showToast(`Вкладка открыта → ${tab.title || domain}`);
    });

    // Copy URL button
    const btnCopy = item.querySelector('.btn-copy-url');
    if (btnCopy) {
      btnCopy.addEventListener('click', (e) => {
        e.stopPropagation();
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

  // Import JSON file
  btnImportJson.addEventListener('click', () => {
    importFileInput.value = '';
    importFileInput.click();
  });

  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const jsonContent = event.target.result;
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
  renderSidebarSessions();

  // Select live session by default on initial page load
  if (liveSession) {
    selectSession(liveSession);
  }
});

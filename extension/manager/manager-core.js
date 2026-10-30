/**
 * Chrome Agent Bridge — Manager Core
 * Shared state, DOM registry, utilities, and background messaging API.
 */

// Chrome native tab group color mapping
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

// Cached DOM Elements Registry
const DOM = {};

function initManagerDOM() {
  DOM.searchInput = document.getElementById('searchInput');
  DOM.btnClearSearch = document.getElementById('btnClearSearch');
  DOM.btnSaveCurrent = document.getElementById('btnSaveCurrent');
  DOM.btnImportJson = document.getElementById('btnImportJson');
  DOM.importFileInput = document.getElementById('importFileInput');

  DOM.liveSessionCard = document.getElementById('liveSessionCard');
  DOM.liveWindowCountBadge = document.getElementById('liveWindowCountBadge');
  DOM.liveTabCountBadge = document.getElementById('liveTabCountBadge');
  DOM.liveGroupCountBadge = document.getElementById('liveGroupCountBadge');
  DOM.savedCountBadge = document.getElementById('savedCountBadge');
  DOM.savedSessionsList = document.getElementById('savedSessionsList');
  DOM.sessionsSortSelect = document.getElementById('sessionsSortSelect');
  DOM.btnClearSessions = document.getElementById('btnClearSessions');

  DOM.sidebar = document.querySelector('.sidebar');
  DOM.btnToggleSidebar = document.getElementById('btnToggleSidebar');
  DOM.btnExpandAll = document.getElementById('btnExpandAll');
  DOM.btnCollapseAll = document.getElementById('btnCollapseAll');

  DOM.selectedSessionTitle = document.getElementById('selectedSessionTitle');
  DOM.sessionTitleInput = document.getElementById('sessionTitleInput');
  DOM.btnEditTitleDirect = document.getElementById('btnEditTitleDirect');
  DOM.btnRenameCurrent = document.getElementById('btnRenameCurrent');
  DOM.selectedSessionTag = document.getElementById('selectedSessionTag');
  DOM.metaDate = document.getElementById('metaDate');
  DOM.metaStats = document.getElementById('metaStats');

  DOM.btnRestoreAll = document.getElementById('btnRestoreAll');
  DOM.btnExportCurrent = document.getElementById('btnExportCurrent');
  DOM.btnSaveLiveAsNew = document.getElementById('btnSaveLiveAsNew');
  DOM.btnDeleteCurrent = document.getElementById('btnDeleteCurrent');
  DOM.btnRefreshLive = document.getElementById('btnRefreshLive');

  DOM.searchBanner = document.getElementById('searchBanner');
  DOM.searchBannerLabel = document.getElementById('searchBannerLabel');
  DOM.searchMatchCount = document.getElementById('searchMatchCount');
  DOM.searchQueryText = document.getElementById('searchQueryText');
  DOM.btnToggleShowAllInSession = document.getElementById('btnToggleShowAllInSession');
  DOM.toggleShowAllIcon = document.getElementById('toggleShowAllIcon');
  DOM.toggleShowAllText = document.getElementById('toggleShowAllText');
  DOM.btnResetFilter = document.getElementById('btnResetFilter');

  DOM.sessionContent = document.getElementById('sessionContent');
  DOM.toast = document.getElementById('toast');

  DOM.batchActionBar = document.getElementById('batchActionBar');
  DOM.batchSelectedSummary = document.getElementById('batchSelectedSummary');
  DOM.btnBatchYouTube = document.getElementById('btnBatchYouTube');
  DOM.batchYtCount = document.getElementById('batchYtCount');
  DOM.btnBatchRestore = document.getElementById('btnBatchRestore');
  DOM.btnBatchDelete = document.getElementById('btnBatchDelete');
  DOM.btnBatchClear = document.getElementById('btnBatchClear');

  DOM.tabHoverPreview = document.getElementById('tabHoverPreview');
  DOM.importSessionBuddyBtn = document.getElementById('importSessionBuddyBtn');
  DOM.sessionBuddyFileInput = document.getElementById('sessionBuddyFileInput');

  // YouTube Playlist Modal Elements
  DOM.ytPlaylistModal = document.getElementById('ytPlaylistModal');
  DOM.ytModalAccountName = document.getElementById('ytModalAccountName');
  DOM.btnYtModalClose = document.getElementById('btnYtModalClose');
  DOM.ytModalVideoCount = document.getElementById('ytModalVideoCount');
  DOM.ytPlaylistSelect = document.getElementById('ytPlaylistSelect');
  DOM.btnRefreshYtPlaylists = document.getElementById('btnRefreshYtPlaylists');
  DOM.ytPlaylistsLoading = document.getElementById('ytPlaylistsLoading');
  DOM.btnToggleCustomPlaylist = document.getElementById('btnToggleCustomPlaylist');
  DOM.ytCustomPlaylistContainer = document.getElementById('ytCustomPlaylistContainer');
  DOM.ytCustomPlaylistInput = document.getElementById('ytCustomPlaylistInput');
  DOM.ytModalStatusBox = document.getElementById('ytModalStatusBox');
  DOM.ytModalProgressBar = document.getElementById('ytModalProgressBar');
  DOM.ytModalProgressFill = document.getElementById('ytModalProgressFill');
  DOM.ytModalStatusText = document.getElementById('ytModalStatusText');
  DOM.btnYtModalCancel = document.getElementById('btnYtModalCancel');
  DOM.btnYtModalSubmit = document.getElementById('btnYtModalSubmit');
}

// Global Manager State
const ManagerState = {
  liveSession: null,
  savedSessions: [],
  activeSession: null,
  searchQuery: '',
  showAllInCurrentSession: false,
  isEditingTitle: false,
  collapsedGroups: new Set(),
  collapsedWindows: new Set(),
  selectedItems: {
    windows: new Set(),
    groups: new Set(),
    tabs: new Set()
  },
  currentSortOrder: localStorage.getItem('chrome_bridge_sort_order') || 'date_desc',
  ytModalVideos: [],
  cachedPlaylists: null,
  cachedYtAccount: null
};

// --- Utilities & Helpers ---

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return 'about:blank';
  const u = url.trim();
  if (u.startsWith('chrome://') || u.startsWith('chrome-extension://') || u.startsWith('edge://')) {
    return 'about:blank';
  }
  return u;
}

function getNoun(number, one, two, five) {
  let n = Math.abs(number);
  n %= 100;
  if (n >= 5 && n <= 20) return five;
  n %= 10;
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return two;
  return five;
}

function showToast(message, duration = 3000) {
  if (!DOM.toast) return;
  DOM.toast.textContent = message;
  DOM.toast.style.display = 'block';
  setTimeout(() => {
    if (DOM.toast) {
      DOM.toast.style.display = 'none';
    }
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlightQuery(text, query) {
  if (!text) return '';
  const safeText = String(text);
  if (!query || !query.trim()) return escapeHtml(safeText);
  const q = query.trim();
  const escaped = escapeHtml(safeText);
  const escapedQuery = escapeHtml(q);
  const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function getSessionMatchStats(session, queryLower) {
  if (!session) return { matches: 0, hasMatch: false, titleMatch: false };
  if (!queryLower || !queryLower.trim()) return { matches: 0, hasMatch: true, titleMatch: false };

  const q = queryLower.trim().toLowerCase();
  const nameMatch = (session.name || session.title || '').toLowerCase().includes(q);
  let tabMatches = 0;

  const windows = session.data || [];
  for (const win of windows) {
    const winNameMatch = (win.name || win.title || '').toLowerCase().includes(q);
    if (winNameMatch) {
      tabMatches++;
    }
    for (const t of (win.tabs || [])) {
      const text = `${t.title || ''} ${t.url || ''}`.toLowerCase();
      if (text.includes(q)) {
        tabMatches++;
      }
    }
    for (const g of (win.groups || [])) {
      if ((g.title || '').toLowerCase().includes(q)) {
        tabMatches++;
      }
    }
  }

  return {
    matches: tabMatches,
    titleMatch: nameMatch,
    hasMatch: nameMatch || (tabMatches > 0)
  };
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

function getSortedSessions(sessionsList, sortOrder = ManagerState.currentSortOrder) {
  const list = [...(sessionsList || [])];
  switch (sortOrder) {
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

// --- Data Fetching & Storage Operations ---

async function fetchLiveSession() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'get_live_session' }, (res) => {
      if (res && res.success && res.result) {
        ManagerState.liveSession = res.result;
        if (DOM.liveWindowCountBadge) DOM.liveWindowCountBadge.textContent = `${ManagerState.liveSession.windowCount} ок.`;
        if (DOM.liveTabCountBadge) DOM.liveTabCountBadge.textContent = `${ManagerState.liveSession.tabCount} вкл.`;
        if (DOM.liveGroupCountBadge) DOM.liveGroupCountBadge.textContent = `${ManagerState.liveSession.groupCount} гр.`;
      }
      resolve(ManagerState.liveSession);
    });
  });
}

async function fetchSavedSessions() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'list_sessions' }, (res) => {
      if (res && res.success && Array.isArray(res.result)) {
        ManagerState.savedSessions = res.result;
        if (DOM.savedCountBadge) DOM.savedCountBadge.textContent = ManagerState.savedSessions.length;
      } else {
        ManagerState.savedSessions = [];
        if (DOM.savedCountBadge) DOM.savedCountBadge.textContent = '0';
      }
      resolve(ManagerState.savedSessions);
    });
  });
}

async function persistUpdatedSavedSession(updatedSession) {
  if (!updatedSession || updatedSession.isLive) return;

  // 1. Очищаем окна без вкладок
  updatedSession.data = (updatedSession.data || []).filter(win => {
    return Array.isArray(win.tabs) && win.tabs.length > 0;
  });

  // 2. Очищаем группы, в которых не осталось вкладок
  for (const win of updatedSession.data) {
    const validGroupIds = new Set(
      (win.tabs || [])
        .map(t => t.groupId)
        .filter(gid => gid !== undefined && gid !== null && gid > 0)
    );
    win.groups = (win.groups || []).filter(g => validGroupIds.has(g.id));
  }

  // 3. Пересчитываем статистику
  let tabCount = 0;
  let groupCount = 0;
  for (const win of updatedSession.data) {
    tabCount += (win.tabs || []).length;
    groupCount += (win.groups || []).length;
  }
  updatedSession.windowCount = updatedSession.data.length;
  updatedSession.tabCount = tabCount;
  updatedSession.groupCount = groupCount;

  // 4. Если в сессии вообще не осталось окон/вкладок
  if (updatedSession.windowCount === 0) {
    const shouldDelete = confirm(`В сессии «${updatedSession.name}» не осталось окон и вкладок. Удалить эту сессию целиком?`);
    if (shouldDelete) {
      deleteSession(updatedSession);
      return;
    }
  }

  // 5. Записываем в chrome.storage.local
  const stored = await chrome.storage.local.get(['saved_sessions']);
  let list = Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
  const idx = list.findIndex(s => s.id === updatedSession.id);
  if (idx !== -1) {
    list[idx] = updatedSession;
  } else {
    list.unshift(updatedSession);
  }
  await chrome.storage.local.set({ saved_sessions: list });

  // 6. Обновляем память
  ManagerState.savedSessions = list;
  if (ManagerState.activeSession && ManagerState.activeSession.id === updatedSession.id) {
    ManagerState.activeSession = updatedSession;
  }

  // 7. Сбрасываем выделение и обновляем UI
  clearSelection();
  renderSidebarSessions();
  renderActiveSessionDetails();
}

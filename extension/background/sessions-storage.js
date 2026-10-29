/**
 * Chrome Agent Bridge - Sessions & Storage Manager
 * Handles live session capture, saving, listing, renaming, updating,
 * deleting, restoring (full, window, or group), and JSON export/import.
 */

const VALID_CHROME_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

function formatDefaultSessionName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const min = pad(now.getMinutes());
  return `Сессия ${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return 'about:blank';
  const trimmed = url.trim();
  if (!trimmed || trimmed === 'about:blank') return 'about:blank';
  if (trimmed.startsWith('chrome://') || trimmed.startsWith('chrome-extension://') || trimmed.startsWith('edge://')) {
    return 'about:blank';
  }
  return trimmed;
}

/**
 * Capture full live session data (all windows, tabs, tab groups)
 */
async function getLiveSession() {
  const windows = await chrome.windows.getAll({ populate: true });
  let allGroups = [];
  try {
    allGroups = await chrome.tabGroups.query({});
  } catch (e) {
    allGroups = [];
  }

  const groupsByWin = new Map();
  for (const g of allGroups) {
    if (!groupsByWin.has(g.windowId)) {
      groupsByWin.set(g.windowId, []);
    }
    const color = (g.color || '').toLowerCase();
    groupsByWin.get(g.windowId).push({
      id: g.id,
      title: g.title || '',
      color: VALID_CHROME_COLORS.includes(color) ? color : 'grey',
      collapsed: Boolean(g.collapsed)
    });
  }

  let totalTabs = 0;
  let totalGroups = 0;
  const windowData = [];

  for (const win of windows) {
    const rawTabs = win.tabs || [];
    const tabs = rawTabs.map(t => ({
      id: t.id,
      url: t.url || t.pendingUrl || '',
      title: t.title || '',
      favIconUrl: t.favIconUrl || '',
      pinned: Boolean(t.pinned),
      index: t.index,
      active: Boolean(t.active),
      groupId: (t.groupId !== undefined && t.groupId > 0) ? t.groupId : null
    }));
    totalTabs += tabs.length;

    const winGroups = groupsByWin.get(win.id) || [];
    totalGroups += winGroups.length;

    windowData.push({
      windowId: win.id,
      focused: Boolean(win.focused),
      tabs: tabs,
      groups: winGroups
    });
  }

  return {
    id: 'live_session',
    name: 'Текущие открытые вкладки',
    timestamp: Date.now(),
    isLive: true,
    windowCount: windowData.length,
    tabCount: totalTabs,
    groupCount: totalGroups,
    data: windowData
  };
}

/**
 * Save current live session to storage
 */
async function saveSession(name) {
  const live = await getLiveSession();

  const sessionObj = {
    id: 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    name: (name && typeof name === 'string' && name.trim()) ? name.trim() : formatDefaultSessionName(),
    timestamp: Date.now(),
    windowCount: live.windowCount,
    tabCount: live.tabCount,
    groupCount: live.groupCount,
    data: live.data
  };

  const stored = await chrome.storage.local.get(['saved_sessions']);
  const list = Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
  list.unshift(sessionObj);
  await chrome.storage.local.set({ saved_sessions: list });

  return sessionObj;
}

/**
 * List all saved sessions from storage
 */
async function listSessions() {
  const stored = await chrome.storage.local.get(['saved_sessions']);
  return Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
}

/**
 * Delete a session by ID
 */
async function deleteSession(sessionId) {
  const stored = await chrome.storage.local.get(['saved_sessions']);
  const list = Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
  const filtered = list.filter(s => s.id !== sessionId);
  await chrome.storage.local.set({ saved_sessions: filtered });
  return { success: true, deleted_id: sessionId, remaining_count: filtered.length };
}

/**
 * Rename a saved session
 */
async function renameSession(sessionId, newName) {
  if (!newName || typeof newName !== 'string' || !newName.trim()) {
    throw new Error('Имя сессии не может быть пустым.');
  }
  const cleanName = newName.trim();
  const stored = await chrome.storage.local.get(['saved_sessions']);
  const list = Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
  const session = list.find(s => s.id === sessionId);
  if (!session) {
    throw new Error(`Сессия с ID '${sessionId}' не найдена.`);
  }
  session.name = cleanName;
  session.title = cleanName;
  await chrome.storage.local.set({ saved_sessions: list });
  return { success: true, session: session };
}

/**
 * Update an existing session's full structure (windows, groups, tabs)
 */
async function updateSession(sessionObj) {
  if (!sessionObj || !sessionObj.id) {
    throw new Error('Некорректные данные сессии для обновления.');
  }
  const stored = await chrome.storage.local.get(['saved_sessions']);
  const list = Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
  const idx = list.findIndex(s => s.id === sessionObj.id);
  if (idx !== -1) {
    list[idx] = sessionObj;
  } else {
    list.unshift(sessionObj);
  }
  await chrome.storage.local.set({ saved_sessions: list });
  return { success: true, session: sessionObj };
}

/**
 * Restore an entire session, a single window, or a specific tab group
 */
async function restoreSession(sessionId, targetGroupId = null, options = {}) {
  const stored = await chrome.storage.local.get(['saved_sessions']);
  const list = Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
  const session = list.find(s => s.id === sessionId);

  if (!session) {
    throw new Error(`Сессия с ID '${sessionId}' не найдена.`);
  }

  // Restore single group mode
  if (targetGroupId !== null && targetGroupId !== undefined) {
    let targetGroup = null;
    let targetTabs = [];

    for (const win of session.data || []) {
      const g = (win.groups || []).find(grp => String(grp.id) === String(targetGroupId) || (grp.title && grp.title === targetGroupId));
      if (g) {
        targetGroup = g;
        targetTabs = (win.tabs || []).filter(t => String(t.groupId) === String(g.id));
        break;
      }
    }

    if (!targetGroup) {
      throw new Error(`Группа '${targetGroupId}' не найдена в сессии.`);
    }

    if (targetTabs.length === 0) {
      throw new Error(`В группе '${targetGroup.title}' нет сохраненных вкладок.`);
    }

    // Restore group into current focused window
    let currentWin;
    try {
      currentWin = await chrome.windows.getLastFocused();
    } catch (e) {
      const wins = await chrome.windows.getAll();
      currentWin = wins[0];
    }
    if (!currentWin) {
      currentWin = await chrome.windows.create({ focused: true });
    }

    const createdTabIds = [];
    for (const t of targetTabs) {
      try {
        const newTab = await chrome.tabs.create({
          windowId: currentWin.id,
          url: sanitizeUrl(t.url),
          active: false
        });
        createdTabIds.push(newTab.id);
      } catch (err) {
        try {
          const fallbackTab = await chrome.tabs.create({
            windowId: currentWin.id,
            url: 'about:blank',
            active: false
          });
          createdTabIds.push(fallbackTab.id);
        } catch (e2) {}
      }
    }

    if (createdTabIds.length > 0) {
      const newGroupId = await chrome.tabs.group({
        tabIds: createdTabIds,
        createProperties: { windowId: currentWin.id }
      });
      const validColor = VALID_CHROME_COLORS.includes(targetGroup.color) ? targetGroup.color : 'blue';
      await chrome.tabGroups.update(newGroupId, {
        title: targetGroup.title || '',
        color: validColor,
        collapsed: Boolean(targetGroup.collapsed)
      });
    }

    return {
      success: true,
      mode: 'single_group',
      group_title: targetGroup.title,
      tabs_restored: createdTabIds.length,
      window_id: currentWin.id
    };
  }

  // Check if restoring a specific single window
  const winIndex = options && (options.targetWindowIndex !== undefined ? options.targetWindowIndex : options.windowIndex);
  const windowsToProcess = (winIndex !== undefined && winIndex !== null && session.data && session.data[winIndex])
    ? [session.data[winIndex]]
    : (session.data || []);

  let totalWindowsRestored = 0;
  let totalTabsRestored = 0;
  let totalGroupsRestored = 0;

  for (const winData of windowsToProcess) {
    const tabs = winData.tabs || [];
    if (tabs.length === 0) continue;

    // 1. Create window with first tab
    const firstTab = tabs[0];
    let newWin;
    try {
      newWin = await chrome.windows.create({
        url: sanitizeUrl(firstTab.url),
        focused: Boolean(winData.focused)
      });
    } catch (e) {
      newWin = await chrome.windows.create({
        url: 'about:blank',
        focused: Boolean(winData.focused)
      });
    }

    const firstTabId = newWin.tabs && newWin.tabs[0] ? newWin.tabs[0].id : null;
    if (firstTab.pinned && firstTabId) {
      try {
        await chrome.tabs.update(firstTabId, { pinned: true });
      } catch (e) {}
    }

    const createdRecords = [{ savedTab: firstTab, tabId: firstTabId }];

    // 2. Create remaining tabs in window
    for (let i = 1; i < tabs.length; i++) {
      const t = tabs[i];
      let crTab = null;
      try {
        crTab = await chrome.tabs.create({
          windowId: newWin.id,
          url: sanitizeUrl(t.url),
          pinned: Boolean(t.pinned)
        });
      } catch (err) {
        try {
          crTab = await chrome.tabs.create({
            windowId: newWin.id,
            url: 'about:blank',
            pinned: Boolean(t.pinned)
          });
        } catch (e2) {}
      }
      if (crTab) {
        createdRecords.push({ savedTab: t, tabId: crTab.id });
      }
    }

    totalWindowsRestored++;
    totalTabsRestored += createdRecords.length;

    // 3. Recreate tab groups in this window
    for (const gDef of winData.groups || []) {
      const tabIdsInGroup = createdRecords
        .filter(rec => rec.tabId && rec.savedTab.groupId !== null && String(rec.savedTab.groupId) === String(gDef.id) && !rec.savedTab.pinned)
        .map(rec => rec.tabId);

      if (tabIdsInGroup.length > 0) {
        try {
          const newGroupId = await chrome.tabs.group({
            tabIds: tabIdsInGroup,
            createProperties: { windowId: newWin.id }
          });
          const color = VALID_CHROME_COLORS.includes(gDef.color) ? gDef.color : 'grey';
          await chrome.tabGroups.update(newGroupId, {
            title: gDef.title || '',
            color: color,
            collapsed: Boolean(gDef.collapsed)
          });
          totalGroupsRestored++;
        } catch (grpErr) {
          // Ignore individual group creation failure
        }
      }
    }
  }

  return {
    success: true,
    mode: (winIndex !== undefined && winIndex !== null) ? 'single_window' : 'full_session',
    session_id: session.id,
    session_name: session.name,
    windows_restored: totalWindowsRestored,
    tabs_restored: totalTabsRestored,
    groups_restored: totalGroupsRestored
  };
}

/**
 * Export session to JSON format
 */
async function exportSessionJson(sessionId) {
  const stored = await chrome.storage.local.get(['saved_sessions']);
  const list = Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
  const session = list.find(s => s.id === sessionId);
  if (!session) {
    throw new Error(`Сессия с ID '${sessionId}' не найдена.`);
  }
  return {
    session: session,
    json: JSON.stringify(session, null, 2)
  };
}

/**
 * Import session from JSON string or object
 */
async function importSessionJson(rawInput) {
  let sessionData = rawInput;
  if (typeof rawInput === 'string') {
    try {
      sessionData = JSON.parse(rawInput);
    } catch (e) {
      throw new Error('Некорректный JSON файл сессии: ' + e.message);
    }
  }

  if (!sessionData || typeof sessionData !== 'object') {
    throw new Error('Данные сессии должны быть объектом JSON.');
  }

  const sessionObj = sessionData.session || sessionData;

  if (!sessionObj.data || !Array.isArray(sessionObj.data)) {
    throw new Error('В файле отсутствует поле "data" со списком окон и вкладок.');
  }

  let tabCount = 0;
  let groupCount = 0;
  for (const win of sessionObj.data) {
    tabCount += (win.tabs || []).length;
    groupCount += (win.groups || []).length;
  }

  const importedSession = {
    id: 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    name: sessionObj.name || formatDefaultSessionName(),
    timestamp: sessionObj.timestamp || Date.now(),
    windowCount: sessionObj.data.length,
    tabCount: tabCount,
    groupCount: groupCount,
    data: sessionObj.data
  };

  const stored = await chrome.storage.local.get(['saved_sessions']);
  const list = Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
  list.unshift(importedSession);
  await chrome.storage.local.set({ saved_sessions: list });

  return {
    success: true,
    session: importedSession
  };
}

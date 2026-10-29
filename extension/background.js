/**
 * Chrome Agent Bridge - Background Service Worker (Manifest V3)
 * Pure Offline & Autonomous Session Manager (0% CPU footprint when idle).
 */

// Update tab count in chrome.storage for popup UI
async function updateTabCount() {
  try {
    const tabs = await chrome.tabs.query({});
    await chrome.storage.local.set({
      tab_count: tabs.length,
      last_updated: Date.now()
    });
  } catch (e) {
    // Ignore context invalidation
  }
}

/**
 * Apply Custom Tab Layout
 * Pure executor: moves tabs to designated windows and creates styled Chrome tab groups.
 */
async function applyLayout(groups, closeEmptyWindows = true) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return { success: true, windows_count: 0, groups_created: 0, groups: [] };
  }

  const allTabs = await chrome.tabs.query({});
  const allTabsMap = new Map(allTabs.map(t => [t.id, t]));
  const existingWindows = await chrome.windows.getAll();
  const existingWinIds = new Set(existingWindows.map(w => w.id));

  // 1. Identify distinct requested window keys
  const uniqueWinKeys = [];
  for (const g of groups) {
    const wKey = g.window_id !== undefined ? g.window_id : 1;
    if (!uniqueWinKeys.includes(wKey)) {
      uniqueWinKeys.push(wKey);
    }
  }

  // 2. Map requested window keys to real Chrome window IDs
  const winKeyToRealId = new Map();
  const usedRealWinIds = new Set();

  // First pass: match actual window IDs if passed
  for (const wKey of uniqueWinKeys) {
    if (typeof wKey === 'number' && existingWinIds.has(wKey) && !usedRealWinIds.has(wKey)) {
      winKeyToRealId.set(wKey, wKey);
      usedRealWinIds.add(wKey);
    }
  }

  // Second pass: reuse unused existing windows
  for (const wKey of uniqueWinKeys) {
    if (!winKeyToRealId.has(wKey)) {
      const unused = existingWindows.find(w => !usedRealWinIds.has(w.id));
      if (unused) {
        winKeyToRealId.set(wKey, unused.id);
        usedRealWinIds.add(unused.id);
      }
    }
  }

  // Third pass: create new window(s) if more windows requested than exist
  for (const wKey of uniqueWinKeys) {
    if (!winKeyToRealId.has(wKey)) {
      const groupForWin = groups.find(g => (g.window_id !== undefined ? g.window_id : 1) === wKey);
      const firstTabId = groupForWin && Array.isArray(groupForWin.tab_ids)
        ? groupForWin.tab_ids.find(id => allTabsMap.has(Number(id)))
        : null;

      if (firstTabId) {
        const newWin = await chrome.windows.create({ tabId: Number(firstTabId), focused: false });
        winKeyToRealId.set(wKey, newWin.id);
        usedRealWinIds.add(newWin.id);
      } else {
        const newWin = await chrome.windows.create({ focused: false });
        winKeyToRealId.set(wKey, newWin.id);
        usedRealWinIds.add(newWin.id);
      }
    }
  }

  // 3. Reset existing groups for moving tabs to prevent group collisions
  const targetTabIds = groups
    .flatMap(g => Array.isArray(g.tab_ids) ? g.tab_ids.map(Number) : [])
    .filter(id => allTabsMap.has(id));

  if (targetTabIds.length > 0) {
    try {
      await chrome.tabs.ungroup(targetTabIds);
    } catch (e) {
      for (const tid of targetTabIds) {
        try { await chrome.tabs.ungroup(tid); } catch (err) {}
      }
    }
  }

  // 4. Move tabs into their target window
  for (const g of groups) {
    const wKey = g.window_id !== undefined ? g.window_id : 1;
    const targetWinId = winKeyToRealId.get(wKey);
    if (!targetWinId) continue;

    const tabIds = (g.tab_ids || []).map(Number).filter(id => allTabsMap.has(id));
    const currentTabs = await chrome.tabs.query({});
    const curTabMap = new Map(currentTabs.map(t => [t.id, t]));
    const toMove = tabIds.filter(id => {
      const t = curTabMap.get(id);
      return t && t.windowId !== targetWinId;
    });

    if (toMove.length > 0) {
      try {
        await chrome.tabs.move(toMove, { windowId: targetWinId, index: -1 });
      } catch (e) {
        for (const tid of toMove) {
          try { await chrome.tabs.move(tid, { windowId: targetWinId, index: -1 }); } catch (err) {}
        }
      }
    }
  }

  // 5. Create Chrome Tab Groups in each target window
  const validColors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  const createdSummary = [];

  for (const g of groups) {
    const wKey = g.window_id !== undefined ? g.window_id : 1;
    const targetWinId = winKeyToRealId.get(wKey);
    if (!targetWinId) continue;

    const currentTabs = await chrome.tabs.query({ windowId: targetWinId });
    const curWinTabIds = new Set(currentTabs.map(t => t.id));
    const tabMap = new Map(currentTabs.map(t => [t.id, t]));

    // Exclude pinned tabs (pinned tabs cannot belong to Chrome tab groups)
    const groupableIds = (g.tab_ids || []).map(Number)
      .filter(id => curWinTabIds.has(id))
      .filter(id => {
        const t = tabMap.get(id);
        return t && !t.pinned;
      });

    if (groupableIds.length > 0) {
      try {
        const groupId = await chrome.tabs.group({
          tabIds: groupableIds,
          createProperties: { windowId: targetWinId }
        });
        const rawColor = (g.color || '').toLowerCase();
        const color = validColors.includes(rawColor) ? rawColor : 'blue';
        await chrome.tabGroups.update(groupId, {
          title: g.title || '',
          color: color
        });
        createdSummary.push({
          groupId: groupId,
          title: g.title || '',
          color: color,
          count: groupableIds.length,
          windowId: targetWinId
        });
      } catch (err) {
        // Skip group creation error for this specific group
      }
    }
  }

  // 6. Close redundant empty windows
  if (closeEmptyWindows !== false) {
    const finalWindows = await chrome.windows.getAll({ populate: true });
    for (const win of finalWindows) {
      if (!usedRealWinIds.has(win.id)) {
        try {
          await chrome.windows.remove(win.id);
        } catch (e) {}
      }
    }
  }

  return {
    success: true,
    windows_count: usedRealWinIds.size,
    groups_created: createdSummary.length,
    groups: createdSummary
  };
}

/**
 * Session Manager with Native Chrome Tab Groups Support
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

// 1. Build Live Session Data Helper
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

// 2. Save Session
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

// 3. List Sessions
async function listSessions() {
  const stored = await chrome.storage.local.get(['saved_sessions']);
  return Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
}

// 4. Delete Session
async function deleteSession(sessionId) {
  const stored = await chrome.storage.local.get(['saved_sessions']);
  const list = Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
  const filtered = list.filter(s => s.id !== sessionId);
  await chrome.storage.local.set({ saved_sessions: filtered });
  return { success: true, deleted_id: sessionId, remaining_count: filtered.length };
}

// 4.1. Rename Session
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

// 4.2. Update Existing Session (windows, groups, tabs)
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

// 5. Restore Session, Single Window, or Single Group
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

// 6. Open Full-screen Manager Tab
function openManagerTab() {
  const managerUrl = chrome.runtime.getURL('manager.html');
  chrome.tabs.query({}, (tabs) => {
    const existing = (tabs || []).find(t => t.url && t.url.includes('manager.html'));
    if (existing) {
      chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId) {
        chrome.windows.update(existing.windowId, { focused: true });
      }
    } else {
      chrome.tabs.create({ url: managerUrl });
    }
  });
}

// 7. Export Session JSON
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

// 6. Import Session JSON
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

// 7. Add Video to YouTube "Watch Later" (InnerTube API)
async function addVideoToYouTubeWatchLater(videoId, preferredTabId) {
  if (!videoId || typeof videoId !== 'string') {
    throw new Error('ID видео YouTube не указан.');
  }

  const cleanVideoId = videoId.trim();

  // Pick target YouTube tab: first check preferredTabId, then any open YouTube tab
  let targetTab = null;
  if (typeof preferredTabId === 'number') {
    try {
      const t = await chrome.tabs.get(preferredTabId);
      if (t && t.url && t.url.includes('youtube.com') && !t.discarded) {
        targetTab = t;
      }
    } catch (e) {
      // Tab not found or closed
    }
  }

  if (!targetTab) {
    const ytTabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    targetTab = ytTabs.find(t => !t.discarded && t.status === 'complete')
             || ytTabs.find(t => !t.discarded)
             || ytTabs[0];
  }

  let createdTempTab = false;
  if (!targetTab) {
    // If no YouTube tab is open, open a lightweight background tab to access YouTube origin
    try {
      targetTab = await chrome.tabs.create({ url: 'https://www.youtube.com/robots.txt', active: false });
      createdTempTab = true;
      await new Promise(r => setTimeout(r, 600));
    } catch (createErr) {
      console.warn('Could not create temp YouTube tab:', createErr);
    }
  }

  if (!targetTab || !targetTab.id) {
    throw new Error('Не удалось найти или открыть вкладку YouTube для авторизованного запроса.');
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      world: 'MAIN',
      func: async (vId) => {
        try {
          // 1. Extract SAPISID or __Secure-3PAPISID from document.cookie
          function getSapisid() {
            const match = document.cookie.match(/(?:^|;\s*)(?:__Secure-3P|__Secure-1P)?SAPISID=([^;]+)/);
            if (match) return match[1];
            const cookies = document.cookie.split('; ');
            for (const c of cookies) {
              if (c.startsWith('SAPISID=')) return c.substring(8);
              if (c.startsWith('__Secure-3PAPISID=')) return c.substring(18);
            }
            return null;
          }

          const sapisid = getSapisid();
          if (!sapisid) {
            return {
              success: false,
              error: 'Вы не авторизованы на YouTube. Войдите в свой аккаунт на youtube.com.'
            };
          }

          // 2. Compute SAPISIDHASH (Date.now() in milliseconds!)
          async function sha1(str) {
            const buffer = new TextEncoder().encode(str);
            const hashBuffer = await window.crypto.subtle.digest('SHA-1', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => ('00' + b.toString(16)).slice(-2)).join('');
          }

          const timestamp = Date.now();
          const origin = window.location.origin || 'https://www.youtube.com';
          const digest = await sha1(`${timestamp} ${sapisid} ${origin}`);
          const sapisidhash = `${timestamp}_${digest}`;

          // 3. Client version from ytcfg
          const clientVersion = window.ytcfg?.data_?.INNERTUBE_CLIENT_VERSION 
                             || (typeof window.ytcfg?.get === 'function' && window.ytcfg.get('INNERTUBE_CLIENT_VERSION'))
                             || '2.20261025.01.00';

          // 4. Send InnerTube browse/edit_playlist request
          const endpoint = 'https://www.youtube.com/youtubei/v1/browse/edit_playlist';
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `SAPISIDHASH ${sapisidhash}`
            },
            credentials: 'include',
            body: JSON.stringify({
              context: {
                client: {
                  clientName: 'WEB',
                  clientVersion: clientVersion
                }
              },
              actions: [
                {
                  addedVideoId: vId,
                  action: 'ACTION_ADD_VIDEO'
                }
              ],
              playlistId: 'WL'
            })
          });

          if (!res.ok) {
            return { success: false, status: res.status, error: `HTTP ${res.status}: ${res.statusText}` };
          }

          const data = await res.json();

          if (data && data.status === 'STATUS_SUCCEEDED') {
            return { success: true, status: 'STATUS_SUCCEEDED', data };
          }

          // Extract error/alert message
          let alertMsg = '';
          if (data && data.alerts && Array.isArray(data.alerts)) {
            for (const a of data.alerts) {
              const text = a?.alertRenderer?.text?.runs?.map(r => r.text).join('') || a?.alertRenderer?.text?.simpleText;
              if (text) { alertMsg = text; break; }
            }
          } else if (data && data.error && data.error.message) {
            alertMsg = data.error.message;
          }

          const isAlreadyAdded = alertMsg && (
            alertMsg.toLowerCase().includes('уже есть') || 
            alertMsg.toLowerCase().includes('already in') ||
            alertMsg.toLowerCase().includes('already added')
          );
          if (isAlreadyAdded) {
            return { success: true, alreadyAdded: true, status: 'ALREADY_IN_PLAYLIST' };
          }

          return {
            success: false,
            status: data?.status || 'STATUS_FAILED',
            error: alertMsg || `YouTube отклонил добавление (статус: ${data?.status || 'STATUS_FAILED'})`
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      },
      args: [cleanVideoId]
    });

    if (results && results[0] && results[0].result) {
      const r = results[0].result;
      if (r.success) {
        return { success: true, videoId: cleanVideoId, alreadyAdded: !!r.alreadyAdded, method: 'in_tab_innertube' };
      }
      if (r.error) {
        throw new Error(r.error);
      }
    }

    throw new Error('Не получен ответ от вкладки YouTube.');
  } finally {
    if (createdTempTab && targetTab && targetTab.id) {
      try {
        await chrome.tabs.remove(targetTab.id);
      } catch (e) {
        // Ignore
      }
    }
  }
}

/**
 * Command Dispatcher - Pure Chrome API Executor
 */
async function executeAgentCommand(action, params) {
  switch (action) {
    case 'get_tabs': {
      const tabs = await chrome.tabs.query({});
      return tabs.map(tab => ({
        id: tab.id,
        windowId: tab.windowId,
        title: tab.title || '',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl || '',
        active: Boolean(tab.active),
        pinned: Boolean(tab.pinned),
        audible: Boolean(tab.audible),
        groupId: tab.groupId !== undefined ? tab.groupId : -1
      }));
    }

    case 'apply_layout': {
      const groups = params.groups || [];
      const closeEmpty = params.close_empty_windows !== false;
      return await applyLayout(groups, closeEmpty);
    }

    case 'close_tabs': {
      const input = params.tab_ids !== undefined ? params.tab_ids : params.tab_id;
      const ids = (Array.isArray(input) ? input : [input])
        .map(Number)
        .filter(id => !isNaN(id) && id > 0);
      if (ids.length > 0) {
        await chrome.tabs.remove(ids);
      }
      return {
        closed: ids,
        count: ids.length
      };
    }

    case 'close_duplicate_tabs': {
      const tabs = await chrome.tabs.query({});
      const seenUrls = new Map();
      const duplicateIds = [];
      const duplicateDetails = [];

      for (const tab of tabs) {
        if (!tab.url) continue;
        const url = tab.url;

        if (seenUrls.has(url)) {
          const existingTab = seenUrls.get(url);
          // Keep active tab if one of duplicates is active
          let toClose = tab;
          if (tab.active && !existingTab.active) {
            toClose = existingTab;
            seenUrls.set(url, tab);
          }
          duplicateIds.push(toClose.id);
          duplicateDetails.push({
            id: toClose.id,
            url: toClose.url,
            title: toClose.title || ''
          });
        } else {
          seenUrls.set(url, tab);
        }
      }

      if (duplicateIds.length > 0) {
        await chrome.tabs.remove(duplicateIds);
      }
      return {
        closed_count: duplicateIds.length,
        closed_tabs: duplicateDetails
      };
    }

    case 'get_page_text': {
      const tabId = Number(params.tab_id);
      if (isNaN(tabId) || tabId <= 0) {
        throw new Error('Valid tab_id is required');
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          try {
            return document.body ? document.body.innerText : (document.documentElement ? document.documentElement.innerText : '');
          } catch (e) {
            return '';
          }
        }
      });

      const text = (results && results[0] && typeof results[0].result === 'string') ? results[0].result : '';
      return {
        tab_id: tabId,
        length: text.length,
        text: text
      };
    }

    case 'ungroup_all_tabs': {
      const tabs = await chrome.tabs.query({});
      const groupedTabs = tabs.filter(t => t.groupId !== undefined && t.groupId > 0);
      const tabIds = groupedTabs.map(t => t.id);

      if (tabIds.length > 0) {
        try {
          await chrome.tabs.ungroup(tabIds);
        } catch (e) {
          for (const id of tabIds) {
            try { await chrome.tabs.ungroup(id); } catch (err) {}
          }
        }
      }

      return {
        success: true,
        ungrouped_count: tabIds.length
      };
    }

    case 'activate_tab': {
      const tabId = Number(params.tab_id);
      if (isNaN(tabId) || tabId <= 0) {
        throw new Error('Valid tab_id is required');
      }
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab && tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return {
        success: true,
        tab_id: tabId,
        title: tab.title || '',
        url: tab.url || ''
      };
    }

    case 'create_tab': {
      const url = params.url || 'about:blank';
      const tab = await chrome.tabs.create({ url });
      return {
        id: tab.id,
        windowId: tab.windowId,
        url: tab.url || url,
        title: tab.title || ''
      };
    }

    // Session Management Commands
    case 'get_live_session': {
      return await getLiveSession();
    }

    case 'open_manager': {
      openManagerTab();
      return { success: true };
    }

    case 'save_session': {
      return await saveSession(params.name);
    }

    case 'list_sessions': {
      return await listSessions();
    }

    case 'restore_session': {
      const sId = params.sessionId || params.session_id || params.id;
      const gId = params.targetGroupId !== undefined ? params.targetGroupId : params.target_group_id;
      const options = {
        targetWindowIndex: params.targetWindowIndex !== undefined ? params.targetWindowIndex : params.windowIndex
      };
      return await restoreSession(sId, gId, options);
    }

    case 'export_session_json': {
      const sId = params.sessionId || params.session_id || params.id;
      return await exportSessionJson(sId);
    }

    case 'delete_session': {
      const sId = params.sessionId || params.session_id || params.id;
      return await deleteSession(sId);
    }

    case 'rename_session': {
      const sId = params.sessionId || params.session_id || params.id;
      const newName = params.newName || params.name || params.title;
      return await renameSession(sId, newName);
    }

    case 'update_session': {
      const sessionObj = params.session || params;
      return await updateSession(sessionObj);
    }

    case 'import_session_json': {
      const raw = params.session || params.sessionData || params.data || params.json || params;
      return await importSessionJson(raw);
    }

    case 'youtube_watch_later': {
      const videoId = params.videoId || params.video_id || params.id;
      const tabId = params.tabId || params.tab_id;
      return await addVideoToYouTubeWatchLater(videoId, tabId);
    }

    default:
      throw new Error(`Unknown command action: ${action}`);
  }
}

// Listen for messages from popup UI and manager dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'get_status') {
    chrome.tabs.query({}).then(tabs => {
      sendResponse({
        tab_count: tabs.length
      });
    });
    return true; // Keep channel open for async response
  }

  const supportedActions = [
    'get_tabs', 'close_duplicate_tabs', 'close_tabs', 'ungroup_all_tabs',
    'apply_layout', 'activate_tab', 'create_tab',
    'get_live_session', 'open_manager',
    'save_session', 'list_sessions', 'restore_session', 'export_session_json', 'delete_session', 'rename_session', 'update_session', 'import_session_json',
    'youtube_watch_later'
  ];

  if (supportedActions.includes(message.action)) {
    executeAgentCommand(message.action, message.params || {})
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }
});

// Setup context menu for right-clicking extension icon
chrome.runtime.onInstalled.addListener(() => {
  updateTabCount();
  try {
    chrome.contextMenus.create({
      id: 'open_manager_tab',
      title: '🖥️ Открыть менеджер во весь экран',
      contexts: ['action']
    });
  } catch (e) {}
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open_manager_tab') {
    openManagerTab();
  }
});

// Update tab count on browser events
chrome.runtime.onStartup.addListener(updateTabCount);
chrome.tabs.onCreated.addListener(updateTabCount);
chrome.tabs.onRemoved.addListener(updateTabCount);

// Initial tab count update on worker load
updateTabCount();

/**
 * Chrome Agent Bridge - Background Service Worker (Manifest V3)
 * Pure Executor ("Hands") - Minimalist, Event-Driven Chrome API Bridge.
 * 0% CPU footprint when idle.
 */

const WS_URL = 'ws://127.0.0.1:8765';
const RECONNECT_DELAY_MS = 5000;
const PING_INTERVAL_MS = 25000;

let socket = null;
let reconnectTimer = null;
let pingInterval = null;
let isConnected = false;

// Update connection status in chrome.storage for popup UI
async function updateStatus(connected) {
  isConnected = connected;
  try {
    const tabs = await chrome.tabs.query({});
    await chrome.storage.local.set({
      bridge_connected: connected,
      tab_count: tabs.length,
      last_updated: Date.now()
    });
  } catch (e) {
    // Ignore context invalidation
  }
}

// Establish WebSocket connection
function connectBridge() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    scheduleReconnect();
    return;
  }

  socket.onopen = async () => {
    await updateStatus(true);
    try {
      socket.send(JSON.stringify({
        type: 'hello',
        role: 'chrome_extension',
        version: '1.1.0'
      }));
    } catch (e) {}

    // Setup keepalive ping to prevent Service Worker hibernation while connected
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ type: 'ping' }));
        } catch (e) {}
      }
    }, PING_INTERVAL_MS);
  };

  socket.onmessage = async (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    if (data.type === 'ping') {
      try {
        socket.send(JSON.stringify({ type: 'pong' }));
      } catch (e) {}
      return;
    }

    if (data.type === 'pong') {
      return;
    }

    // Execute incoming agent command
    if (data.id && data.action) {
      try {
        const result = await executeAgentCommand(data.action, data.params || {});
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            id: data.id,
            success: true,
            result: result
          }));
        }
      } catch (err) {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            id: data.id,
            success: false,
            error: err.message || String(err)
          }));
        }
      }
    }
  };

  socket.onclose = () => {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    updateStatus(false);
    scheduleReconnect();
  };

  socket.onerror = () => {
    // Gentle: no unhandled console spam when bridge is offline
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBridge();
  }, RECONNECT_DELAY_MS);
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

    default:
      throw new Error(`Unknown command action: ${action}`);
  }
}

// Listen for messages from popup UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'get_status') {
    chrome.tabs.query({}).then(tabs => {
      sendResponse({
        connected: isConnected,
        tab_count: tabs.length
      });
    });
    return true; // Keep channel open for async response
  }

  if (['get_tabs', 'close_duplicate_tabs', 'close_tabs', 'ungroup_all_tabs', 'apply_layout', 'activate_tab', 'create_tab'].includes(message.action)) {
    executeAgentCommand(message.action, message.params || {})
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }
});

// Wake up & connect on browser events
chrome.runtime.onStartup.addListener(connectBridge);
chrome.runtime.onInstalled.addListener(connectBridge);
chrome.tabs.onCreated.addListener(() => updateStatus(isConnected));
chrome.tabs.onRemoved.addListener(() => updateStatus(isConnected));

// Initial connection on worker load
connectBridge();

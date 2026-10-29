/**
 * Chrome Agent Bridge - Background Service Worker (Manifest V3)
 * Pure Offline & Autonomous Session Manager (0% CPU footprint when idle).
 *
 * Modular architecture:
 * - background/tabs-manager.js: Tab querying, grouping, and layout manipulation
 * - background/sessions-storage.js: Session persistence, restoration, and JSON import/export
 * - background/youtube-service.js: Authenticated YouTube Watch Later integration
 * - background/command-router.js: Central command dispatcher
 */

// Import decomposed domain modules synchronously into Service Worker scope
importScripts(
  'background/tabs-manager.js',
  'background/sessions-storage.js',
  'background/youtube-service.js',
  'background/command-router.js'
);

/**
 * Open or focus the full-screen Session Manager tab
 */
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

/**
 * Message listener for Popup UI, Fullscreen Manager, and external agents
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  // Lightweight status probe
  if (message.action === 'get_status') {
    chrome.tabs.query({}).then(tabs => {
      sendResponse({ tab_count: tabs.length });
    });
    return true; // Keep message channel open for async response
  }

  // Domain command router
  if (SUPPORTED_ACTIONS.includes(message.action)) {
    executeAgentCommand(message.action, message.params || {})
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true; // Keep message channel open for async response
  }
});

/**
 * Context menu setup on extension installation / update
 */
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

/**
 * Keep tab count synchronized in chrome.storage on browser events
 */
chrome.runtime.onStartup.addListener(updateTabCount);
chrome.tabs.onCreated.addListener(updateTabCount);
chrome.tabs.onRemoved.addListener(updateTabCount);

// Initial tab count update on worker load
updateTabCount();

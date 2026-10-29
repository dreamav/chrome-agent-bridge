/**
 * Chrome Agent Bridge - Popup Master Controller
 *
 * Modular architecture:
 * - popup/ui-helpers.js: Color palette, toast notifications, date formatting, and file download
 * - popup/actions-controller.js: Live tab metrics and quick actions (refresh, dedupe, ungroup)
 * - popup/sessions-controller.js: Session saving, listing, restoring, and JSON import/export
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Navigation elements
  const tabNavActions = document.getElementById('tabNavActions');
  const tabNavSessions = document.getElementById('tabNavSessions');
  const viewActions = document.getElementById('viewActions');
  const viewSessions = document.getElementById('viewSessions');
  const sessionsCountBadge = document.getElementById('sessionsCountBadge');

  // Metric elements & notification
  const tabCountElem = document.getElementById('tabCount');
  const toastMessage = document.getElementById('toastMessage');

  // Action buttons
  const btnRefresh = document.getElementById('btnRefresh');
  const btnDedupe = document.getElementById('btnDedupe');
  const btnUngroup = document.getElementById('btnUngroup');
  const btnOpenManager = document.getElementById('btnOpenManager');

  // Session elements
  const sessionNameInput = document.getElementById('sessionNameInput');
  const btnSaveSession = document.getElementById('btnSaveSession');
  const btnImportSession = document.getElementById('btnImportSession');
  const fileImportInput = document.getElementById('fileImportInput');
  const sessionsList = document.getElementById('sessionsList');

  // Setup toast notifier
  const showToast = createToastNotifier(toastMessage);

  // Setup Fullscreen Manager Button
  if (btnOpenManager) {
    btnOpenManager.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'open_manager' });
    });
  }

  // Initialize modular controllers
  const actionsCtrl = initActionsController({
    tabCountElem,
    btnRefresh,
    btnDedupe,
    btnUngroup,
    showToast
  });

  const sessionsCtrl = initSessionsController({
    sessionsList,
    sessionsCountBadge,
    sessionNameInput,
    btnSaveSession,
    btnImportSession,
    fileImportInput,
    showToast,
    refreshTabs: actionsCtrl.refreshTabs
  });

  // Tab switcher
  function switchTab(viewName) {
    if (viewName === 'sessions') {
      tabNavActions.classList.remove('active');
      tabNavSessions.classList.add('active');
      viewActions.classList.add('hidden');
      viewSessions.classList.remove('hidden');
      if (sessionNameInput) {
        sessionNameInput.placeholder = getFormattedNow();
      }
      sessionsCtrl.loadSessions();
    } else {
      tabNavSessions.classList.remove('active');
      tabNavActions.classList.add('active');
      viewSessions.classList.add('hidden');
      viewActions.classList.remove('hidden');
      actionsCtrl.refreshTabs(false);
    }
  }

  if (tabNavActions) {
    tabNavActions.addEventListener('click', () => switchTab('actions'));
  }
  if (tabNavSessions) {
    tabNavSessions.addEventListener('click', () => switchTab('sessions'));
  }

  // Initial load
  await actionsCtrl.refreshTabs(false);
  if (sessionNameInput) {
    sessionNameInput.placeholder = getFormattedNow();
  }
  sessionsCtrl.loadSessionsCount();
});

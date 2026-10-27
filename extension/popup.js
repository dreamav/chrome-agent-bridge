/**
 * Chrome Agent Bridge - Popup Controller
 * Full Session Manager with native Chrome Tab Groups support.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Navigation elements
  const tabNavActions = document.getElementById('tabNavActions');
  const tabNavSessions = document.getElementById('tabNavSessions');
  const viewActions = document.getElementById('viewActions');
  const viewSessions = document.getElementById('viewSessions');
  const sessionsCountBadge = document.getElementById('sessionsCountBadge');

  // Header & metric elements
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const tabCountElem = document.getElementById('tabCount');
  const toastMessage = document.getElementById('toastMessage');

  // Action buttons
  const btnRefresh = document.getElementById('btnRefresh');
  const btnDedupe = document.getElementById('btnDedupe');
  const btnUngroup = document.getElementById('btnUngroup');
  const btnSmart = document.getElementById('btnSmart');

  // Session elements
  const sessionNameInput = document.getElementById('sessionNameInput');
  const btnSaveSession = document.getElementById('btnSaveSession');
  const btnImportSession = document.getElementById('btnImportSession');
  const fileImportInput = document.getElementById('fileImportInput');
  const sessionsList = document.getElementById('sessionsList');
  const btnOpenManager = document.getElementById('btnOpenManager');

  if (btnOpenManager) {
    btnOpenManager.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'open_manager' });
    });
  }

  // Native Chrome Tab Groups color map
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

  function showToast(message, duration = 3000) {
    toastMessage.textContent = message;
    toastMessage.style.display = 'block';
    setTimeout(() => {
      toastMessage.style.display = 'none';
    }, duration);
  }

  function getFormattedNow() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `Сессия ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function renderStatus(connected, tabCount) {
    if (connected) {
      statusBadge.classList.add('connected');
      statusText.textContent = 'Connected 🟢';
    } else {
      statusBadge.classList.remove('connected');
      statusText.textContent = 'Offline 🔴';
    }
    if (typeof tabCount === 'number') {
      tabCountElem.textContent = tabCount;
    }
  }

  // Refresh tabs & status
  async function refreshTabs(showNotification = false) {
    try {
      const tabs = await chrome.tabs.query({});
      const count = tabs.length;
      tabCountElem.textContent = count;

      chrome.runtime.sendMessage({ action: 'get_status' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          chrome.storage.local.get(['bridge_connected'], (data) => {
            renderStatus(Boolean(data && data.bridge_connected), count);
          });
        } else {
          renderStatus(Boolean(response.connected), response.tab_count || count);
        }
      });

      if (showNotification) {
        showToast(`Вкладок: ${count} → Список обновлен`);
      }
    } catch (e) {
      // Ignore
    }
  }

  // Tab switcher
  function switchTab(viewName) {
    if (viewName === 'sessions') {
      tabNavActions.classList.remove('active');
      tabNavSessions.classList.add('active');
      viewActions.classList.add('hidden');
      viewSessions.classList.remove('hidden');
      sessionNameInput.placeholder = getFormattedNow();
      loadSessions();
    } else {
      tabNavSessions.classList.remove('active');
      tabNavActions.classList.add('active');
      viewSessions.classList.add('hidden');
      viewActions.classList.remove('hidden');
      refreshTabs(false);
    }
  }

  tabNavActions.addEventListener('click', () => switchTab('actions'));
  tabNavSessions.addEventListener('click', () => switchTab('sessions'));

  // Initial load
  await refreshTabs(false);
  sessionNameInput.placeholder = getFormattedNow();
  loadSessionsCount();

  // Update session badge count
  function loadSessionsCount() {
    chrome.runtime.sendMessage({ action: 'list_sessions' }, (response) => {
      if (response && response.success && Array.isArray(response.result)) {
        sessionsCountBadge.textContent = response.result.length;
      }
    });
  }

  // --- ACTIONS TAB HANDLERS ---

  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.disabled = true;
      btnRefresh.textContent = 'Обновление...';
      await refreshTabs(true);
      btnRefresh.disabled = false;
      btnRefresh.textContent = 'Обновить список вкладок →';
    });
  }

  if (btnDedupe) {
    btnDedupe.addEventListener('click', async () => {
      btnDedupe.disabled = true;
      btnDedupe.textContent = 'Поиск дубликатов...';

      chrome.runtime.sendMessage({ action: 'close_duplicate_tabs' }, async (response) => {
        btnDedupe.disabled = false;
        btnDedupe.textContent = 'Закрыть дубликаты →';

        if (response && response.success) {
          const closed = response.result.closed_count;
          if (closed > 0) {
            showToast(`Удалено дубликатов: ${closed} →`);
          } else {
            showToast('Дубликатов не обнаружено →');
          }
        } else {
          showToast('Ошибка при удалении дубликатов →');
        }
        await refreshTabs(false);
      });
    });
  }

  if (btnUngroup) {
    btnUngroup.addEventListener('click', async () => {
      btnUngroup.disabled = true;
      btnUngroup.textContent = 'Роспуск групп...';

      chrome.runtime.sendMessage({ action: 'ungroup_all_tabs' }, async (response) => {
        btnUngroup.disabled = false;
        btnUngroup.textContent = 'Распустить группы →';

        if (response && response.success) {
          const count = response.result.ungrouped_count;
          if (count > 0) {
            showToast(`Распущено групп: ${count} вкл. →`);
          } else {
            showToast('Сгруппированных вкладок нет →');
          }
        } else {
          showToast('Ошибка при разгруппировке →');
        }
        await refreshTabs(false);
      });
    });
  }

  if (btnSmart) {
    btnSmart.addEventListener('click', async () => {
      btnSmart.disabled = true;
      btnSmart.textContent = 'Организация...';

      chrome.runtime.sendMessage({ action: 'get_tabs' }, async (tabs) => {
        if (!tabs || !Array.isArray(tabs) || tabs.length === 0) {
          showToast('Нет открытых вкладок →');
          btnSmart.disabled = false;
          btnSmart.textContent = 'Умная организация (AI) →';
          return;
        }

        const groups = {
          AI: [],
          SERVICES: [],
          AUTO: [],
          CAREER: [],
          MEDIA: [],
          OTHER: []
        };

        for (const t of tabs) {
          const text = `${t.url || ''} ${t.title || ''}`.toLowerCase();

          if (['вайбкодинг', 'заказ', 'клиент', 'фриланс', 'джун', 'стажер', 'работу в it', 'web3', 'нейронайм', 'портфолио'].some(k => text.includes(k))) {
            groups.CAREER.push(t.id);
          } else if (['grok', 'x.ai', 'claude', 'notebooklm', 'antigravity', 'qwen', 'chatgpt', 'gemini', 'deepseek', 'llm', 'blender', 'three.js', 'threejs', 'awwwards', 'layers.to', 'bentogrids', 'minimal.gallery', 'recent.design'].some(k => text.includes(k))) {
            groups.AI.push(t.id);
          } else if (['vin', 'vininspector', 'alshnedauto', 'partsgiant', 'partsdeal', 'subaru', 'mopar', 'infiniti', 'mercedes', 'ford', 'nhtsa', 'motorhome', 'chassis', 'автозапчаст'].some(k => text.includes(k))) {
            groups.AUTO.push(t.id);
          } else if (['whatsapp', 'mail.google', 'gmail', 'fastpanel', ':8888', 'digitalocean', 'cloudways', 'paypal', 'cloud.google', 'extensions'].some(k => text.includes(k))) {
            groups.SERVICES.push(t.id);
          } else if (['kinect', 'pegasus', 'transformers', 'beast wars', 'пустоши', 'japan got talent', 'reels', 'instagram', 'standup', 'музыка', 'юмор', 'youtube.com', 'youtu.be'].some(k => text.includes(k))) {
            groups.MEDIA.push(t.id);
          } else {
            groups.OTHER.push(t.id);
          }
        }

        const layoutPlan = [];
        if (groups.AI.length > 0) layoutPlan.push({ title: 'ИИ & Нейросети', color: 'purple', tab_ids: groups.AI, window_id: 1 });
        if (groups.SERVICES.length > 0) layoutPlan.push({ title: 'Общение & Сервер', color: 'green', tab_ids: groups.SERVICES, window_id: 1 });
        if (groups.AUTO.length > 0) layoutPlan.push({ title: 'Vincode & Авто', color: 'cyan', tab_ids: groups.AUTO, window_id: 2 });
        if (groups.CAREER.length > 0) layoutPlan.push({ title: 'Вайбкодинг & Карьера', color: 'blue', tab_ids: groups.CAREER, window_id: 3 });
        if (groups.MEDIA.length > 0) layoutPlan.push({ title: 'Отдых, Спорт & Музыка', color: 'red', tab_ids: groups.MEDIA, window_id: 3 });
        if (groups.OTHER.length > 0) layoutPlan.push({ title: 'Прочее & Поиск', color: 'grey', tab_ids: groups.OTHER, window_id: 3 });

        chrome.runtime.sendMessage({
          action: 'apply_layout',
          params: { groups: layoutPlan, close_empty_windows: true }
        }, async (res) => {
          btnSmart.disabled = false;
          btnSmart.textContent = 'Умная организация (AI) →';

          if (res && res.success) {
            showToast(`Организовано окон: ${res.result.windows_count} →`);
          } else {
            showToast('Ошибка организации →');
          }
          await refreshTabs(false);
        });
      });
    });
  }

  // --- SESSIONS MANAGER HANDLERS ---

  // Save session
  if (btnSaveSession) {
    btnSaveSession.addEventListener('click', async () => {
      const name = sessionNameInput.value.trim() || getFormattedNow();
      btnSaveSession.disabled = true;
      btnSaveSession.textContent = 'Сохранение...';

      chrome.runtime.sendMessage({
        action: 'save_session',
        params: { name }
      }, (response) => {
        btnSaveSession.disabled = false;
        btnSaveSession.textContent = '💾 Сохранить с группами';

        if (response && response.success) {
          const s = response.result;
          sessionNameInput.value = '';
          sessionNameInput.placeholder = getFormattedNow();
          showToast(`Сессия сохранена! (${s.tabCount} вкл., ${s.groupCount} групп) →`);
          loadSessions();
        } else {
          showToast('Ошибка сохранения сессии →');
        }
      });
    });
  }

  // Load and render sessions list
  function loadSessions() {
    chrome.runtime.sendMessage({ action: 'list_sessions' }, (response) => {
      if (!response || !response.success || !Array.isArray(response.result)) {
        sessionsList.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">⚠️</span>
            <p>Не удалось загрузить сессии</p>
          </div>
        `;
        return;
      }

      const sessions = response.result;
      sessionsCountBadge.textContent = sessions.length;

      if (sessions.length === 0) {
        sessionsList.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">📂</span>
            <p>Нет сохраненных сессий</p>
          </div>
        `;
        return;
      }

      sessionsList.innerHTML = '';

      sessions.forEach(session => {
        const card = document.createElement('div');
        card.className = 'session-card';

        const dateStr = new Date(session.timestamp).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });

        // Collect all groups from this session
        const allWinGroups = [];
        for (const win of (session.data || [])) {
          for (const g of (win.groups || [])) {
            allWinGroups.push(g);
          }
        }

        // Build groups chips HTML
        let groupsHtml = '';
        if (allWinGroups.length > 0) {
          groupsHtml = '<div class="session-groups">';
          allWinGroups.forEach(g => {
            const colorHex = CHROME_GROUP_COLORS[g.color] || '#9aa0a6';
            const groupTitle = g.title ? g.title : 'Группа';
            groupsHtml += `
              <span class="group-chip" title="Восстановить только группу '${groupTitle}'" data-session-id="${session.id}" data-group-id="${g.id}">
                <span class="group-dot" style="background: ${colorHex}"></span>
                ${groupTitle}
              </span>
            `;
          });
          groupsHtml += '</div>';
        }

        card.innerHTML = `
          <div class="session-header">
            <span class="session-name" title="${session.name}">${session.name}</span>
            <span class="session-date">${dateStr}</span>
          </div>
          <div class="session-badges">
            <span class="badge-pill">🪟 ${session.windowCount || 1} ок.</span>
            <span class="badge-pill">📑 ${session.tabCount || 0} вкл.</span>
            <span class="badge-pill">🎨 ${session.groupCount || 0} гр.</span>
          </div>
          ${groupsHtml}
          <div class="session-actions">
            <button class="btn-mini btn-mini-primary btn-restore" data-id="${session.id}" title="Восстановить сессию целиком">
              ⚡ Восстановить
            </button>
            <button class="btn-mini btn-mini-secondary btn-export" data-id="${session.id}" title="Скачать сессию в JSON">
              📥 JSON
            </button>
            <button class="btn-mini btn-mini-danger btn-delete" data-id="${session.id}" title="Удалить сессию">
              🗑️
            </button>
          </div>
        `;

        // Restore entire session
        card.querySelector('.btn-restore').addEventListener('click', () => {
          showToast(`Восстановление сессии "${session.name}"...`);
          chrome.runtime.sendMessage({
            action: 'restore_session',
            params: { sessionId: session.id }
          }, (res) => {
            if (res && res.success) {
              showToast(`Сессия восстановлена! (${res.result.tabs_restored} вкл., ${res.result.groups_restored} групп) →`);
              refreshTabs(false);
            } else {
              showToast(`Ошибка восстановления: ${res?.error || 'Неизвестная ошибка'} →`);
            }
          });
        });

        // Restore single group when chip clicked
        card.querySelectorAll('.group-chip').forEach(chip => {
          chip.addEventListener('click', (e) => {
            e.stopPropagation();
            const gId = chip.getAttribute('data-group-id');
            showToast('Восстановление выбранной группы...');
            chrome.runtime.sendMessage({
              action: 'restore_session',
              params: { sessionId: session.id, targetGroupId: gId }
            }, (res) => {
              if (res && res.success) {
                showToast(`Группа "${res.result.group_title}" восстановлена! (${res.result.tabs_restored} вкл.) →`);
                refreshTabs(false);
              } else {
                showToast(`Ошибка восстановления группы: ${res?.error || ''} →`);
              }
            });
          });
        });

        // Export session JSON
        card.querySelector('.btn-export').addEventListener('click', () => {
          chrome.runtime.sendMessage({
            action: 'export_session_json',
            params: { sessionId: session.id }
          }, (res) => {
            if (res && res.success && res.result.json) {
              const safeName = session.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_');
              const filename = `chrome_session_${safeName}_${session.timestamp}.json`;
              downloadJsonFile(filename, res.result.json);
              showToast('Сессия экспортирована в JSON →');
            } else {
              showToast('Ошибка экспорта сессии →');
            }
          });
        });

        // Delete session
        card.querySelector('.btn-delete').addEventListener('click', () => {
          if (!confirm(`Удалить сессию "${session.name}"?`)) return;

          chrome.runtime.sendMessage({
            action: 'delete_session',
            params: { sessionId: session.id }
          }, (res) => {
            if (res && res.success) {
              showToast('Сессия удалена →');
              loadSessions();
            } else {
              showToast('Ошибка удаления сессии →');
            }
          });
        });

        sessionsList.appendChild(card);
      });
    });
  }

  // Download JSON helper
  function downloadJsonFile(filename, jsonText) {
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

  // Import session from JSON
  if (btnImportSession && fileImportInput) {
    btnImportSession.addEventListener('click', () => {
      fileImportInput.value = '';
      fileImportInput.click();
    });

    fileImportInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target.result;
          chrome.runtime.sendMessage({
            action: 'import_session_json',
            params: { json: content }
          }, (res) => {
            if (res && res.success) {
              const s = res.result.session;
              showToast(`Сессия "${s.name}" успешно импортирована! →`);
              loadSessions();
            } else {
              showToast(`Ошибка импорта: ${res?.error || 'Неверный формат'} →`);
            }
          });
        } catch (err) {
          showToast(`Ошибка чтения файла: ${err.message} →`);
        }
      };
      reader.readAsText(file);
    });
  }
});

/**
 * Chrome Agent Bridge - Popup Sessions View Controller
 * Handles session saving, listing, single-group/full restoration, JSON import and export.
 */

function initSessionsController({
  sessionsList,
  sessionsCountBadge,
  sessionNameInput,
  btnSaveSession,
  btnImportSession,
  fileImportInput,
  showToast,
  refreshTabs
}) {
  // Update session badge count
  function loadSessionsCount() {
    chrome.runtime.sendMessage({ action: 'list_sessions' }, (response) => {
      if (response && response.success && Array.isArray(response.result)) {
        if (sessionsCountBadge) {
          sessionsCountBadge.textContent = response.result.length;
        }
      }
    });
  }

  // Save current live session
  if (btnSaveSession) {
    btnSaveSession.addEventListener('click', () => {
      const customName = sessionNameInput ? sessionNameInput.value.trim() : '';
      btnSaveSession.disabled = true;
      btnSaveSession.textContent = 'Сохранение...';

      chrome.runtime.sendMessage({
        action: 'save_session',
        params: { name: customName || undefined }
      }, (response) => {
        btnSaveSession.disabled = false;
        btnSaveSession.textContent = '💾 Сохранить с группами';

        if (response && response.success) {
          showToast(`Сессия "${response.result.name}" сохранена! →`);
          if (sessionNameInput) {
            sessionNameInput.value = '';
            sessionNameInput.placeholder = getFormattedNow();
          }
          loadSessions();
        } else {
          showToast('Ошибка сохранения сессии →');
        }
      });
    });
  }

  // Load and render sessions list
  function loadSessions() {
    if (!sessionsList) return;

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
      if (sessionsCountBadge) {
        sessionsCountBadge.textContent = sessions.length;
      }

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

  // Import session from JSON file
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

  return {
    loadSessions,
    loadSessionsCount
  };
}

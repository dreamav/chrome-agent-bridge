/**
 * Chrome Agent Bridge — Manager Sidebar & Sessions List
 * Handles sidebar rendering, session switching, inline renaming, export/delete, and Session Buddy import.
 */

function selectSession(session) {
  ManagerState.activeSession = session;
  ManagerState.showAllInCurrentSession = false; // Reset to focused matches view on session switch
  clearSelection(); // Reset any batch selection when switching sessions

  // Update active highlight in sidebar
  if (session.isLive) {
    if (DOM.liveSessionCard) DOM.liveSessionCard.classList.add('active');
    document.querySelectorAll('#savedSessionsList .session-nav-item').forEach(el => el.classList.remove('active'));
  } else {
    if (DOM.liveSessionCard) DOM.liveSessionCard.classList.remove('active');
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

function renderSidebarSessions() {
  const filter = (ManagerState.searchQuery || '').trim().toLowerCase();

  // 1. Live Session Card handling
  if (DOM.liveSessionCard && ManagerState.liveSession) {
    if (filter) {
      const liveStats = getSessionMatchStats(ManagerState.liveSession, filter);
      if (liveStats.hasMatch) {
        DOM.liveSessionCard.style.display = 'flex';
        DOM.liveWindowCountBadge.style.display = 'none';
        DOM.liveTabCountBadge.style.display = '';
        DOM.liveTabCountBadge.textContent = `🎯 ${liveStats.matches || 1} совп.`;
        DOM.liveTabCountBadge.style.background = 'rgba(56, 189, 248, 0.25)';
        DOM.liveTabCountBadge.style.color = '#38bdf8';
        DOM.liveGroupCountBadge.style.display = 'none';
      } else {
        DOM.liveSessionCard.style.display = 'none';
      }
    } else {
      DOM.liveSessionCard.style.display = 'flex';
      DOM.liveWindowCountBadge.style.display = '';
      DOM.liveTabCountBadge.style.display = '';
      DOM.liveGroupCountBadge.style.display = '';
      DOM.liveWindowCountBadge.textContent = `${ManagerState.liveSession.windowCount || 1} ок.`;
      DOM.liveTabCountBadge.textContent = `${ManagerState.liveSession.tabCount || 0} вкл.`;
      DOM.liveTabCountBadge.style.background = '';
      DOM.liveTabCountBadge.style.color = '';
      DOM.liveGroupCountBadge.textContent = `${ManagerState.liveSession.groupCount || 0} гр.`;
    }
  }

  if (ManagerState.savedSessions.length === 0) {
    if (DOM.savedSessionsList) {
      DOM.savedSessionsList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 16px;">
          Нет сохранённых сессий.<br>Нажмите «Сохранить состояние».
        </div>
      `;
    }
    if (DOM.savedCountBadge) DOM.savedCountBadge.textContent = '0';
    return;
  }

  const sorted = getSortedSessions(ManagerState.savedSessions, ManagerState.currentSortOrder);

  // Filter to only matching sessions when searching
  let matchingList = sorted.map(s => ({
    session: s,
    stats: getSessionMatchStats(s, filter)
  }));

  if (filter) {
    matchingList = matchingList.filter(item => item.stats.hasMatch);
    if (DOM.savedCountBadge) {
      DOM.savedCountBadge.textContent = `${matchingList.length}/${ManagerState.savedSessions.length}`;
      DOM.savedCountBadge.title = `Найдено ${matchingList.length} сессий из ${ManagerState.savedSessions.length}`;
    }
  } else {
    if (DOM.savedCountBadge) {
      DOM.savedCountBadge.textContent = String(ManagerState.savedSessions.length);
      DOM.savedCountBadge.title = `Всего ${ManagerState.savedSessions.length} сессий`;
    }
  }

  if (matchingList.length === 0) {
    if (DOM.savedSessionsList) {
      DOM.savedSessionsList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 24px 12px; line-height: 1.5;">
          🔍 По запросу «<strong style="color: #fff;">${escapeHtml(filter)}</strong>» совпадений не найдено.<br>
          <button id="btnResetSearchInline" style="margin-top: 10px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 11px;">Сбросить поиск</button>
        </div>
      `;
      const btnReset = document.getElementById('btnResetSearchInline');
      if (btnReset) {
        btnReset.addEventListener('click', () => {
          DOM.searchInput.value = '';
          ManagerState.searchQuery = '';
          DOM.btnClearSearch.classList.add('hidden');
          handleSearchUpdate();
        });
      }
    }
    return;
  }

  if (!DOM.savedSessionsList) return;
  DOM.savedSessionsList.innerHTML = '';

  matchingList.forEach(({ session, stats }) => {
    const isSelected = ManagerState.activeSession && ManagerState.activeSession.id === session.id;
    const card = document.createElement('div');
    card.className = `session-nav-item ${isSelected ? 'active' : ''}`;
    card.setAttribute('data-id', session.id);

    const sDate = new Date(session.timestamp || session.createdAt || Date.now());
    const isCurrentYear = sDate.getFullYear() === new Date().getFullYear();
    const dateStr = sDate.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: isCurrentYear ? undefined : 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const matchPill = filter
      ? `<span class="meta-pill match-pill">🎯 ${stats.matches || 1} совп.</span>`
      : '';

    const sessionName = session.name || session.title || 'Сессия';

    card.innerHTML = `
      <div class="session-nav-icon">💾</div>
      <div class="session-nav-info">
        <div class="session-nav-title" title="${escapeHtml(sessionName)}">${highlightQuery(sessionName, filter)}</div>
        <div class="session-nav-meta">
          ${matchPill}
          <span class="session-nav-date">${dateStr}</span>
          <span class="meta-pill">${session.windowCount || 1} ок.</span>
          <span class="meta-pill">${session.tabCount || 0} вкл.</span>
          <span class="meta-pill">${session.groupCount || 0} гр.</span>
        </div>
      </div>
      <div class="session-nav-actions">
        <button class="btn-icon-mini btn-quick-restore" title="Восстановить сессию" data-id="${session.id}">⚡</button>
        <button class="btn-icon-mini btn-rename-sidebar" title="Переименовать" data-id="${session.id}">✏️</button>
        <button class="btn-icon-mini btn-export-sidebar" title="Экспорт JSON" data-id="${session.id}">📥</button>
        <button class="btn-icon-mini btn-delete btn-delete-sidebar" title="Удалить" data-id="${session.id}">🗑️</button>
      </div>
    `;

    // Select session on card click
    card.addEventListener('click', (e) => {
      if (e.target.closest('.session-nav-actions')) return;
      selectSession(session);
    });

    // Double-click on session title to rename
    card.querySelector('.session-nav-title').addEventListener('dblclick', (e) => {
      e.stopPropagation();
      selectSession(session);
      startEditingSessionTitle(session);
    });

    // Quick Restore button
    card.querySelector('.btn-quick-restore').addEventListener('click', (e) => {
      e.stopPropagation();
      restoreFullSession(session);
    });

    // Rename button
    card.querySelector('.btn-rename-sidebar').addEventListener('click', (e) => {
      e.stopPropagation();
      selectSession(session);
      startEditingSessionTitle(session);
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

    DOM.savedSessionsList.appendChild(card);
  });
}

// --- Inline Session Title Renaming ---

function startEditingSessionTitle(sessionToEdit) {
  const target = sessionToEdit || ManagerState.activeSession;
  if (!target || target.isLive) return;

  if (!ManagerState.activeSession || ManagerState.activeSession.id !== target.id) {
    selectSession(target);
  }

  ManagerState.isEditingTitle = true;
  const currentName = target.name || target.title || '';
  DOM.sessionTitleInput.value = currentName;
  DOM.selectedSessionTitle.classList.add('hidden');
  DOM.btnEditTitleDirect.classList.add('hidden');
  DOM.sessionTitleInput.classList.remove('hidden');
  DOM.sessionTitleInput.focus();
  DOM.sessionTitleInput.select();
}

async function saveEditedSessionTitle() {
  if (!ManagerState.isEditingTitle) return;
  const newName = DOM.sessionTitleInput.value.trim();
  const targetSession = ManagerState.activeSession;

  DOM.sessionTitleInput.classList.add('hidden');
  DOM.selectedSessionTitle.classList.remove('hidden');
  if (targetSession && !targetSession.isLive) {
    DOM.btnEditTitleDirect.classList.remove('hidden');
  }
  ManagerState.isEditingTitle = false;

  if (!targetSession || targetSession.isLive) return;

  const oldName = targetSession.name || targetSession.title || '';
  if (!newName || newName === oldName) {
    DOM.selectedSessionTitle.textContent = oldName;
    return;
  }

  chrome.runtime.sendMessage({
    action: 'rename_session',
    params: { sessionId: targetSession.id, newName: newName }
  }, async (res) => {
    if (res && res.success) {
      targetSession.name = newName;
      targetSession.title = newName;
      DOM.selectedSessionTitle.textContent = newName;
      showToast(`Сессия переименована: «${newName}»`);
      await fetchSavedSessions();
      renderSidebarSessions();
    } else {
      DOM.selectedSessionTitle.textContent = oldName;
      showToast(`Ошибка переименования: ${res?.error || 'Неизвестная ошибка'}`);
    }
  });
}

function cancelEditingSessionTitle() {
  if (!ManagerState.isEditingTitle) return;
  ManagerState.isEditingTitle = false;
  DOM.sessionTitleInput.classList.add('hidden');
  DOM.selectedSessionTitle.classList.remove('hidden');
  if (ManagerState.activeSession && !ManagerState.activeSession.isLive) {
    DOM.btnEditTitleDirect.classList.remove('hidden');
  }
  if (ManagerState.activeSession) {
    DOM.selectedSessionTitle.textContent = ManagerState.activeSession.name || ManagerState.activeSession.title || '';
  }
}

// --- Export & Delete Operations ---

function exportSession(session = ManagerState.activeSession) {
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
      const json = JSON.stringify(session, null, 2);
      downloadJson(`chrome_session_live_${Date.now()}.json`, json);
      showToast('Сессия экспортирована в JSON →');
    }
  });
}

function deleteSession(session = ManagerState.activeSession) {
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
      selectSession(ManagerState.liveSession);
    } else {
      showToast(`Ошибка удаления: ${res?.error || ''}`);
    }
  });
}

// --- Save Current Live Session as New Saved Session ---

async function handleSaveCurrent() {
  const defaultName = getFormattedNow();

  chrome.runtime.sendMessage({
    action: 'save_session',
    params: { name: defaultName }
  }, async (res) => {
    if (res && res.success) {
      const saved = res.result;
      showToast(`Сессия сохранена! Введите название или нажмите Enter.`);
      await fetchSavedSessions();
      renderSidebarSessions();
      selectSession(saved);

      setTimeout(() => {
        startEditingSessionTitle(saved);
      }, 80);
    } else {
      showToast('Ошибка сохранения сессии.');
    }
  });
}

// --- Session Buddy Official Backup Import (nxs.json.v2) ---

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

  const rawCollections = (json.data && Array.isArray(json.data.collections))
    ? json.data.collections
    : (Array.isArray(json.collections) ? json.collections : (Array.isArray(json) ? json : []));
  if (!rawCollections || !rawCollections.length) {
    alert('В файле не найдены коллекции Session Buddy.');
    return;
  }

  const CHROME_COLORS = ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'grey'];

  const importedSessions = rawCollections.map((col, idx) => {
    const createdAt = typeof col.created === 'number'
      ? col.created
      : (Date.parse(col.created) || (Date.now() - idx * 1000));

    const sessionTitle = col.title || ('Сессия от ' + new Date(createdAt).toLocaleDateString('ru-RU'));

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

  // Sort newest first
  importedSessions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // Merge and persist
  chrome.storage.local.get(['saved_sessions'], async (res) => {
    const existing = Array.isArray(res.saved_sessions) ? res.saved_sessions : [];
    const existingIds = new Set(existing.map(s => s.id));
    const newUnique = importedSessions.filter(s => !existingIds.has(s.id));

    if (newUnique.length === 0) {
      showToast('Все сессии из этого бэкапа уже присутствуют в списке.');
      return;
    }

    const merged = [...newUnique, ...existing];
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


function initSidebarEvents() {
  if (DOM.liveSessionCard) {
    DOM.liveSessionCard.addEventListener('click', async () => {
      await fetchLiveSession();
      if (ManagerState.liveSession) {
        selectSession(ManagerState.liveSession);
      }
    });
  }
}

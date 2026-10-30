/**
 * Chrome Agent Bridge — Full-Screen Session & Tab Groups Manager
 * Master Coordinator & Application Bootstrap
 *
 * Modular architecture:
 * - manager/manager-core.js: Shared state, DOM cache, data API & helpers
 * - manager/manager-preview.js: Glassmorphism tab preview & YouTube poster cards
 * - manager/manager-details-view.js: Active session details view, windows, groups & batch actions
 * - manager/manager-sidebar.js: Sidebar sessions list, search match pills, inline renaming & import
 */

function handleSearchUpdate() {
  renderSidebarSessions();

  const filter = (ManagerState.searchQuery || '').trim().toLowerCase();
  if (filter) {
    const currentStats = ManagerState.activeSession ? getSessionMatchStats(ManagerState.activeSession, filter) : { hasMatch: false };

    if (!currentStats.hasMatch) {
      let firstMatch = null;
      if (ManagerState.liveSession && getSessionMatchStats(ManagerState.liveSession, filter).hasMatch) {
        firstMatch = ManagerState.liveSession;
      } else {
        const sorted = getSortedSessions(ManagerState.savedSessions, ManagerState.currentSortOrder);
        firstMatch = sorted.find(s => getSessionMatchStats(s, filter).hasMatch);
      }

      if (firstMatch) {
        selectSession(firstMatch);
      } else {
        renderGlobalNoMatches(filter);
      }
    } else {
      renderActiveSessionDetails();
    }
  } else {
    if (!ManagerState.activeSession) {
      if (ManagerState.liveSession) {
        selectSession(ManagerState.liveSession);
      } else if (ManagerState.savedSessions.length > 0) {
        selectSession(ManagerState.savedSessions[0]);
      }
    } else {
      renderActiveSessionDetails();
    }
  }
}

function renderGlobalNoMatches(filter) {
  DOM.selectedSessionTitle.textContent = 'Поиск по всем сессиям';
  DOM.selectedSessionTag.textContent = '0 СОВПАДЕНИЙ';
  DOM.selectedSessionTag.className = 'session-tag';
  DOM.metaDate.textContent = `Поисковый запрос: «${filter}»`;
  DOM.metaStats.textContent = `Проверено ${ManagerState.savedSessions.length + (ManagerState.liveSession ? 1 : 0)} сессий`;
  DOM.btnSaveLiveAsNew.classList.add('hidden');
  DOM.btnDeleteCurrent.classList.add('hidden');
  DOM.btnRefreshLive.classList.add('hidden');
  DOM.btnRestoreAll.style.display = 'none';

  DOM.searchBanner.classList.remove('hidden');
  DOM.searchMatchCount.textContent = '0';
  DOM.searchQueryText.textContent = filter;

  DOM.sessionContent.innerHTML = `
    <div style="text-align: center; color: var(--text-muted); padding: 60px 20px;">
      <div style="font-size: 38px; margin-bottom: 14px;">🔍</div>
      <div style="font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 8px;">Ничего не найдено</div>
      <div style="font-size: 13px; max-width: 440px; margin: 0 auto 16px auto; line-height: 1.5; color: var(--text-muted);">
        Ни в одной из ${ManagerState.savedSessions.length + (ManagerState.liveSession ? 1 : 0)} сессий не найдено вкладок или групп по запросу «<strong style="color: #38bdf8;">${escapeHtml(filter)}</strong>».
      </div>
      <button id="btnResetFilterGlobal" class="btn btn-secondary" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; font-size: 12px; margin: 0 auto; cursor: pointer;">
        <span>✕</span> Очистить поисковый запрос
      </button>
    </div>
  `;

  const btnResetGlobal = document.getElementById('btnResetFilterGlobal');
  if (btnResetGlobal) {
    btnResetGlobal.addEventListener('click', () => {
      DOM.searchInput.value = '';
      ManagerState.searchQuery = '';
      DOM.btnClearSearch.classList.add('hidden');
      handleSearchUpdate();
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize DOM references & event handlers
  initManagerDOM();
  initHoverPreviewEvents();
  initYouTubeModalEvents();

  // --- Search Input Listeners ---
  DOM.searchInput.addEventListener('input', () => {
    ManagerState.searchQuery = DOM.searchInput.value.trim().toLowerCase();
    if (ManagerState.searchQuery) {
      DOM.btnClearSearch.classList.remove('hidden');
    } else {
      DOM.btnClearSearch.classList.add('hidden');
    }
    handleSearchUpdate();
  });

  DOM.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      DOM.searchInput.value = '';
      ManagerState.searchQuery = '';
      DOM.btnClearSearch.classList.add('hidden');
      handleSearchUpdate();
    }
  });

  DOM.btnClearSearch.addEventListener('click', () => {
    DOM.searchInput.value = '';
    ManagerState.searchQuery = '';
    DOM.btnClearSearch.classList.add('hidden');
    handleSearchUpdate();
  });

  DOM.btnResetFilter.addEventListener('click', () => {
    DOM.searchInput.value = '';
    ManagerState.searchQuery = '';
    DOM.btnClearSearch.classList.add('hidden');
    handleSearchUpdate();
  });

  if (DOM.btnToggleShowAllInSession) {
    DOM.btnToggleShowAllInSession.addEventListener('click', () => {
      ManagerState.showAllInCurrentSession = !ManagerState.showAllInCurrentSession;
      renderWindowsAndGroups();
    });
  }

  // --- Header Action Buttons ---
  DOM.btnRestoreAll.addEventListener('click', () => {
    restoreFullSession(ManagerState.activeSession);
  });

  DOM.btnExportCurrent.addEventListener('click', () => {
    exportSession(ManagerState.activeSession);
  });

  DOM.btnDeleteCurrent.addEventListener('click', () => {
    deleteSession(ManagerState.activeSession);
  });

  DOM.btnRefreshLive.addEventListener('click', async () => {
    DOM.btnRefreshLive.style.transform = 'rotate(360deg)';
    DOM.btnRefreshLive.style.transition = 'transform 0.5s ease';
    await fetchLiveSession();
    setTimeout(() => {
      if (DOM.btnRefreshLive) {
        DOM.btnRefreshLive.style.transform = '';
        DOM.btnRefreshLive.style.transition = '';
      }
    }, 500);

    if (ManagerState.activeSession && ManagerState.activeSession.isLive) {
      selectSession(ManagerState.liveSession);
    }
    showToast('Живой список вкладок обновлен!');
  });

  DOM.btnSaveCurrent.addEventListener('click', handleSaveCurrent);
  DOM.btnSaveLiveAsNew.addEventListener('click', handleSaveCurrent);

  // --- Floating Batch Action Bar Button Listeners ---
  if (DOM.btnBatchYouTube) {
    DOM.btnBatchYouTube.addEventListener('click', () => {
      const ytVideos = getSelectedYouTubeVideos();
      if (ytVideos.length === 0) {
        showToast('Не выбрано ни одной вкладки с видео YouTube.');
        return;
      }
      openYouTubePlaylistModal(ytVideos);
    });
  }

  if (DOM.btnBatchDelete) {
    DOM.btnBatchDelete.addEventListener('click', () => {
      deleteSelectedItems();
    });
  }

  if (DOM.btnBatchRestore) {
    DOM.btnBatchRestore.addEventListener('click', () => {
      restoreSelectedItems();
    });
  }

  if (DOM.btnBatchClear) {
    DOM.btnBatchClear.addEventListener('click', () => {
      clearSelection();
    });
  }

  // --- Session Title Renaming Listeners ---
  DOM.selectedSessionTitle.addEventListener('click', () => {
    if (ManagerState.activeSession && !ManagerState.activeSession.isLive) {
      startEditingSessionTitle(ManagerState.activeSession);
    }
  });

  if (DOM.btnEditTitleDirect) {
    DOM.btnEditTitleDirect.addEventListener('click', (e) => {
      e.stopPropagation();
      startEditingSessionTitle(ManagerState.activeSession);
    });
  }

  if (DOM.btnRenameCurrent) {
    DOM.btnRenameCurrent.addEventListener('click', (e) => {
      e.stopPropagation();
      startEditingSessionTitle(ManagerState.activeSession);
    });
  }

  DOM.sessionTitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEditedSessionTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingSessionTitle();
    }
  });

  DOM.sessionTitleInput.addEventListener('blur', () => {
    if (ManagerState.isEditingTitle) {
      saveEditedSessionTitle();
    }
  });

  // --- Sidebar Sort & Clear History Listeners ---
  if (DOM.sessionsSortSelect) {
    DOM.sessionsSortSelect.value = ManagerState.currentSortOrder;
    DOM.sessionsSortSelect.addEventListener('change', () => {
      ManagerState.currentSortOrder = DOM.sessionsSortSelect.value;
      localStorage.setItem('chrome_bridge_sort_order', ManagerState.currentSortOrder);
      renderSidebarSessions();
    });
  }

  if (DOM.btnClearSessions) {
    DOM.btnClearSessions.addEventListener('click', async () => {
      if (!ManagerState.savedSessions || ManagerState.savedSessions.length === 0) {
        showToast('Список сохранённых сессий уже пуст.');
        return;
      }
      const imported = ManagerState.savedSessions.filter(s => s && s.id && s.id.startsWith('sb_'));
      const native = ManagerState.savedSessions.filter(s => s && s.id && !s.id.startsWith('sb_'));

      if (imported.length > 0 && native.length > 0) {
        const choice = confirm(
          `Найдено:\n` +
          `• ${imported.length} импортированных сессий из Session Buddy\n` +
          `• ${native.length} ваших родных сессий Chrome Bridge\n\n` +
          `Нажмите «OK», чтобы удалить ТОЛЬКО сессии из Session Buddy (${imported.length} шт.), сохранив вашу родную сессию!\n\n` +
          `Нажмите «Отмена», чтобы отменить.`
        );
        if (!choice) return;

        const updated = native;
        await chrome.storage.local.set({ saved_sessions: updated });
        ManagerState.savedSessions = updated;
        DOM.savedCountBadge.textContent = updated.length;
        renderSidebarSessions();
        if (ManagerState.activeSession && ManagerState.activeSession.id && ManagerState.activeSession.id.startsWith('sb_')) {
          if (ManagerState.liveSession) selectSession(ManagerState.liveSession);
          else if (updated.length > 0) selectSession(updated[0]);
        }
        showToast(`🗑️ Удалено ${imported.length} сессий Session Buddy.`);
        return;
      }

      if (confirm(`Удалить все сохранённые сессии (${ManagerState.savedSessions.length} шт.)? Это действие нельзя отменить.`)) {
        await chrome.storage.local.set({ saved_sessions: [] });
        ManagerState.savedSessions = [];
        DOM.savedCountBadge.textContent = '0';
        renderSidebarSessions();
        if (ManagerState.liveSession) {
          selectSession(ManagerState.liveSession);
        }
        showToast('🗑️ История сохранённых сессий очищена.');
      }
    });
  }

  // --- Import JSON Listeners ---
  if (DOM.btnImportJson && DOM.importFileInput) {
    DOM.btnImportJson.addEventListener('click', () => {
      DOM.importFileInput.value = '';
      DOM.importFileInput.click();
    });

    DOM.importFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      handleImportFile(file);
    });
  }

  // --- Session Buddy Direct Import ---
  if (DOM.importSessionBuddyBtn && DOM.sessionBuddyFileInput) {
    DOM.importSessionBuddyBtn.addEventListener('click', () => {
      DOM.sessionBuddyFileInput.value = '';
      DOM.sessionBuddyFileInput.click();
    });

    DOM.sessionBuddyFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      handleSessionBuddyImport(file);
    });
  }

  // --- Sidebar Toggle Listeners ---
  if (DOM.btnToggleSidebar) {
    DOM.btnToggleSidebar.addEventListener('click', () => {
      DOM.sidebar.classList.toggle('collapsed');
    });
  }

  // --- Expand / Collapse All Toggles ---
  if (DOM.btnExpandAll) {
    DOM.btnExpandAll.addEventListener('click', () => {
      ManagerState.collapsedWindows.clear();
      ManagerState.collapsedGroups.clear();
      document.querySelectorAll('.window-card.collapsed').forEach(c => c.classList.remove('collapsed'));
      document.querySelectorAll('.tab-group-card.collapsed').forEach(c => c.classList.remove('collapsed'));
      showToast('▾ Все окна и группы развернуты');
    });
  }

  if (DOM.btnCollapseAll) {
    DOM.btnCollapseAll.addEventListener('click', () => {
      const windows = ManagerState.activeSession ? (ManagerState.activeSession.data || []) : [];
      windows.forEach((win, winIdx) => {
        const winKey = `${ManagerState.activeSession.id}_win_${winIdx}`;
        ManagerState.collapsedWindows.add(winKey);
        (win.groups || []).forEach(g => {
          const groupKey = `${ManagerState.activeSession.id}_win${winIdx}_grp${g.id}`;
          ManagerState.collapsedGroups.add(groupKey);
        });
      });
      document.querySelectorAll('.window-card').forEach(c => c.classList.add('collapsed'));
      document.querySelectorAll('.tab-group-card').forEach(c => c.classList.add('collapsed'));
      showToast('▴ Все окна и группы свернуты');
    });
  }

  // --- Keyboard Shortcuts ---
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      DOM.sidebar.classList.toggle('collapsed');
    }
    if ((e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'f')) && document.activeElement !== DOM.searchInput) {
      e.preventDefault();
      DOM.searchInput.focus();
    }
    if (e.key === 'Escape') {
      if (!DOM.ytPlaylistModal.classList.contains('hidden')) {
        closeYouTubePlaylistModal();
        return;
      }
      if (document.activeElement === DOM.searchInput) {
        DOM.searchInput.value = '';
        ManagerState.searchQuery = '';
        DOM.btnClearSearch.classList.add('hidden');
        renderWindowsAndGroups();
        DOM.searchInput.blur();
      }
    }
  });

  // --- Initial Bootstrap ---
  await fetchLiveSession();
  await fetchSavedSessions();

  // Однократная очистка старой ошибочной истории Session Buddy
  if (!localStorage.getItem('chrome_bridge_old_sb_cleared_v2')) {
    const stored = await chrome.storage.local.get(['saved_sessions']);
    const allSaved = Array.isArray(stored.saved_sessions) ? stored.saved_sessions : [];
    const nativeOnly = allSaved.filter(s => s && s.id && !s.id.startsWith('sb_'));
    const sbCount = allSaved.length - nativeOnly.length;
    if (sbCount > 0) {
      await chrome.storage.local.set({ saved_sessions: nativeOnly });
      ManagerState.savedSessions = nativeOnly;
      showToast(`🧹 Удалено ${sbCount} старых сессий Session Buddy. Ваша родная сессия сохранена!`, 4000);
    }
    localStorage.setItem('chrome_bridge_old_sb_cleared_v2', 'true');
  }

  renderSidebarSessions();

  if (ManagerState.liveSession) {
    selectSession(ManagerState.liveSession);
  } else if (ManagerState.savedSessions.length > 0) {
    selectSession(ManagerState.savedSessions[0]);
  }

  // Auto-refresh live session whenever manager tab regains focus or visibility
  window.addEventListener('focus', async () => {
    await fetchLiveSession();
    renderSidebarSessions();
    if (ManagerState.activeSession && ManagerState.activeSession.isLive && ManagerState.liveSession) {
      selectSession(ManagerState.liveSession);
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      await fetchLiveSession();
      renderSidebarSessions();
      if (ManagerState.activeSession && ManagerState.activeSession.isLive && ManagerState.liveSession) {
        selectSession(ManagerState.liveSession);
      }
    }
  });
});

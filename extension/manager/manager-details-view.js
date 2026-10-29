/**
 * Chrome Agent Bridge — Manager Details View & Tabs Renderer
 * Renders the active session panels, windows, tab groups, checkboxes, and executes batch/in-place actions.
 */

function clearSelection() {
  ManagerState.selectedItems.windows.clear();
  ManagerState.selectedItems.groups.clear();
  ManagerState.selectedItems.tabs.clear();
  updateBatchBar();
  document.querySelectorAll('.session-cb').forEach(cb => {
    cb.checked = false;
    cb.indeterminate = false;
  });
  document.querySelectorAll('.tab-item.is-selected, .window-card.is-selected').forEach(el => {
    el.classList.remove('is-selected');
  });
}

function updateBatchBar() {
  if (!DOM.batchActionBar) return;

  const winCount = ManagerState.selectedItems.windows.size;
  const grpCount = ManagerState.selectedItems.groups.size;
  const tabCount = ManagerState.selectedItems.tabs.size;
  const totalSelected = winCount + grpCount + tabCount;

  if (totalSelected === 0) {
    DOM.batchActionBar.classList.add('hidden');
    return;
  }

  DOM.batchActionBar.classList.remove('hidden');

  const parts = [];
  if (winCount > 0) parts.push(`${winCount} ${getNoun(winCount, 'окно', 'окна', 'окон')}`);
  if (grpCount > 0) parts.push(`${grpCount} ${getNoun(grpCount, 'группу', 'группы', 'групп')}`);
  if (tabCount > 0) parts.push(`${tabCount} ${getNoun(tabCount, 'вкладку', 'вкладки', 'вкладок')}`);

  DOM.batchSelectedSummary.textContent = `Выбрано: ${parts.join(', ')}`;
}

function checkIfWholeWindowSelected(winIndex, totalTabsInWin, winCard) {
  let selectedTabCount = 0;
  for (let t = 0; t < totalTabsInWin; t++) {
    if (ManagerState.selectedItems.tabs.has(`win_${winIndex}_tab_${t}`)) {
      selectedTabCount++;
    }
  }
  const winCb = winCard ? winCard.querySelector('.session-cb-window') : null;
  if (selectedTabCount === totalTabsInWin && totalTabsInWin > 0) {
    ManagerState.selectedItems.windows.add(`win_${winIndex}`);
    if (winCb) {
      winCb.checked = true;
      winCb.indeterminate = false;
    }
    if (winCard) winCard.classList.add('is-selected');
  } else if (selectedTabCount > 0) {
    ManagerState.selectedItems.windows.delete(`win_${winIndex}`);
    if (winCb) {
      winCb.checked = false;
      winCb.indeterminate = true;
    }
    if (winCard) winCard.classList.remove('is-selected');
  } else {
    ManagerState.selectedItems.windows.delete(`win_${winIndex}`);
    if (winCb) {
      winCb.checked = false;
      winCb.indeterminate = false;
    }
    if (winCard) winCard.classList.remove('is-selected');
  }
}

function createTabItemElement(tab, context = {}) {
  const item = document.createElement('div');
  const isLive = Boolean(ManagerState.activeSession?.isLive);
  const winIdx = context.winIndex !== undefined ? context.winIndex : 0;
  const tabIdx = context.tabIndex !== undefined ? context.tabIndex : 0;
  const tabKey = `win_${winIdx}_tab_${tabIdx}`;
  const isSelected = ManagerState.selectedItems.tabs.has(tabKey) || ManagerState.selectedItems.windows.has(`win_${winIdx}`);

  item.className = `tab-item ${isSelected ? 'is-selected' : ''}`;

  const domain = extractDomain(tab.url);
  const faviconUrl = tab.favIconUrl || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '');

  const faviconHtml = faviconUrl
    ? `<img src="${escapeHtml(faviconUrl)}" alt="">`
    : '🌐';

  const pinnedBadge = tab.pinned ? '<span class="tab-badge pinned">📌 PIN</span>' : '';
  const activeBadge = tab.active ? '<span class="tab-badge active-badge">★ ACTIVE</span>' : '';

  const tabCheckboxHtml = !isLive
    ? `<label class="session-cb-label" title="Выбрать вкладку"><input type="checkbox" class="session-cb session-cb-tab" data-win-idx="${winIdx}" data-tab-idx="${tabIdx}" ${isSelected ? 'checked' : ''}></label>`
    : '';

  const tabDeleteBtnHtml = !isLive
    ? `<button class="tab-hover-btn btn-delete-tab" data-win-idx="${winIdx}" data-tab-idx="${tabIdx}" title="Удалить эту вкладку из сохранённой сессии">🗑️</button>`
    : '';

  item.innerHTML = `
    ${tabCheckboxHtml}
    <div class="tab-favicon">${faviconHtml}</div>
    <div class="tab-details">
      <span class="tab-title">${highlightQuery(tab.title || tab.url || 'Новая вкладка', ManagerState.searchQuery)}</span>
      <span class="tab-domain">${highlightQuery(domain, ManagerState.searchQuery)}</span>
    </div>
    <div class="tab-badges-group">
      ${pinnedBadge}
      ${activeBadge}
      <button class="tab-hover-btn btn-copy-url" title="Скопировать ссылку">🔗</button>
      ${tabDeleteBtnHtml}
    </div>
  `;

  // Fallback on broken favicon image (Pure JS, zero CSP violations)
  const favImg = item.querySelector('.tab-favicon img');
  if (favImg) {
    favImg.addEventListener('error', () => {
      const parent = favImg.parentElement;
      if (parent) parent.textContent = '🌐';
    });
  }

  // Tab checkbox change handler
  const tabCb = item.querySelector('.session-cb-tab');
  if (tabCb) {
    tabCb.addEventListener('click', (e) => e.stopPropagation());
    tabCb.addEventListener('change', (e) => {
      e.stopPropagation();
      const checked = tabCb.checked;
      if (checked) {
        ManagerState.selectedItems.tabs.add(tabKey);
        item.classList.add('is-selected');
      } else {
        ManagerState.selectedItems.tabs.delete(tabKey);
        item.classList.remove('is-selected');
        if (context.groupId) {
          ManagerState.selectedItems.groups.delete(`win_${winIdx}_grp_${context.groupId}`);
          const parentGrpCb = item.closest('.tab-group-card')?.querySelector('.session-cb-group');
          if (parentGrpCb) parentGrpCb.checked = false;
        }
        ManagerState.selectedItems.windows.delete(`win_${winIdx}`);
        const parentWinCb = item.closest('.window-card')?.querySelector('.session-cb-window');
        if (parentWinCb) {
          parentWinCb.checked = false;
        }
      }

      const winCard = item.closest('.window-card');
      const totalTabsInWin = ManagerState.activeSession?.data?.[winIdx]?.tabs?.length || 0;
      checkIfWholeWindowSelected(winIdx, totalTabsInWin, winCard);
      updateBatchBar();
    });
  }

  // Delete single tab button
  const btnDelTab = item.querySelector('.btn-delete-tab');
  if (btnDelTab) {
    btnDelTab.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabHoverPreview(true);
      deleteTabFromSession(winIdx, tabIdx);
    });
  }

  // Hover preview listeners
  item.addEventListener('mouseenter', () => {
    if (isMouseOverCard) return;

    if (item === activePreviewItem) {
      if (hoverHideTimer) {
        clearTimeout(hoverHideTimer);
        hoverHideTimer = null;
      }
      return;
    }

    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }

    if (hoverShowTimer) clearTimeout(hoverShowTimer);
    hoverShowTimer = setTimeout(() => {
      if (!isMouseOverCard) {
        showTabHoverPreview(tab, context, item);
      }
    }, HOVER_SHOW_DELAY);
  });

  item.addEventListener('mouseleave', () => {
    if (hoverShowTimer) {
      clearTimeout(hoverShowTimer);
      hoverShowTimer = null;
    }
    hideTabHoverPreview(false);
  });

  // Click handler: Point opening (switches to tab if already open, otherwise opens directly in Chrome!)
  item.addEventListener('click', (e) => {
    if (e.target.closest('.btn-copy-url') || e.target.closest('.btn-delete-tab') || e.target.closest('.session-cb-label')) return;
    if (!tab.url) return;
    openOrSwitchToTab(tab);
  });

  // Copy URL button
  const btnCopy = item.querySelector('.btn-copy-url');
  if (btnCopy) {
    btnCopy.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabHoverPreview(true);
      if (tab.url) {
        navigator.clipboard.writeText(tab.url);
        showToast('URL скопирован в буфер обмена!');
      }
    });
  }

  return item;
}

function renderWindowsAndGroups() {
  if (!DOM.sessionContent) return;
  DOM.sessionContent.innerHTML = '';

  const filter = (ManagerState.searchQuery || '').trim().toLowerCase();
  let totalMatches = 0;

  const windows = ManagerState.activeSession ? (ManagerState.activeSession.data || []) : [];

  if (!ManagerState.activeSession || windows.length === 0) {
    DOM.sessionContent.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 40px;">
        ${filter ? `В этой сессии нет вкладок по запросу «${escapeHtml(filter)}».` : 'В этой сессии нет открытых окон или вкладок.'}
      </div>
    `;
    if (filter) {
      DOM.searchBanner.classList.remove('hidden');
      DOM.searchMatchCount.textContent = '0';
      DOM.searchQueryText.textContent = filter;
    } else {
      DOM.searchBanner.classList.add('hidden');
    }
    return;
  }

  const sessionTitleMatches = (ManagerState.activeSession.name || ManagerState.activeSession.title || '').toLowerCase().includes(filter);
  const hasAnyTabMatch = windows.some(w =>
    (w.tabs || []).some(t => `${t.title || ''} ${t.url || ''}`.toLowerCase().includes(filter))
  );

  // Calculate total matches in this session
  if (filter) {
    windows.forEach(win => {
      (win.tabs || []).forEach(t => {
        const text = `${t.title || ''} ${t.url || ''}`.toLowerCase();
        if (text.includes(filter)) {
          totalMatches++;
        }
      });
      (win.groups || []).forEach(g => {
        if ((g.title || '').toLowerCase().includes(filter)) {
          totalMatches++;
        }
      });
    });
    if (totalMatches === 0 && sessionTitleMatches) {
      totalMatches = 1;
    }
  }

  windows.forEach((win, winIndex) => {
    const winTabs = win.tabs || [];
    const winGroups = win.groups || [];

    // Group tabs by groupId, preserving original tabIndex
    const groupedTabsMap = new Map();
    const ungroupedTabs = [];

    winTabs.forEach((tab, originalTabIndex) => {
      const itemWithIdx = { tab, tabIndex: originalTabIndex };
      if (tab.groupId && tab.groupId > 0) {
        if (!groupedTabsMap.has(tab.groupId)) {
          groupedTabsMap.set(tab.groupId, []);
        }
        groupedTabsMap.get(tab.groupId).push(itemWithIdx);
      } else {
        ungroupedTabs.push(itemWithIdx);
      }
    });

    // Filter tabs if search is active AND showAllInCurrentSession is false
    const matchesTab = (item) => {
      const t = item.tab;
      if (!filter || ManagerState.showAllInCurrentSession) return true;
      if (hasAnyTabMatch) {
        const text = `${t.title || ''} ${t.url || ''}`.toLowerCase();
        return text.includes(filter);
      }
      return sessionTitleMatches;
    };

    const filteredUngrouped = ungroupedTabs.filter(matchesTab);
    let winMatchingTabsCount = filteredUngrouped.length;

    const filteredGroups = [];
    winGroups.forEach(g => {
      const tabsInGroup = groupedTabsMap.get(g.id) || [];
      const groupTitleMatch = (g.title || '').toLowerCase().includes(filter);
      const filteredGroupTabs = tabsInGroup.filter(item => matchesTab(item) || (!ManagerState.showAllInCurrentSession && groupTitleMatch));
      if (filteredGroupTabs.length > 0 || (!filter && tabsInGroup.length > 0) || (ManagerState.showAllInCurrentSession && tabsInGroup.length > 0)) {
        filteredGroups.push({
          groupDef: g,
          tabs: filteredGroupTabs
        });
        winMatchingTabsCount += filteredGroupTabs.length;
      }
    });

    if (filter && !ManagerState.showAllInCurrentSession && winMatchingTabsCount === 0) {
      return;
    }

    // Create Window Card DOM
    const winKey = `${ManagerState.activeSession.id}_win_${winIndex}`;
    const isWinCollapsed = ManagerState.collapsedWindows.has(winKey);
    const isLive = Boolean(ManagerState.activeSession.isLive);
    const isWinSelected = ManagerState.selectedItems.windows.has(`win_${winIndex}`);

    const winCard = document.createElement('div');
    winCard.className = `window-card ${isWinCollapsed ? 'collapsed' : ''} ${isWinSelected ? 'is-selected' : ''}`;

    const winTitle = `Окно ${winIndex + 1}`;
    const winBadge = `${winTabs.length} вкладок, ${winGroups.length} групп`;

    const winCheckboxHtml = !isLive
      ? `<label class="session-cb-label" title="Выбрать окно для массовых действий"><input type="checkbox" class="session-cb session-cb-window" data-win-idx="${winIndex}" ${isWinSelected ? 'checked' : ''}></label>`
      : '';

    const winDeleteBtnHtml = !isLive
      ? `<button class="btn-mini-action btn-danger-action btn-delete-window" data-win-idx="${winIndex}" title="Удалить это окно из сохранённой сессии">🗑️ Удалить окно</button>`
      : '';

    winCard.innerHTML = `
      <div class="window-header" title="Кликните, чтобы свернуть/развернуть окно">
        <div class="window-title-group">
          ${winCheckboxHtml}
          <span class="window-toggle-arrow">▼</span>
          <span class="window-icon">🪟</span>
          <span class="window-title">${winTitle}</span>
          <span class="window-stats">(${winBadge})</span>
        </div>
        <div class="window-actions-right">
          <button class="btn-mini-action btn-restore-window" data-win-idx="${winIndex}" title="Восстановить только это окно">
            ⚡ Восстановить окно
          </button>
          ${winDeleteBtnHtml}
        </div>
      </div>
      <div class="window-body"></div>
    `;

    // Window collapse/expand toggle
    winCard.querySelector('.window-header').addEventListener('click', (e) => {
      if (e.target.closest('.btn-mini-action') || e.target.closest('.session-cb-label')) return;
      if (winCard.classList.contains('collapsed')) {
        winCard.classList.remove('collapsed');
        ManagerState.collapsedWindows.delete(winKey);
      } else {
        winCard.classList.add('collapsed');
        ManagerState.collapsedWindows.add(winKey);
      }
    });

    // Window Checkbox
    const winCb = winCard.querySelector('.session-cb-window');
    if (winCb) {
      winCb.addEventListener('click', (e) => e.stopPropagation());
      winCb.addEventListener('change', (e) => {
        e.stopPropagation();
        const checked = winCb.checked;
        const winKeyId = `win_${winIndex}`;

        if (checked) {
          ManagerState.selectedItems.windows.add(winKeyId);
          winCard.classList.add('is-selected');
        } else {
          ManagerState.selectedItems.windows.delete(winKeyId);
          winCard.classList.remove('is-selected');
        }

        // Cascade to groups
        winGroups.forEach(g => {
          const gKey = `win_${winIndex}_grp_${g.id}`;
          if (checked) ManagerState.selectedItems.groups.add(gKey);
          else ManagerState.selectedItems.groups.delete(gKey);
        });

        // Cascade to tabs
        winTabs.forEach((_, tIdx) => {
          const tKey = `win_${winIndex}_tab_${tIdx}`;
          if (checked) ManagerState.selectedItems.tabs.add(tKey);
          else ManagerState.selectedItems.tabs.delete(tKey);
        });

        winCard.querySelectorAll('.session-cb-group, .session-cb-tab').forEach(c => {
          c.checked = checked;
        });
        winCard.querySelectorAll('.tab-item').forEach(itemEl => {
          itemEl.classList.toggle('is-selected', checked);
        });

        updateBatchBar();
      });
    }

    // Delete Window button handler
    const btnDelWin = winCard.querySelector('.btn-delete-window');
    if (btnDelWin) {
      btnDelWin.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteWindowFromSession(winIndex);
      });
    }

    const winBody = winCard.querySelector('.window-body');

    // 1. Render Colored Tab Groups
    filteredGroups.forEach(({ groupDef, tabs }) => {
      const groupColor = (groupDef.color || 'grey').toLowerCase();
      const colorHex = CHROME_GROUP_COLORS[groupColor] || '#9aa0a6';
      const groupKey = `${ManagerState.activeSession.id}_win${winIndex}_grp${groupDef.id}`;
      const isCollapsed = ManagerState.collapsedGroups.has(groupKey) || (Boolean(groupDef.collapsed) && !ManagerState.collapsedGroups.has(`exp_${groupKey}`));
      const isGrpSelected = ManagerState.selectedItems.groups.has(`win_${winIndex}_grp_${groupDef.id}`) || ManagerState.selectedItems.windows.has(`win_${winIndex}`);

      const groupCard = document.createElement('div');
      groupCard.className = `tab-group-card color-${groupColor} ${isCollapsed ? 'collapsed' : ''}`;

      const grpCheckboxHtml = !isLive
        ? `<label class="session-cb-label" title="Выбрать группу для массовых действий"><input type="checkbox" class="session-cb session-cb-group" data-win-idx="${winIndex}" data-group-id="${groupDef.id}" ${isGrpSelected ? 'checked' : ''}></label>`
        : '';

      const grpDeleteBtnHtml = !isLive
        ? `<button class="btn-mini-action btn-danger-action btn-delete-group" data-win-idx="${winIndex}" data-group-id="${groupDef.id}" title="Удалить эту группу из сохранённой сессии">🗑️ Удалить группу</button>`
        : '';

      groupCard.innerHTML = `
        <div class="tab-group-header">
          <div class="tab-group-left">
            ${grpCheckboxHtml}
            <span class="group-toggle-arrow">▼</span>
            <span class="group-color-chip" style="background: ${colorHex};"></span>
            <span class="group-title">${groupDef.title || 'Без названия'}</span>
            <span class="group-count">${tabs.length} вкл.</span>
          </div>
          <div class="tab-group-actions-right">
            <button class="btn-mini-action btn-restore-group" title="Восстановить только эту группу в текущее окно">
              ⚡ Восстановить группу
            </button>
            ${grpDeleteBtnHtml}
          </div>
        </div>
        <div class="tab-group-items"></div>
      `;

      groupCard.querySelector('.tab-group-header').addEventListener('click', (e) => {
        if (e.target.closest('.btn-mini-action') || e.target.closest('.session-cb-label')) return;
        if (groupCard.classList.contains('collapsed')) {
          groupCard.classList.remove('collapsed');
          ManagerState.collapsedGroups.delete(groupKey);
          ManagerState.collapsedGroups.add(`exp_${groupKey}`);
        } else {
          groupCard.classList.add('collapsed');
          ManagerState.collapsedGroups.add(groupKey);
          ManagerState.collapsedGroups.delete(`exp_${groupKey}`);
        }
      });

      const grpCb = groupCard.querySelector('.session-cb-group');
      if (grpCb) {
        grpCb.addEventListener('click', (e) => e.stopPropagation());
        grpCb.addEventListener('change', (e) => {
          e.stopPropagation();
          const checked = grpCb.checked;
          const gKey = `win_${winIndex}_grp_${groupDef.id}`;

          if (checked) {
            ManagerState.selectedItems.groups.add(gKey);
          } else {
            ManagerState.selectedItems.groups.delete(gKey);
            ManagerState.selectedItems.windows.delete(`win_${winIndex}`);
            if (winCb) winCb.checked = false;
          }

          tabs.forEach(item => {
            const tKey = `win_${winIndex}_tab_${item.tabIndex}`;
            if (checked) ManagerState.selectedItems.tabs.add(tKey);
            else ManagerState.selectedItems.tabs.delete(tKey);
          });

          groupCard.querySelectorAll('.session-cb-tab').forEach(c => {
            c.checked = checked;
          });
          groupCard.querySelectorAll('.tab-item').forEach(itemEl => {
            itemEl.classList.toggle('is-selected', checked);
          });

          checkIfWholeWindowSelected(winIndex, winTabs.length, winCard);
          updateBatchBar();
        });
      }

      const btnDelGrp = groupCard.querySelector('.btn-delete-group');
      if (btnDelGrp) {
        btnDelGrp.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteGroupFromSession(winIndex, groupDef.id);
        });
      }

      groupCard.querySelector('.btn-restore-group').addEventListener('click', (e) => {
        e.stopPropagation();
        restoreGroup(groupDef);
      });

      const groupItemsContainer = groupCard.querySelector('.tab-group-items');
      tabs.forEach(item => {
        groupItemsContainer.appendChild(createTabItemElement(item.tab, {
          winIndex,
          tabIndex: item.tabIndex,
          groupId: groupDef.id,
          groupTitle: groupDef.title,
          groupColor,
          windowTitle: winTitle
        }));
      });

      winBody.appendChild(groupCard);
    });

    // 2. Render Ungrouped Tabs
    if (filteredUngrouped.length > 0) {
      const ungroupedCard = document.createElement('div');
      ungroupedCard.className = 'ungrouped-card';
      ungroupedCard.innerHTML = `
        <div class="ungrouped-title">Вне групп (${filteredUngrouped.length})</div>
      `;
      filteredUngrouped.forEach(item => {
        ungroupedCard.appendChild(createTabItemElement(item.tab, {
          winIndex,
          tabIndex: item.tabIndex,
          isUngrouped: true,
          windowTitle: winTitle
        }));
      });
      winBody.appendChild(ungroupedCard);
    }

    // Restore Window Handler
    winCard.querySelector('.btn-restore-window').addEventListener('click', () => {
      restoreWindow(winIndex);
    });

    DOM.sessionContent.appendChild(winCard);
  });

  // Update search banner visibility and toggle button
  if (filter) {
    DOM.searchBanner.classList.remove('hidden');

    if (ManagerState.showAllInCurrentSession) {
      if (DOM.searchBannerLabel) {
        DOM.searchBannerLabel.innerHTML = `Показаны <strong>все ${ManagerState.activeSession.tabCount || 0} вкладок</strong> сессии (совпадений: <strong style="color: #38bdf8;">${totalMatches}</strong> по «${escapeHtml(filter)}»)`;
      }
      if (DOM.btnToggleShowAllInSession) {
        DOM.btnToggleShowAllInSession.classList.add('active');
        if (DOM.toggleShowAllIcon) DOM.toggleShowAllIcon.textContent = '🔍';
        if (DOM.toggleShowAllText) DOM.toggleShowAllText.textContent = `Только совпадения (${totalMatches})`;
        DOM.btnToggleShowAllInSession.title = `Вернуться к показу только найденных вкладок (${totalMatches} шт.)`;
      }
    } else {
      if (DOM.searchBannerLabel) {
        DOM.searchBannerLabel.innerHTML = `Найдено: <strong>${totalMatches}</strong> вкладок по запросу «<span id="searchQueryText">${escapeHtml(filter)}</span>»`;
      }
      if (DOM.btnToggleShowAllInSession) {
        DOM.btnToggleShowAllInSession.classList.remove('active');
        if (DOM.toggleShowAllIcon) DOM.toggleShowAllIcon.textContent = '👁️';
        if (DOM.toggleShowAllText) DOM.toggleShowAllText.textContent = `Показать всё в этой сессии (${ManagerState.activeSession.tabCount || 0})`;
        DOM.btnToggleShowAllInSession.title = `Показать все ${ManagerState.activeSession.tabCount || 0} вкладок этой сессии с подсветкой совпадений`;
      }
    }

    if (totalMatches === 0 && !ManagerState.showAllInCurrentSession) {
      DOM.sessionContent.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 50px 20px;">
          В сессии «<strong>${escapeHtml(ManagerState.activeSession?.name || ManagerState.activeSession?.title || 'сессия')}</strong>» не найдено вкладок по запросу «${escapeHtml(filter)}».
        </div>
      `;
    }
  } else {
    DOM.searchBanner.classList.add('hidden');
  }
}

function renderActiveSessionDetails() {
  if (!ManagerState.activeSession) return;

  if (ManagerState.isEditingTitle) {
    ManagerState.isEditingTitle = false;
  }

  DOM.selectedSessionTitle.textContent = ManagerState.activeSession.name || ManagerState.activeSession.title || 'Сессия';
  if (ManagerState.activeSession.isLive) {
    DOM.selectedSessionTitle.classList.remove('can-edit');
    DOM.selectedSessionTitle.removeAttribute('title');
    DOM.sessionTitleInput.classList.add('hidden');
    DOM.selectedSessionTitle.classList.remove('hidden');
    DOM.btnEditTitleDirect.classList.add('hidden');
    DOM.btnRenameCurrent.classList.add('hidden');

    DOM.selectedSessionTag.textContent = 'LIVE';
    DOM.selectedSessionTag.className = 'session-tag live';
    DOM.metaDate.textContent = 'Живое состояние браузера';
    DOM.btnSaveLiveAsNew.classList.remove('hidden');
    DOM.btnDeleteCurrent.classList.add('hidden');
    DOM.btnRefreshLive.classList.remove('hidden');
    DOM.btnRestoreAll.style.display = 'none';
  } else {
    DOM.selectedSessionTitle.classList.add('can-edit');
    DOM.selectedSessionTitle.setAttribute('title', 'Кликните, чтобы переименовать');
    DOM.sessionTitleInput.classList.add('hidden');
    DOM.selectedSessionTitle.classList.remove('hidden');
    DOM.btnEditTitleDirect.classList.remove('hidden');
    DOM.btnRenameCurrent.classList.remove('hidden');

    DOM.selectedSessionTag.textContent = 'SAVED';
    DOM.selectedSessionTag.className = 'session-tag saved';
    const dateStr = new Date(ManagerState.activeSession.timestamp).toLocaleString('ru-RU', {
      dateStyle: 'long',
      timeStyle: 'short'
    });
    DOM.metaDate.textContent = dateStr;
    DOM.btnSaveLiveAsNew.classList.add('hidden');
    DOM.btnDeleteCurrent.classList.remove('hidden');
    DOM.btnRefreshLive.classList.add('hidden');
    DOM.btnRestoreAll.style.display = 'inline-flex';
  }

  DOM.metaStats.textContent = `${ManagerState.activeSession.windowCount || 1} окон, ${ManagerState.activeSession.tabCount || 0} вкладок, ${ManagerState.activeSession.groupCount || 0} групп`;

  renderWindowsAndGroups();
}

// --- Restorations ---

function restoreFullSession(session = ManagerState.activeSession) {
  if (!session) return;
  if (session.isLive) {
    showToast('Это живая сессия — все вкладки уже открыты в браузере.');
    return;
  }

  showToast(`Восстановление сессии «${session.name}»...`);
  chrome.runtime.sendMessage({
    action: 'restore_session',
    params: { sessionId: session.id }
  }, (res) => {
    if (res && res.success) {
      showToast(`✨ Сессия восстановлена! (${res.result.tabs_restored} вкл., ${res.result.groups_restored} групп)`);
      fetchLiveSession();
    } else {
      showToast(`Ошибка восстановления: ${res?.error || 'Неизвестная ошибка'}`);
    }
  });
}

function restoreWindow(winIndex) {
  if (!ManagerState.activeSession) return;
  showToast(`Восстановление Окна #${winIndex + 1}...`);
  chrome.runtime.sendMessage({
    action: 'restore_session',
    params: {
      sessionId: ManagerState.activeSession.id,
      targetWindowIndex: winIndex
    }
  }, (res) => {
    if (res && res.success) {
      showToast(`✨ Окно #${winIndex + 1} успешно восстановлено!`);
      fetchLiveSession();
    } else {
      showToast(`Ошибка: ${res?.error || 'Не удалось восстановить окно'}`);
    }
  });
}

function restoreGroup(groupDef) {
  if (!ManagerState.activeSession) return;
  showToast(`Восстановление группы «${groupDef.title || 'Группа'}»...`);
  chrome.runtime.sendMessage({
    action: 'restore_session',
    params: {
      sessionId: ManagerState.activeSession.id,
      targetGroupId: groupDef.id
    }
  }, (res) => {
    if (res && res.success) {
      showToast(`✨ Группа «${groupDef.title}» восстановлена в текущее окно!`);
      fetchLiveSession();
    } else {
      showToast(`Ошибка восстановления группы: ${res?.error || ''}`);
    }
  });
}

// --- In-Place Saved Session Deletions ---

function deleteWindowFromSession(winIndex) {
  if (!ManagerState.activeSession || ManagerState.activeSession.isLive) return;
  if (!ManagerState.activeSession.data || !ManagerState.activeSession.data[winIndex]) return;

  const winTitle = `Окно ${winIndex + 1}`;
  const winTabsCount = (ManagerState.activeSession.data[winIndex].tabs || []).length;
  if (!confirm(`Удалить ${winTitle} (${winTabsCount} вкл.) из сохранённой сессии?`)) {
    return;
  }

  ManagerState.activeSession.data.splice(winIndex, 1);
  showToast(`🗑️ ${winTitle} удалено из сессии.`);
  persistUpdatedSavedSession(ManagerState.activeSession);
}

function deleteGroupFromSession(winIndex, groupId) {
  if (!ManagerState.activeSession || ManagerState.activeSession.isLive) return;
  const win = ManagerState.activeSession.data && ManagerState.activeSession.data[winIndex];
  if (!win) return;

  const grp = (win.groups || []).find(g => String(g.id) === String(groupId));
  const grpTitle = grp ? grp.title || 'Без названия' : 'Группа';

  if (!confirm(`Удалить группу «${grpTitle}» и все её вкладки из сохранённой сессии?`)) {
    return;
  }

  win.tabs = (win.tabs || []).filter(t => String(t.groupId) !== String(groupId));
  win.groups = (win.groups || []).filter(g => String(g.id) !== String(groupId));

  showToast(`🗑️ Группа «${grpTitle}» удалена.`);
  persistUpdatedSavedSession(ManagerState.activeSession);
}

function deleteTabFromSession(winIndex, tabIndex) {
  if (!ManagerState.activeSession || ManagerState.activeSession.isLive) return;
  const win = ManagerState.activeSession.data && ManagerState.activeSession.data[winIndex];
  if (!win || !win.tabs || !win.tabs[tabIndex]) return;

  const tab = win.tabs[tabIndex];
  const tabTitle = tab.title || tab.url || 'Вкладка';

  win.tabs.splice(tabIndex, 1);
  showToast(`🗑️ Вкладка удалена: ${tabTitle.substring(0, 30)}...`);
  persistUpdatedSavedSession(ManagerState.activeSession);
}

// --- Batch Operations ---

async function deleteSelectedItems() {
  if (!ManagerState.activeSession || ManagerState.activeSession.isLive) {
    showToast('Удаление доступно только для сохранённых сессий.');
    return;
  }

  const winCount = ManagerState.selectedItems.windows.size;
  const grpCount = ManagerState.selectedItems.groups.size;
  const tabCount = ManagerState.selectedItems.tabs.size;

  if (winCount === 0 && grpCount === 0 && tabCount === 0) {
    showToast('Ничего не выбрано для удаления.');
    return;
  }

  const parts = [];
  if (winCount > 0) parts.push(`${winCount} ${getNoun(winCount, 'окно', 'окна', 'окон')}`);
  if (grpCount > 0) parts.push(`${grpCount} ${getNoun(grpCount, 'группу', 'группы', 'групп')}`);
  if (tabCount > 0) parts.push(`${tabCount} ${getNoun(tabCount, 'вкладку', 'вкладки', 'вкладок')}`);

  const msg = `Удалить из сессии «${ManagerState.activeSession.name}» выбранное:\n• ${parts.join('\n• ')}?`;
  if (!confirm(msg)) return;

  const windows = ManagerState.activeSession.data || [];
  const updatedWindows = [];

  windows.forEach((win, winIdx) => {
    if (ManagerState.selectedItems.windows.has(`win_${winIdx}`)) {
      return;
    }

    const winTabs = win.tabs || [];
    const winGroups = win.groups || [];

    const remainingTabs = winTabs.filter((tab, tabIdx) => {
      if (ManagerState.selectedItems.tabs.has(`win_${winIdx}_tab_${tabIdx}`)) {
        return false;
      }
      if (tab.groupId && ManagerState.selectedItems.groups.has(`win_${winIdx}_grp_${tab.groupId}`)) {
        return false;
      }
      return true;
    });

    const remainingGroupIds = new Set(
      remainingTabs.map(t => t.groupId).filter(gid => gid !== undefined && gid !== null && gid > 0)
    );
    const remainingGroups = winGroups.filter(g => {
      if (ManagerState.selectedItems.groups.has(`win_${winIdx}_grp_${g.id}`)) return false;
      return remainingGroupIds.has(g.id);
    });

    if (remainingTabs.length > 0) {
      updatedWindows.push({
        ...win,
        tabs: remainingTabs,
        groups: remainingGroups
      });
    }
  });

  ManagerState.activeSession.data = updatedWindows;
  showToast(`🗑️ Выбранные элементы успешно удалены!`);
  await persistUpdatedSavedSession(ManagerState.activeSession);
}

async function restoreSelectedItems() {
  if (!ManagerState.activeSession) return;

  const winCount = ManagerState.selectedItems.windows.size;
  const grpCount = ManagerState.selectedItems.groups.size;
  const tabCount = ManagerState.selectedItems.tabs.size;

  if (winCount === 0 && grpCount === 0 && tabCount === 0) {
    showToast('Ничего не выбрано для восстановления.');
    return;
  }

  showToast('⚡ Восстановление выбранных окон и вкладок в Chrome...');

  const windows = ManagerState.activeSession.data || [];

  for (let winIdx = 0; winIdx < windows.length; winIdx++) {
    const win = windows[winIdx];
    const isWholeWinSelected = ManagerState.selectedItems.windows.has(`win_${winIdx}`);
    const winTabs = win.tabs || [];
    const winGroups = win.groups || [];

    let tabsToRestore = [];
    if (isWholeWinSelected) {
      tabsToRestore = [...winTabs];
    } else {
      tabsToRestore = winTabs.filter((tab, tabIdx) => {
        if (ManagerState.selectedItems.tabs.has(`win_${winIdx}_tab_${tabIdx}`)) return true;
        if (tab.groupId && ManagerState.selectedItems.groups.has(`win_${winIdx}_grp_${tab.groupId}`)) return true;
        return false;
      });
    }

    if (tabsToRestore.length === 0) continue;

    const firstTab = tabsToRestore[0];
    let newWin;
    try {
      newWin = await chrome.windows.create({
        url: sanitizeUrl(firstTab.url),
        focused: true
      });
    } catch (e) {
      newWin = await chrome.windows.create({ url: 'about:blank', focused: true });
    }

    const firstTabId = newWin.tabs && newWin.tabs[0] ? newWin.tabs[0].id : null;
    if (firstTab.pinned && firstTabId) {
      try { await chrome.tabs.update(firstTabId, { pinned: true }); } catch (e) {}
    }

    const createdRecords = [{ savedTab: firstTab, tabId: firstTabId }];

    for (let i = 1; i < tabsToRestore.length; i++) {
      const t = tabsToRestore[i];
      try {
        const crTab = await chrome.tabs.create({
          windowId: newWin.id,
          url: sanitizeUrl(t.url),
          pinned: Boolean(t.pinned)
        });
        if (crTab) createdRecords.push({ savedTab: t, tabId: crTab.id });
      } catch (err) {}
    }

    // Recreate groups
    const relevantGroupIds = new Set(tabsToRestore.map(t => t.groupId).filter(Boolean));
    for (const gDef of winGroups) {
      if (!relevantGroupIds.has(gDef.id)) continue;
      const tabIdsInGroup = createdRecords
        .filter(rec => rec.tabId && String(rec.savedTab.groupId) === String(gDef.id) && !rec.savedTab.pinned)
        .map(rec => rec.tabId);

      if (tabIdsInGroup.length > 0) {
        try {
          const newGroupId = await chrome.tabs.group({
            tabIds: tabIdsInGroup,
            createProperties: { windowId: newWin.id }
          });
          const color = (gDef.color || 'grey').toLowerCase();
          await chrome.tabGroups.update(newGroupId, {
            title: gDef.title || '',
            color: color,
            collapsed: Boolean(gDef.collapsed)
          });
        } catch (grpErr) {}
      }
    }
  }

  showToast('✨ Выбранные элементы успешно восстановлены в Chrome!');
  fetchLiveSession();
  clearSelection();
}

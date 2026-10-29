/**
 * Chrome Agent Bridge - Popup Actions View Controller
 * Handles refresh, deduplication, and ungrouping operations.
 */

function initActionsController({ tabCountElem, btnRefresh, btnDedupe, btnUngroup, showToast }) {
  // Update tab counter UI
  function renderStatus(tabCount) {
    if (typeof tabCount === 'number' && tabCountElem) {
      tabCountElem.textContent = tabCount;
    }
  }

  // Refresh tabs and update counter
  async function refreshTabs(showNotification = false) {
    try {
      const tabs = await chrome.tabs.query({});
      const count = tabs.length;
      renderStatus(count);

      if (showNotification) {
        showToast(`Вкладок: ${count} → Список обновлен`);
      }
    } catch (e) {
      // Ignore
    }
  }

  // 1. Refresh Button Handler
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.disabled = true;
      btnRefresh.textContent = 'Обновление...';
      await refreshTabs(true);
      btnRefresh.disabled = false;
      btnRefresh.textContent = 'Обновить список вкладок →';
    });
  }

  // 2. Close Duplicates Button Handler
  if (btnDedupe) {
    btnDedupe.addEventListener('click', async () => {
      btnDedupe.disabled = true;
      btnDedupe.textContent = 'Поиск дубликатов...';

      chrome.runtime.sendMessage({ action: 'close_duplicate_tabs' }, async (response) => {
        btnDedupe.disabled = false;
        btnDedupe.textContent = 'Закрыть дубликаты →';

        if (response && response.success) {
          const res = response.result;
          if (res.closed_count > 0) {
            showToast(`Закрыто дубликатов: ${res.closed_count} вкладок →`);
            await refreshTabs(false);
          } else {
            showToast('Дубликатов вкладок не найдено →');
          }
        } else {
          showToast(`Ошибка: ${response?.error || 'Не удалось закрыть дубликаты'} →`);
        }
      });
    });
  }

  // 3. Ungroup All Tabs Button Handler
  if (btnUngroup) {
    btnUngroup.addEventListener('click', async () => {
      btnUngroup.disabled = true;
      btnUngroup.textContent = 'Роспуск групп...';

      chrome.runtime.sendMessage({ action: 'ungroup_all_tabs' }, async (response) => {
        btnUngroup.disabled = false;
        btnUngroup.textContent = 'Распустить группы →';

        if (response && response.success) {
          const res = response.result;
          if (res.ungrouped_count > 0) {
            showToast(`Распущено ${res.ungrouped_count} сгруппированных вкладок →`);
            await refreshTabs(false);
          } else {
            showToast('Нет активных групп вкладок →');
          }
        } else {
          showToast(`Ошибка: ${response?.error || 'Не удалось распустить группы'} →`);
        }
      });
    });
  }

  return {
    refreshTabs,
    renderStatus
  };
}

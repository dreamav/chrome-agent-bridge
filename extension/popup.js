/**
 * Chrome Agent Bridge - Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const tabCountElem = document.getElementById('tabCount');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnDedupe = document.getElementById('btnDedupe');
  const btnUngroup = document.getElementById('btnUngroup');
  const btnSmart = document.getElementById('btnSmart');
  const toastMessage = document.getElementById('toastMessage');

  function showToast(message, duration = 3000) {
    toastMessage.textContent = message;
    toastMessage.style.display = 'block';
    setTimeout(() => {
      toastMessage.style.display = 'none';
    }, duration);
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

  // Refresh status and tab counter
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

  // Initial load
  await refreshTabs(false);

  // [Обновить список вкладок]
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.disabled = true;
      btnRefresh.textContent = 'Обновление...';
      await refreshTabs(true);
      btnRefresh.disabled = false;
      btnRefresh.textContent = 'Обновить список вкладок →';
    });
  }

  // [Закрыть дубликаты]
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

  // [Распустить группы]
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

  // [Умная организация (AI)]
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

        // Semantic layout builder (3 windows)
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

        // Build plan: Window 1 (AI+Services), Window 2 (Auto), Window 3 (Career+Media)
        const layoutPlan = [];
        if (groups.AI.length > 0) layoutPlan.push({ title: 'ИИ & Нейросети', color: 'purple', tab_ids: groups.AI, window_id: 1 });
        if (groups.SERVICES.length > 0) layoutPlan.push({ title: 'Общение & Сервер', color: 'green', tab_ids: groups.SERVICES, window_id: 1 });
        if (groups.AUTO.length > 0) layoutPlan.push({ title: 'Vincode & Авто', color: 'cyan', tab_ids: groups.AUTO, window_id: 2 });
        if (groups.CAREER.length > 0) layoutPlan.push({ title: 'Вайбкодинг & Карьера', color: 'blue', tab_ids: groups.CAREER, window_id: 3 });
        if (groups.MEDIA.length > 0) layoutPlan.push({ title: 'Отдых, Спорт & Музыка', color: 'red', tab_ids: groups.MEDIA, window_id: 3 });
        if (groups.OTHER.length > 0) layoutPlan.push({ title: 'Прочее & Поиск', color: 'grey', tab_ids: groups.OTHER, window_id: 3 });

        // Execute via apply_layout on background executor
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
});

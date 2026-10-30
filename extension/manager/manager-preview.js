/**
 * Chrome Agent Bridge — Manager Tab Preview & Smart Switcher
 * Handles floating glassmorphism preview card, YouTube posters, and smart tab switching.
 */

let hoverShowTimer = null;
let hoverHideTimer = null;
let isMouseOverCard = false;
let activePreviewItem = null;
const HOVER_SHOW_DELAY = 220; // 220ms delay prevents flickering
const HOVER_HIDE_GRACE = 380; // 380ms grace period so cursor can smoothly transition into card

function extractYouTubeVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        return u.searchParams.get('v');
      }
      if (u.pathname.startsWith('/shorts/')) {
        const parts = u.pathname.split('/');
        return parts[2] || null;
      }
      if (u.pathname.startsWith('/embed/')) {
        const parts = u.pathname.split('/');
        return parts[2] || null;
      }
      if (u.pathname.startsWith('/live/')) {
        const parts = u.pathname.split('/');
        return parts[2] || null;
      }
    } else if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split(/[?#&]/)[0];
      return id || null;
    }
  } catch (e) {
    // Fallback regex
  }
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/))([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/**
 * Smart Tab Switcher / Opener (Session Buddy Style)
 * Finds matching open tab across all Chrome windows before opening a new one.
 */
function findMatchingOpenTab(targetUrl, openTabs) {
  if (!targetUrl || !Array.isArray(openTabs) || openTabs.length === 0) return null;

  // 1. Exact URL match
  const exactMatch = openTabs.find(t => t.url === targetUrl);
  if (exactMatch) return exactMatch;

  // 2. Normalized match (without trailing slash)
  const stripTrailing = u => (u || '').replace(/\/+$/, '');
  const normTarget = stripTrailing(targetUrl);
  const normMatch = openTabs.find(t => t.url && stripTrailing(t.url) === normTarget);
  if (normMatch) return normMatch;

  let targetObj;
  try {
    targetObj = new URL(targetUrl);
  } catch (e) {
    return null;
  }

  if (!['http:', 'https:'].includes(targetObj.protocol)) {
    return null;
  }

  const targetHost = targetObj.hostname.replace(/^www\./, '').toLowerCase();

  // 3. Special service handlers:
  // a) YouTube: match by videoId
  if (targetHost === 'youtube.com' || targetHost === 'm.youtube.com' || targetHost === 'youtu.be') {
    const targetVideoId = extractYouTubeVideoId(targetUrl);
    if (targetVideoId) {
      const ytMatch = openTabs.find(t => t.url && extractYouTubeVideoId(t.url) === targetVideoId);
      if (ytMatch) return ytMatch;
    }
  }

  // b) Gmail: match mail.google.com (including specific /u/0 account if present)
  if (targetHost === 'mail.google.com') {
    const targetAccountMatch = targetUrl.match(/\/u\/(\d+)/);
    const targetAccount = targetAccountMatch ? targetAccountMatch[1] : null;

    const gmailMatch = openTabs.find(t => {
      try {
        const oObj = new URL(t.url);
        if (oObj.hostname.replace(/^www\./, '').toLowerCase() !== 'mail.google.com') return false;
        if (targetAccount !== null) {
          const oAccountMatch = t.url.match(/\/u\/(\d+)/);
          const oAccount = oAccountMatch ? oAccountMatch[1] : null;
          return oAccount === targetAccount;
        }
        return true;
      } catch (e) {
        return false;
      }
    });
    if (gmailMatch) return gmailMatch;
  }

  // c) Web Apps with SPA hash or user prefix (WhatsApp, Telegram Web, Discord, Slack, etc.)
  const isSinglePageApp = (
    targetHost === 'web.whatsapp.com' ||
    targetHost === 'web.telegram.org' ||
    targetHost.includes('discord.com') ||
    targetHost.includes('slack.com')
  );

  if (isSinglePageApp) {
    const appMatch = openTabs.find(t => {
      try {
        const oObj = new URL(t.url);
        const oHost = oObj.hostname.replace(/^www\./, '').toLowerCase();
        return oHost === targetHost;
      } catch (e) {
        return false;
      }
    });
    if (appMatch) return appMatch;
  }

  // d) DigitalOcean Droplets
  if (targetHost === 'cloud.digitalocean.com' && targetObj.pathname.startsWith('/droplets')) {
    const doMatch = openTabs.find(t => {
      try {
        const oObj = new URL(t.url);
        return oObj.hostname.replace(/^www\./, '').toLowerCase() === 'cloud.digitalocean.com' &&
               oObj.pathname.startsWith('/droplets');
      } catch (e) {
        return false;
      }
    });
    if (doMatch) return doMatch;
  }

  // 4. Base URL match (without hash and trailing slashes)
  const stripHashAndSlash = u => (u || '').split('#')[0].replace(/\/+$/, '');
  const baseTarget = stripHashAndSlash(targetUrl);
  const baseMatch = openTabs.find(t => t.url && stripHashAndSlash(t.url) === baseTarget);
  if (baseMatch) return baseMatch;

  // 5. Origin + Pathname match
  const originPathMatch = openTabs.find(t => {
    try {
      const oObj = new URL(t.url);
      const oHost = oObj.hostname.replace(/^www\./, '').toLowerCase();
      if (oHost !== targetHost) return false;
      if (oObj.pathname.replace(/\/+$/, '') !== targetObj.pathname.replace(/\/+$/, '')) return false;

      // If target has search query, verify it matches
      if (targetObj.search) {
        return oObj.search === targetObj.search;
      }
      return true;
    } catch (e) {
      return false;
    }
  });
  if (originPathMatch) return originPathMatch;

  return null;
}

/**
 * Open tab or switch to already open tab
 */
async function openOrSwitchToTab(tab) {
  if (!tab || !tab.url) return;

  hideTabHoverPreview(true);

  const targetUrl = tab.url;
  const tabTitle = tab.title || extractDomain(targetUrl) || 'Вкладка';

  try {
    // 1. If tab has an active Chrome tab ID (e.g. from Live session), test if it exists
    if (tab.id && typeof tab.id === 'number' && tab.id > 0) {
      try {
        const existingTab = await chrome.tabs.get(tab.id);
        if (existingTab && existingTab.id) {
          await chrome.tabs.update(existingTab.id, { active: true });
          if (existingTab.windowId) {
            await chrome.windows.update(existingTab.windowId, { focused: true });
          }
          showToast(`⚡ Переключено на вкладку → ${existingTab.title || tabTitle}`);
          return;
        }
      } catch (e) {
        // Tab ID was not found in active browser, fall through to URL matching
      }
    }

    // 2. Query all open tabs in all Chrome windows to find matching URL
    const openTabs = await chrome.tabs.query({});
    const matchedTab = findMatchingOpenTab(targetUrl, openTabs);

    if (matchedTab && matchedTab.id) {
      // Tab is already open! Switch to it and focus its window
      await chrome.tabs.update(matchedTab.id, { active: true });
      if (matchedTab.windowId) {
        await chrome.windows.update(matchedTab.windowId, { focused: true });
      }
      showToast(`⚡ Переключено на открытую вкладку → ${matchedTab.title || tabTitle}`);
      return;
    }

    // 3. Tab is not open anywhere in Chrome -> Open in new tab
    const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
    if (newTab && newTab.windowId) {
      await chrome.windows.update(newTab.windowId, { focused: true });
    }
    showToast(`🌐 Вкладка открыта → ${tabTitle}`);
  } catch (err) {
    console.error('Error switching or opening tab:', err);
    chrome.tabs.create({ url: targetUrl, active: true });
  }
}

/**
 * Show floating tab hover preview card
 */
function showTabHoverPreview(tab, context, itemEl) {
  if (!DOM.tabHoverPreview || !tab || !tab.url) return;

  activePreviewItem = itemEl;
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer);
    hoverHideTimer = null;
  }

  const domain = extractDomain(tab.url);
  const ytVideoId = extractYouTubeVideoId(tab.url);
  const faviconUrl = tab.favIconUrl || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : '');

  // Context badges
  let groupBadge = '';
  if (context && context.groupTitle) {
    const chipColor = CHROME_GROUP_COLORS[context.groupColor] || '#38bdf8';
    groupBadge = `
      <span class="hover-preview-pill pill-group" title="Группа вкладок Chrome">
        <span style="width: 7px; height: 7px; border-radius: 50%; background: ${chipColor}; display: inline-block;"></span>
        ${escapeHtml(context.groupTitle)}
      </span>
    `;
  } else if (context && context.isUngrouped) {
    groupBadge = `<span class="hover-preview-pill" title="Вне групп">Вне групп</span>`;
  }

  const pinnedBadge = tab.pinned ? `<span class="hover-preview-pill" title="Закреплённая вкладка">📌 Закреплена</span>` : '';
  const activeBadge = tab.active ? `<span class="hover-preview-pill pill-live" title="Активная вкладка">★ Активная</span>` : '';
  const winBadge = context?.windowTitle ? `<span class="hover-preview-pill" title="Окно Chrome">${escapeHtml(context.windowTitle)}</span>` : '';
  const sessionTypeBadge = ManagerState.activeSession?.isLive
    ? `<span class="hover-preview-pill pill-live" title="Текущая живая сессия">🟢 Live</span>`
    : `<span class="hover-preview-pill" title="Сохранённая сессия">💾 Сохранено</span>`;

  let mediaHtml = '';
  let headerHtml = '';
  let openBtnText = '<span>🌐</span> Открыть';

  if (ytVideoId) {
    openBtnText = '<span>▶</span> Смотреть';
    const posterUrl = `https://img.youtube.com/vi/${ytVideoId}/mqdefault.jpg`;
    mediaHtml = `
      <div class="hover-preview-media" title="Кликните, чтобы открыть видео в Chrome">
        <img src="${escapeHtml(posterUrl)}" alt="Превью YouTube">
        <div class="hover-preview-yt-badge">
          <span>▶</span> YouTube Video
        </div>
        <div class="hover-preview-play-icon">▶</div>
      </div>
    `;
  } else {
    const faviconImg = faviconUrl
      ? `<img src="${escapeHtml(faviconUrl)}" alt="">`
      : '🌐';
    headerHtml = `
      <div class="hover-preview-header-generic">
        <div class="hover-preview-favicon-box">
          ${faviconImg}
        </div>
        <div class="hover-preview-domain-info">
          <span class="hover-preview-domain">🔒 ${escapeHtml(domain || 'Веб-страница')}</span>
          <span class="hover-preview-domain-sub">Полное превью ссылки</span>
        </div>
      </div>
    `;
  }

  DOM.tabHoverPreview.innerHTML = `
    <button class="btn-preview-close" type="button" title="Закрыть превью">✕</button>
    ${mediaHtml}
    ${headerHtml}
    <div class="hover-preview-body">
      <div class="hover-preview-title">${escapeHtml(tab.title || tab.url || 'Без названия')}</div>
      <div class="hover-preview-url">${escapeHtml(tab.url)}</div>
      <div class="hover-preview-meta-row">
        ${sessionTypeBadge}
        ${winBadge}
        ${groupBadge}
        ${pinnedBadge}
        ${activeBadge}
      </div>
    </div>
    <div class="hover-preview-footer">
      <button class="btn-preview-open" type="button" title="${ytVideoId ? 'Смотреть видео на YouTube' : 'Открыть вкладку в Chrome'}">
        ${openBtnText}
      </button>
      ${ytVideoId ? `
        <button class="btn-preview-watch-later" type="button" title="Добавить в плейлист «Смотреть позже» вашего YouTube-аккаунта">
          <span>⏱️</span> В «Позже»
        </button>
        <button class="btn-preview-playlist" type="button" title="Выбрать другой плейлист YouTube...">
          <span>📋</span> В плейлист...
        </button>
      ` : ''}
      <button class="btn-preview-copy" type="button" title="Скопировать ссылку в буфер обмена">
        <span>🔗</span> Копировать
      </button>
    </div>
  `;

  // Connect Close Button
  const btnClose = DOM.tabHoverPreview.querySelector('.btn-preview-close');
  if (btnClose) {
    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabHoverPreview(true);
    });
  }

  // Image fallback error listeners (Pure JS, zero CSP violations)
  const previewPosterImg = DOM.tabHoverPreview.querySelector('.hover-preview-media img');
  if (previewPosterImg) {
    previewPosterImg.addEventListener('error', () => {
      const mediaParent = previewPosterImg.closest('.hover-preview-media');
      if (mediaParent) mediaParent.style.display = 'none';
    });
  }

  const previewFavImg = DOM.tabHoverPreview.querySelector('.hover-preview-favicon-box img');
  if (previewFavImg) {
    previewFavImg.addEventListener('error', () => {
      const box = previewFavImg.parentElement;
      if (box) box.textContent = '🌐';
    });
  }

  // Connect Click on Media Poster
  const mediaEl = DOM.tabHoverPreview.querySelector('.hover-preview-media');
  if (mediaEl) {
    mediaEl.addEventListener('click', (e) => {
      e.stopPropagation();
      openOrSwitchToTab(tab);
    });
  }

  // Connect Action Buttons in Hover Card
  DOM.tabHoverPreview.querySelector('.btn-preview-open').addEventListener('click', (e) => {
    e.stopPropagation();
    openOrSwitchToTab(tab);
  });

  // Connect Quick Watch Later Button
  const btnWatchLater = DOM.tabHoverPreview.querySelector('.btn-preview-watch-later');
  if (btnWatchLater && ytVideoId) {
    btnWatchLater.addEventListener('click', (e) => {
      e.stopPropagation();
      const origHtml = btnWatchLater.innerHTML;
      btnWatchLater.disabled = true;
      btnWatchLater.innerHTML = '<span>⏳</span> В «Позже»...';

      chrome.runtime.sendMessage({
        action: 'youtube_watch_later',
        params: {
          videoId: ytVideoId,
          tabId: typeof tab.id === 'number' ? tab.id : null,
          tabUrl: tab.url
        }
      }, (res) => {
        if (res && res.success) {
          const accSuffix = res.accountTitle ? ` (${res.accountTitle})` : '';
          if (res.alreadyAdded) {
            btnWatchLater.innerHTML = '<span>✓</span> Уже в «Позже»';
            btnWatchLater.classList.add('success-glow');
            showToast(`✓ Это видео уже в «Смотреть позже»${accSuffix}!`, 3500);
          } else {
            btnWatchLater.innerHTML = '<span>✓</span> В «Позже»!';
            btnWatchLater.classList.add('success-glow');
            showToast(`✓ Добавлено в «Смотреть позже»${accSuffix}!`, 3500);
          }
        } else {
          btnWatchLater.disabled = false;
          btnWatchLater.innerHTML = origHtml;
          const err = res?.error || 'Не удалось добавить видео в YouTube';
          showToast(`⚠️ ${err}`, 5000);
        }
      });
    });
  }

  // Connect Choose Playlist Button
  const btnPlaylist = DOM.tabHoverPreview.querySelector('.btn-preview-playlist');
  if (btnPlaylist && ytVideoId) {
    btnPlaylist.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabHoverPreview(true);
      if (typeof openYouTubePlaylistModal === 'function') {
        openYouTubePlaylistModal([{
          videoId: ytVideoId,
          title: tab.title || 'Видео YouTube',
          url: tab.url,
          tabId: tab.id
        }]);
      }
    });
  }

  const btnCopy = DOM.tabHoverPreview.querySelector('.btn-preview-copy');
  if (btnCopy) {
    btnCopy.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(tab.url);
      btnCopy.innerHTML = '<span>✓</span> Скопировано!';
      btnCopy.style.borderColor = 'var(--cyan-neon)';
      btnCopy.style.color = '#fff';
      showToast('URL скопирован в буфер обмена!');
      setTimeout(() => {
        if (btnCopy) {
          btnCopy.innerHTML = '<span>🔗</span> Копировать';
          btnCopy.style.borderColor = '';
          btnCopy.style.color = '';
        }
      }, 1500);
    });
  }

  // Positioning anchored directly to the tab item row
  const itemRect = itemEl ? itemEl.getBoundingClientRect() : { left: 100, right: 300, top: 100, bottom: 140 };
  const cardWidth = 410;
  const cardPadding = 16;

  let targetX = itemRect.left + 80;
  if (targetX + cardWidth > window.innerWidth - cardPadding) {
    targetX = window.innerWidth - cardWidth - cardPadding;
  }
  if (targetX < cardPadding) {
    targetX = cardPadding;
  }

  DOM.tabHoverPreview.style.left = `${Math.round(targetX)}px`;
  DOM.tabHoverPreview.style.top = '-9999px';
  DOM.tabHoverPreview.classList.remove('hidden');

  const cardHeight = DOM.tabHoverPreview.offsetHeight || 260;
  let targetY;

  if (itemRect.bottom + cardHeight + cardPadding <= window.innerHeight) {
    targetY = itemRect.bottom + 6;
  } else {
    targetY = itemRect.top - cardHeight - 6;
    if (targetY < cardPadding) {
      targetY = Math.max(cardPadding, window.innerHeight - cardHeight - cardPadding);
    }
  }

  DOM.tabHoverPreview.style.left = `${Math.round(targetX)}px`;
  DOM.tabHoverPreview.style.top = `${Math.round(targetY)}px`;
  DOM.tabHoverPreview.setAttribute('aria-hidden', 'false');

  requestAnimationFrame(() => {
    DOM.tabHoverPreview.classList.add('visible');
  });
}

function hideTabHoverPreview(immediate = false) {
  if (hoverShowTimer) {
    clearTimeout(hoverShowTimer);
    hoverShowTimer = null;
  }
  if (!DOM.tabHoverPreview) return;

  if (immediate) {
    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }
    isMouseOverCard = false;
    activePreviewItem = null;
    DOM.tabHoverPreview.classList.remove('visible');
    DOM.tabHoverPreview.classList.add('hidden');
    DOM.tabHoverPreview.setAttribute('aria-hidden', 'true');
  } else {
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(() => {
      if (!isMouseOverCard && DOM.tabHoverPreview) {
        DOM.tabHoverPreview.classList.remove('visible');
        DOM.tabHoverPreview.classList.add('hidden');
        DOM.tabHoverPreview.setAttribute('aria-hidden', 'true');
        activePreviewItem = null;
      }
    }, HOVER_HIDE_GRACE);
  }
}

function initHoverPreviewEvents() {
  if (!DOM.tabHoverPreview) return;

  DOM.tabHoverPreview.addEventListener('mouseenter', () => {
    isMouseOverCard = true;
    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }
  });

  DOM.tabHoverPreview.addEventListener('mouseleave', () => {
    isMouseOverCard = false;
    hideTabHoverPreview(false);
  });

  // Auto-dismiss preview on scroll, window blur, or click outside
  if (DOM.sessionContent) {
    DOM.sessionContent.addEventListener('scroll', () => hideTabHoverPreview(true), { passive: true });
  }
  window.addEventListener('scroll', () => hideTabHoverPreview(true), { passive: true });
  window.addEventListener('blur', () => hideTabHoverPreview(true));
  document.addEventListener('click', (e) => {
    if (DOM.tabHoverPreview && !DOM.tabHoverPreview.contains(e.target) && !e.target.closest('.tab-item')) {
      hideTabHoverPreview(true);
    }
  });
}

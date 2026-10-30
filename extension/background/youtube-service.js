/**
 * Chrome Agent Bridge - YouTube Service
 * Handles authenticated additions to YouTube playlists ('Watch Later' & custom playlists) via InnerTube API.
 * Supports active YouTube brand accounts / delegated identities (DELEGATED_SESSION_ID & X-Goog-PageId).
 * Supports single-video and batch additions of multiple videos in a single operation.
 */

function isRealYouTubePage(tab) {
  if (!tab || !tab.url) return false;
  const u = tab.url;
  return u.includes('youtube.com') && 
    !u.includes('/robots.txt') && 
    !u.includes('/favicon.ico') &&
    !u.includes('accounts.google.com');
}

/**
 * Normalizes playlist ID or URL to a clean playlist ID string (e.g. 'WL' or 'PLxxxxxx')
 */
function normalizePlaylistId(input) {
  if (!input || typeof input !== 'string') return 'WL';
  const clean = input.trim();
  if (!clean) return 'WL';
  const match = clean.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return clean;
}

/**
 * Finds or temporarily creates a real YouTube tab to execute authenticated InnerTube requests
 */
async function withYouTubeTab(preferredTabId, runner) {
  let cachedContext = null;
  try {
    const stored = await chrome.storage.local.get(['yt_account_context']);
    cachedContext = stored.yt_account_context || null;
  } catch (e) {
    // Ignore storage read error
  }

  let targetTab = null;
  if (typeof preferredTabId === 'number') {
    try {
      const t = await chrome.tabs.get(preferredTabId);
      if (t && isRealYouTubePage(t) && !t.discarded) {
        targetTab = t;
      }
    } catch (e) {
      // Tab not found or closed
    }
  }

  if (!targetTab) {
    const ytTabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    const activeContentTab = ytTabs.find(t => t.active && !t.discarded && isRealYouTubePage(t));
    const readyContentTab = ytTabs.find(t => t.status === 'complete' && !t.discarded && isRealYouTubePage(t));
    const anyContentTab = ytTabs.find(t => !t.discarded && isRealYouTubePage(t));
    const fallbackTab = ytTabs.find(t => !t.discarded) || ytTabs[0];

    targetTab = activeContentTab || readyContentTab || anyContentTab || fallbackTab;
  }

  let createdTempTab = false;
  if (!targetTab) {
    try {
      const urlToOpen = cachedContext?.delegatedSessionId
        ? 'https://www.youtube.com/robots.txt'
        : 'https://www.youtube.com/?app=desktop';

      targetTab = await chrome.tabs.create({ url: urlToOpen, active: false });
      createdTempTab = true;

      await new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (!done) { done = true; resolve(); }
        }, 2500);

        const listener = (tabId, changeInfo) => {
          if (tabId === targetTab.id && (changeInfo.status === 'complete' || changeInfo.title)) {
            if (!done) {
              done = true;
              clearTimeout(timer);
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    } catch (createErr) {
      console.warn('Could not create temp YouTube tab:', createErr);
    }
  }

  if (!targetTab || !targetTab.id) {
    throw new Error('Не удалось найти или открыть вкладку YouTube для авторизованного запроса.');
  }

  try {
    return await runner(targetTab, cachedContext);
  } finally {
    if (createdTempTab && targetTab && targetTab.id) {
      try {
        await chrome.tabs.remove(targetTab.id);
      } catch (e) {
        // Ignore
      }
    }
  }
}

/**
 * Get available playlists for active YouTube account / brand channel
 */
async function getYouTubePlaylists(sampleVideoId = null, preferredTabId = null) {
  return await withYouTubeTab(preferredTabId, async (targetTab, cachedContext) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      world: 'MAIN',
      func: async (sVideoId, fallbackAuth) => {
        try {
          function getSapisid() {
            const match = document.cookie.match(/(?:^|;\s*)(?:__Secure-3P|__Secure-1P)?SAPISID=([^;]+)/);
            if (match) return match[1];
            const cookies = document.cookie.split('; ');
            for (const c of cookies) {
              if (c.startsWith('SAPISID=')) return c.substring(8);
              if (c.startsWith('__Secure-3PAPISID=')) return c.substring(18);
              if (c.startsWith('__Secure-1PAPISID=')) return c.substring(18);
            }
            return null;
          }

          const sapisid = getSapisid();
          if (!sapisid) {
            return {
              success: false,
              error: 'Вы не авторизованы на YouTube. Войдите в свой аккаунт на youtube.com.'
            };
          }

          async function sha1(str) {
            const buffer = new TextEncoder().encode(str);
            const hashBuffer = await window.crypto.subtle.digest('SHA-1', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => ('00' + b.toString(16)).slice(-2)).join('');
          }

          const timestamp = Date.now();
          const origin = window.location.origin || 'https://www.youtube.com';
          const digest = await sha1(`${timestamp} ${sapisid} ${origin}`);
          const sapisidhash = `${timestamp}_${digest}`;

          function getYtCfg(key) {
            try {
              if (typeof window.ytcfg?.get === 'function') {
                const val = window.ytcfg.get(key);
                if (val !== undefined && val !== null) return val;
              }
              if (window.ytcfg?.data_ && window.ytcfg.data_[key] !== undefined && window.ytcfg.data_[key] !== null) {
                return window.ytcfg.data_[key];
              }
              if (typeof window.ytcfg?.d === 'function') {
                const d = window.ytcfg.d();
                if (d && d[key] !== undefined && d[key] !== null) return d[key];
              }
            } catch (e) {}
            return null;
          }

          const innertubeContext = getYtCfg('INNERTUBE_CONTEXT');
          const delegatedSessionId = getYtCfg('DELEGATED_SESSION_ID')
            || innertubeContext?.user?.onBehalfOfUser
            || innertubeContext?.user?.delegatedSessionId
            || fallbackAuth?.delegatedSessionId
            || null;

          const sessionIndex = getYtCfg('SESSION_INDEX') ?? fallbackAuth?.sessionIndex ?? '0';
          const apiKey = getYtCfg('INNERTUBE_API_KEY') || fallbackAuth?.apiKey || null;
          const clientVersion = getYtCfg('INNERTUBE_CLIENT_VERSION') || fallbackAuth?.clientVersion || '2.20261025.01.00';
          const visitorData = getYtCfg('VISITOR_DATA') || fallbackAuth?.visitorData || null;

          function getActiveAccountTitle() {
            try {
              const cfgName = getYtCfg('USER_DISPLAY_NAME') 
                           || getYtCfg('USER_NAME') 
                           || getYtCfg('CHANNEL_TITLE')
                           || getYtCfg('INNERTUBE_CONTEXT')?.user?.displayName;
              if (cfgName && typeof cfgName === 'string' && cfgName.trim().length > 0) {
                return cfgName.trim();
              }
              const avatarBtn = document.querySelector('button#avatar-btn, ytd-topbar-menu-button-renderer button');
              const ariaLabel = avatarBtn?.getAttribute('aria-label') || avatarBtn?.title || '';
              if (ariaLabel) {
                const match = ariaLabel.match(/(?:Аккаунт Google|Google Account|Аккаунт|Account)?\s*(?::\s*)?([^\n(]+)/i);
                if (match && match[1]) {
                  const cleaned = match[1].replace(/^(?:Аватар профиля|Аватар пользователя|Avatar image|Profile photo)(?::|\s*[-–—]\s*)?\s*/i, '').trim();
                  if (cleaned && cleaned.length > 0 && cleaned.length < 50 && !/^(?:аккаунт|account|аватар|avatar)$/i.test(cleaned)) {
                    return cleaned;
                  }
                }
              }
              const guideChannelLink = document.querySelector('ytd-guide-section-renderer a[href*="/@"], a#endpoint[href*="/@"]');
              if (guideChannelLink) {
                const handleMatch = (guideChannelLink.getAttribute('href') || '').match(/@([a-zA-Z0-9_.-]+)/);
                if (handleMatch && handleMatch[1]) return handleMatch[1];
                const text = guideChannelLink.textContent?.trim();
                if (text && text.length > 0 && text.length < 40 && text.toLowerCase() !== 'вы' && text.toLowerCase() !== 'you') {
                  return text;
                }
              }
            } catch (e) {}
            return fallbackAuth?.accountTitle || null;
          }

          const accountTitle = getActiveAccountTitle();

          const reqHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `SAPISIDHASH ${sapisidhash}`,
            'X-Goog-AuthUser': String(sessionIndex),
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': clientVersion,
            'X-Origin': origin
          };
          if (delegatedSessionId) {
            reqHeaders['X-Goog-PageId'] = String(delegatedSessionId);
          }
          if (visitorData) {
            reqHeaders['X-Goog-Visitor-Id'] = String(visitorData);
          }

          let reqContext = null;
          if (innertubeContext && typeof innertubeContext === 'object') {
            try { reqContext = JSON.parse(JSON.stringify(innertubeContext)); } catch (e) {}
          }
          if (!reqContext) {
            reqContext = { client: { clientName: 'WEB', clientVersion: clientVersion } };
          }
          if (delegatedSessionId) {
            if (!reqContext.user) reqContext.user = {};
            reqContext.user.onBehalfOfUser = String(delegatedSessionId);
            reqContext.user.delegatedSessionId = String(delegatedSessionId);
          }

          const currentAuthContext = {
            delegatedSessionId: delegatedSessionId ? String(delegatedSessionId) : null,
            sessionIndex: String(sessionIndex),
            clientVersion,
            apiKey: apiKey ? String(apiKey) : null,
            visitorData: visitorData ? String(visitorData) : null,
            accountTitle: accountTitle ? String(accountTitle) : null,
            savedAt: Date.now()
          };

          const endpoint = apiKey
            ? `https://www.youtube.com/youtubei/v1/playlist/get_add_to_playlist?key=${apiKey}&prettyPrint=false`
            : 'https://www.youtube.com/youtubei/v1/playlist/get_add_to_playlist';

          const bodyObj = { context: reqContext };
          if (sVideoId) {
            bodyObj.videoIds = [String(sVideoId).trim()];
          }

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: reqHeaders,
            credentials: 'include',
            body: JSON.stringify(bodyObj)
          });

          const playlists = [];
          let hasWatchLater = false;

          if (res.ok) {
            const data = await res.json();
            const contents = data?.contents || [];

            function parseItems(items) {
              if (!Array.isArray(items)) return;
              for (const it of items) {
                const opt = it?.playlistAddToOptionRenderer;
                if (opt && opt.playlistId) {
                  const pid = opt.playlistId;
                  if (pid === 'WL') hasWatchLater = true;
                  const title = opt.title?.simpleText || opt.title?.runs?.map(r => r.text).join('') || pid;
                  playlists.push({
                    id: pid,
                    title: title,
                    privacy: opt.privacy || 'UNKNOWN',
                    containsSelectedVideos: opt.containsSelectedVideos || 'NONE'
                  });
                }
              }
            }

            for (const c of contents) {
              if (c?.addToPlaylistRenderer?.playlists) {
                parseItems(c.addToPlaylistRenderer.playlists);
              }
            }
          }

          // Always ensure 'WL' is the first/default entry
          if (!hasWatchLater) {
            playlists.unshift({
              id: 'WL',
              title: 'Смотреть позже (Watch Later)',
              privacy: 'PRIVACY_PRIVATE',
              containsSelectedVideos: 'NONE'
            });
          }

          return {
            success: true,
            playlists,
            accountTitle,
            authContext: currentAuthContext
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      },
      args: [sampleVideoId || null, cachedContext]
    });

    if (results && results[0] && results[0].result) {
      const r = results[0].result;
      if (r.authContext) {
        try {
          await chrome.storage.local.set({ yt_account_context: r.authContext });
        } catch (saveErr) {}
      }
      if (r.success) {
        return {
          success: true,
          playlists: r.playlists || [],
          accountTitle: r.accountTitle || null
        };
      }
      if (r.error) {
        throw new Error(r.error);
      }
    }

    throw new Error('Не получен ответ от вкладки YouTube при загрузке плейлистов.');
  });
}

/**
 * Adds one or more YouTube videos to any specified playlist (default: 'WL' - Watch Later).
 * Supports active Brand Accounts (delegated session) and batch processing.
 */
async function addVideosToYouTubePlaylist(videoIds, playlistId = 'WL', preferredTabId = null) {
  // Normalize videoIds
  let rawList = [];
  if (Array.isArray(videoIds)) {
    rawList = videoIds;
  } else if (typeof videoIds === 'string') {
    rawList = [videoIds];
  }

  const cleanIds = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'string') continue;
    const clean = item.trim();
    if (!clean) continue;
    const match = clean.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/))([a-zA-Z0-9_-]{11})/);
    const vId = match ? match[1] : clean;
    if (vId && /^[a-zA-Z0-9_-]{11}$/.test(vId) && !cleanIds.includes(vId)) {
      cleanIds.push(vId);
    }
  }

  if (cleanIds.length === 0) {
    throw new Error('Не указано ни одного корректного ID видео YouTube.');
  }

  const targetPlaylistId = normalizePlaylistId(playlistId);

  return await withYouTubeTab(preferredTabId, async (targetTab, cachedContext) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      world: 'MAIN',
      func: async (vIds, pId, fallbackAuth) => {
        try {
          function getSapisid() {
            const match = document.cookie.match(/(?:^|;\s*)(?:__Secure-3P|__Secure-1P)?SAPISID=([^;]+)/);
            if (match) return match[1];
            const cookies = document.cookie.split('; ');
            for (const c of cookies) {
              if (c.startsWith('SAPISID=')) return c.substring(8);
              if (c.startsWith('__Secure-3PAPISID=')) return c.substring(18);
              if (c.startsWith('__Secure-1PAPISID=')) return c.substring(18);
            }
            return null;
          }

          const sapisid = getSapisid();
          if (!sapisid) {
            return {
              success: false,
              error: 'Вы не авторизованы на YouTube. Войдите в свой аккаунт на youtube.com.'
            };
          }

          async function sha1(str) {
            const buffer = new TextEncoder().encode(str);
            const hashBuffer = await window.crypto.subtle.digest('SHA-1', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => ('00' + b.toString(16)).slice(-2)).join('');
          }

          const timestamp = Date.now();
          const origin = window.location.origin || 'https://www.youtube.com';
          const digest = await sha1(`${timestamp} ${sapisid} ${origin}`);
          const sapisidhash = `${timestamp}_${digest}`;

          function getYtCfg(key) {
            try {
              if (typeof window.ytcfg?.get === 'function') {
                const val = window.ytcfg.get(key);
                if (val !== undefined && val !== null) return val;
              }
              if (window.ytcfg?.data_ && window.ytcfg.data_[key] !== undefined && window.ytcfg.data_[key] !== null) {
                return window.ytcfg.data_[key];
              }
              if (typeof window.ytcfg?.d === 'function') {
                const d = window.ytcfg.d();
                if (d && d[key] !== undefined && d[key] !== null) return d[key];
              }
            } catch (e) {}
            return null;
          }

          const innertubeContext = getYtCfg('INNERTUBE_CONTEXT');
          const delegatedSessionId = getYtCfg('DELEGATED_SESSION_ID')
            || innertubeContext?.user?.onBehalfOfUser
            || innertubeContext?.user?.delegatedSessionId
            || fallbackAuth?.delegatedSessionId
            || null;

          const sessionIndex = getYtCfg('SESSION_INDEX') ?? fallbackAuth?.sessionIndex ?? '0';
          const apiKey = getYtCfg('INNERTUBE_API_KEY') || fallbackAuth?.apiKey || null;
          const clientVersion = getYtCfg('INNERTUBE_CLIENT_VERSION') || fallbackAuth?.clientVersion || '2.20261025.01.00';
          const visitorData = getYtCfg('VISITOR_DATA') || fallbackAuth?.visitorData || null;

          function getActiveAccountTitle() {
            try {
              const cfgName = getYtCfg('USER_DISPLAY_NAME') 
                           || getYtCfg('USER_NAME') 
                           || getYtCfg('CHANNEL_TITLE')
                           || getYtCfg('INNERTUBE_CONTEXT')?.user?.displayName;
              if (cfgName && typeof cfgName === 'string' && cfgName.trim().length > 0) {
                return cfgName.trim();
              }
              const avatarBtn = document.querySelector('button#avatar-btn, ytd-topbar-menu-button-renderer button');
              const ariaLabel = avatarBtn?.getAttribute('aria-label') || avatarBtn?.title || '';
              if (ariaLabel) {
                const match = ariaLabel.match(/(?:Аккаунт Google|Google Account|Аккаунт|Account)?\s*(?::\s*)?([^\n(]+)/i);
                if (match && match[1]) {
                  const cleaned = match[1].replace(/^(?:Аватар профиля|Аватар пользователя|Avatar image|Profile photo)(?::|\s*[-–—]\s*)?\s*/i, '').trim();
                  if (cleaned && cleaned.length > 0 && cleaned.length < 50 && !/^(?:аккаунт|account|аватар|avatar)$/i.test(cleaned)) {
                    return cleaned;
                  }
                }
              }
              const guideChannelLink = document.querySelector('ytd-guide-section-renderer a[href*="/@"], a#endpoint[href*="/@"]');
              if (guideChannelLink) {
                const handleMatch = (guideChannelLink.getAttribute('href') || '').match(/@([a-zA-Z0-9_.-]+)/);
                if (handleMatch && handleMatch[1]) return handleMatch[1];
                const text = guideChannelLink.textContent?.trim();
                if (text && text.length > 0 && text.length < 40 && text.toLowerCase() !== 'вы' && text.toLowerCase() !== 'you') {
                  return text;
                }
              }
            } catch (e) {}
            return fallbackAuth?.accountTitle || null;
          }

          const accountTitle = getActiveAccountTitle();

          const reqHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `SAPISIDHASH ${sapisidhash}`,
            'X-Goog-AuthUser': String(sessionIndex),
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': clientVersion,
            'X-Origin': origin
          };
          if (delegatedSessionId) {
            reqHeaders['X-Goog-PageId'] = String(delegatedSessionId);
          }
          if (visitorData) {
            reqHeaders['X-Goog-Visitor-Id'] = String(visitorData);
          }

          let reqContext = null;
          if (innertubeContext && typeof innertubeContext === 'object') {
            try { reqContext = JSON.parse(JSON.stringify(innertubeContext)); } catch (e) {}
          }
          if (!reqContext) {
            reqContext = { client: { clientName: 'WEB', clientVersion: clientVersion } };
          }
          if (delegatedSessionId) {
            if (!reqContext.user) reqContext.user = {};
            reqContext.user.onBehalfOfUser = String(delegatedSessionId);
            reqContext.user.delegatedSessionId = String(delegatedSessionId);
          }

          const currentAuthContext = {
            delegatedSessionId: delegatedSessionId ? String(delegatedSessionId) : null,
            sessionIndex: String(sessionIndex),
            clientVersion,
            apiKey: apiKey ? String(apiKey) : null,
            visitorData: visitorData ? String(visitorData) : null,
            accountTitle: accountTitle ? String(accountTitle) : null,
            savedAt: Date.now()
          };

          const endpoint = apiKey
            ? `https://www.youtube.com/youtubei/v1/browse/edit_playlist?key=${apiKey}&prettyPrint=false`
            : 'https://www.youtube.com/youtubei/v1/browse/edit_playlist';

          // Helper to check if an alert means "already in playlist"
          function checkAlreadyAdded(dataObj) {
            let alertMsg = '';
            if (dataObj && dataObj.alerts && Array.isArray(dataObj.alerts)) {
              for (const a of dataObj.alerts) {
                const text = a?.alertRenderer?.text?.runs?.map(r => r.text).join('') || a?.alertRenderer?.text?.simpleText;
                if (text) { alertMsg = text; break; }
              }
            } else if (dataObj && dataObj.error && dataObj.error.message) {
              alertMsg = dataObj.error.message;
            }
            const isAlready = alertMsg && (
              alertMsg.toLowerCase().includes('уже есть') || 
              alertMsg.toLowerCase().includes('already in') ||
              alertMsg.toLowerCase().includes('already added')
            );
            return { isAlready, alertMsg };
          }

          // 1. Try single batch request with all actions
          const batchActions = vIds.map(id => ({
            addedVideoId: id,
            action: 'ACTION_ADD_VIDEO'
          }));

          let batchSucceeded = false;
          let batchAlertInfo = null;

          try {
            const batchRes = await fetch(endpoint, {
              method: 'POST',
              headers: reqHeaders,
              credentials: 'include',
              body: JSON.stringify({
                context: reqContext,
                actions: batchActions,
                playlistId: pId
              })
            });

            if (batchRes.ok) {
              const bData = await batchRes.json();
              if (bData && bData.status === 'STATUS_SUCCEEDED') {
                batchSucceeded = true;
                batchAlertInfo = checkAlreadyAdded(bData);
              }
            }
          } catch (batchErr) {
            batchSucceeded = false;
          }

          if (batchSucceeded) {
            return {
              success: true,
              mode: 'batch',
              playlistId: pId,
              totalRequested: vIds.length,
              addedCount: vIds.length,
              alreadyAddedCount: batchAlertInfo?.isAlready ? vIds.length : 0,
              accountTitle,
              authContext: currentAuthContext
            };
          }

          // 2. Sequential Fallback: guarantees high resilience if batch is rejected
          let addedCount = 0;
          let alreadyCount = 0;
          const failedList = [];

          for (let i = 0; i < vIds.length; i++) {
            const vId = vIds[i];
            try {
              const singleRes = await fetch(endpoint, {
                method: 'POST',
                headers: reqHeaders,
                credentials: 'include',
                body: JSON.stringify({
                  context: reqContext,
                  actions: [{ addedVideoId: vId, action: 'ACTION_ADD_VIDEO' }],
                  playlistId: pId
                })
              });

              if (singleRes.ok) {
                const sData = await singleRes.json();
                if (sData?.status === 'STATUS_SUCCEEDED') {
                  addedCount++;
                } else {
                  const check = checkAlreadyAdded(sData);
                  if (check.isAlready) {
                    alreadyCount++;
                  } else {
                    failedList.push({ videoId: vId, error: check.alertMsg || sData?.status || 'STATUS_FAILED' });
                  }
                }
              } else {
                failedList.push({ videoId: vId, error: `HTTP ${singleRes.status}` });
              }
            } catch (singleErr) {
              failedList.push({ videoId: vId, error: singleErr.message });
            }

            if (i < vIds.length - 1) {
              await new Promise(r => setTimeout(r, 120));
            }
          }

          const totalSuccess = addedCount + alreadyCount;
          if (totalSuccess > 0) {
            return {
              success: true,
              mode: 'sequential',
              playlistId: pId,
              totalRequested: vIds.length,
              addedCount,
              alreadyAddedCount: alreadyCount,
              failedCount: failedList.length,
              failedList,
              accountTitle,
              authContext: currentAuthContext
            };
          }

          const firstErr = failedList[0]?.error || 'Не удалось добавить видео в выбранный плейлист.';
          return {
            success: false,
            error: firstErr,
            playlistId: pId,
            totalRequested: vIds.length,
            failedList,
            authContext: currentAuthContext
          };

        } catch (e) {
          return { success: false, error: e.message };
        }
      },
      args: [cleanIds, targetPlaylistId, cachedContext]
    });

    if (results && results[0] && results[0].result) {
      const r = results[0].result;
      if (r.authContext) {
        try {
          await chrome.storage.local.set({ yt_account_context: r.authContext });
        } catch (saveErr) {}
      }

      if (r.success) {
        return {
          success: true,
          playlistId: r.playlistId,
          totalRequested: r.totalRequested,
          addedCount: r.addedCount,
          alreadyAddedCount: r.alreadyAddedCount || 0,
          failedCount: r.failedCount || 0,
          accountTitle: r.accountTitle || null,
          delegatedSessionId: r.authContext?.delegatedSessionId || null,
          mode: r.mode || 'batch'
        };
      }

      if (r.error) {
        throw new Error(r.error);
      }
    }

    throw new Error('Не получен ответ от вкладки YouTube при добавлении в плейлист.');
  });
}

/**
 * Backward compatibility wrapper for single video addition to 'Watch Later'
 */
async function addVideoToYouTubeWatchLater(videoId, preferredTabId) {
  const res = await addVideosToYouTubePlaylist([videoId], 'WL', preferredTabId);
  return {
    success: true,
    videoId: videoId,
    alreadyAdded: res.alreadyAddedCount > 0 && res.addedCount === 0,
    accountTitle: res.accountTitle,
    delegatedSessionId: res.delegatedSessionId,
    method: 'in_tab_innertube'
  };
}

/**
 * Chrome Agent Bridge - YouTube Service
 * Handles authenticated additions to YouTube 'Watch Later' playlist via InnerTube API.
 * Supports active YouTube brand accounts / delegated identities (DELEGATED_SESSION_ID & X-Goog-PageId).
 */

function isRealYouTubePage(tab) {
  if (!tab || !tab.url) return false;
  const u = tab.url;
  return u.includes('youtube.com') && 
    !u.includes('/robots.txt') && 
    !u.includes('/favicon.ico') &&
    !u.includes('accounts.google.com');
}

async function addVideoToYouTubeWatchLater(videoId, preferredTabId) {
  if (!videoId || typeof videoId !== 'string') {
    throw new Error('ID видео YouTube не указан.');
  }

  const cleanVideoId = videoId.trim();

  // 1. Retrieve last known YouTube auth context (cached channel/brand account)
  let cachedContext = null;
  try {
    const stored = await chrome.storage.local.get(['yt_account_context']);
    cachedContext = stored.yt_account_context || null;
  } catch (e) {
    // Ignore storage read error
  }

  // 2. Select target YouTube tab: prioritize active/open content tabs with loaded ytcfg
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
    
    // Priority:
    // a) Active content tab in any window (especially the user's current YouTube window)
    const activeContentTab = ytTabs.find(t => t.active && !t.discarded && isRealYouTubePage(t));
    // b) Fully loaded content tab (watch page, home, channel)
    const readyContentTab = ytTabs.find(t => t.status === 'complete' && !t.discarded && isRealYouTubePage(t));
    // c) Any non-discarded real content tab
    const anyContentTab = ytTabs.find(t => !t.discarded && isRealYouTubePage(t));
    // d) Fallback to any tab
    const fallbackTab = ytTabs.find(t => !t.discarded) || ytTabs[0];

    targetTab = activeContentTab || readyContentTab || anyContentTab || fallbackTab;
  }

  let createdTempTab = false;
  if (!targetTab) {
    // If no YouTube tab is open:
    // If we have cached brand account info, lightweight robots.txt suffices for cookie transport
    // If not, open desktop YouTube in background to initialize ytcfg and active channel identity
    try {
      const urlToOpen = cachedContext?.delegatedSessionId
        ? 'https://www.youtube.com/robots.txt'
        : 'https://www.youtube.com/?app=desktop';

      targetTab = await chrome.tabs.create({ url: urlToOpen, active: false });
      createdTempTab = true;

      // Wait for tab readiness (up to 2500ms)
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
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      world: 'MAIN',
      func: async (vId, fallbackAuth) => {
        try {
          // 1. Extract SAPISID or __Secure-3PAPISID from document.cookie
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

          // 2. Compute SAPISIDHASH (Date.now() in milliseconds)
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

          // 3. Helper to extract configuration from window.ytcfg
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

          // Active Brand Account / Channel identity (DELEGATED_SESSION_ID = Google PageId)
          const delegatedSessionId = getYtCfg('DELEGATED_SESSION_ID')
            || innertubeContext?.user?.onBehalfOfUser
            || innertubeContext?.user?.delegatedSessionId
            || fallbackAuth?.delegatedSessionId
            || null;

          const sessionIndex = getYtCfg('SESSION_INDEX')
            ?? fallbackAuth?.sessionIndex
            ?? '0';

          const apiKey = getYtCfg('INNERTUBE_API_KEY')
            || fallbackAuth?.apiKey
            || null;

          const clientVersion = getYtCfg('INNERTUBE_CLIENT_VERSION')
            || fallbackAuth?.clientVersion
            || '2.20261025.01.00';

          const visitorData = getYtCfg('VISITOR_DATA')
            || fallbackAuth?.visitorData
            || null;

          // Attempt to extract active channel/profile title
          function getActiveAccountTitle() {
            try {
              // 1. Check ytcfg configuration
              const cfgName = getYtCfg('USER_DISPLAY_NAME') 
                           || getYtCfg('USER_NAME') 
                           || getYtCfg('CHANNEL_TITLE')
                           || getYtCfg('INNERTUBE_CONTEXT')?.user?.displayName;
              if (cfgName && typeof cfgName === 'string' && cfgName.trim().length > 0) {
                return cfgName.trim();
              }

              // 2. Check avatar button aria-label / title
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

              // 3. Check avatar img alt attribute
              const avatarImg = document.querySelector('button#avatar-btn img, yt-img-shadow#avatar img');
              if (avatarImg && avatarImg.alt) {
                const clean = avatarImg.alt
                  .replace(/^(?:Аватар профиля|Аватар пользователя|Аватарка|Avatar image|Profile photo)(?::|\s*[-–—]\s*)?\s*/i, '')
                  .trim();
                if (clean && clean.length > 0 && clean.length < 50 && !/^(?:аккаунт|account|аватар|avatar)$/i.test(clean)) {
                  return clean;
                }
              }

              // 4. Check "You" / channel link in guide sidebar (e.g. href="/@relovedv")
              const guideChannelLink = document.querySelector('ytd-guide-section-renderer a[href*="/@"], a#endpoint[href*="/@"]');
              if (guideChannelLink) {
                const handleMatch = (guideChannelLink.getAttribute('href') || '').match(/@([a-zA-Z0-9_.-]+)/);
                if (handleMatch && handleMatch[1]) {
                  return handleMatch[1];
                }
                const text = guideChannelLink.textContent?.trim();
                if (text && text.length > 0 && text.length < 40 && text.toLowerCase() !== 'вы' && text.toLowerCase() !== 'you') {
                  return text;
                }
              }
            } catch (e) {}
            return fallbackAuth?.accountTitle || null;
          }
          const accountTitle = getActiveAccountTitle();

          // 4. Construct InnerTube headers
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

          // 5. Construct payload context
          let reqContext = null;
          if (innertubeContext && typeof innertubeContext === 'object') {
            try {
              reqContext = JSON.parse(JSON.stringify(innertubeContext));
            } catch (e) {
              reqContext = null;
            }
          }
          if (!reqContext) {
            reqContext = {
              client: {
                clientName: 'WEB',
                clientVersion: clientVersion
              }
            };
          }

          // Ensure delegated channel identity is explicitly set on user context
          if (delegatedSessionId) {
            if (!reqContext.user) reqContext.user = {};
            reqContext.user.onBehalfOfUser = String(delegatedSessionId);
            reqContext.user.delegatedSessionId = String(delegatedSessionId);
          }

          // 6. Send InnerTube browse/edit_playlist request
          const endpoint = apiKey
            ? `https://www.youtube.com/youtubei/v1/browse/edit_playlist?key=${apiKey}&prettyPrint=false`
            : 'https://www.youtube.com/youtubei/v1/browse/edit_playlist';

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: reqHeaders,
            credentials: 'include',
            body: JSON.stringify({
              context: reqContext,
              actions: [
                {
                  addedVideoId: vId,
                  action: 'ACTION_ADD_VIDEO'
                }
              ],
              playlistId: 'WL'
            })
          });

          if (!res.ok) {
            return { success: false, status: res.status, error: `HTTP ${res.status}: ${res.statusText}` };
          }

          const data = await res.json();

          const currentAuthContext = {
            delegatedSessionId: delegatedSessionId ? String(delegatedSessionId) : null,
            sessionIndex: String(sessionIndex),
            clientVersion,
            apiKey: apiKey ? String(apiKey) : null,
            visitorData: visitorData ? String(visitorData) : null,
            accountTitle: accountTitle ? String(accountTitle) : null,
            savedAt: Date.now()
          };

          if (data && data.status === 'STATUS_SUCCEEDED') {
            return {
              success: true,
              status: 'STATUS_SUCCEEDED',
              authContext: currentAuthContext,
              data
            };
          }

          // Extract error/alert message
          let alertMsg = '';
          if (data && data.alerts && Array.isArray(data.alerts)) {
            for (const a of data.alerts) {
              const text = a?.alertRenderer?.text?.runs?.map(r => r.text).join('') || a?.alertRenderer?.text?.simpleText;
              if (text) { alertMsg = text; break; }
            }
          } else if (data && data.error && data.error.message) {
            alertMsg = data.error.message;
          }

          const isAlreadyAdded = alertMsg && (
            alertMsg.toLowerCase().includes('уже есть') || 
            alertMsg.toLowerCase().includes('already in') ||
            alertMsg.toLowerCase().includes('already added')
          );
          if (isAlreadyAdded) {
            return {
              success: true,
              alreadyAdded: true,
              status: 'ALREADY_IN_PLAYLIST',
              authContext: currentAuthContext
            };
          }

          return {
            success: false,
            status: data?.status || 'STATUS_FAILED',
            error: alertMsg || `YouTube отклонил добавление (статус: ${data?.status || 'STATUS_FAILED'})`
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      },
      args: [cleanVideoId, cachedContext]
    });

    if (results && results[0] && results[0].result) {
      const r = results[0].result;

      // Update background cache with latest YouTube auth identity
      if (r.authContext) {
        try {
          await chrome.storage.local.set({ yt_account_context: r.authContext });
        } catch (saveErr) {
          console.warn('Could not cache yt_account_context:', saveErr);
        }
      }

      if (r.success) {
        return {
          success: true,
          videoId: cleanVideoId,
          alreadyAdded: !!r.alreadyAdded,
          accountTitle: r.authContext?.accountTitle || null,
          delegatedSessionId: r.authContext?.delegatedSessionId || null,
          method: 'in_tab_innertube'
        };
      }
      if (r.error) {
        throw new Error(r.error);
      }
    }

    throw new Error('Не получен ответ от вкладки YouTube.');
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


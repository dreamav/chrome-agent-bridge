/**
 * Chrome Agent Bridge - YouTube Service
 * Handles authenticated additions to YouTube 'Watch Later' playlist via InnerTube API.
 */

async function addVideoToYouTubeWatchLater(videoId, preferredTabId) {
  if (!videoId || typeof videoId !== 'string') {
    throw new Error('ID видео YouTube не указан.');
  }

  const cleanVideoId = videoId.trim();

  // Pick target YouTube tab: first check preferredTabId, then any open YouTube tab
  let targetTab = null;
  if (typeof preferredTabId === 'number') {
    try {
      const t = await chrome.tabs.get(preferredTabId);
      if (t && t.url && t.url.includes('youtube.com') && !t.discarded) {
        targetTab = t;
      }
    } catch (e) {
      // Tab not found or closed
    }
  }

  if (!targetTab) {
    const ytTabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    targetTab = ytTabs.find(t => !t.discarded && t.status === 'complete')
             || ytTabs.find(t => !t.discarded)
             || ytTabs[0];
  }

  let createdTempTab = false;
  if (!targetTab) {
    // If no YouTube tab is open, open a lightweight background tab to access YouTube origin
    try {
      targetTab = await chrome.tabs.create({ url: 'https://www.youtube.com/robots.txt', active: false });
      createdTempTab = true;
      await new Promise(r => setTimeout(r, 600));
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
      func: async (vId) => {
        try {
          // 1. Extract SAPISID or __Secure-3PAPISID from document.cookie
          function getSapisid() {
            const match = document.cookie.match(/(?:^|;\s*)(?:__Secure-3P|__Secure-1P)?SAPISID=([^;]+)/);
            if (match) return match[1];
            const cookies = document.cookie.split('; ');
            for (const c of cookies) {
              if (c.startsWith('SAPISID=')) return c.substring(8);
              if (c.startsWith('__Secure-3PAPISID=')) return c.substring(18);
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

          // 2. Compute SAPISIDHASH (Date.now() in milliseconds!)
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

          // 3. Client version from ytcfg
          const clientVersion = window.ytcfg?.data_?.INNERTUBE_CLIENT_VERSION 
                             || (typeof window.ytcfg?.get === 'function' && window.ytcfg.get('INNERTUBE_CLIENT_VERSION'))
                             || '2.20261025.01.00';

          // 4. Send InnerTube browse/edit_playlist request
          const endpoint = 'https://www.youtube.com/youtubei/v1/browse/edit_playlist';
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `SAPISIDHASH ${sapisidhash}`
            },
            credentials: 'include',
            body: JSON.stringify({
              context: {
                client: {
                  clientName: 'WEB',
                  clientVersion: clientVersion
                }
              },
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

          if (data && data.status === 'STATUS_SUCCEEDED') {
            return { success: true, status: 'STATUS_SUCCEEDED', data };
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
            return { success: true, alreadyAdded: true, status: 'ALREADY_IN_PLAYLIST' };
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
      args: [cleanVideoId]
    });

    if (results && results[0] && results[0].result) {
      const r = results[0].result;
      if (r.success) {
        return { success: true, videoId: cleanVideoId, alreadyAdded: !!r.alreadyAdded, method: 'in_tab_innertube' };
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

/**
 * Chrome Agent Bridge — YouTube Batch Playlist Modal Controller
 * Handles playlist retrieval, brand channel detection, selection, and batch submission via InnerTube.
 */

function openYouTubePlaylistModal(videosList) {
  if (!Array.isArray(videosList) || videosList.length === 0) {
    showToast('Нет выбранных видео YouTube для добавления.');
    return;
  }

  ManagerState.ytModalVideos = videosList;

  if (DOM.ytModalVideoCount) {
    DOM.ytModalVideoCount.textContent = `${videosList.length} ${getNoun(videosList.length, 'видео', 'видео', 'видео')}`;
  }

  if (DOM.ytModalStatusBox) DOM.ytModalStatusBox.classList.add('hidden');
  if (DOM.btnYtModalSubmit) {
    DOM.btnYtModalSubmit.disabled = false;
    DOM.btnYtModalSubmit.innerHTML = '<span>▶️</span> Добавить в плейлист';
  }
  if (DOM.ytCustomPlaylistContainer) {
    DOM.ytCustomPlaylistContainer.classList.add('hidden');
  }
  if (DOM.ytCustomPlaylistInput) {
    DOM.ytCustomPlaylistInput.value = '';
  }

  if (DOM.ytPlaylistModal) {
    DOM.ytPlaylistModal.classList.remove('hidden');
    DOM.ytPlaylistModal.setAttribute('aria-hidden', 'false');
  }

  loadYouTubePlaylists();
}

function closeYouTubePlaylistModal() {
  if (DOM.ytPlaylistModal) {
    DOM.ytPlaylistModal.classList.add('hidden');
    DOM.ytPlaylistModal.setAttribute('aria-hidden', 'true');
  }
  ManagerState.ytModalVideos = [];
}

async function loadYouTubePlaylists(forceRefresh = false) {
  if (!forceRefresh && ManagerState.cachedPlaylists && ManagerState.cachedPlaylists.length > 0) {
    populatePlaylistsDropdown(ManagerState.cachedPlaylists, ManagerState.cachedYtAccount);
    return;
  }

  if (DOM.ytPlaylistsLoading) DOM.ytPlaylistsLoading.classList.remove('hidden');
  if (DOM.ytModalAccountName) DOM.ytModalAccountName.textContent = 'Определение канала...';

  const sampleVideoId = ManagerState.ytModalVideos[0]?.videoId || null;

  chrome.runtime.sendMessage({
    action: 'youtube_get_playlists',
    params: { sampleVideoId }
  }, (res) => {
    if (DOM.ytPlaylistsLoading) DOM.ytPlaylistsLoading.classList.add('hidden');

    if (res && res.success) {
      const playlists = res.result?.playlists || [];
      const accountTitle = res.result?.accountTitle || null;

      ManagerState.cachedPlaylists = playlists;
      ManagerState.cachedYtAccount = accountTitle;

      populatePlaylistsDropdown(playlists, accountTitle);
    } else {
      populatePlaylistsDropdown([{ id: 'WL', title: 'Смотреть позже (Watch Later)', privacy: 'PRIVACY_PRIVATE' }], null);
    }
  });
}

function populatePlaylistsDropdown(playlists, accountTitle) {
  if (DOM.ytModalAccountName) {
    DOM.ytModalAccountName.textContent = accountTitle || 'Авторизованный канал';
  }

  if (!DOM.ytPlaylistSelect) return;
  DOM.ytPlaylistSelect.innerHTML = '';

  const lastUsedPlaylist = localStorage.getItem('chrome_bridge_yt_last_playlist') || 'WL';

  playlists.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    const privacyIcon = p.privacy === 'PRIVACY_PRIVATE' ? '🔒 ' : (p.privacy === 'PRIVACY_PUBLIC' ? '🌐 ' : '');
    opt.textContent = `${privacyIcon}${p.title}`;
    if (p.id === lastUsedPlaylist) {
      opt.selected = true;
    }
    DOM.ytPlaylistSelect.appendChild(opt);
  });
}

async function submitYouTubeAddToPlaylist() {
  if (!ManagerState.ytModalVideos || ManagerState.ytModalVideos.length === 0) {
    showToast('Не выбрано ни одного видео.');
    return;
  }

  // Determine target playlist
  let targetPlaylist = 'WL';
  const isCustomVisible = DOM.ytCustomPlaylistContainer && !DOM.ytCustomPlaylistContainer.classList.contains('hidden');
  const customVal = DOM.ytCustomPlaylistInput?.value?.trim();

  if (isCustomVisible && customVal) {
    targetPlaylist = customVal;
  } else if (DOM.ytPlaylistSelect?.value) {
    targetPlaylist = DOM.ytPlaylistSelect.value;
  }

  localStorage.setItem('chrome_bridge_yt_last_playlist', targetPlaylist);

  // UI state: progress
  if (DOM.btnYtModalSubmit) {
    DOM.btnYtModalSubmit.disabled = true;
    DOM.btnYtModalSubmit.innerHTML = '<span class="spinner-mini"></span> Добавление...';
  }
  if (DOM.ytModalStatusBox) {
    DOM.ytModalStatusBox.classList.remove('hidden');
  }
  if (DOM.ytModalProgressFill) {
    DOM.ytModalProgressFill.style.width = '35%';
  }
  if (DOM.ytModalStatusText) {
    DOM.ytModalStatusText.textContent = `Отправка запроса в YouTube InnerTube для ${ManagerState.ytModalVideos.length} видео...`;
  }

  const videoIds = ManagerState.ytModalVideos.map(v => v.videoId);

  chrome.runtime.sendMessage({
    action: 'youtube_add_to_playlist',
    params: {
      videoIds,
      playlistId: targetPlaylist
    }
  }, (res) => {
    if (DOM.ytModalProgressFill) {
      DOM.ytModalProgressFill.style.width = '100%';
    }

    if (res && res.success) {
      const r = res.result || {};
      const addedCount = r.addedCount || 0;
      const alreadyCount = r.alreadyAddedCount || 0;
      const channelSuffix = r.accountTitle ? ` (Канал: ${r.accountTitle})` : '';

      let msg = '';
      if (addedCount > 0 && alreadyCount > 0) {
        msg = `✓ Добавлено ${addedCount} видео (ещё ${alreadyCount} уже были в плейлисте)${channelSuffix}!`;
      } else if (alreadyCount > 0 && addedCount === 0) {
        msg = `✓ Все ${alreadyCount} видео уже находятся в этом плейлисте${channelSuffix}!`;
      } else {
        msg = `✓ Успешно добавлено ${addedCount} видео в плейлист${channelSuffix}!`;
      }

      if (DOM.ytModalStatusText) {
        DOM.ytModalStatusText.innerHTML = `<span style="color: #4ade80;">${escapeHtml(msg)}</span>`;
      }
      showToast(msg, 4500);

      setTimeout(() => {
        closeYouTubePlaylistModal();
        clearSelection();
      }, 1200);
    } else {
      const err = res?.error || 'Не удалось добавить видео в плейлист YouTube.';
      if (DOM.ytModalStatusText) {
        DOM.ytModalStatusText.innerHTML = `<span style="color: #f87171;">⚠️ ${escapeHtml(err)}</span>`;
      }
      if (DOM.btnYtModalSubmit) {
        DOM.btnYtModalSubmit.disabled = false;
        DOM.btnYtModalSubmit.innerHTML = '<span>▶️</span> Повторить попытку';
      }
      showToast(`⚠️ ${err}`, 5000);
    }
  });
}

function initYouTubeModalEvents() {
  if (DOM.btnYtModalClose) {
    DOM.btnYtModalClose.addEventListener('click', closeYouTubePlaylistModal);
  }
  if (DOM.btnYtModalCancel) {
    DOM.btnYtModalCancel.addEventListener('click', closeYouTubePlaylistModal);
  }
  if (DOM.ytPlaylistModal) {
    DOM.ytPlaylistModal.addEventListener('click', (e) => {
      if (e.target === DOM.ytPlaylistModal) {
        closeYouTubePlaylistModal();
      }
    });
  }
  if (DOM.btnRefreshYtPlaylists) {
    DOM.btnRefreshYtPlaylists.addEventListener('click', (e) => {
      e.stopPropagation();
      loadYouTubePlaylists(true);
    });
  }
  if (DOM.btnToggleCustomPlaylist) {
    DOM.btnToggleCustomPlaylist.addEventListener('click', (e) => {
      e.stopPropagation();
      if (DOM.ytCustomPlaylistContainer) {
        const isHidden = DOM.ytCustomPlaylistContainer.classList.contains('hidden');
        DOM.ytCustomPlaylistContainer.classList.toggle('hidden', !isHidden);
        if (isHidden && DOM.ytCustomPlaylistInput) {
          DOM.ytCustomPlaylistInput.focus();
        }
      }
    });
  }
  if (DOM.btnYtModalSubmit) {
    DOM.btnYtModalSubmit.addEventListener('click', submitYouTubeAddToPlaylist);
  }

  // Batch action bar YouTube button trigger
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
}

/**
 * Chrome Agent Bridge - Command Router
 * Dispatches extension and agent commands to appropriate domain modules.
 */

const SUPPORTED_ACTIONS = [
  'get_tabs',
  'close_duplicate_tabs',
  'close_tabs',
  'ungroup_all_tabs',
  'apply_layout',
  'activate_tab',
  'create_tab',
  'get_page_text',
  'get_live_session',
  'open_manager',
  'save_session',
  'list_sessions',
  'restore_session',
  'export_session_json',
  'delete_session',
  'rename_session',
  'update_session',
  'import_session_json',
  'youtube_watch_later'
];

/**
 * Command Dispatcher - Pure Chrome API Executor
 */
async function executeAgentCommand(action, params = {}) {
  switch (action) {
    // --- Tabs & Layout ---
    case 'get_tabs': {
      return await getTabs();
    }

    case 'apply_layout': {
      const groups = params.groups || [];
      const closeEmpty = params.close_empty_windows !== false;
      return await applyLayout(groups, closeEmpty);
    }

    case 'close_tabs': {
      const input = params.tab_ids !== undefined ? params.tab_ids : params.tab_id;
      return await closeTabs(input);
    }

    case 'close_duplicate_tabs': {
      return await closeDuplicateTabs();
    }

    case 'get_page_text': {
      return await getPageText(params.tab_id);
    }

    case 'ungroup_all_tabs': {
      return await ungroupAllTabs();
    }

    case 'activate_tab': {
      return await activateTab(params.tab_id);
    }

    case 'create_tab': {
      return await createTab(params.url);
    }

    // --- Session Management ---
    case 'get_live_session': {
      return await getLiveSession();
    }

    case 'open_manager': {
      openManagerTab();
      return { success: true };
    }

    case 'save_session': {
      return await saveSession(params.name);
    }

    case 'list_sessions': {
      return await listSessions();
    }

    case 'restore_session': {
      const sId = params.sessionId || params.session_id || params.id;
      const gId = params.targetGroupId !== undefined ? params.targetGroupId : params.target_group_id;
      const options = {
        targetWindowIndex: params.targetWindowIndex !== undefined ? params.targetWindowIndex : params.windowIndex
      };
      return await restoreSession(sId, gId, options);
    }

    case 'export_session_json': {
      const sId = params.sessionId || params.session_id || params.id;
      return await exportSessionJson(sId);
    }

    case 'delete_session': {
      const sId = params.sessionId || params.session_id || params.id;
      return await deleteSession(sId);
    }

    case 'rename_session': {
      const sId = params.sessionId || params.session_id || params.id;
      const newName = params.newName || params.name || params.title;
      return await renameSession(sId, newName);
    }

    case 'update_session': {
      const sessionObj = params.session || params;
      return await updateSession(sessionObj);
    }

    case 'import_session_json': {
      const raw = params.session || params.sessionData || params.data || params.json || params;
      return await importSessionJson(raw);
    }

    // --- YouTube Integration ---
    case 'youtube_watch_later': {
      const videoId = params.videoId || params.video_id || params.id;
      const tabId = params.tabId || params.tab_id;
      return await addVideoToYouTubeWatchLater(videoId, tabId);
    }

    default:
      throw new Error(`Unknown command action: ${action}`);
  }
}

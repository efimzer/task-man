export const FOLDER_IDS = Object.freeze({
  ALL: 'all',
  INBOX: 'inbox',
  PERSONAL: 'personal',
  ARCHIVE: 'archive'
});

export function createDefaultState({ timestamp = Date.now() } = {}) {
  return {
    meta: {
      version: 0,
      updatedAt: timestamp,
      emptyStateTimestamps: {}
    },
    folders: [
      { id: FOLDER_IDS.ALL, name: 'Все' },
      { id: FOLDER_IDS.INBOX, name: 'Основные' },
      { id: FOLDER_IDS.PERSONAL, name: 'Личное' },
      { id: FOLDER_IDS.ARCHIVE, name: 'Архив' }
    ],
    tasks: [],
    archivedTasks: [],
    ui: {
      selectedFolderId: FOLDER_IDS.INBOX,
      activeScreen: 'folders'
    }
  };
}

export function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeState(rawState) {
  const base = createDefaultState();
  if (!rawState || typeof rawState !== 'object') {
    return base;
  }

  const normalized = {
    folders: Array.isArray(rawState.folders) && rawState.folders.length
      ? rawState.folders
      : base.folders,
    tasks: Array.isArray(rawState.tasks) ? rawState.tasks : base.tasks,
    archivedTasks: Array.isArray(rawState.archivedTasks) ? rawState.archivedTasks : base.archivedTasks,
    ui: {
      ...base.ui,
      ...(typeof rawState.ui === 'object' ? rawState.ui : {})
    },
    meta: {
      ...base.meta,
      ...(typeof rawState.meta === 'object' ? rawState.meta : {})
    }
  };

  if (!Number.isFinite(normalized.meta.version)) {
    const parsedVersion = parseInt(normalized.meta.version ?? base.meta.version, 10);
    normalized.meta.version = Number.isFinite(parsedVersion) ? parsedVersion : base.meta.version;
  }

  const rawUpdatedAt = normalized.meta.updatedAt;
  if (!Number.isFinite(rawUpdatedAt)) {
    if (typeof rawUpdatedAt === 'string') {
      const parsed = Date.parse(rawUpdatedAt);
      normalized.meta.updatedAt = Number.isFinite(parsed) ? parsed : base.meta.updatedAt;
    } else {
      normalized.meta.updatedAt = base.meta.updatedAt;
    }
  }

  if (!normalized.meta.emptyStateTimestamps || typeof normalized.meta.emptyStateTimestamps !== 'object') {
    normalized.meta.emptyStateTimestamps = {};
  }

  if (normalized.ui.activeScreen !== 'tasks' && normalized.ui.activeScreen !== 'folders') {
    normalized.ui.activeScreen = base.ui.activeScreen;
  }

  normalized.ui.selectedFolderId = normalized.ui.selectedFolderId || base.ui.selectedFolderId;

  return normalized;
}

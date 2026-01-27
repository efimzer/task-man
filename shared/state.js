const DEFAULT_ICON = null;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VALID_VIEW_MODES = new Set(['list', 'week']);

export const FOLDER_IDS = Object.freeze({
  ALL: 'all',
  INBOX: 'inbox',
  PERSONAL: 'personal',
  ARCHIVE: 'archive'
});

export const CURRENT_SCHEMA_VERSION = 2;

const REQUIRED_SYSTEM_FOLDERS = [
  {
    id: FOLDER_IDS.ALL,
    name: 'Все',
    parentId: null,
    order: 0,
    icon: DEFAULT_ICON
  },
  {
    id: FOLDER_IDS.ARCHIVE,
    name: 'Архив',
    parentId: FOLDER_IDS.ALL,
    order: 1000,
    icon: DEFAULT_ICON
  }
];

const DEFAULT_ROOT_FOLDERS = [
  {
    id: FOLDER_IDS.INBOX,
    name: 'Основные',
    parentId: FOLDER_IDS.ALL,
    order: 1,
    icon: DEFAULT_ICON
  },
  {
    id: FOLDER_IDS.PERSONAL,
    name: 'Личное',
    parentId: FOLDER_IDS.ALL,
    order: 2,
    icon: DEFAULT_ICON
  }
];

export function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFolder(folder, index, timestamp, fallbackParentId = FOLDER_IDS.ALL) {
  if (!folder || typeof folder !== 'object') {
    return null;
  }

  const id = typeof folder.id === 'string' && folder.id.trim()
    ? folder.id.trim()
    : `folder-${index}`;
  const name = typeof folder.name === 'string' && folder.name.trim()
    ? folder.name.trim()
    : `Папка ${index + 1}`;
  const parentId = typeof folder.parentId === 'string' && folder.parentId.trim()
    ? folder.parentId.trim()
    : null;
  const createdAt = toFiniteNumber(folder.createdAt, timestamp);
  const updatedAt = toFiniteNumber(folder.updatedAt, createdAt);
  const order = toFiniteNumber(folder.order, index);
  const icon = typeof folder.icon === 'string' && folder.icon.trim()
    ? folder.icon.trim()
    : DEFAULT_ICON;
  const viewMode = VALID_VIEW_MODES.has(folder.viewMode) ? folder.viewMode : 'list';
  const passwordHash = typeof folder.passwordHash === 'string' && folder.passwordHash.trim()
    ? folder.passwordHash.trim()
    : undefined;
  const passwordSalt = typeof folder.passwordSalt === 'string' && folder.passwordSalt.trim()
    ? folder.passwordSalt.trim()
    : undefined;
  const passwordHint = typeof folder.passwordHint === 'string'
    ? folder.passwordHint.trim()
    : '';
  const hasHint = Boolean(passwordHint);
  const isLocked = Boolean(passwordHash && passwordSalt);

  return {
    id,
    name,
    parentId: parentId === id ? fallbackParentId : parentId,
    createdAt,
    updatedAt,
    order,
    icon,
    viewMode,
    ...(passwordHash ? { passwordHash } : {}),
    ...(passwordSalt ? { passwordSalt } : {}),
    ...(hasHint ? { passwordHint } : {}),
    isLocked
  };
}

function normalizeTask(task, index, timestamp, folderIds = new Set(), { completed = false } = {}) {
  if (!task || typeof task !== 'object') {
    return null;
  }

  const id = typeof task.id === 'string' && task.id.trim()
    ? task.id.trim()
    : `task-${index}`;

  let text = typeof task.text === 'string' ? task.text : '';
  if (!text && typeof task.title === 'string') {
    text = task.title;
  }
  text = text.trim();
  if (!text) {
    return null;
  }

  const folderId = typeof task.folderId === 'string' && folderIds.has(task.folderId)
    ? task.folderId
    : null;

  const createdAt = toFiniteNumber(task.createdAt, timestamp);
  const updatedAt = toFiniteNumber(task.updatedAt ?? task.modifiedAt, createdAt);
  const order = toFiniteNumber(task.order, index);
  const completedAt = toFiniteNumber(task.completedAt, updatedAt);
  const plannedFor = typeof task.plannedFor === 'string' && ISO_DATE_PATTERN.test(task.plannedFor)
    ? task.plannedFor
    : undefined;

  return {
    id,
    text,
    folderId,
    completed: completed || Boolean(task.completed),
    createdAt,
    updatedAt,
    order,
    ...(Number.isFinite(completedAt) ? { completedAt } : {}),
    ...(plannedFor ? { plannedFor } : {})
  };
}

function mergeSystemFolders(folders, timestamp) {
  const map = new Map();

  folders.forEach((folder, index) => {
    const normalized = normalizeFolder(folder, index, timestamp);
    if (normalized) {
      map.set(normalized.id, normalized);
    }
  });

  REQUIRED_SYSTEM_FOLDERS.forEach((systemFolder, index) => {
    const existing = map.get(systemFolder.id);
    if (existing) {
      map.set(systemFolder.id, {
        ...systemFolder,
        ...existing,
        parentId: existing.parentId ?? systemFolder.parentId,
        createdAt: toFiniteNumber(existing.createdAt, timestamp),
        updatedAt: toFiniteNumber(existing.updatedAt, timestamp),
        order: toFiniteNumber(existing.order, systemFolder.order ?? index)
      });
    } else {
      map.set(
        systemFolder.id,
        normalizeFolder(systemFolder, index, timestamp, FOLDER_IDS.ALL)
      );
    }
  });

  return Array.from(map.values()).sort((a, b) => {
    if (a.order === b.order) {
      return a.name.localeCompare(b.name, 'ru');
    }
    return a.order - b.order;
  });
}

export function createDefaultState({ timestamp = Date.now() } = {}) {
  const folders = mergeSystemFolders([...DEFAULT_ROOT_FOLDERS], timestamp);
  return {
    meta: {
      version: 0,
      updatedAt: timestamp,
      emptyStateTimestamps: {},
      schemaVersion: CURRENT_SCHEMA_VERSION
    },
    folders,
    tasks: [],
    archivedTasks: [],
    ui: {
      selectedFolderId: FOLDER_IDS.INBOX,
      activeScreen: 'folders',
      expandedFolderIds: [FOLDER_IDS.ALL]
    }
  };
}

export function migrateToHierarchical(previousState = {}, { timestamp = Date.now() } = {}) {
  const base = createDefaultState({ timestamp });
  const source = previousState && typeof previousState === 'object'
    ? cloneState(previousState)
    : {};

  const mergedFolders = mergeSystemFolders(Array.isArray(source.folders) ? source.folders : [], timestamp);
  const folderIds = new Set(mergedFolders.map((folder) => folder.id));

  const tasks = [];
  const archivedCollection = [];
  const rawTasks = Array.isArray(source.tasks) ? source.tasks : [];
  rawTasks.forEach((task, index) => {
    const normalized = normalizeTask(task, index, timestamp, folderIds, { completed: Boolean(task?.completed) });
    if (normalized) {
      if (normalized.completed) {
        archivedCollection.push({ ...normalized, completed: true });
      } else {
        tasks.push({ ...normalized, completed: false });
      }
    }
  });

  const legacyArchived = Array.isArray(source.archivedTasks) ? source.archivedTasks : [];
  legacyArchived.forEach((task, index) => {
    const normalized = normalizeTask(
      task,
      rawTasks.length + index,
      timestamp,
      folderIds,
      { completed: true }
    );
    if (normalized) {
      archivedCollection.push({ ...normalized, completed: true });
    }
  });

  const ui = {
    ...base.ui,
    ...(typeof source.ui === 'object' ? source.ui : {})
  };

  if (!Array.isArray(ui.expandedFolderIds)) {
    ui.expandedFolderIds = [...base.ui.expandedFolderIds];
  } else {
    ui.expandedFolderIds = Array.from(
      new Set(
        ui.expandedFolderIds
          .filter((id) => typeof id === 'string' && folderIds.has(id))
      )
    );
  }

  if (!folderIds.has(ui.selectedFolderId)) {
    ui.selectedFolderId = folderIds.has(FOLDER_IDS.INBOX) ? FOLDER_IDS.INBOX : FOLDER_IDS.ALL;
  }

  return {
    meta: {
      ...base.meta,
      ...(typeof source.meta === 'object' ? source.meta : {}),
      schemaVersion: CURRENT_SCHEMA_VERSION
    },
    folders: mergedFolders,
    tasks,
    archivedTasks: archivedCollection,
    ui
  };
}

export function normalizeState(rawState, { timestamp = Date.now() } = {}) {
  if (!rawState || typeof rawState !== 'object') {
    return createDefaultState({ timestamp });
  }

  const schemaVersion = Number(rawState?.meta?.schemaVersion ?? 1);
  let workingState = rawState;

  if (schemaVersion < CURRENT_SCHEMA_VERSION || Array.isArray(rawState?.archivedTasks)) {
    workingState = migrateToHierarchical(rawState, { timestamp });
  }

  const base = createDefaultState({ timestamp });
  const folders = mergeSystemFolders(
    Array.isArray(workingState.folders) ? workingState.folders : [],
    timestamp
  );
  const folderIds = new Set(folders.map((folder) => folder.id));

  const seenIds = new Set();
  const tasks = [];
  const archivedTasks = [];

  const pushTask = (collection, task) => {
    if (!task) {
      return;
    }
    if (seenIds.has(task.id)) {
      return;
    }
    seenIds.add(task.id);
    collection.push(task);
  };

  (Array.isArray(workingState.tasks) ? workingState.tasks : []).forEach((task, index) => {
    const normalized = normalizeTask(task, index, timestamp, folderIds);
    if (!normalized) {
      return;
    }
    if (normalized.completed) {
      pushTask(archivedTasks, { ...normalized, completed: true });
    } else {
      pushTask(tasks, { ...normalized, completed: false });
    }
  });

  (Array.isArray(workingState.archivedTasks) ? workingState.archivedTasks : []).forEach((task, index) => {
    const normalized = normalizeTask(task, tasks.length + index, timestamp, folderIds, { completed: true });
    if (!normalized) {
      return;
    }
    pushTask(archivedTasks, { ...normalized, completed: true });
  });

  const ui = {
    ...base.ui,
    ...(typeof workingState.ui === 'object' ? workingState.ui : {})
  };

  if (!folderIds.has(ui.selectedFolderId)) {
    ui.selectedFolderId = folderIds.has(FOLDER_IDS.INBOX) ? FOLDER_IDS.INBOX : FOLDER_IDS.ALL;
  }

  if (!Array.isArray(ui.expandedFolderIds)) {
    ui.expandedFolderIds = [...base.ui.expandedFolderIds];
  } else {
    ui.expandedFolderIds = Array.from(
      new Set(
        ui.expandedFolderIds
          .filter((id) => typeof id === 'string' && folderIds.has(id))
      )
    );
  }

  const meta = {
    ...base.meta,
    ...(typeof workingState.meta === 'object' ? workingState.meta : {}),
    schemaVersion: CURRENT_SCHEMA_VERSION
  };

  if (!Number.isFinite(meta.version)) {
    meta.version = 0;
  }

  if (!Number.isFinite(meta.updatedAt)) {
    meta.updatedAt = timestamp;
  }

  if (!meta.emptyStateTimestamps || typeof meta.emptyStateTimestamps !== 'object') {
    meta.emptyStateTimestamps = {};
  }

  return {
    meta,
    folders,
    tasks,
    archivedTasks,
    ui
  };
}

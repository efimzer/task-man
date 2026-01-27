import { createSyncManager } from './sync.js';
import { syncConfig } from './sync-config.js';
import { authStore } from './auth.js';
import { initSwipeNavigation } from './swipe-navigation.js';
import { settingsManager } from './settings.js';
import { showLoadingIndicator, hideLoadingIndicator, showStartupLoader, hideStartupLoader } from './loading-indicator.js';
import {
  createDefaultState,
  normalizeState,
  cloneState,
  FOLDER_IDS
} from '../shared/state.js';

const STORAGE_KEY = 'vuexyTodoState';
const SESSION_COOKIE_NAME = 'todo_token';
const ALL_FOLDER_ID = FOLDER_IDS.ALL;
const ARCHIVE_FOLDER_ID = FOLDER_IDS.ARCHIVE;
const EMPTY_STATE_TIMEOUT = 30 * 1000;

const isChromeExtension = typeof chrome !== 'undefined' && chrome?.runtime?.id;
const hasChromeStorage = Boolean(isChromeExtension && chrome?.storage?.local);
const shouldPersistState = false; // Храним состояние только в памяти для всех окружений
const FAB_LONG_PRESS_THRESHOLD = 500;
const UI_CONTEXT_STORAGE_KEY = 'todoUiContext';
const UI_CONTEXT_VERSION = 1;
const PULL_REFRESH_THRESHOLD = 90;
const PULL_REFRESH_MAX = 160;
const PULL_REFRESH_RESET_DELAY = 500;
const PULL_REFRESH_DEFAULT_TEXT = 'Потяните, чтобы синхронизировать';
const PULL_REFRESH_READY_TEXT = 'Отпустите, чтобы синхронизировать';
const PULL_REFRESH_SYNCING_TEXT = 'Синхронизация...';
const PULL_REFRESH_DONE_TEXT = 'Синхронизировано';
const PULL_REFRESH_ERROR_TEXT = 'Ошибка синхронизации';
const VIEW_MODES = Object.freeze({
  LIST: 'list',
  WEEK: 'week'
});
const VALID_VIEW_MODES = new Set(Object.values(VIEW_MODES));
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LINK_PREVIEW_TTL = 12 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 2;
const INACTIVITY_TIMEOUT = 5 * 60 * 1000;

let uiContext = createDefaultUiContext();
let uiContextReady = false;
let uiContextProfileKey = 'anonymous';
let uiContextStorageSnapshot = null;
let navigationHistory = [];
const pullToRefreshState = {
  active: false,
  pulling: false,
  ready: false,
  syncing: false,
  startX: 0,
  startY: 0,
  currentOffset: 0
};
let pendingRestoredContext = null;
let syncManager = null;
let inMemoryState = null;
let storageKey = STORAGE_KEY;
let authMode = 'login'; // Переместили сюда
let pendingAuthErrorMessage = '';
let pendingAuthPrefillEmail = '';
let currentScreen = null;
let draggingTaskId = null;
let draggingSubfolderId = null;
let draggingSubfolderParentId = null;
let draggingFolderId = null;
let draggingFolderParentKey = null;
let draggingFolderBlock = null;
let draggingFolderAccepted = false;
let suppressFolderClickUntil = 0;
let weekDropTarget = null;
let dragGhost = null;
let editingFolderId = null;
let folderMenuAnchor = null;
let inlineComposer = null;
let lastCreatedTaskId = null;
let initialSyncCompleted = false;
let syncBootstrapInFlight = false;
let emptyStateTimer = null;
let emptyStateTimerFolderId = null;
let emptyStateExpired = false;
let manualSyncInFlight = false;
let state = null;
let startupLoaderActive = false;
let folderModalParentId = null;
let passwordModalState = { mode: null, folderId: null, busy: false };
let unlockModalState = { folderId: null, busy: false };
let inactivityTimer = null;
let fabPressTimer = null;
let fabLongPressTriggered = false;
let suppressNextFabClick = false;
const weekViewState = new Map();
const weekAutoScrollState = new Map();
const linkPreviewCache = new Map();
const unlockedFolderIds = new Set();

function supportsWebkitHaptics() {
  return typeof window !== 'undefined' && typeof window.webkit?.playHaptic === 'function';
}

function playHaptic(pattern = 'light') {
  try {
    if (supportsWebkitHaptics()) {
      window.webkit.playHaptic(pattern);
      return true;
    }
  } catch (error) {
    console.warn('Todo haptics: webkit play failed', error);
  }
  if (navigator?.vibrate) {
    const fallbackDuration = pattern === 'heavy' ? 50 : pattern === 'medium' ? 30 : 10;
    try {
      navigator.vibrate(fallbackDuration);
    } catch (error) {
      // ignore vibration errors
    }
  }
  return false;
}

const folderMenuState = {
  visible: false,
  folderId: null
};

const appMenuState = {
  visible: false,
  anchor: null
};

const weekMenuState = {
  visible: false,
  anchor: null
};

function ensureStartupLoader() {
  if (!startupLoaderActive) {
    showStartupLoader();
    startupLoaderActive = true;
  }
}

function dismissStartupLoader() {
  if (!startupLoaderActive) {
    return;
  }
  hideStartupLoader();
  startupLoaderActive = false;
}

const shouldUseAuthCookies = (() => {
  if (typeof window === 'undefined' || !syncConfig.baseUrl) {
    return false;
  }
  try {
    const target = new URL(syncConfig.baseUrl, window.location.origin);
    return target.origin === window.location.origin;
  } catch (error) {
    return false;
  }
})();

function hasSessionCookie() {
  if (typeof document === 'undefined') {
    return false;
  }
  try {
    return document.cookie
      .split(';')
      .map((part) => part.trim())
      .some((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  } catch (error) {
    console.warn('Todo sync: unable to read document.cookie', error);
    return false;
  }
}

function resolveAssetPath(extensionPath, { webPath } = {}) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(extensionPath);
  }
  if (webPath) {
    return webPath;
  }
  return extensionPath;
}

function buildApiUrl(path) {
  if (!syncConfig.baseUrl) {
    return path;
  }

  try {
    const url = new URL(path, syncConfig.baseUrl);
    return url.toString();
  } catch (error) {
    console.warn('Todo sync: unable to build API URL', error);
    return path;
  }
}

const uid = () => {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
};

const normalizeUserKey = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

function createDefaultUiContext() {
  return {
    lastScreen: 'folders',
    lastOpenedFolderId: null,
    navigationHistory: [],
    folderViewModes: {},
    taskPlannedFor: {},
    weekViewShowCompleted: {}
  };
}

function sanitizeUiContext(value) {
  if (!value || typeof value !== 'object') {
    return createDefaultUiContext();
  }

  const lastScreen = value.lastScreen === 'tasks' ? 'tasks' : 'folders';
  const lastOpenedFolderId = typeof value.lastOpenedFolderId === 'string' && value.lastOpenedFolderId.trim()
    ? value.lastOpenedFolderId.trim()
    : null;
  const navigationHistory = Array.isArray(value.navigationHistory)
    ? value.navigationHistory
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter((id) => Boolean(id))
    : [];
  const rawViewModes = value.folderViewModes;
  const folderViewModes = {};
  if (rawViewModes && typeof rawViewModes === 'object') {
    Object.entries(rawViewModes).forEach(([id, mode]) => {
      if (typeof id === 'string' && VALID_VIEW_MODES.has(mode)) {
        folderViewModes[id] = mode;
      }
    });
  }
  const rawTaskPlannedFor = value.taskPlannedFor;
  const taskPlannedFor = {};
  if (rawTaskPlannedFor && typeof rawTaskPlannedFor === 'object') {
    Object.entries(rawTaskPlannedFor).forEach(([id, date]) => {
      const plannedFor = normalizePlannedFor(date);
      if (typeof id === 'string' && plannedFor) {
        taskPlannedFor[id] = plannedFor;
      }
    });
  }
  const rawWeekShowCompleted = value.weekViewShowCompleted;
  const weekViewShowCompleted = {};
  if (rawWeekShowCompleted && typeof rawWeekShowCompleted === 'object') {
    Object.entries(rawWeekShowCompleted).forEach(([id, enabled]) => {
      if (typeof id === 'string' && typeof enabled === 'boolean') {
        weekViewShowCompleted[id] = enabled;
      }
    });
  }

  return {
    lastScreen,
    lastOpenedFolderId,
    navigationHistory,
    folderViewModes,
    taskPlannedFor,
    weekViewShowCompleted
  };
}

function setUiContextProfileKey(email) {
  const normalized = normalizeUserKey(email);
  uiContextProfileKey = normalized || 'anonymous';
}

async function readUiContextStorage() {
  if (uiContextStorageSnapshot) {
    return uiContextStorageSnapshot;
  }

  let stored = null;
  try {
    if (hasChromeStorage) {
      const result = await chrome.storage.local.get(UI_CONTEXT_STORAGE_KEY);
      stored = result?.[UI_CONTEXT_STORAGE_KEY] ?? null;
    } else if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(UI_CONTEXT_STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : null;
    }
  } catch (error) {
    console.warn('Todo UI: unable to read context storage', error);
  }

  if (!stored || typeof stored !== 'object') {
    stored = { version: UI_CONTEXT_VERSION, profiles: {} };
  } else {
    stored.version = Number.isFinite(stored.version) ? stored.version : UI_CONTEXT_VERSION;
    if (!stored.profiles || typeof stored.profiles !== 'object') {
      stored.profiles = {};
    }
  }

  uiContextStorageSnapshot = stored;
  return stored;
}

async function loadUiContextFromStorage() {
  const snapshot = await readUiContextStorage();
  const rawContext = snapshot?.profiles?.[uiContextProfileKey] ?? null;
  const sanitized = sanitizeUiContext(rawContext);
  snapshot.profiles = snapshot.profiles ?? {};
  snapshot.profiles[uiContextProfileKey] = {
    ...createDefaultUiContext(),
    ...sanitized,
    navigationHistory: [...sanitized.navigationHistory]
  };
  uiContextStorageSnapshot = snapshot;
  return sanitized;
}

async function persistUiContext({ force = false } = {}) {
  if (!uiContextReady && !force) {
    return;
  }

  const snapshot = await readUiContextStorage();
  const sanitized = sanitizeUiContext(uiContext);

  snapshot.version = UI_CONTEXT_VERSION;
  snapshot.profiles = snapshot.profiles ?? {};
  snapshot.profiles[uiContextProfileKey] = {
    ...createDefaultUiContext(),
    ...sanitized,
    navigationHistory: [...sanitized.navigationHistory]
  };

  uiContextStorageSnapshot = snapshot;

  try {
    if (hasChromeStorage) {
      await chrome.storage.local.set({ [UI_CONTEXT_STORAGE_KEY]: snapshot });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(UI_CONTEXT_STORAGE_KEY, JSON.stringify(snapshot));
    }
  } catch (error) {
    console.warn('Todo UI: unable to persist context', error);
  }
}

function cleanupLocalState(activeKey) {
  try {
    const prefix = `${STORAGE_KEY}`;
    const removeKeys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix) && key !== activeKey) {
        removeKeys.push(key);
      }
    }
    removeKeys.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.warn('Todo sync: unable to cleanup local storage', error);
  }

  if (hasChromeStorage) {
    chrome.storage.local.get(null, (items) => {
      if (chrome.runtime.lastError) {
        console.warn('Todo sync: unable to enumerate chrome storage', chrome.runtime.lastError);
        return;
      }
      const remove = Object.keys(items || {}).filter((key) => key.startsWith(STORAGE_KEY) && key !== activeKey);
      if (remove.length) {
        chrome.storage.local.remove(remove, () => {
          if (chrome.runtime.lastError) {
            console.warn('Todo sync: unable to cleanup chrome storage', chrome.runtime.lastError);
          }
        });
      }
    });
  }
}

function purgeLegacyLocalStorage() {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Todo sync: unable to purge legacy localStorage', error);
  }
}

function purgeLegacyChromeStorage() {
  if (!hasChromeStorage) {
    return;
  }
  try {
    chrome.storage.local.remove(STORAGE_KEY, () => {
      if (chrome.runtime?.lastError) {
        console.warn('Todo sync: unable to purge chrome storage', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    console.warn('Todo sync: unable to purge chrome storage', error);
  }
}

async function bootstrapAuthContext(userIdentifier) {
  // В веб-версии не добавляем email к ключу, так как localStorage уже изолирован
  // В расширении используем один общий ключ для всех пользователей (синхронизация через backend)
  storageKey = STORAGE_KEY;
  // Не делаем cleanup, так как используем один ключ
  if (!shouldPersistState) {
    purgeLegacyLocalStorage();
    purgeLegacyChromeStorage();
    inMemoryState = null;
  }
}

async function loadState() {
  if (!shouldPersistState || !hasChromeStorage) {
    if (inMemoryState) {
      return cloneState(inMemoryState);
    }
    return createDefaultState();
  }

  try {
    const stored = await chrome.storage.local.get(storageKey);
    const raw = stored?.[storageKey];
    if (!raw) {
      return createDefaultState();
    }
    return normalizeState(raw);
  } catch (error) {
    console.warn('Failed to load saved state:', error);
    return createDefaultState();
  }
}

async function saveState(state, options = {}) {
  const { skipRemote = false, updateMeta = true } = options;

  ensureSystemFolders(state);

  if (updateMeta) {
    const prevMeta = state.meta ?? {};
    const nextVersion = Number.isFinite(prevMeta.version) ? prevMeta.version + 1 : 1;
    const emptyStateTimestamps = prevMeta.emptyStateTimestamps ?? {};
    state.meta = {
      ...prevMeta,
      version: nextVersion,
      updatedAt: Date.now(),
      emptyStateTimestamps
    };
  } else if (!state.meta) {
    state.meta = { version: 0, updatedAt: Date.now(), emptyStateTimestamps: {} };
  } else if (!state.meta.emptyStateTimestamps) {
    state.meta.emptyStateTimestamps = {};
  }

  const snapshot = cloneState(state);

  if (shouldPersistState && hasChromeStorage) {
    try {
      await chrome.storage.local.set({ [storageKey]: snapshot });
    } catch (error) {
      console.warn('Failed to persist state:', error);
    }
  }

  inMemoryState = snapshot;

  if (!skipRemote) {
    syncManager?.schedulePush();
  }
}

const SYSTEM_FOLDER_BLUEPRINTS = [
  { id: ALL_FOLDER_ID, name: 'Все', parentId: null, order: 0 },
  { id: ARCHIVE_FOLDER_ID, name: 'Архив', parentId: ALL_FOLDER_ID, order: 1000 }
];

const PROTECTED_FOLDER_IDS = new Set([
  ALL_FOLDER_ID,
  ARCHIVE_FOLDER_ID
]);

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'sftp:']);
const LINKIFY_PATTERN = /(\[([^\]]+)\]\(([^)]+)\))|((?:https?|ftp):\/\/[^\s<>()]+|(?:www\.)[^\s<>()]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>()]*)?)/gi;

function ensureSystemFolders(state) {
  const now = Date.now();
  const map = new Map();
  const folders = Array.isArray(state.folders) ? state.folders : [];

  folders.forEach((folder, index) => {
    if (!folder || typeof folder !== 'object') {
      return;
    }
    const id = typeof folder.id === 'string' && folder.id.trim() ? folder.id.trim() : `folder-${index}`;
    const name = typeof folder.name === 'string' && folder.name.trim() ? folder.name.trim() : `Папка ${index + 1}`;
    const parentId = typeof folder.parentId === 'string' && folder.parentId.trim()
      ? folder.parentId.trim()
      : null;
    const createdAt = Number.isFinite(folder.createdAt) ? folder.createdAt : now;
    const updatedAt = Number.isFinite(folder.updatedAt) ? folder.updatedAt : createdAt;
    const order = Number.isFinite(folder.order) ? folder.order : index;
    const icon = typeof folder.icon === 'string' && folder.icon.trim() ? folder.icon.trim() : null;
    const viewMode = VALID_VIEW_MODES.has(folder.viewMode) ? folder.viewMode : VIEW_MODES.LIST;
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

    map.set(id, {
      id,
      name,
      parentId: parentId === id ? ALL_FOLDER_ID : parentId,
      createdAt,
      updatedAt,
      order,
      icon,
      viewMode,
      ...(passwordHash ? { passwordHash } : {}),
      ...(passwordSalt ? { passwordSalt } : {}),
      ...(hasHint ? { passwordHint } : {}),
      isLocked
    });
  });

  SYSTEM_FOLDER_BLUEPRINTS.forEach((blueprint, index) => {
    const existing = map.get(blueprint.id);
    if (existing) {
      existing.name = existing.name || blueprint.name;
      existing.parentId = typeof existing.parentId === 'string' ? existing.parentId : blueprint.parentId;
      existing.order = Number.isFinite(existing.order) ? existing.order : (blueprint.order ?? index);
      existing.createdAt = Number.isFinite(existing.createdAt) ? existing.createdAt : now;
      existing.updatedAt = Number.isFinite(existing.updatedAt) ? existing.updatedAt : now;
      existing.icon = existing.icon ?? blueprint.icon ?? null;
      existing.viewMode = VALID_VIEW_MODES.has(existing.viewMode) ? existing.viewMode : VIEW_MODES.LIST;
    } else {
      map.set(blueprint.id, {
        id: blueprint.id,
        name: blueprint.name,
        parentId: blueprint.parentId,
        createdAt: now,
        updatedAt: now,
        order: blueprint.order ?? index,
        icon: blueprint.icon ?? null,
        viewMode: VIEW_MODES.LIST
      });
    }
  });

  state.folders = Array.from(map.values()).sort((a, b) => {
    if (a.order === b.order) {
      return a.name.localeCompare(b.name, 'ru');
    }
    return a.order - b.order;
  });

  const folderIds = new Set(state.folders.map((folder) => folder.id));
  if (!folderIds.has(state.ui.selectedFolderId)) {
    state.ui.selectedFolderId = folderIds.has(FOLDER_IDS.INBOX) ? FOLDER_IDS.INBOX : ALL_FOLDER_ID;
    if (state.ui.activeScreen === 'tasks') {
      state.ui.activeScreen = 'folders';
    }
  }

  if (!Array.isArray(state.ui.expandedFolderIds)) {
    state.ui.expandedFolderIds = [ALL_FOLDER_ID];
  } else {
    state.ui.expandedFolderIds = Array.from(
      new Set(
        state.ui.expandedFolderIds.filter((id) => typeof id === 'string' && folderIds.has(id))
      )
    );
    if (!state.ui.expandedFolderIds.length) {
      state.ui.expandedFolderIds.push(ALL_FOLDER_ID);
    }
  }

  if (pendingRestoredContext) {
    attemptRestorePendingUiContext();
  }
}

function getFolderParentId(folderId) {
  if (!folderId) {
    return null;
  }
  const folder = state.folders.find((entry) => entry.id === folderId);
  return folder?.parentId ?? null;
}

function getFolderById(folderId) {
  if (!folderId) {
    return null;
  }
  return state.folders.find((folder) => folder.id === folderId) ?? null;
}

function getFolderLockKey(folderId) {
  if (!folderId) {
    return null;
  }
  return `folder:${folderId}`;
}

function folderHasPassword(folder) {
  return Boolean(folder?.passwordHash && folder?.passwordSalt);
}

function isFolderLocked(folderId) {
  const folder = getFolderById(folderId);
  return folderHasPassword(folder);
}

function isFolderUnlocked(folderId) {
  const key = getFolderLockKey(folderId);
  if (!key) {
    return false;
  }
  return unlockedFolderIds.has(key);
}

function setFolderUnlocked(folderId, unlocked) {
  const key = getFolderLockKey(folderId);
  if (!key) {
    return;
  }
  if (unlocked) {
    unlockedFolderIds.add(key);
  } else {
    unlockedFolderIds.delete(key);
  }
}

function requiresFolderUnlock(folderId) {
  if (!folderId || folderId === ALL_FOLDER_ID || folderId === ARCHIVE_FOLDER_ID) {
    return false;
  }
  return isFolderLocked(folderId) && !isFolderUnlocked(folderId);
}

function lockFolderIfNeeded(folderId) {
  if (!folderId) {
    return false;
  }
  if (isFolderLocked(folderId) && isFolderUnlocked(folderId)) {
    setFolderUnlocked(folderId, false);
    return true;
  }
  return false;
}

function lockAllFolders() {
  if (!unlockedFolderIds.size) {
    return false;
  }
  unlockedFolderIds.clear();
  return true;
}

function handleInactivityTimeout() {
  const changed = lockAllFolders();
  if (!changed) {
    return;
  }
  if (currentScreen === 'tasks' && requiresFolderUnlock(state?.ui?.selectedFolderId)) {
    render();
    return;
  }
  if (currentScreen === 'folders') {
    renderFolders();
    return;
  }
  render();
}

function scheduleInactivityLock() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }
  inactivityTimer = setTimeout(handleInactivityTimeout, INACTIVITY_TIMEOUT);
}

function handleUserActivity() {
  scheduleInactivityLock();
}

function getFolderViewMode(folderId) {
  if (!folderId || folderId === ALL_FOLDER_ID || folderId === ARCHIVE_FOLDER_ID) {
    return VIEW_MODES.LIST;
  }
  const contextMode = uiContext?.folderViewModes?.[folderId];
  if (VALID_VIEW_MODES.has(contextMode)) {
    return contextMode;
  }
  const folder = getFolderById(folderId);
  if (!folder) {
    return VIEW_MODES.LIST;
  }
  return folder.viewMode === VIEW_MODES.WEEK ? VIEW_MODES.WEEK : VIEW_MODES.LIST;
}

function setFolderViewMode(folderId, viewMode) {
  if (!folderId || !VALID_VIEW_MODES.has(viewMode)) {
    return;
  }
  const folder = getFolderById(folderId);
  if (!folder) {
    return;
  }
  if (folder.viewMode === viewMode) {
    return;
  }
  if (viewMode === VIEW_MODES.WEEK) {
    weekAutoScrollState.delete(folderId);
  }
  folder.viewMode = viewMode;
  folder.updatedAt = Date.now();
  if (!PROTECTED_FOLDER_IDS.has(folderId)) {
    if (!uiContext.folderViewModes || typeof uiContext.folderViewModes !== 'object') {
      uiContext.folderViewModes = {};
    }
    uiContext.folderViewModes[folderId] = viewMode;
    void persistUiContext({ force: true });
  }
  persistState();
  render();
}

function syncFolderViewModesToContext({ persist = true } = {}) {
  if (!uiContext || !state?.folders) {
    return false;
  }
  if (!uiContext.folderViewModes || typeof uiContext.folderViewModes !== 'object') {
    uiContext.folderViewModes = {};
  }
  const mapping = uiContext.folderViewModes;
  let changed = false;
  state.folders.forEach((folder) => {
    if (!folder || PROTECTED_FOLDER_IDS.has(folder.id)) {
      return;
    }
    const mode = VALID_VIEW_MODES.has(folder.viewMode) ? folder.viewMode : VIEW_MODES.LIST;
    if (mapping[folder.id] !== mode) {
      mapping[folder.id] = mode;
      changed = true;
    }
  });
  if (changed && uiContextReady && persist) {
    void persistUiContext();
  }
  return changed;
}

function applyFolderViewModesFromContext({ persist = false } = {}) {
  if (!uiContext || !state?.folders) {
    return false;
  }
  const mapping = uiContext.folderViewModes;
  if (!mapping || typeof mapping !== 'object') {
    return false;
  }
  let mutated = false;
  const now = Date.now();
  state.folders.forEach((folder) => {
    if (!folder || PROTECTED_FOLDER_IDS.has(folder.id)) {
      return;
    }
    const desired = mapping[folder.id];
    if (!VALID_VIEW_MODES.has(desired)) {
      return;
    }
    if (folder.viewMode !== desired) {
      folder.viewMode = desired;
      folder.updatedAt = now;
      mutated = true;
    }
  });
  if (mutated) {
    ensureSystemFolders(state);
    if (persist) {
      persistState();
    }
  }
  return mutated;
}

function isWeekViewActive(folderId = state?.ui?.selectedFolderId) {
  if (!folderId || folderId === ALL_FOLDER_ID || folderId === ARCHIVE_FOLDER_ID) {
    return false;
  }
  return getFolderViewMode(folderId) === VIEW_MODES.WEEK;
}

function getWeekStartForFolder(folderId) {
  const today = new Date();
  if (!folderId) {
    return getStartOfISOWeek(today);
  }
  const stored = weekViewState.get(folderId);
  if (stored?.start && isValidISODate(stored.start)) {
    const parsed = parseISODate(stored.start);
    if (parsed) {
      return parsed;
    }
  }
  const start = getStartOfISOWeek(today);
  weekViewState.set(folderId, {
    ...(stored && typeof stored === 'object' ? stored : {}),
    start: formatISODate(start)
  });
  return start;
}

function setWeekStartForFolder(folderId, date) {
  if (!folderId) {
    return;
  }
  const start = getStartOfISOWeek(date);
  weekAutoScrollState.delete(folderId);
  const existing = weekViewState.get(folderId);
  weekViewState.set(folderId, {
    ...(existing && typeof existing === 'object' ? existing : {}),
    start: formatISODate(start)
  });
}

function isISODateInWeek(isoDate, weekStart) {
  if (!isValidISODate(isoDate)) {
    return false;
  }
  const parsed = parseISODate(isoDate);
  if (!parsed) {
    return false;
  }
  const start = getStartOfISOWeek(weekStart);
  const end = addDays(start, 6);
  return parsed >= start && parsed <= end;
}

function getWeekSelectedDateForFolder(folderId, weekStart) {
  if (!folderId) {
    return null;
  }
  const stored = weekViewState.get(folderId);
  const candidate = stored?.selected;
  const start = weekStart ?? getWeekStartForFolder(folderId);
  if (candidate && isISODateInWeek(candidate, start)) {
    return candidate;
  }
  return null;
}

function setWeekSelectedDateForFolder(folderId, isoDate) {
  if (!folderId || !isValidISODate(isoDate)) {
    return;
  }
  const existing = weekViewState.get(folderId);
  weekViewState.set(folderId, {
    ...(existing && typeof existing === 'object' ? existing : {}),
    selected: isoDate
  });
}

function clearWeekSelectedDateForFolder(folderId) {
  if (!folderId) {
    return;
  }
  const existing = weekViewState.get(folderId);
  if (!existing || typeof existing !== 'object' || !existing.selected) {
    return;
  }
  const next = { ...existing };
  delete next.selected;
  weekViewState.set(folderId, next);
}

function getWeekShowCompleted(folderId) {
  if (!folderId) {
    return false;
  }
  return Boolean(uiContext.weekViewShowCompleted?.[folderId]);
}

function setWeekShowCompleted(folderId, value) {
  if (!folderId) {
    return;
  }
  if (!uiContext.weekViewShowCompleted || typeof uiContext.weekViewShowCompleted !== 'object') {
    uiContext.weekViewShowCompleted = {};
  }
  const nextValue = Boolean(value);
  if (uiContext.weekViewShowCompleted[folderId] === nextValue) {
    return;
  }
  uiContext.weekViewShowCompleted[folderId] = nextValue;
  void persistUiContext({ force: true });
  renderTasks();
}

function updateFolderMenuViewState(folderId) {
  if (!elements.folderMenu) {
    return;
  }
  const listItem = elements.folderMenu.querySelector('[data-action="view-list"]');
  const weekItem = elements.folderMenu.querySelector('[data-action="view-week"]');
  if (!listItem || !weekItem) {
    return;
  }
  const viewMode = getFolderViewMode(folderId);
  listItem.classList.toggle('is-selected', viewMode === VIEW_MODES.LIST);
  weekItem.classList.toggle('is-selected', viewMode === VIEW_MODES.WEEK);
  listItem.setAttribute('aria-checked', String(viewMode === VIEW_MODES.LIST));
  weekItem.setAttribute('aria-checked', String(viewMode === VIEW_MODES.WEEK));
}

function updateFolderMenuLockState(folderId) {
  if (!elements.folderMenu) {
    return;
  }
  const setItem = elements.folderMenu.querySelector('[data-action="password-set"]');
  const changeItem = elements.folderMenu.querySelector('[data-action="password-change"]');
  const removeItem = elements.folderMenu.querySelector('[data-action="password-remove"]');
  const lockItem = elements.folderMenu.querySelector('[data-action="lock-again"]');
  const divider = elements.folderMenu.querySelector('[data-divider="password"]');

  if (PROTECTED_FOLDER_IDS.has(folderId)) {
    setItem?.classList.add('hidden');
    changeItem?.classList.add('hidden');
    removeItem?.classList.add('hidden');
    lockItem?.classList.add('hidden');
    divider?.classList.add('hidden');
    return;
  }

  const locked = isFolderLocked(folderId);
  const unlocked = isFolderUnlocked(folderId);

  setItem?.classList.toggle('hidden', locked);
  changeItem?.classList.toggle('hidden', !locked);
  removeItem?.classList.toggle('hidden', !locked);
  lockItem?.classList.toggle('hidden', !(locked && unlocked));

  const anyVisible = [setItem, changeItem, removeItem, lockItem]
    .some((item) => item && !item.classList.contains('hidden'));
  divider?.classList.toggle('hidden', !anyVisible);
}

function expandAncestors(folderId) {
  const expanded = new Set(Array.isArray(state.ui.expandedFolderIds) ? state.ui.expandedFolderIds : [ALL_FOLDER_ID]);
  let current = folderId;
  while (current) {
    expanded.add(current);
    current = getFolderParentId(current);
  }
  expanded.add(ALL_FOLDER_ID);
  state.ui.expandedFolderIds = Array.from(expanded);
}

function computeFolderPath(folderId) {
  if (!folderId || folderId === ALL_FOLDER_ID) {
    return [];
  }
  const path = [];
  const seen = new Set();
  let current = folderId;

  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = getFolderById(current);
    if (!folder) {
      break;
    }
    path.unshift(folder.id);
    const parentId = folder.parentId ?? null;
    if (!parentId || parentId === ALL_FOLDER_ID) {
      break;
    }
    current = parentId;
  }

  return path;
}

function updateNavigationHistory(folderId) {
  if (!folderId || !getFolderById(folderId) || folderId === ALL_FOLDER_ID) {
    navigationHistory = [];
  } else {
    navigationHistory = computeFolderPath(folderId);
  }
  uiContext.navigationHistory = [...navigationHistory];
}

function applyUiContext(restoredContext) {
  const sanitized = sanitizeUiContext(restoredContext);
  uiContext = {
    ...createDefaultUiContext(),
    ...sanitized,
    navigationHistory: [...(sanitized.navigationHistory ?? [])]
  };
  applyFolderViewModesFromContext({ persist: false });
  syncFolderViewModesToContext({ persist: false });

  pendingRestoredContext = null;

  const desiredScreen = sanitized.lastScreen === 'tasks' ? 'tasks' : 'folders';
  const desiredFolderId = typeof sanitized.lastOpenedFolderId === 'string' && sanitized.lastOpenedFolderId.trim()
    ? sanitized.lastOpenedFolderId.trim()
    : null;

  if (desiredScreen === 'tasks') {
    if (desiredFolderId) {
      const folder = getFolderById(desiredFolderId);
      if (folder) {
        state.ui.selectedFolderId = folder.id;
        state.ui.activeScreen = 'tasks';
        expandAncestors(folder.id);
        updateNavigationHistory(folder.id);
        uiContext.lastScreen = 'tasks';
        uiContext.lastOpenedFolderId = folder.id;
        return 'applied';
      }
      pendingRestoredContext = {
        lastScreen: 'tasks',
        lastOpenedFolderId: desiredFolderId
      };
      state.ui.activeScreen = 'folders';
      updateNavigationHistory(null);
      uiContext.lastScreen = 'tasks';
      uiContext.lastOpenedFolderId = desiredFolderId;
      return 'pending';
    }

    state.ui.activeScreen = 'folders';
    uiContext.lastScreen = 'folders';
    uiContext.lastOpenedFolderId = null;
    updateNavigationHistory(null);
    return 'fallback';
  }

  state.ui.activeScreen = 'folders';
  uiContext.lastScreen = 'folders';
  uiContext.lastOpenedFolderId = null;
  updateNavigationHistory(null);
  return 'applied';
}

function attemptRestorePendingUiContext({ allowFallback = false } = {}) {
  if (!pendingRestoredContext) {
    if (allowFallback && !uiContextReady) {
      uiContextReady = true;
    }
    return 'none';
  }

  const targetScreen = pendingRestoredContext.lastScreen === 'tasks' ? 'tasks' : 'folders';
  const targetFolderId = typeof pendingRestoredContext.lastOpenedFolderId === 'string' && pendingRestoredContext.lastOpenedFolderId.trim()
    ? pendingRestoredContext.lastOpenedFolderId.trim()
    : null;

  if (targetScreen === 'tasks' && targetFolderId) {
    const folder = getFolderById(targetFolderId);
    if (folder) {
      state.ui.selectedFolderId = folder.id;
      state.ui.activeScreen = 'tasks';
      expandAncestors(folder.id);
      updateNavigationHistory(folder.id);
      uiContext.lastScreen = 'tasks';
      uiContext.lastOpenedFolderId = folder.id;
      pendingRestoredContext = null;
      uiContextReady = true;
      return 'restored';
    }

    if (!allowFallback) {
      return 'pending';
    }
  }

  pendingRestoredContext = null;
  uiContext.lastScreen = 'folders';
  uiContext.lastOpenedFolderId = null;
  updateNavigationHistory(null);
  if (!uiContextReady && allowFallback) {
    uiContextReady = true;
  }
  return targetScreen === 'tasks' ? 'fallback' : 'applied';
}

async function restoreUiContextFromStorage() {
  try {
    const stored = await loadUiContextFromStorage();
    const status = applyUiContext(stored);
    if (status === 'applied' || status === 'fallback') {
      uiContextReady = true;
    } else {
      uiContextReady = false;
    }
  } catch (error) {
    console.warn('Todo UI: unable to restore context', error);
    uiContext = createDefaultUiContext();
    state.ui.activeScreen = 'folders';
    updateNavigationHistory(null);
    uiContextReady = true;
  }
  ensureTaskPlannedFor({ persistStateChanges: true, persistContextChanges: true });
}

function updateUiContextForScreen(screenName) {
  if (!uiContextReady) {
    return;
  }

  if (screenName === 'tasks') {
    const selected = typeof state?.ui?.selectedFolderId === 'string'
      ? state.ui.selectedFolderId
      : null;
    if (selected && !getFolderById(selected)) {
      updateNavigationHistory(null);
      uiContext.lastOpenedFolderId = null;
    } else {
      updateNavigationHistory(selected ?? null);
      uiContext.lastOpenedFolderId = selected ?? null;
    }
    uiContext.lastScreen = 'tasks';
  } else {
    uiContext.lastScreen = 'folders';
    uiContext.lastOpenedFolderId = null;
    updateNavigationHistory(null);
  }

  syncFolderViewModesToContext({ persist: false });
  void persistUiContext();
}

function computeFolderTaskCounts() {
  const counts = new Map();
  const parentMap = new Map();
  const folders = Array.isArray(state?.folders) ? state.folders : [];
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const archivedTasks = Array.isArray(state?.archivedTasks) ? state.archivedTasks : [];

  folders.forEach((folder) => {
    counts.set(folder.id, 0);
    parentMap.set(folder.id, folder.parentId ?? null);
  });

  counts.set(ALL_FOLDER_ID, counts.get(ALL_FOLDER_ID) ?? 0);
  counts.set(ARCHIVE_FOLDER_ID, archivedTasks.length);

  tasks.forEach((task) => {
    if (task.completed) {
      return;
    }
    if (typeof task.folderId === 'string' && parentMap.has(task.folderId)) {
      let current = task.folderId;
      while (current) {
        counts.set(current, (counts.get(current) ?? 0) + 1);
        current = parentMap.get(current) || null;
      }
    }
    counts.set(ALL_FOLDER_ID, (counts.get(ALL_FOLDER_ID) ?? 0) + 1);
  });

  return { counts, parentMap };
}

function appendTextWithBreaks(target, text) {
  if (!text) {
    return;
  }
  const parts = String(text).split('\n');
  parts.forEach((part, index) => {
    if (part) {
      target.appendChild(document.createTextNode(part));
    } else {
      target.appendChild(document.createTextNode(''));
    }
    if (index < parts.length - 1) {
      target.appendChild(document.createElement('br'));
    }
  });
}

function stripTrailingPunctuation(value) {
  let url = value;
  let trailing = '';

  while (url.length) {
    const lastChar = url.charAt(url.length - 1);
    if (/[.,!?;:]/.test(lastChar)) {
      trailing = lastChar + trailing;
      url = url.slice(0, -1);
      continue;
    }
    if (lastChar === ')' || lastChar === ']' || lastChar === '}') {
      const pair = lastChar === ')' ? '(' : lastChar === ']' ? '[' : '{';
      const openCount = (url.match(new RegExp(`\\${pair}`, 'g')) || []).length;
      const closeCount = (url.match(new RegExp(`\\${lastChar}`, 'g')) || []).length;
      if (closeCount > openCount) {
        trailing = lastChar + trailing;
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }

  return { url, trailing };
}

function normalizeUrl(rawValue) {
  let value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) {
    return null;
  }
  if (/^(javascript|data|vbscript):/i.test(value)) {
    return null;
  }
  const hasProtocol = /^[a-z][\w+.-]*:/i.test(value);
  if (!hasProtocol) {
    value = `https://${value}`;
  }

  try {
    const parsed = new URL(value);
    if (!ALLOWED_LINK_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch (error) {
    return null;
  }
}

function createLinkElement({ href, label }) {
  const anchor = document.createElement('a');
  anchor.className = 'task-link';
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.textContent = label;

  const stop = (event) => event.stopPropagation();
  anchor.addEventListener('click', (event) => {
    if (event.detail > 1) {
      event.preventDefault();
    }
    stop(event);
  });
  anchor.addEventListener('mousedown', stop);
  anchor.addEventListener('mouseup', stop);
  anchor.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  return anchor;
}

function isValidISODate(value) {
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value);
}

function formatISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseISODate(value) {
  if (!isValidISODate(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function addDays(date, amount) {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  base.setDate(base.getDate() + amount);
  return base;
}

function getStartOfISOWeek(date) {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = base.getDay(); // 0 (Sun) - 6 (Sat)
  const offset = (day + 6) % 7; // Monday = 0
  base.setDate(base.getDate() - offset);
  base.setHours(0, 0, 0, 0);
  return base;
}

function formatWeekdayLabel(date) {
  const locale = navigator?.language || 'en-US';
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date);
  return `${weekday.replace('.', '')} ${day}`;
}

function formatWeekRangeLabel(startDate) {
  const locale = navigator?.language || 'en-US';
  const endDate = addDays(startDate, 6);
  const now = new Date();
  const includeYear = startDate.getFullYear() !== endDate.getFullYear()
    || startDate.getFullYear() !== now.getFullYear();
  const formatter = new Intl.DateTimeFormat(locale, includeYear
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric' });
  return `${formatter.format(startDate)} – ${formatter.format(endDate)}`;
}

function normalizePlannedFor(value) {
  return isValidISODate(value) ? value : undefined;
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function generatePasswordSalt(byteLength = 16) {
  if (typeof crypto?.getRandomValues !== 'function') {
    const fallback = Array.from({ length: byteLength }, () => Math.floor(Math.random() * 256));
    return fallback.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPasswordWithSalt(password, salt) {
  if (!crypto?.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('Crypto unavailable');
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(digest);
}

async function verifyFolderPassword(folder, password) {
  if (!folderHasPassword(folder)) {
    return false;
  }
  const hash = await hashPasswordWithSalt(password, folder.passwordSalt);
  return hash === folder.passwordHash;
}

function rememberTaskPlannedFor(taskId, plannedFor) {
  const normalized = normalizePlannedFor(plannedFor);
  if (!taskId || !normalized) {
    return;
  }
  if (!uiContext.taskPlannedFor || typeof uiContext.taskPlannedFor !== 'object') {
    uiContext.taskPlannedFor = {};
  }
  if (uiContext.taskPlannedFor[taskId] === normalized) {
    return;
  }
  uiContext.taskPlannedFor[taskId] = normalized;
  void persistUiContext({ force: true });
}

function ensureTaskPlannedFor({ persistStateChanges = true, persistContextChanges = true } = {}) {
  if (!state?.tasks || !state?.archivedTasks) {
    return false;
  }
  const fallback = formatISODate(new Date());
  if (!uiContext.taskPlannedFor || typeof uiContext.taskPlannedFor !== 'object') {
    uiContext.taskPlannedFor = {};
  }
  const mapping = uiContext.taskPlannedFor;
  const now = Date.now();
  let mutated = false;
  let mappingChanged = false;

  const apply = (task) => {
    if (!task || !task.id) {
      return;
    }
    const normalized = normalizePlannedFor(task.plannedFor);
    const mapped = normalizePlannedFor(mapping[task.id]);
    const desired = normalized ?? mapped ?? fallback;
    if (task.plannedFor !== desired) {
      task.plannedFor = desired;
      task.updatedAt = Number.isFinite(task.updatedAt) ? task.updatedAt : now;
      mutated = true;
    }
    if (mapping[task.id] !== desired) {
      mapping[task.id] = desired;
      mappingChanged = true;
    }
  };

  state.tasks.forEach(apply);
  state.archivedTasks.forEach(apply);

  if (mappingChanged && persistContextChanges) {
    void persistUiContext({ force: true });
  }
  if (mutated && persistStateChanges) {
    persistState();
  }

  return mutated || mappingChanged;
}

function createLinkifiedFragment(text, options = {}) {
  const fragment = document.createDocumentFragment();
  if (!text) {
    return fragment;
  }
  const hideHref = typeof options.hideHref === 'string' ? options.hideHref : null;
  const replacementText = typeof options.replacementText === 'string' ? options.replacementText : '';

  const input = String(text);
  let lastIndex = 0;
  LINKIFY_PATTERN.lastIndex = 0;
  let match;

  while ((match = LINKIFY_PATTERN.exec(input)) !== null) {
    const fullMatch = match[0];
    const matchStart = match.index;
    const matchEnd = match.index + fullMatch.length;

    if (matchStart > lastIndex) {
      appendTextWithBreaks(fragment, input.slice(lastIndex, matchStart));
    }

    const isMarkdown = Boolean(match[1]);
    if (!isMarkdown) {
      const precedingChar = matchStart > 0 ? input.charAt(matchStart - 1) : '';
      if (precedingChar === '@') {
        appendTextWithBreaks(fragment, fullMatch);
        lastIndex = matchEnd;
        continue;
      }
    }

    let label = '';
    let rawUrl = '';
    let trailing = '';

    if (isMarkdown) {
      label = match[2] ?? '';
      rawUrl = match[3] ?? '';
    } else {
      const stripped = stripTrailingPunctuation(fullMatch);
      label = stripped.url;
      rawUrl = stripped.url;
      trailing = stripped.trailing;
    }

    const normalized = normalizeUrl(rawUrl);
    if (!normalized) {
      appendTextWithBreaks(fragment, fullMatch);
      lastIndex = matchEnd;
      continue;
    }

    if (!isMarkdown && hideHref && normalized === hideHref) {
      if (replacementText) {
        appendTextWithBreaks(fragment, replacementText);
      }
      lastIndex = matchEnd;
      continue;
    }

    const anchor = createLinkElement({ href: normalized, label: label || normalized });
    fragment.appendChild(anchor);

    if (trailing) {
      appendTextWithBreaks(fragment, trailing);
    }

    lastIndex = matchEnd;
  }

  if (lastIndex < input.length) {
    appendTextWithBreaks(fragment, input.slice(lastIndex));
  }

  return fragment;
}

function extractFirstLink(text) {
  if (!text) {
    return null;
  }
  const input = String(text);
  LINKIFY_PATTERN.lastIndex = 0;
  let match;

  while ((match = LINKIFY_PATTERN.exec(input)) !== null) {
    const fullMatch = match[0];
    const matchStart = match.index;
    const isMarkdown = Boolean(match[1]);

    if (!isMarkdown) {
      const precedingChar = matchStart > 0 ? input.charAt(matchStart - 1) : '';
      if (precedingChar === '@') {
        continue;
      }
    }

    let label = '';
    let rawUrl = '';

    if (isMarkdown) {
      label = match[2] ?? '';
      rawUrl = match[3] ?? '';
    } else {
      const stripped = stripTrailingPunctuation(fullMatch);
      label = stripped.url;
      rawUrl = stripped.url;
    }

    const normalized = normalizeUrl(rawUrl);
    if (!normalized) {
      continue;
    }

    return {
      href: normalized,
      label: label || normalized,
      isMarkdown
    };
  }

  return null;
}

function getHostname(value) {
  if (!value) {
    return '';
  }
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch (error) {
    return '';
  }
}

function isDirectImageUrl(value) {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.toLowerCase();
    return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path);
  } catch (error) {
    return false;
  }
}

function isDirectVideoUrl(value) {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.toLowerCase();
    return /\.(mp4|webm|ogg|mov|m4v)$/i.test(path);
  } catch (error) {
    return false;
  }
}

function getYouTubeId(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./i, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.slice(1);
      return id || null;
    }
    if (!host.endsWith('youtube.com')) {
      return null;
    }
    if (parsed.pathname === '/watch') {
      return parsed.searchParams.get('v');
    }
    if (parsed.pathname.startsWith('/shorts/')) {
      return parsed.pathname.split('/')[2] || null;
    }
    if (parsed.pathname.startsWith('/embed/')) {
      return parsed.pathname.split('/')[2] || null;
    }
    if (parsed.pathname.startsWith('/live/')) {
      return parsed.pathname.split('/')[2] || null;
    }
  } catch (error) {
    return null;
  }
  return null;
}

function isVideoLink(value) {
  if (getYouTubeId(value)) {
    return true;
  }
  if (isDirectVideoUrl(value)) {
    return true;
  }
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./i, '');
    if (host.endsWith('vimeo.com') || host.endsWith('loom.com') || host.endsWith('rutube.ru')) {
      return true;
    }
  } catch (error) {
    return false;
  }
  return false;
}

function buildSitePreviewUrl(value) {
  const encoded = encodeURI(value);
  return `https://image.thum.io/get/width/900/noanimate/${encoded}`;
}

function getPreviewMedia(value) {
  const youtubeId = getYouTubeId(value);
  if (youtubeId) {
    return {
      src: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`,
      isVideo: true
    };
  }

  if (isDirectImageUrl(value)) {
    return { src: value, isVideo: false };
  }

  if (isVideoLink(value)) {
    return { src: buildSitePreviewUrl(value), isVideo: true };
  }

  return { src: buildSitePreviewUrl(value), isVideo: false };
}

function getCachedPreviewData(href) {
  const cached = linkPreviewCache.get(href);
  if (!cached) {
    return null;
  }
  if (cached.data && cached.fetchedAt && Date.now() - cached.fetchedAt < LINK_PREVIEW_TTL) {
    return cached.data;
  }
  if (cached.promise) {
    return null;
  }
  return cached.data ?? null;
}

async function fetchLinkPreviewData(href) {
  if (!href) {
    return null;
  }
  const cached = linkPreviewCache.get(href);
  if (cached?.data && cached.fetchedAt && Date.now() - cached.fetchedAt < LINK_PREVIEW_TTL) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const endpoint = `${syncConfig.baseUrl}/api/preview?url=${encodeURIComponent(href)}`;
  const headers = new Headers();
  const token = authStore.getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const promise = fetch(endpoint, {
    method: 'GET',
    headers,
    credentials: 'include',
    signal: controller.signal
  })
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      return payload?.data ?? null;
    })
    .catch(() => null)
    .finally(() => {
      clearTimeout(timeout);
    });

  linkPreviewCache.set(href, { promise });

  const data = await promise;
  linkPreviewCache.set(href, { data, fetchedAt: Date.now() });
  return data;
}

function applyLinkPreviewMetadata(preview, data) {
  if (!preview || !data || typeof data !== 'object') {
    return;
  }
  const titleNode = preview.querySelector('.link-preview-title');
  const urlNode = preview.querySelector('.link-preview-url');
  const descriptionNode = preview.querySelector('.link-preview-description');

  if (data.title && titleNode) {
    titleNode.textContent = data.title;
  }
  if (data.description && descriptionNode) {
    descriptionNode.textContent = data.description;
    descriptionNode.classList.remove('is-empty');
  } else if (descriptionNode) {
    descriptionNode.textContent = '';
    descriptionNode.classList.add('is-empty');
  }
  if (data.displayUrl && urlNode) {
    urlNode.textContent = data.displayUrl;
  }

  const href = preview.dataset.href;
  if (!href || isVideoLink(href)) {
    return;
  }
  if (data.image && /^https?:/i.test(data.image)) {
    const image = preview.querySelector('.link-preview-image');
    if (image && image.src !== data.image) {
      image.src = data.image;
    }
  }
}

function renderTaskLinkPreview(bodyNode, text) {
  if (!bodyNode) {
    return null;
  }

  const link = extractFirstLink(text);
  let preview = bodyNode.querySelector('.task-link-preview');

  if (!link) {
    preview?.remove();
    return null;
  }

  if (!preview) {
    preview = document.createElement('a');
    preview.className = 'task-link-preview';
    preview.target = '_blank';
    preview.rel = 'noopener noreferrer';

    const content = document.createElement('span');
    content.className = 'link-preview-content';

    const title = document.createElement('span');
    title.className = 'link-preview-title';

    const description = document.createElement('span');
    description.className = 'link-preview-description is-empty';

    const url = document.createElement('span');
    url.className = 'link-preview-url';

    content.append(title, description, url);
    preview.append(content);

    const stop = (event) => event.stopPropagation();
    preview.addEventListener('click', (event) => {
      if (event.detail > 1) {
        event.preventDefault();
      }
      stop(event);
    });
    preview.addEventListener('mousedown', stop);
    preview.addEventListener('mouseup', stop);
    preview.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    const folderLabel = bodyNode.querySelector('.task-folder-label');
    if (folderLabel) {
      bodyNode.insertBefore(preview, folderLabel);
    } else {
      bodyNode.appendChild(preview);
    }
  }

  preview.href = link.href;

  let hostname = '';
  let displayUrl = link.href;
  try {
    const parsed = new URL(link.href);
    hostname = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    displayUrl = `${hostname}${path}${parsed.search ?? ''}`;
  } catch (error) {
    // keep fallback displayUrl
  }

  const label = typeof link.label === 'string' ? link.label.trim() : '';
  const titleNode = preview.querySelector('.link-preview-title');
  const urlNode = preview.querySelector('.link-preview-url');
  const titleText = label && label !== link.href && label !== displayUrl ? label : (hostname || displayUrl);

  if (titleNode) {
    titleNode.textContent = titleText || displayUrl;
  }
  if (urlNode) {
    urlNode.textContent = displayUrl;
  }
  preview.setAttribute('aria-label', `Открыть ссылку ${displayUrl}`);
  preview.dataset.href = link.href;

  const existingMedia = preview.querySelector('.link-preview-media');
  const { src, isVideo } = getPreviewMedia(link.href);
  let media = existingMedia;
  if (!media) {
    media = document.createElement('span');
    media.className = 'link-preview-media';
    preview.insertBefore(media, preview.firstChild);
  } else {
    media.textContent = '';
  }

  const image = document.createElement('img');
  image.className = 'link-preview-image';
  image.alt = titleText || hostname || 'Preview';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.src = src;
  image.addEventListener('error', () => {
    if (!hostname) {
      return;
    }
    const fallback = `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
    if (image.src !== fallback) {
      image.src = fallback;
      image.classList.add('is-fallback');
    }
  }, { once: true });

  media.appendChild(image);
  media.classList.toggle('is-video', Boolean(isVideo));

  if (isVideo) {
    const play = document.createElement('span');
    play.className = 'link-preview-play';
    play.setAttribute('aria-hidden', 'true');
    play.textContent = '▶';
    media.appendChild(play);
  }

  const cached = getCachedPreviewData(link.href);
  if (cached) {
    applyLinkPreviewMetadata(preview, cached);
  } else {
    fetchLinkPreviewData(link.href).then((data) => {
      if (!data || !preview.isConnected || preview.dataset.href !== link.href) {
        return;
      }
      applyLinkPreviewMetadata(preview, data);
    });
  }

  return link.href;
}

function renderTaskTitle(node, text, { previewHref } = {}) {
  if (!node) {
    return;
  }
  node.textContent = '';
  if (!previewHref) {
    const fragment = createLinkifiedFragment(text);
    node.appendChild(fragment);
    return;
  }
  const fragment = createLinkifiedFragment(text, { hideHref: previewHref });
  const visibleText = fragment.textContent?.replace(/[\s.,!?;:]+/g, '') ?? '';
  if (!visibleText) {
    const hostname = getHostname(previewHref) || 'Ссылка';
    const replacement = createLinkifiedFragment(text, {
      hideHref: previewHref,
      replacementText: hostname
    });
    node.appendChild(replacement);
    return;
  }
  node.appendChild(fragment);
}

function isDescendantFolder(candidateId, ancestorId) {
  if (!candidateId || !ancestorId) {
    return false;
  }
  if (candidateId === ancestorId) {
    return true;
  }
  let current = candidateId;
  const guard = new Set();
  while (current && !guard.has(current)) {
    guard.add(current);
    const parent = getFolderParentId(current);
    if (!parent) {
      break;
    }
    if (parent === ancestorId) {
      return true;
    }
    current = parent;
  }
  return false;
}

function folderHasTaskHistory(folderId) {
  if (!state) {
    return false;
  }
  if (!folderId || folderId === ALL_FOLDER_ID) {
    return (state.tasks?.length ?? 0) > 0 || (state.archivedTasks?.length ?? 0) > 0;
  }
  if (folderId === ARCHIVE_FOLDER_ID) {
    return false;
  }
  const hasActive = state.tasks.some((task) => task.folderId && isDescendantFolder(task.folderId, folderId));
  if (hasActive) {
    return true;
  }
  return state.archivedTasks.some((task) => task.folderId && isDescendantFolder(task.folderId, folderId));
}

function shouldShowSuccessIllustration(folderId) {
  return folderHasTaskHistory(folderId);
}

function triggerTasksScreenAnimation({ reverse = false } = {}) {
  const container = elements.taskList?.closest('.tasks-scroll') || elements.screenTasks;
  if (!container) {
    return;
  }

  const translate = reverse ? -16 : 16;
  const keyframes = [
    { opacity: 0, transform: `translate3d(0, ${translate}px, 0)` },
    { opacity: 1, transform: 'translate3d(0, 0, 0)' }
  ];
  const timing = {
    duration: 260,
    easing: 'cubic-bezier(0.33, 1, 0.68, 1)'
  };

  if (typeof container.animate === 'function') {
    container.animate(keyframes, timing);
    return;
  }

  // Fallback for older browsers without WAAPI support
  const target = elements.screenTasks;
  target.classList.remove('screen-enter');
  target.classList.remove('screen-enter-reverse');
  void target.offsetWidth;
  if (reverse) {
    target.classList.add('screen-enter-reverse');
  }
  requestAnimationFrame(() => {
    target.classList.add('screen-enter');
    target.addEventListener('animationend', () => {
      target.classList.remove('screen-enter');
      target.classList.remove('screen-enter-reverse');
    }, { once: true });
  });
}

function getScrollPosition() {
  if (typeof document !== 'undefined' && document.scrollingElement) {
    return document.scrollingElement.scrollTop;
  }
  if (typeof window !== 'undefined') {
    return window.scrollY ?? 0;
  }
  return 0;
}

function updatePullToRefreshLabel(text) {
  if (elements.pullToRefreshLabel) {
    elements.pullToRefreshLabel.textContent = text;
  }
}

function setPullToRefreshOffset(value, { smooth = false } = {}) {
  const offset = Math.max(0, Math.min(PULL_REFRESH_MAX, value));
  pullToRefreshState.currentOffset = offset;
  if (elements.appShell) {
    if (smooth) {
      elements.appShell.style.transition = 'transform 0.26s cubic-bezier(0.33, 1, 0.68, 1)';
    } else if (offset === 0) {
      elements.appShell.style.transition = '';
    }
    if (offset > 0.5) {
      elements.appShell.style.transform = `translate3d(0, ${offset}px, 0)`;
    } else {
      elements.appShell.style.transform = '';
    }
    if (smooth) {
      setTimeout(() => {
        if (elements.appShell) {
          elements.appShell.style.transition = '';
        }
      }, 280);
    }
  }
  if (!pullToRefreshState.syncing && elements.pullToRefreshSpinner) {
    const progress = Math.min(1, offset / PULL_REFRESH_THRESHOLD);
    elements.pullToRefreshSpinner.style.transform = `rotate(${progress * 240}deg)`;
  }
}

function setPullToRefreshReady(isReady) {
  if (!elements.pullToRefresh) {
    return;
  }
  pullToRefreshState.ready = isReady;
  elements.pullToRefresh.classList.toggle('is-ready', Boolean(isReady));
  if (!pullToRefreshState.syncing) {
    updatePullToRefreshLabel(isReady ? PULL_REFRESH_READY_TEXT : PULL_REFRESH_DEFAULT_TEXT);
  }
}

function showPullToRefreshIndicator() {
  if (!elements.pullToRefresh) {
    return;
  }
  elements.pullToRefresh.classList.add('is-visible');
  elements.pullToRefresh.classList.remove('is-complete', 'is-error');
  elements.pullToRefresh.setAttribute('aria-hidden', 'false');
  updatePullToRefreshLabel(PULL_REFRESH_DEFAULT_TEXT);
}

function resetPullToRefresh({ immediate = false } = {}) {
  pullToRefreshState.active = false;
  pullToRefreshState.pulling = false;
  pullToRefreshState.ready = false;
  pullToRefreshState.startX = 0;
  pullToRefreshState.startY = 0;
  if (!pullToRefreshState.syncing) {
    elements.pullToRefresh?.classList.remove('is-syncing');
  }
  pullToRefreshState.syncing = false;
  const indicator = elements.pullToRefresh;
  updatePullToRefreshLabel(PULL_REFRESH_DEFAULT_TEXT);
  setPullToRefreshOffset(0, { smooth: !immediate });
  if (elements.pullToRefreshSpinner) {
    elements.pullToRefreshSpinner.style.transform = 'rotate(0deg)';
  }
  if (!indicator) {
    return;
  }
  indicator.classList.remove('is-visible', 'is-ready', 'is-complete', 'is-error', 'is-hiding');
  if (!immediate) {
    indicator.classList.add('is-hiding');
    requestAnimationFrame(() => {
      indicator.classList.remove('is-hiding');
    });
  }
  indicator.setAttribute('aria-hidden', 'true');
}

function beginPullToRefreshSync() {
  if (!elements.pullToRefresh) {
    return;
  }
  pullToRefreshState.syncing = true;
  elements.pullToRefresh.classList.add('is-syncing', 'is-visible');
  elements.pullToRefresh.classList.remove('is-ready');
  elements.pullToRefresh.setAttribute('aria-hidden', 'false');
  updatePullToRefreshLabel(PULL_REFRESH_SYNCING_TEXT);
  setPullToRefreshOffset(PULL_REFRESH_THRESHOLD);
  if (elements.pullToRefreshSpinner) {
    elements.pullToRefreshSpinner.style.transform = '';
  }
}

function completePullToRefresh({ success }) {
  if (!elements.pullToRefresh) {
    return;
  }
  pullToRefreshState.syncing = false;
  elements.pullToRefresh.classList.remove('is-syncing', 'is-ready');
  if (success) {
    elements.pullToRefresh.classList.add('is-complete');
    updatePullToRefreshLabel(PULL_REFRESH_DONE_TEXT);
  } else {
    elements.pullToRefresh.classList.add('is-error');
    updatePullToRefreshLabel(PULL_REFRESH_ERROR_TEXT);
  }
  setPullToRefreshOffset(success ? PULL_REFRESH_THRESHOLD * 0.7 : 0, { smooth: true });
  setTimeout(() => {
    resetPullToRefresh({ immediate: false });
  }, success ? PULL_REFRESH_RESET_DELAY : PULL_REFRESH_RESET_DELAY * 2);
}

function canStartPullToRefresh() {
  if (!elements.pullToRefresh) {
    return false;
  }
  if (pullToRefreshState.syncing || manualSyncInFlight || syncBootstrapInFlight) {
    return false;
  }
  if (currentScreen !== 'folders') {
    return false;
  }
  return getScrollPosition() <= 0;
}

function getTouchY(event) {
  if (event.touches && event.touches.length) {
    return event.touches[0].clientY;
  }
  if (event.changedTouches && event.changedTouches.length) {
    return event.changedTouches[0].clientY;
  }
  return event.clientY ?? 0;
}

function getTouchX(event) {
  if (event.touches && event.touches.length) {
    return event.touches[0].clientX;
  }
  if (event.changedTouches && event.changedTouches.length) {
    return event.changedTouches[0].clientX;
  }
  return event.clientX ?? 0;
}

function handlePullStart(event) {
  if (!canStartPullToRefresh()) {
    pullToRefreshState.active = false;
    resetPullToRefresh({ immediate: true });
    return;
  }
  if (event.touches && event.touches.length > 1) {
    pullToRefreshState.active = false;
    return;
  }
  pullToRefreshState.active = true;
  pullToRefreshState.pulling = false;
  pullToRefreshState.ready = false;
  pullToRefreshState.startX = getTouchX(event);
  pullToRefreshState.startY = getTouchY(event);
  setPullToRefreshOffset(0);
  if (elements.pullToRefreshSpinner) {
    elements.pullToRefreshSpinner.style.transform = 'rotate(0deg)';
  }
}

function handlePullMove(event) {
  if (!pullToRefreshState.active) {
    return;
  }

  const currentY = getTouchY(event);
  const currentX = getTouchX(event);
  const deltaY = currentY - pullToRefreshState.startY;
  const deltaX = Math.abs(currentX - pullToRefreshState.startX);

  if (!pullToRefreshState.pulling) {
    if (deltaY > 0 && deltaY > deltaX) {
      pullToRefreshState.pulling = true;
      showPullToRefreshIndicator();
      playHaptic('light');
    } else if (deltaY < 0) {
      pullToRefreshState.active = false;
      return;
    }
  }

  if (!pullToRefreshState.pulling) {
    return;
  }

  if (deltaY <= 0) {
    setPullToRefreshOffset(0);
    setPullToRefreshReady(false);
    return;
  }

  const clampedY = Math.max(0, Math.min(PULL_REFRESH_MAX * 3, deltaY));
  const easing = 1 - Math.exp(-clampedY / (PULL_REFRESH_THRESHOLD * 0.9));
  const damped = Math.min(PULL_REFRESH_MAX, easing * PULL_REFRESH_MAX);
  const offset = Math.min(PULL_REFRESH_MAX, damped);
  setPullToRefreshOffset(offset);
  setPullToRefreshReady(offset >= PULL_REFRESH_THRESHOLD);

  if (deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX)) {
    event.preventDefault();
  }
}

function handlePullEnd(event) {
  if (!pullToRefreshState.active) {
    return;
  }

  const shouldTrigger = pullToRefreshState.pulling && pullToRefreshState.ready && !pullToRefreshState.syncing;

  pullToRefreshState.active = false;

  if (shouldTrigger) {
    playHaptic('heavy');
    if (!manualSyncInFlight) {
      void handleManualSyncClick({ source: 'pull' });
    } else {
      resetPullToRefresh({ immediate: true });
    }
  } else {
    resetPullToRefresh({ immediate: true });
  }
}

function buildBreadcrumbSegments(folderId) {
  const segments = [];
  let current = folderId;

  while (current) {
    const folder = getFolderById(current);
    if (!folder) {
      break;
    }
    if (folder.id === ALL_FOLDER_ID) {
      break;
    }
    segments.unshift(folder);
    current = folder.parentId ?? null;
  }

  return segments;
}

function renderTasksHeader(folderId) {
  const header = elements.tasksHeaderTitle;
  if (!header) {
    return;
  }

  header.innerHTML = '';

  if (!folderId) {
    header.textContent = 'Папка';
    header.title = 'Папка';
    return;
  }

  if (folderId === ARCHIVE_FOLDER_ID) {
    header.textContent = 'Архив';
    header.title = 'Архив';
    return;
  }

  const folder = getFolderById(folderId);
  if (!folder) {
    header.textContent = 'Папка';
    header.title = 'Папка';
    return;
  }

  if (folderId === ALL_FOLDER_ID) {
    header.textContent = folder.name;
    header.title = folder.name;
    return;
  }

  const segments = buildBreadcrumbSegments(folderId);
  if (segments.length <= 1) {
    header.textContent = folder.name;
    header.title = folder.name;
    return;
  }
  let displaySegments = [...segments];
  let ellipsisTargetId = null;

  if (displaySegments.length > 2) {
    const hidden = displaySegments.slice(0, displaySegments.length - 2);
    const lastHidden = hidden[hidden.length - 1];
    ellipsisTargetId = lastHidden?.id ?? hidden[0]?.id ?? null;
    displaySegments = [
      { id: ellipsisTargetId, name: '…', isEllipsis: true },
      ...displaySegments.slice(-2)
    ];
  }

  displaySegments.forEach((segment, index) => {
    const span = document.createElement('span');
    span.className = 'breadcrumb-segment';
    span.textContent = segment.isEllipsis ? '…' : segment.name;

    const isLast = index === displaySegments.length - 1;
    const targetId = segment.isEllipsis ? ellipsisTargetId : segment.id;

    if (!isLast && targetId) {
      span.classList.add('is-link');
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      span.addEventListener('click', () => {
        openFolderWithUnlock(targetId, { openTasks: true });
      });
      span.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openFolderWithUnlock(targetId, { openTasks: true });
        }
      });
    }

    header.appendChild(span);

    if (!isLast) {
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.textContent = '/';
      header.appendChild(separator);
    }
  });

  header.title = segments.map((segment) => segment.name).join(' / ');
}

function normalizeLoadedState() {
  ensureSystemFolders(state);
  const now = Date.now();
  const folderIds = new Set(state.folders.map((folder) => folder.id));
  let mutated = false;

  if (!Array.isArray(state.archivedTasks)) {
    state.archivedTasks = [];
    mutated = true;
  }

  const seenIds = new Set();

  state.archivedTasks = state.archivedTasks.map((task, index) => {
    if (!task || typeof task !== 'object') {
      mutated = true;
      return null;
    }
    const text = typeof task.text === 'string' && task.text.trim()
      ? task.text.trim()
      : typeof task.title === 'string'
        ? task.title.trim()
        : '';
    if (!text) {
      mutated = true;
      return null;
    }
    const normalized = {
      ...task,
      text,
      folderId: folderIds.has(task.folderId) ? task.folderId : null,
      completed: true,
      createdAt: Number.isFinite(task.createdAt) ? task.createdAt : now,
      updatedAt: Number.isFinite(task.updatedAt) ? task.updatedAt : now,
      completedAt: Number.isFinite(task.completedAt) ? task.completedAt : now + index,
      order: Number.isFinite(task.order) ? task.order : index
    };
    const plannedFor = normalizePlannedFor(task.plannedFor);
    if (plannedFor) {
      normalized.plannedFor = plannedFor;
    } else if ('plannedFor' in normalized) {
      delete normalized.plannedFor;
      mutated = true;
    }
    seenIds.add(normalized.id);
    delete normalized.title;
    return normalized;
  }).filter(Boolean);

  state.tasks = state.tasks.map((task, index) => {
    if (!task || typeof task !== 'object') {
      mutated = true;
      return null;
    }
    const text = typeof task.text === 'string' && task.text.trim()
      ? task.text.trim()
      : typeof task.title === 'string'
        ? task.title.trim()
        : '';
    if (!text) {
      mutated = true;
      return null;
    }
    const folderId = folderIds.has(task.folderId) ? task.folderId : null;
    const createdAt = Number.isFinite(task.createdAt) ? task.createdAt : now;
    const updatedAt = Number.isFinite(task.updatedAt) ? task.updatedAt : createdAt;
    const order = Number.isFinite(task.order) ? task.order : index;
    const plannedFor = normalizePlannedFor(task.plannedFor);

    const normalizedTask = {
      ...task,
      text,
      folderId,
      completed: Boolean(task.completed),
      createdAt,
      updatedAt,
      order,
      ...(plannedFor ? { plannedFor } : {})
    };
    if (!plannedFor && 'plannedFor' in normalizedTask) {
      delete normalizedTask.plannedFor;
      mutated = true;
    }

    delete normalizedTask.title;

    if (normalizedTask.completed) {
      if (!seenIds.has(normalizedTask.id)) {
        seenIds.add(normalizedTask.id);
        state.archivedTasks.push({
          ...normalizedTask,
          completed: true,
          completedAt: Number.isFinite(normalizedTask.completedAt) ? normalizedTask.completedAt : updatedAt
        });
        mutated = true;
      }
      return null;
    }

    if (seenIds.has(normalizedTask.id)) {
      mutated = true;
      return null;
    }
    seenIds.add(normalizedTask.id);

    delete normalizedTask.completedAt;
    return { ...normalizedTask, completed: false };
  }).filter(Boolean);
  state.archivedTasks.sort((a, b) => {
    const timeA = Number.isFinite(a.completedAt) ? a.completedAt : (a.updatedAt ?? 0);
    const timeB = Number.isFinite(b.completedAt) ? b.completedAt : (b.updatedAt ?? 0);
    return timeB - timeA;
  });
  state.tasks.sort((a, b) => {
    const orderA = Number.isFinite(a.order) ? a.order : 0;
    const orderB = Number.isFinite(b.order) ? b.order : 0;
    if (orderA === orderB) {
      return (a.createdAt ?? 0) - (b.createdAt ?? 0);
    }
    return orderA - orderB;
  });
  state.meta = state.meta ?? { version: 0, updatedAt: Date.now() };

  if (mutated) {
    void saveState(state, { skipRemote: true, updateMeta: false });
  }
}

function applyRemoteState(remoteState) {
  if (!remoteState) {
    return;
  }

  const normalized = normalizeState(remoteState);
  const preservedUI = { ...state.ui };
  const preservedEmptyState = { ...(state.meta?.emptyStateTimestamps ?? {}) };

  state.folders = normalized.folders;
  state.tasks = normalized.tasks;
  state.archivedTasks = normalized.archivedTasks ?? [];
  state.ui = {
    ...normalized.ui,
    ...preservedUI,
    selectedFolderId: preservedUI.selectedFolderId ?? normalized.ui?.selectedFolderId,
    activeScreen: preservedUI.activeScreen ?? normalized.ui?.activeScreen
  };
  const remoteEmptyState = normalized.meta?.emptyStateTimestamps ?? {};
  const hasRemoteEmptyState = Object.keys(remoteEmptyState).length > 0;
  state.meta = {
    ...normalized.meta,
    emptyStateTimestamps: hasRemoteEmptyState
      ? { ...remoteEmptyState }
      : preservedEmptyState
  };

  ensureSystemFolders(state);
  const appliedViewModes = applyFolderViewModesFromContext({ persist: false });
  const plannedForUpdated = ensureTaskPlannedFor({ persistStateChanges: false, persistContextChanges: true });
  syncFolderViewModesToContext({ persist: false });
  attemptRestorePendingUiContext({ allowFallback: true });
  const targetScreen = state.ui?.activeScreen === 'tasks' ? 'tasks' : 'folders';

  saveState(state, { skipRemote: true, updateMeta: false });

  if (currentScreen !== targetScreen) {
    showScreen(targetScreen, { skipPersist: true });
  }

  render();
  updateUiContextForScreen(targetScreen);
  if (appliedViewModes || plannedForUpdated) {
    persistState();
  }
}

function updateSyncStatusLabel({ syncing = false } = {}) {
  const isSyncing = Boolean(syncing);
  const version = Number.isFinite(state?.meta?.version) ? state.meta.version : 0;
  if (elements.syncStatusLabel) {
    elements.syncStatusLabel.textContent = 'Синхронизация';
    elements.syncStatusLabel.dataset.version = String(version);
    elements.syncStatusLabel.title = `Версия ${version}`;
    elements.syncStatusLabel.setAttribute('aria-label', `Синхронизация, версия ${version}`);
  }
  if (elements.syncNowButton) {
    elements.syncNowButton.disabled = isSyncing;
    elements.syncNowButton.classList.toggle('is-syncing', isSyncing);
    elements.syncNowButton.setAttribute('aria-busy', String(isSyncing));
  }
}

const elements = {
  appShell: document.querySelector('.app-shell'),
  screenFolders: document.getElementById('screenFolders'),
  screenTasks: document.getElementById('screenTasks'),
  folderList: document.getElementById('folderList'),
  folderTemplate: document.getElementById('folderTemplate'),
  folderMenu: document.getElementById('folderMenu'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  folderModal: document.getElementById('folderModal'),
  folderModalForm: document.getElementById('folderModalForm'),
  folderModalInput: document.getElementById('folderModalInput'),
  folderModalCancel: document.getElementById('folderModalCancel'),
  folderUnlockModal: document.getElementById('folderUnlockModal'),
  folderUnlockForm: document.getElementById('folderUnlockForm'),
  folderUnlockInput: document.getElementById('folderUnlockInput'),
  folderUnlockCancel: document.getElementById('folderUnlockCancel'),
  folderUnlockError: document.getElementById('folderUnlockError'),
  folderUnlockHint: document.getElementById('folderUnlockHint'),
  folderPasswordModal: document.getElementById('folderPasswordModal'),
  folderPasswordForm: document.getElementById('folderPasswordForm'),
  folderPasswordTitle: document.getElementById('folderPasswordTitle'),
  folderPasswordCurrent: document.getElementById('folderPasswordCurrent'),
  folderPasswordNew: document.getElementById('folderPasswordNew'),
  folderPasswordConfirm: document.getElementById('folderPasswordConfirm'),
  folderPasswordHint: document.getElementById('folderPasswordHint'),
  folderPasswordCancel: document.getElementById('folderPasswordCancel'),
  folderPasswordSubmit: document.getElementById('folderPasswordSubmit'),
  folderPasswordError: document.getElementById('folderPasswordError'),
  folderPasswordCurrentField: document.getElementById('folderPasswordCurrentField'),
  folderPasswordNewField: document.getElementById('folderPasswordNewField'),
  folderPasswordConfirmField: document.getElementById('folderPasswordConfirmField'),
  folderPasswordHintField: document.getElementById('folderPasswordHintField'),
  taskList: document.getElementById('taskList'),
  taskTemplate: document.getElementById('taskTemplate'),
  weekToolbar: document.getElementById('weekToolbar'),
  weekPrevButton: document.getElementById('weekPrevButton'),
  weekNextButton: document.getElementById('weekNextButton'),
  weekTodayButton: document.getElementById('weekTodayButton'),
  weekRangeLabel: document.getElementById('weekRangeLabel'),
  weekView: document.getElementById('weekView'),
  weekGrid: document.getElementById('weekGrid'),
  weekMenuButton: document.getElementById('weekMenuButton'),
  weekMenu: document.getElementById('weekMenu'),
  emptyState: document.getElementById('emptyState'),
  backButton: document.getElementById('backToFolders'),
  tasksHeaderTitle: document.getElementById('tasksHeaderTitle'),
  appMenuButtons: Array.from(document.querySelectorAll('.app-menu-button')),
  appMenu: document.getElementById('appMenu'),
  logoutAction: document.getElementById('logoutAction'),
  clearArchiveAction: document.getElementById('clearArchiveAction'),
  floatingActionButton: document.getElementById('floatingActionButton'),
  pullToRefresh: document.getElementById('pullToRefresh'),
  pullToRefreshLabel: document.getElementById('pullToRefreshLabel'),
  pullToRefreshSpinner: document.querySelector('#pullToRefresh .pull-refresh-spinner'),
  authOverlay: document.getElementById('authOverlay'),
  authForm: document.getElementById('authForm'),
  authEmail: document.getElementById('authEmail'),
  authPassword: document.getElementById('authPassword'),
  authSubmit: document.getElementById('authSubmit'),
  authToggleMode: document.getElementById('authToggleMode'),
  authError: document.getElementById('authError'),
  authTitle: document.getElementById('authTitle'),
  // Settings screen
  screenSettings: document.getElementById('screenSettings'),
  backToFoldersFromSettings: document.getElementById('backToFoldersFromSettings'),
  settingsAction: document.getElementById('settingsAction'),
  autoThemeToggle: document.getElementById('autoThemeToggle'),
  darkModeToggle: document.getElementById('darkModeToggle'),
  showCounterToggle: document.getElementById('showCounterToggle'),
  showArchiveToggle: document.getElementById('showArchiveToggle'),
  clearArchiveButton: document.getElementById('clearArchiveButton'),
  changePasswordButton: document.getElementById('changePasswordButton'),
  logoutButton: document.getElementById('logoutButton'),
  syncNowButton: document.getElementById('syncNowButton'),
  syncStatusLabel: document.getElementById('syncStatusLabel')
};

if (elements.pullToRefreshLabel) {
  elements.pullToRefreshLabel.textContent = PULL_REFRESH_DEFAULT_TEXT;
}
resetPullToRefresh({ immediate: true });

console.log('🗨️ Elements initialized:', {
  authOverlay: !!elements.authOverlay,
  authForm: !!elements.authForm,
  authEmail: !!elements.authEmail,
  authPassword: !!elements.authPassword,
  authSubmit: !!elements.authSubmit
});

// Проверяем DOM элементы напрямую
console.log('🔍 Direct DOM check:', {
  authOverlayById: !!document.getElementById('authOverlay'),
  authFormById: !!document.getElementById('authForm'),
  authEmailById: !!document.getElementById('authEmail'),
  authPasswordById: !!document.getElementById('authPassword'),
  authSubmitById: !!document.getElementById('authSubmit')
});

console.log('🌐 Environment info:', {
  hasChromeStorage,
  isExtension: typeof chrome !== 'undefined' && chrome.runtime,
  baseUrl: syncConfig.baseUrl,
  shouldUseAuthCookies
});

await authStore.init();
const initialAuthUser = authStore.getUser();
const initialToken = authStore.getToken();
const initialCookie = hasSessionCookie();

if (initialToken || initialCookie) {
  ensureStartupLoader();
} else {
  dismissStartupLoader();
}

console.log('🔑 Auth store initialized, user:', initialAuthUser, 'token:', authStore.getToken());

await bootstrapAuthContext(initialAuthUser?.email);
setUiContextProfileKey(initialAuthUser?.email);

state = await loadState();
console.log('📋 Loaded state:', {
  folders: state.folders?.length,
  tasks: state.tasks?.length,
  completedTasks: state.tasks?.filter?.((task) => task?.completed)?.length ?? 0,
  selectedFolderId: state.ui?.selectedFolderId
});

normalizeLoadedState();

uiContextReady = false;
await restoreUiContextFromStorage();

await settingsManager.init();
updateThemeControls();
if (elements.showCounterToggle) {
  elements.showCounterToggle.checked = settingsManager.get('showCounter');
}
if (elements.showArchiveToggle) {
  elements.showArchiveToggle.checked = settingsManager.get('showArchive');
}

authStore.subscribe(({ token, user }) => {
  console.log('🔔 Auth store subscription triggered:', { token: !!token, user });
  const hasCookie = hasSessionCookie();
  const hasSession = Boolean(token) || hasCookie;
  
  if (!hasSession) {
    console.log('🔔 No token - stopping sync and showing auth overlay');
    stopSyncManager();
    initialSyncCompleted = false;
    dismissStartupLoader();
    const email = pendingAuthPrefillEmail || user?.email || elements.authEmail?.value || '';
    showAuthOverlay({ errorMessage: pendingAuthErrorMessage, prefillEmail: email });
    pendingAuthErrorMessage = '';
    pendingAuthPrefillEmail = '';
  } else if (token && elements.authOverlay && !elements.authOverlay.classList.contains('hidden')) {
    console.log('🔔 Token exists and auth overlay visible - hiding overlay and starting sync');
    hideAuthOverlay();
    ensureStartupLoader();
    void startSyncIfNeeded({ forcePull: true });
  } else if (token) {
    console.log('🔔 Token exists - starting sync');
    ensureStartupLoader();
    void startSyncIfNeeded();
  }
});

if (authStore.getToken() || hasSessionCookie()) {
  console.log('✅ User is authenticated, starting sync');
  await startSyncIfNeeded({ forcePull: true });
} else {
  console.log('❌ User not authenticated, showing auth overlay');
  dismissStartupLoader();
  showAuthOverlay();
}

elements.folderModalForm.addEventListener('submit', handleFolderModalSubmit);
elements.folderModalCancel.addEventListener('click', closeFolderModal);
elements.folderUnlockForm?.addEventListener('submit', handleFolderUnlockSubmit);
elements.folderUnlockCancel?.addEventListener('click', closeFolderUnlockModal);
elements.folderPasswordForm?.addEventListener('submit', handleFolderPasswordSubmit);
elements.folderPasswordCancel?.addEventListener('click', closeFolderPasswordModal);
elements.modalBackdrop.addEventListener('click', closeActiveModal);
elements.authForm?.addEventListener('submit', handleAuthSubmit);
elements.authToggleMode?.addEventListener('click', toggleAuthMode);

elements.folderList.addEventListener('click', handleFolderClick);
elements.folderList.addEventListener('keydown', handleFolderKeydown);
elements.folderList.addEventListener('change', handleTaskChange);
elements.folderList.addEventListener('dblclick', handleTaskDblClick);
elements.folderList.addEventListener('dragstart', handleFolderDragStart);
elements.folderList.addEventListener('dragover', handleFolderDragOver);
elements.folderList.addEventListener('drop', handleFolderDrop);
elements.folderList.addEventListener('dragend', handleFolderDragEnd);
elements.folderMenu.addEventListener('click', handleFolderMenuClick);
document.addEventListener('click', handleDocumentClick, true);
document.addEventListener('click', handleWeekMenuDocumentClick, true);
window.addEventListener('resize', () => {
  closeFolderMenu();
  closeAppMenu();
  closeWeekMenu();
});
document.addEventListener('scroll', () => {
  closeFolderMenu();
  closeAppMenu();
  closeWeekMenu();
  if (!pullToRefreshState.pulling && !pullToRefreshState.syncing && getScrollPosition() > 0) {
    resetPullToRefresh({ immediate: true });
  }
}, true);

document.addEventListener('touchstart', handlePullStart, { passive: true });
document.addEventListener('touchmove', handlePullMove, { passive: false });
document.addEventListener('touchend', handlePullEnd, { passive: true });
document.addEventListener('touchcancel', handlePullEnd, { passive: true });

function updateAuthMode(mode) {
  console.log('🔄 updateAuthMode called with:', mode);
  authMode = mode;
  const isLogin = authMode === 'login';
  
  if (elements.authTitle) {
    elements.authTitle.textContent = isLogin ? 'Вход' : 'Регистрация';
    console.log('🔄 Set authTitle text');
  } else {
    console.log('⚠️ authTitle element not found');
  }
  if (elements.authSubmit) {
    elements.authSubmit.textContent = isLogin ? 'Войти' : 'Создать аккаунт';
  }
  if (elements.authToggleMode) {
    elements.authToggleMode.textContent = isLogin ? 'Регистрация' : 'Войти';
  }
}

function toggleAuthMode(event) {
  event?.preventDefault();
  updateAuthMode(authMode === 'login' ? 'register' : 'login');
  setAuthError('');
  elements.authPassword?.focus({ preventScroll: true });
}

function setAuthError(message) {
  if (elements.authError) {
    elements.authError.textContent = message ?? '';
  }
}

function setAuthLoading(isLoading) {
  if (elements.authSubmit) {
    const baseLabel = authMode === 'login' ? 'Войти' : 'Создать аккаунт';
    elements.authSubmit.disabled = Boolean(isLoading);
    elements.authSubmit.textContent = isLoading ? `${baseLabel}…` : baseLabel;
  }
  elements.authEmail?.setAttribute('aria-busy', String(!!isLoading));
  elements.authPassword?.setAttribute('aria-busy', String(!!isLoading));
}

function showAuthOverlay({ errorMessage, prefillEmail } = {}) {
  console.log('🔐 showAuthOverlay called with:', { errorMessage, prefillEmail });
  console.log('🔐 elements.authOverlay exists:', !!elements.authOverlay);
  dismissStartupLoader();
  
  // Временное решение - объявляем authMode локально
  let localAuthMode = 'login';
  console.log('🔐 localAuthMode before try block:', typeof localAuthMode, localAuthMode);
  
  try {
    if (!elements.authOverlay) {
      console.error('❌ authOverlay element not found!');
      return;
    }
    
    // Дополнительная проверка
    const authOverlayDirect = document.getElementById('authOverlay');
    console.log('🔐 Direct DOM query for authOverlay:', !!authOverlayDirect);
    console.log('🔐 Are they the same element?', elements.authOverlay === authOverlayDirect);
    
    localAuthMode = 'login';
    console.log('🔐 Removing hidden class from authOverlay');
    elements.authOverlay.classList.remove('hidden');
    console.log('🔐 AuthOverlay classes after removing hidden:', elements.authOverlay.className);
    
    try {
      console.log('🔐 AuthOverlay computed styles:', {
        display: getComputedStyle(elements.authOverlay).display,
        visibility: getComputedStyle(elements.authOverlay).visibility,
        opacity: getComputedStyle(elements.authOverlay).opacity
      });
    } catch (styleError) {
      console.error('❌ Error getting computed styles:', styleError);
    }
  
  // Принудительно сделаем элемент видимым
  elements.authOverlay.style.display = 'flex';
  elements.authOverlay.style.visibility = 'visible';
  elements.authOverlay.style.opacity = '1';
  elements.authOverlay.style.pointerEvents = 'auto';
  elements.authOverlay.style.position = 'fixed';
    elements.authOverlay.style.top = '0';
    elements.authOverlay.style.left = '0';
    elements.authOverlay.style.width = '100%';
    elements.authOverlay.style.height = '100%';
    elements.authOverlay.style.zIndex = '9999';
    elements.authOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    console.log('🔐 Forced authOverlay to be visible');
  
  updateAuthMode(localAuthMode);
  console.log('🔐 Called updateAuthMode');
  
  setAuthError(errorMessage ?? '');
  console.log('🔐 Called setAuthError');
  
  const email = prefillEmail ?? authStore.getUser()?.email ?? '';
  console.log('🔐 Prepared email:', email);
  
  if (elements.authEmail) {
    elements.authEmail.value = email;
    console.log('🔐 Set authEmail value');
  } else {
    console.log('⚠️ authEmail element not found');
  }
  if (elements.authPassword) {
    elements.authPassword.value = '';
    elements.authPassword.type = 'password';
    console.log('🔐 Set authPassword value');
  } else {
    console.log('⚠️ authPassword element not found');
  }
  
  console.log('🔐 About to focus authEmail');
  requestAnimationFrame(() => {
    console.log('🔐 In requestAnimationFrame, focusing authEmail');
    elements.authEmail?.focus({ preventScroll: true });
    console.log('🔐 Focus completed');
  });
  
  console.log('🔐 showAuthOverlay function completed');
  
  // Обновляем глобальную переменную
  authMode = localAuthMode;
  
  } catch (error) {
    console.error('❌ Error in showAuthOverlay:', error);
    console.error('❌ Error stack:', error.stack);
  }
}

function hideAuthOverlay() {
  if (!elements.authOverlay) {
    return;
  }
  elements.authOverlay.classList.add('hidden');
  setAuthError('');
  setAuthLoading(false);
}

function buildAuthUrl(path) {
  return buildApiUrl(path.startsWith('/') ? path : `/${path}`);
}

async function authRequest(path, payload) {
  const url = buildAuthUrl(path);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: shouldUseAuthCookies ? 'include' : 'omit'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data?.details;
    const detailMessage = typeof details === 'object' ? Object.values(details)[0] : null;
    const message = data?.error === 'EMAIL_EXISTS'
      ? 'Такой email уже зарегистрирован'
      : data?.error === 'INVALID_CREDENTIALS'
        ? 'Неверный email или пароль'
        : detailMessage || 'Не удалось выполнить запрос';
    throw new Error(message);
  }
  return data;
}

async function switchActiveUserSession(user) {
  if (user) {
    ensureStartupLoader();
  } else {
    dismissStartupLoader();
  }
  const email = user?.email ?? null;
  await bootstrapAuthContext(email);
  setUiContextProfileKey(email);
  state = await loadState();
  normalizeLoadedState();
  uiContextReady = false;
  await restoreUiContextFromStorage();
  render();
  updateUiContextForScreen(state.ui?.activeScreen === 'tasks' ? 'tasks' : 'folders');
}

function stopSyncManager() {
  if (syncManager?.stopPolling) {
    syncManager.stopPolling();
  }
  syncManager = null;
}

async function startSyncIfNeeded({ forcePull = false } = {}) {
  console.log('🔄 startSyncIfNeeded called, token:', authStore.getToken(), 'forcePull:', forcePull);
  
  if (!authStore.getToken() && !hasSessionCookie()) {
    console.log('⚠️ No auth token, skipping sync');
    dismissStartupLoader();
    return;
  }
  if (!syncManager) {
    console.log('🔧 Creating sync manager');
    syncManager = createSyncManager({
      getState: () => state,
      applyRemoteState,
      getAuthToken: () => authStore.getToken(),
      onUnauthorized: handleAuthUnauthorized,
      useAuthCookies: shouldUseAuthCookies
    });
    console.log('🔧 Sync manager created, enabled:', syncManager.enabled);
  }
  if (!syncManager.enabled) {
    console.log('⚠️ Sync manager is disabled');
    dismissStartupLoader();
    return;
  }
  if (!syncBootstrapInFlight) {
    syncBootstrapInFlight = true;
    updateSyncStatusLabel({ syncing: true });
    try {
      // Если forcePull=true - всегда делаем pull, независимо от initialSyncCompleted
      if (forcePull || (!initialSyncCompleted && syncConfig.pullOnStartup !== false)) {
        console.log('📥 Force pulling initial state from server');
        const initialResult = await syncManager.pullInitial();
        if (initialResult?.notFound) {
          const fresh = createDefaultState();
          state.folders = fresh.folders;
          state.tasks = fresh.tasks;
          state.archivedTasks = fresh.archivedTasks;
          state.ui = { ...state.ui, ...fresh.ui };
          state.meta = { ...fresh.meta };
          ensureSystemFolders(state);
          await saveState(state, { skipRemote: true, updateMeta: false });
          await syncManager.forcePush();
        }
        if (forcePull) {
          console.log('✅ Force pull completed, state version:', state.meta.version);
        }
        initialSyncCompleted = true;
      }
    } catch (error) {
      console.warn('Todo sync: initial sync failed', error);
    } finally {
      syncBootstrapInFlight = false;
      updateSyncStatusLabel({ syncing: manualSyncInFlight });
      dismissStartupLoader();
    }
  }
  if (typeof syncManager.startPolling === 'function') {
    syncManager.startPolling();
  }

  if (!syncBootstrapInFlight && !manualSyncInFlight) {
    dismissStartupLoader();
  }
}

async function handleManualSyncClick({ source = 'button' } = {}) {
  if (manualSyncInFlight) {
    return;
  }
  const preserveSettingsScreen = currentScreen === 'settings';
  if (source === 'button' && preserveSettingsScreen) {
    hideSettingsScreen();
  }
  manualSyncInFlight = true;

  if (source === 'pull') {
    beginPullToRefreshSync();
  }

  updateSyncStatusLabel({ syncing: true });

  let indicatorVisible = false;
  let success = true;
  try {
    if (source !== 'pull') {
      showLoadingIndicator();
      indicatorVisible = true;
    }

    await startSyncIfNeeded();

    if (syncManager?.enabled) {
      await syncManager.forcePush();
      await syncManager.pullLatest({ skipIfUnchanged: false });
    }
  } catch (error) {
    success = false;
    console.warn('Todo sync: manual sync failed', error);
    if (source !== 'pull') {
      alert('Не удалось обновить данные. Проверьте соединение и попробуйте ещё раз.');
    }
  } finally {
    if (indicatorVisible) {
      hideLoadingIndicator();
    }
    manualSyncInFlight = false;
    updateSyncStatusLabel({ syncing: syncBootstrapInFlight });
    if (source === 'pull') {
      completePullToRefresh({ success });
    } else if (!pullToRefreshState.syncing) {
      resetPullToRefresh({ immediate: true });
    }
    if (preserveSettingsScreen && source !== 'pull' && source !== 'button') {
      showSettingsScreen();
    }
  }
}

async function handleAuthSubmit(event) {
  console.log('📝 handleAuthSubmit called, event:', event);
  event.preventDefault();
  
  if (!elements.authEmail || !elements.authPassword) {
    console.error('❌ Auth form elements not found');
    return;
  }

  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  
  console.log('📝 Form values - email:', email, 'password length:', password.length);

  if (!email || !password) {
    setAuthError('Введите email и пароль');
    return;
  }

  setAuthError('');
  setAuthLoading(true);

  try {
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const result = await authRequest(endpoint, { email, password });
    await authStore.setSession({ token: result?.token, user: result?.user });
    await switchActiveUserSession(result?.user);
    initialSyncCompleted = false;
    await startSyncIfNeeded({ forcePull: true });
    hideAuthOverlay();
  } catch (error) {
    const friendly = error?.message === 'Failed to fetch'
      ? 'Не удалось подключиться к серверу'
      : error?.message;
    setAuthError(friendly || 'Не удалось выполнить запрос');
  } finally {
    setAuthLoading(false);
  }
}

async function performLogout() {
  const token = authStore.getToken();
  pendingAuthPrefillEmail = authStore.getUser()?.email ?? '';
  try {
    if (token) {
      await fetch(buildAuthUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: shouldUseAuthCookies ? 'include' : 'omit'
      });
    }
  } catch (error) {
    console.warn('Todo sync: logout request failed', error);
  }
  await authStore.clearSession();
  stopSyncManager();
  initialSyncCompleted = false;
  await switchActiveUserSession(null);
}

async function handleAuthUnauthorized() {
  pendingAuthErrorMessage = 'Сессия истекла, войдите снова.';
  pendingAuthPrefillEmail = authStore.getUser()?.email ?? '';
  await authStore.clearSession();
  stopSyncManager();
  initialSyncCompleted = false;
  await switchActiveUserSession(null);
}
elements.appMenuButtons.forEach((button) => {
  button?.addEventListener('click', handleAppMenuToggle);
});
elements.logoutAction?.addEventListener('click', handleLogoutAction);
elements.clearArchiveAction?.addEventListener('click', handleClearArchive);
setupFloatingActionButton();
document.addEventListener('click', handleAppMenuDocumentClick, true);

elements.taskList.addEventListener('click', handleTaskListClick);
elements.taskList.addEventListener('change', handleTaskChange);
elements.taskList.addEventListener('dblclick', handleTaskDblClick);
elements.taskList.addEventListener('keydown', handleTaskKeydown);
elements.taskList.addEventListener('dragstart', handleDragStart);
elements.taskList.addEventListener('dragover', handleDragOver);
elements.taskList.addEventListener('dragend', handleDragEnd);

if (elements.weekView) {
  elements.weekView.addEventListener('click', handleTaskListClick);
  elements.weekView.addEventListener('change', handleTaskChange);
  elements.weekView.addEventListener('dblclick', handleTaskDblClick);
  elements.weekView.addEventListener('keydown', handleTaskKeydown);
  elements.weekView.addEventListener('dragstart', handleWeekDragStart);
  elements.weekView.addEventListener('dragover', handleWeekDragOver);
  elements.weekView.addEventListener('drop', handleWeekDrop);
  elements.weekView.addEventListener('dragend', handleWeekDragEnd);
}

elements.weekPrevButton?.addEventListener('click', () => shiftWeek(-1));
elements.weekNextButton?.addEventListener('click', () => shiftWeek(1));
elements.weekTodayButton?.addEventListener('click', () => jumpToCurrentWeek());
elements.weekMenuButton?.addEventListener('click', handleWeekMenuToggle);
elements.weekMenu?.addEventListener('click', handleWeekMenuClick);

elements.backButton.addEventListener('click', handleBackNavigation);

document.addEventListener('keydown', handleGlobalKeydown);
scheduleInactivityLock();
const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'wheel',
  'pointerdown'
];
const PASSIVE_ACTIVITY_EVENTS = new Set(['mousemove', 'mousedown', 'touchstart', 'scroll', 'wheel', 'pointerdown']);
ACTIVITY_EVENTS.forEach((eventName) => {
  document.addEventListener(
    eventName,
    handleUserActivity,
    PASSIVE_ACTIVITY_EVENTS.has(eventName) ? { passive: true } : undefined
  );
});

function handleGlobalKeydown(event) {
  if (event.key === 'Escape') {
    if (appMenuState.visible) {
      closeAppMenu();
    }
    if (
      !elements.folderModal.classList.contains('hidden')
      || (elements.folderUnlockModal && !elements.folderUnlockModal.classList.contains('hidden'))
      || (elements.folderPasswordModal && !elements.folderPasswordModal.classList.contains('hidden'))
    ) {
      event.preventDefault();
      closeActiveModal();
    }
    return;
  }

  const target = event.target;
  const tagName = (target?.tagName || '').toLowerCase();
  const isEditable = target?.isContentEditable || tagName === 'input' || tagName === 'textarea';
  const lowerKey = typeof event.key === 'string' ? event.key.toLowerCase() : '';

  if ((lowerKey === 'f' || lowerKey === 'а') && !isEditable) {
    event.preventDefault();
    if (event.shiftKey) {
      createTaskViaShortcut();
    } else {
      createFolderViaShortcut();
    }
    return;
  }

  if (!isEditable && currentScreen === 'tasks' && isWeekViewActive()) {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      shiftWeek(-1);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      shiftWeek(1);
      return;
    }

    if (lowerKey === 't' || lowerKey === 'е') {
      event.preventDefault();
      jumpToCurrentWeek();
      return;
    }

    if (event.key && /^[1-7]$/.test(event.key)) {
      event.preventDefault();
      const folderId = state.ui.selectedFolderId;
      const weekStart = getWeekStartForFolder(folderId);
      const dayIndex = Number(event.key) - 1;
      const targetDate = addDays(weekStart, dayIndex);
      const isoDate = formatISODate(targetDate);
      setWeekSelectedDateForFolder(folderId, isoDate);
      const currentSelected = elements.weekGrid?.querySelector('.week-day.is-selected-day');
      if (currentSelected && currentSelected.dataset?.date !== isoDate) {
        currentSelected.classList.remove('is-selected-day');
      }
      const dayColumn = elements.weekGrid?.querySelector(`.week-day[data-date="${isoDate}"]`);
      dayColumn?.classList.add('is-selected-day');
      scrollWeekGridToDate(isoDate);
      return;
    }
  }

  if (event.key !== 'Enter' || isEditable) {
    return;
  }
  if (!elements.folderModal.classList.contains('hidden')) {
    return;
  }
  if (folderMenuState.visible) {
    return;
  }

  event.preventDefault();

  if (currentScreen !== 'tasks') {
    handleAddTaskInline({ forceComposerOnRoot: true });
    return;
  }

  if (inlineComposer) {
    commitInlineTask(inlineComposer.input.value.trim());
  } else {
    handleAddTaskInline();
  }
}

function handleBackNavigation() {
  if (currentScreen !== 'tasks') {
    showScreen('folders');
    return;
  }

  const currentFolder = getFolderById(state.ui.selectedFolderId);
  if (!currentFolder) {
    showScreen('folders');
    return;
  }

  const parentId = currentFolder.parentId;
  if (parentId && parentId !== ALL_FOLDER_ID) {
    openFolderWithUnlock(parentId, { openTasks: true });
    return;
  }

  showScreen('folders');
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render();
    if (syncManager?.enabled && typeof syncManager.pullLatest === 'function') {
      syncManager.pullLatest({ skipIfUnchanged: true }).catch((error) => {
        console.warn('Todo sync: visibility pull failed', error);
      });
    }
  }
});

function showScreen(screenName, { skipPersist = false } = {}) {
  if (currentScreen === screenName) {
    if (!skipPersist && state.ui.activeScreen !== screenName) {
      state.ui.activeScreen = screenName;
      persistState();
    }
    if (screenName === 'folders') {
      document.body?.classList.remove('is-week-wide');
    }
    if (screenName !== 'folders') {
      resetPullToRefresh({ immediate: true });
    }
    updateUiContextForScreen(screenName);
    return;
  }

  const entering = screenName === 'folders' ? elements.screenFolders : elements.screenTasks;
  const leaving = screenName === 'folders' ? elements.screenTasks : elements.screenFolders;

  closeAppMenu();
  currentScreen = screenName;

  if (screenName !== 'folders') {
    resetPullToRefresh({ immediate: true });
  }

  if (leaving && leaving !== entering) {
    leaving.classList.remove('screen-enter');
    leaving.classList.remove('is-active');
  }

  entering.classList.add('is-active');
  entering.classList.remove('screen-enter');
  requestAnimationFrame(() => {
    entering.classList.add('screen-enter');
    entering.addEventListener('animationend', () => entering.classList.remove('screen-enter'), { once: true });
  });

  if (screenName === 'folders') {
    cancelInlineComposer(true);
    closeFolderMenu();
    document.body?.classList.remove('is-week-wide');
    lockFolderIfNeeded(state.ui.selectedFolderId);
  }

  state.ui.activeScreen = screenName;
  updateUiContextForScreen(screenName);
  if (!skipPersist) {
    persistState();
  }
  renderFolders();
  updateFloatingAction();

  if (screenName === 'tasks' && requiresFolderUnlock(state.ui.selectedFolderId)) {
    if (unlockModalState.folderId !== state.ui.selectedFolderId) {
      openFolderUnlockModal(state.ui.selectedFolderId);
    }
  }
}

function openFolderModal({ parentId = null, initialName = '' } = {}) {
  folderModalParentId = parentId;
  closeFolderMenu();
  elements.folderModalInput.value = initialName;
  clearInvalid(elements.folderModalInput);
  elements.folderModal.classList.remove('hidden');
  elements.modalBackdrop.classList.remove('hidden');
  requestAnimationFrame(() => {
    elements.folderModal.classList.add('show');
    elements.modalBackdrop.classList.add('show');
    elements.folderModalInput.focus({ preventScroll: true });
    elements.folderModalInput.select();
  });
}

function closeFolderModal() {
  elements.folderModal.classList.remove('show');
  elements.modalBackdrop.classList.remove('show');
  editingFolderId = null;
  folderModalParentId = null;
  const hide = () => {
    elements.folderModal.classList.add('hidden');
    elements.modalBackdrop.classList.add('hidden');
    elements.folderModal.removeEventListener('transitionend', hide);
  };
  elements.folderModal.addEventListener('transitionend', hide, { once: true });
}

function showModal(modal, focusTarget) {
  if (!modal) {
    return;
  }
  modal.classList.remove('hidden');
  elements.modalBackdrop.classList.remove('hidden');
  requestAnimationFrame(() => {
    modal.classList.add('show');
    elements.modalBackdrop.classList.add('show');
    if (focusTarget) {
      focusTarget.focus({ preventScroll: true });
      if (typeof focusTarget.select === 'function') {
        focusTarget.select();
      }
    }
  });
}

function hideModal(modal, onHidden) {
  if (!modal) {
    return;
  }
  modal.classList.remove('show');
  elements.modalBackdrop.classList.remove('show');
  const hide = () => {
    modal.classList.add('hidden');
    elements.modalBackdrop.classList.add('hidden');
    modal.removeEventListener('transitionend', hide);
    if (typeof onHidden === 'function') {
      onHidden();
    }
  };
  modal.addEventListener('transitionend', hide, { once: true });
}

function closeActiveModal() {
  if (elements.folderUnlockModal && !elements.folderUnlockModal.classList.contains('hidden')) {
    closeFolderUnlockModal();
    return;
  }
  if (elements.folderPasswordModal && !elements.folderPasswordModal.classList.contains('hidden')) {
    closeFolderPasswordModal();
    return;
  }
  if (elements.folderModal && !elements.folderModal.classList.contains('hidden')) {
    closeFolderModal();
  }
}

function handleFolderModalSubmit(event) {
  event.preventDefault();
  const title = elements.folderModalInput.value.trim();
  if (!title) {
    flagInvalid(elements.folderModalInput);
    elements.folderModalInput.focus({ preventScroll: true });
    return;
  }

  if (editingFolderId) {
    const folder = getFolderById(editingFolderId);
    if (folder) {
      folder.name = title;
      folder.updatedAt = Date.now();
      ensureSystemFolders(state);
      persistState();
    }
    editingFolderId = null;
    folderModalParentId = null;
    render();
    closeFolderModal();
    return;
  }

  addFolder(title, { parentId: folderModalParentId });
  folderModalParentId = null;
  closeFolderModal();
}

function setFolderUnlockError(message) {
  if (elements.folderUnlockError) {
    elements.folderUnlockError.textContent = message ?? '';
  }
}

function setFolderPasswordError(message) {
  if (elements.folderPasswordError) {
    elements.folderPasswordError.textContent = message ?? '';
  }
}

function setFolderPasswordBusy(isBusy) {
  passwordModalState.busy = Boolean(isBusy);
  if (elements.folderPasswordSubmit) {
    elements.folderPasswordSubmit.disabled = Boolean(isBusy);
  }
  elements.folderPasswordForm?.setAttribute('aria-busy', String(Boolean(isBusy)));
}

function setFolderUnlockBusy(isBusy) {
  unlockModalState.busy = Boolean(isBusy);
  const submitButton = elements.folderUnlockForm?.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = Boolean(isBusy);
  }
  elements.folderUnlockForm?.setAttribute('aria-busy', String(Boolean(isBusy)));
}

function openFolderUnlockModal(folderId) {
  const folder = getFolderById(folderId);
  if (!folder || !folderHasPassword(folder)) {
    return;
  }
  closeFolderMenu();
  closeAppMenu();
  closeWeekMenu();
  unlockModalState = { folderId, busy: false };
  if (elements.folderUnlockInput) {
    elements.folderUnlockInput.value = '';
  }
  setFolderUnlockError('');
  if (elements.folderUnlockHint) {
    const hint = folder.passwordHint;
    if (hint) {
      elements.folderUnlockHint.textContent = hint;
      elements.folderUnlockHint.classList.remove('hidden');
    } else {
      elements.folderUnlockHint.textContent = '';
      elements.folderUnlockHint.classList.add('hidden');
    }
  }
  setFolderUnlockBusy(false);
  showModal(elements.folderUnlockModal, elements.folderUnlockInput);
}

function closeFolderUnlockModal() {
  if (!elements.folderUnlockModal || elements.folderUnlockModal.classList.contains('hidden')) {
    return;
  }
  hideModal(elements.folderUnlockModal, () => {
    unlockModalState = { folderId: null, busy: false };
  });
}

function applyFolderPasswordUpdate(folder, { hash, salt, hint } = {}) {
  const nextHash = typeof hash === 'string' && hash.trim() ? hash.trim() : null;
  const nextSalt = typeof salt === 'string' && salt.trim() ? salt.trim() : null;
  const nextHint = typeof hint === 'string' ? hint.trim() : '';

  if (nextHash && nextSalt) {
    folder.passwordHash = nextHash;
    folder.passwordSalt = nextSalt;
  } else {
    delete folder.passwordHash;
    delete folder.passwordSalt;
  }

  if (nextHint) {
    folder.passwordHint = nextHint;
  } else {
    delete folder.passwordHint;
  }

  folder.isLocked = Boolean(nextHash && nextSalt);
  folder.updatedAt = Date.now();
  ensureSystemFolders(state);
  persistState();
  if (syncManager?.enabled) {
    void syncManager.forcePush();
  }
  render();
}

function openFolderPasswordModal(folderId, mode) {
  const folder = getFolderById(folderId);
  if (!folder) {
    return;
  }
  closeFolderMenu();
  closeAppMenu();
  closeWeekMenu();
  passwordModalState = { mode, folderId, busy: false };

  const showCurrent = mode === 'change' || mode === 'remove';
  const showNew = mode === 'set' || mode === 'change';
  const showConfirm = mode === 'set' || mode === 'change';
  const showHint = mode === 'set' || mode === 'change';

  elements.folderPasswordCurrentField?.classList.toggle('hidden', !showCurrent);
  elements.folderPasswordNewField?.classList.toggle('hidden', !showNew);
  elements.folderPasswordConfirmField?.classList.toggle('hidden', !showConfirm);
  elements.folderPasswordHintField?.classList.toggle('hidden', !showHint);

  if (elements.folderPasswordTitle) {
    elements.folderPasswordTitle.textContent = mode === 'remove'
      ? 'Снять пароль'
      : mode === 'change'
        ? 'Изменить пароль'
        : 'Установить пароль';
  }
  if (elements.folderPasswordSubmit) {
    elements.folderPasswordSubmit.textContent = mode === 'remove' ? 'Снять' : 'Сохранить';
  }

  if (elements.folderPasswordCurrent) {
    elements.folderPasswordCurrent.value = '';
  }
  if (elements.folderPasswordNew) {
    elements.folderPasswordNew.value = '';
  }
  if (elements.folderPasswordConfirm) {
    elements.folderPasswordConfirm.value = '';
  }
  if (elements.folderPasswordHint) {
    elements.folderPasswordHint.value = showHint ? (folder.passwordHint ?? '') : '';
  }
  setFolderPasswordError('');
  setFolderPasswordBusy(false);

  const focusTarget = showCurrent ? elements.folderPasswordCurrent : elements.folderPasswordNew;
  showModal(elements.folderPasswordModal, focusTarget);
}

function closeFolderPasswordModal() {
  if (!elements.folderPasswordModal || elements.folderPasswordModal.classList.contains('hidden')) {
    return;
  }
  hideModal(elements.folderPasswordModal, () => {
    passwordModalState = { mode: null, folderId: null, busy: false };
  });
}

async function handleFolderUnlockSubmit(event) {
  event.preventDefault();
  if (unlockModalState.busy) {
    return;
  }
  const folderId = unlockModalState.folderId;
  const folder = getFolderById(folderId);
  if (!folder || !folderHasPassword(folder)) {
    closeFolderUnlockModal();
    return;
  }
  const password = elements.folderUnlockInput?.value ?? '';
  if (!password) {
    setFolderUnlockError('Введите пароль');
    elements.folderUnlockInput?.focus({ preventScroll: true });
    return;
  }

  setFolderUnlockBusy(true);
  try {
    const valid = await verifyFolderPassword(folder, password);
    if (!valid) {
      setFolderUnlockError('Неверный пароль');
      setFolderUnlockBusy(false);
      elements.folderUnlockInput?.focus({ preventScroll: true });
      return;
    }
    setFolderUnlocked(folderId, true);
    scheduleInactivityLock();
    closeFolderUnlockModal();
    render();
  } catch (error) {
    setFolderUnlockError('Не удалось проверить пароль');
    setFolderUnlockBusy(false);
  }
}

async function handleFolderPasswordSubmit(event) {
  event.preventDefault();
  if (passwordModalState.busy) {
    return;
  }
  const { mode, folderId } = passwordModalState;
  const folder = getFolderById(folderId);
  if (!folder) {
    closeFolderPasswordModal();
    return;
  }

  const currentPassword = elements.folderPasswordCurrent?.value ?? '';
  const newPassword = elements.folderPasswordNew?.value ?? '';
  const confirmPassword = elements.folderPasswordConfirm?.value ?? '';
  const hint = elements.folderPasswordHint?.value ?? '';

  if ((mode === 'change' || mode === 'remove') && !currentPassword) {
    setFolderPasswordError('Введите текущий пароль');
    elements.folderPasswordCurrent?.focus({ preventScroll: true });
    return;
  }

  if ((mode === 'set' || mode === 'change')) {
    if (newPassword.trim().length < PASSWORD_MIN_LENGTH) {
      setFolderPasswordError(`Минимум ${PASSWORD_MIN_LENGTH} символа`);
      elements.folderPasswordNew?.focus({ preventScroll: true });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFolderPasswordError('Пароли не совпадают');
      elements.folderPasswordConfirm?.focus({ preventScroll: true });
      return;
    }
  }

  setFolderPasswordBusy(true);

  try {
    if (mode === 'change' || mode === 'remove') {
      const valid = await verifyFolderPassword(folder, currentPassword);
      if (!valid) {
        setFolderPasswordError('Неверный пароль');
        setFolderPasswordBusy(false);
        elements.folderPasswordCurrent?.focus({ preventScroll: true });
        return;
      }
    }

    if (mode === 'remove') {
      setFolderUnlocked(folderId, false);
      applyFolderPasswordUpdate(folder, { hash: null, salt: null, hint: '' });
      closeFolderPasswordModal();
      return;
    }

    const salt = generatePasswordSalt();
    const hash = await hashPasswordWithSalt(newPassword, salt);
    setFolderUnlocked(folderId, false);
    applyFolderPasswordUpdate(folder, { hash, salt, hint });
    closeFolderPasswordModal();
  } catch (error) {
    setFolderPasswordError('Не удалось сохранить пароль');
    setFolderPasswordBusy(false);
  }
}

function addFolder(name, { parentId } = {}) {
  const id = uid();
  const now = Date.now();
  let targetParent = ALL_FOLDER_ID;
  if (typeof parentId === 'string') {
    targetParent = parentId === ARCHIVE_FOLDER_ID ? ALL_FOLDER_ID : parentId;
  } else if (parentId === null) {
    targetParent = null;
  }

  const siblingOrders = state.folders
    .filter((folder) => folder.parentId === targetParent && folder.id !== ARCHIVE_FOLDER_ID)
    .map((folder) => folder.order ?? 0);
  const nextOrder = siblingOrders.length ? Math.max(...siblingOrders) + 1 : state.folders.length + 1;

  state.folders.push({
    id,
    name,
    parentId: targetParent,
    createdAt: now,
    updatedAt: now,
    order: nextOrder,
    icon: null,
    viewMode: VIEW_MODES.LIST
  });

  ensureSystemFolders(state);
  persistState();
  render();
  return id;
}

function setupFloatingActionButton() {
  const fab = elements.floatingActionButton;
  if (!fab) {
    return;
  }

  fab.addEventListener('pointerdown', handleFabPointerDown);
  fab.addEventListener('pointerup', handleFabPointerUp);
  fab.addEventListener('pointerleave', handleFabPointerCancel);
  fab.addEventListener('pointercancel', handleFabPointerCancel);
  fab.addEventListener('click', (event) => {
    if (suppressNextFabClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextFabClick = false;
      return;
    }
    triggerFabShortPress();
  });
  fab.addEventListener('contextmenu', (event) => event.preventDefault());
}

function handleFabPointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }
  suppressNextFabClick = true;
  fabLongPressTriggered = false;
  clearTimeout(fabPressTimer);
  fabPressTimer = setTimeout(() => {
    fabLongPressTriggered = true;
    triggerFabLongPress();
    fabPressTimer = null;
  }, FAB_LONG_PRESS_THRESHOLD);
}

function handleFabPointerUp() {
  if (fabPressTimer) {
    clearTimeout(fabPressTimer);
    fabPressTimer = null;
    if (!fabLongPressTriggered) {
      triggerFabShortPress();
    }
  }
  setTimeout(() => {
    suppressNextFabClick = false;
  }, 0);
}

function handleFabPointerCancel() {
  if (fabPressTimer) {
    clearTimeout(fabPressTimer);
    fabPressTimer = null;
  }
  setTimeout(() => {
    suppressNextFabClick = false;
  }, 0);
}

function triggerFabShortPress() {
  if (!elements.folderModal.classList.contains('hidden')) {
    return;
  }
  if (!state) {
    return;
  }
  if (folderMenuState.visible) {
    closeFolderMenu();
  }
  closeAppMenu();
  playHaptic('medium');
  if (currentScreen === 'folders') {
    handleAddTaskInline({ forceComposerOnRoot: true });
    return;
  }

  if (currentScreen === 'tasks') {
    if (state.ui.selectedFolderId === ARCHIVE_FOLDER_ID) {
      state.ui.selectedFolderId = FOLDER_IDS.INBOX;
      render();
    }
    handleAddTaskInline();
    return;
  }

  showScreen('tasks');
  requestAnimationFrame(() => {
    handleAddTaskInline();
  });
}

function triggerFabLongPress() {
  if (!elements.folderModal.classList.contains('hidden')) {
    return;
  }
  if (!state) {
    return;
  }
  if (folderMenuState.visible) {
    closeFolderMenu();
  }
  closeAppMenu();
  playHaptic('heavy');

  if (currentScreen === 'tasks') {
    if (state.ui.selectedFolderId === ARCHIVE_FOLDER_ID) {
      return;
    }
    const parentId = state.ui.selectedFolderId === ALL_FOLDER_ID ? null : state.ui.selectedFolderId;
    openFolderModal({ parentId });
  } else {
    openFolderModal({ parentId: null });
  }
}

function createFolderViaShortcut() {
  if (!elements.folderModal.classList.contains('hidden')) {
    return;
  }
  if (!state) {
    return;
  }
  if (folderMenuState.visible) {
    return;
  }
  if (currentScreen === 'tasks') {
    if (state.ui.selectedFolderId === ARCHIVE_FOLDER_ID) {
      return;
    }
    const parentId = state.ui.selectedFolderId === ALL_FOLDER_ID ? null : state.ui.selectedFolderId;
    openFolderModal({ parentId });
    return;
  }
  openFolderModal({ parentId: null });
}

function createTaskViaShortcut() {
  triggerFabShortPress();
}

function handleFolderClick(event) {
  if (draggingFolderId || Date.now() < suppressFolderClickUntil) {
    return;
  }
  const taskItem = event.target.closest('.task-item');
  if (taskItem) {
    handleTaskListClick(event);
    return;
  }

  const toggle = event.target.closest('.folder-toggle');
  if (toggle) {
    event.preventDefault();
    const folderId = toggle.dataset.folderId;
    if (folderId) {
      toggleFolderExpansion(folderId);
    }
    return;
  }

  const menuButton = event.target.closest('.folder-menu-button');
  if (menuButton) {
    event.stopPropagation();
    const folderId = menuButton.closest('.folder-item')?.dataset.folderId;
    if (!folderId || PROTECTED_FOLDER_IDS.has(folderId)) {
      closeFolderMenu();
      return;
    }
    openFolderMenu(folderId, menuButton);
    return;
  }

  if (editingFolderId) {
    return;
  }

  const item = event.target.closest('.folder-item');
  if (!item) return;
  const folderId = item.dataset.folderId;
  openFolderWithUnlock(folderId, { openTasks: true });
}

function handleFolderKeydown(event) {
  const taskItem = event.target.closest('.task-item');
  if (taskItem) {
    handleTaskKeydown(event);
    return;
  }

  const item = event.target.closest('.folder-item');
  if (!item) return;
  const folderId = item.dataset.folderId;

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    toggleFolderExpansion(folderId, true);
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    toggleFolderExpansion(folderId, false);
    return;
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openFolderWithUnlock(folderId, { openTasks: true });
  }
}

function handleFolderMenuClick(event) {
  const action = event.target.dataset.action;
  if (!action || !folderMenuState.folderId) {
    return;
  }

  if (action === 'rename') {
    startFolderRename(folderMenuState.folderId);
  } else if (action === 'password-set') {
    openFolderPasswordModal(folderMenuState.folderId, 'set');
  } else if (action === 'password-change') {
    openFolderPasswordModal(folderMenuState.folderId, 'change');
  } else if (action === 'password-remove') {
    openFolderPasswordModal(folderMenuState.folderId, 'remove');
  } else if (action === 'lock-again') {
    setFolderUnlocked(folderMenuState.folderId, false);
    render();
  } else if (action === 'view-list') {
    setFolderViewMode(folderMenuState.folderId, VIEW_MODES.LIST);
  } else if (action === 'view-week') {
    setWeekStartForFolder(folderMenuState.folderId, new Date());
    setFolderViewMode(folderMenuState.folderId, VIEW_MODES.WEEK);
  } else if (action === 'delete') {
    if (PROTECTED_FOLDER_IDS.has(folderMenuState.folderId)) {
      window.alert('Эту папку нельзя удалить');
      closeFolderMenu();
      return;
    }
    deleteFolder(folderMenuState.folderId);
  }
  closeFolderMenu();
}

function handleDocumentClick(event) {
  if (!folderMenuState.visible) {
    return;
  }
  const isMenuClick = elements.folderMenu.contains(event.target);
  const isAnchorClick = folderMenuAnchor?.contains?.(event.target);
  if (!isMenuClick && !isAnchorClick) {
    closeFolderMenu();
  }
}

function startFolderRename(folderId) {
  if (!folderId || PROTECTED_FOLDER_IDS.has(folderId)) {
    return;
  }
  const folder = getFolderById(folderId);
  if (!folder) {
    return;
  }
  editingFolderId = folderId;
  openFolderModal({ parentId: folder.parentId ?? null, initialName: folder.name });
}

function deleteFolder(folderId) {
  if (!folderId || PROTECTED_FOLDER_IDS.has(folderId)) {
    return;
  }

  if (folderId === FOLDER_IDS.INBOX || folderId === FOLDER_IDS.PERSONAL) {
    const confirmed = window.confirm('Удалить папку вместе с задачами?');
    if (!confirmed) {
      return;
    }
  }

  const folderIndex = state.folders.findIndex((item) => item.id === folderId);
  if (folderIndex === -1) {
    return;
  }

  const parentId = getFolderParentId(folderId);
  const descendants = new Set([folderId]);
  const queue = [folderId];
  const allFolders = state.folders.slice();

  while (queue.length) {
    const current = queue.shift();
    allFolders.forEach((folder) => {
      if (folder.parentId === current && !descendants.has(folder.id)) {
        descendants.add(folder.id);
        queue.push(folder.id);
      }
    });
  }

  state.folders = state.folders.filter((folder) => !descendants.has(folder.id));
  state.tasks = state.tasks.filter((task) => !descendants.has(task.folderId));
  let viewModeContextChanged = false;
  descendants.forEach((id) => {
    weekViewState.delete(id);
    setFolderUnlocked(id, false);
    if (uiContext.folderViewModes && typeof uiContext.folderViewModes === 'object' && uiContext.folderViewModes[id]) {
      delete uiContext.folderViewModes[id];
      viewModeContextChanged = true;
    }
  });

  if (descendants.has(state.ui.selectedFolderId)) {
    const fallback = parentId && parentId !== ARCHIVE_FOLDER_ID
      ? parentId
      : (state.folders.some((folder) => folder.id === FOLDER_IDS.INBOX) ? FOLDER_IDS.INBOX : ALL_FOLDER_ID);
    state.ui.selectedFolderId = fallback;
    showScreen('folders');
  }

  if (descendants.has(editingFolderId)) {
    editingFolderId = null;
  }

  state.ui.expandedFolderIds = Array.isArray(state.ui.expandedFolderIds)
    ? state.ui.expandedFolderIds.filter((id) => !descendants.has(id))
    : [ALL_FOLDER_ID];

  ensureSystemFolders(state);
  expandAncestors(state.ui.selectedFolderId);
  persistState();
  if (viewModeContextChanged) {
    void persistUiContext({ force: true });
  }
  render();
}

function openFolderMenu(folderId, anchor) {
  closeAppMenu();
  closeWeekMenu();
  folderMenuState.visible = true;
  folderMenuState.folderId = folderId;
  folderMenuAnchor = anchor;

  const menu = elements.folderMenu;
  menu.dataset.folderId = folderId;
  menu.classList.remove('hidden');
  const deleteItem = menu.querySelector('[data-action="delete"]');
  if (deleteItem) {
    deleteItem.classList.toggle('hidden', PROTECTED_FOLDER_IDS.has(folderId));
  }
  updateFolderMenuViewState(folderId);
  updateFolderMenuLockState(folderId);
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${rect.right + window.scrollX - width}px`;
}

function closeFolderMenu() {
  folderMenuState.visible = false;
  folderMenuState.folderId = null;
  folderMenuAnchor = null;
  elements.folderMenu.classList.add('hidden');
}

function openAppMenu(anchor) {
  appMenuState.visible = true;
  appMenuState.anchor = anchor;
  closeWeekMenu();

  const menu = elements.appMenu;
  menu.classList.remove('hidden');

  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const offsetTop = rect.bottom + window.scrollY + 8;
  const computedLeft = rect.right + window.scrollX - width;
  const maxLeft = document.body.clientWidth - width - 16;
  const minLeft = 16;

  menu.style.top = `${offsetTop}px`;
  menu.style.right = 'auto';
  menu.style.left = `${Math.max(Math.min(computedLeft, maxLeft), minLeft)}px`;
}

function closeAppMenu() {
  appMenuState.visible = false;
  appMenuState.anchor = null;
  elements.appMenu.classList.add('hidden');
}

function handleAppMenuToggle(event) {
  event.preventDefault();
  event.stopPropagation();

  const anchor = event.currentTarget;
  if (appMenuState.visible && appMenuState.anchor === anchor) {
    closeAppMenu();
    return;
  }
  openAppMenu(anchor);
}

function handleAppMenuDocumentClick(event) {
  if (!appMenuState.visible) {
    return;
  }

  if (appMenuState.anchor?.contains(event.target)) {
    return;
  }

  if (elements.appMenu.contains(event.target)) {
    return;
  }

  closeAppMenu();
}

function updateWeekMenuState(folderId = state.ui.selectedFolderId) {
  if (!elements.weekMenu) {
    return;
  }
  const toggleItem = elements.weekMenu.querySelector('[data-action="toggle-completed"]');
  if (toggleItem) {
    const showCompleted = getWeekShowCompleted(folderId);
    toggleItem.textContent = showCompleted ? 'Скрыть выполненные' : 'Отображать выполненные';
    toggleItem.setAttribute('aria-checked', String(showCompleted));
  }
}

function openWeekMenu(anchor) {
  if (!elements.weekMenu) {
    return;
  }
  closeAppMenu();
  closeFolderMenu();
  weekMenuState.visible = true;
  weekMenuState.anchor = anchor;
  updateWeekMenuState();

  const menu = elements.weekMenu;
  menu.classList.remove('hidden');

  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const offsetTop = rect.bottom + window.scrollY + 8;
  const computedLeft = rect.right + window.scrollX - width;
  const maxLeft = document.body.clientWidth - width - 16;
  const minLeft = 16;

  menu.style.top = `${offsetTop}px`;
  menu.style.right = 'auto';
  menu.style.left = `${Math.max(Math.min(computedLeft, maxLeft), minLeft)}px`;
}

function closeWeekMenu() {
  if (!elements.weekMenu) {
    return;
  }
  weekMenuState.visible = false;
  weekMenuState.anchor = null;
  elements.weekMenu.classList.add('hidden');
}

function handleWeekMenuToggle(event) {
  event.preventDefault();
  event.stopPropagation();

  const anchor = event.currentTarget;
  if (weekMenuState.visible && weekMenuState.anchor === anchor) {
    closeWeekMenu();
    return;
  }
  openWeekMenu(anchor);
}

function handleWeekMenuClick(event) {
  const action = event.target.dataset.action;
  if (!action) {
    return;
  }
  if (action === 'toggle-completed') {
    const folderId = state.ui.selectedFolderId;
    if (folderId && isWeekViewActive(folderId)) {
      setWeekShowCompleted(folderId, !getWeekShowCompleted(folderId));
    }
  } else if (action === 'carryover') {
    moveUnfinishedTasksToNextWeek();
  }
  closeWeekMenu();
}

function handleWeekMenuDocumentClick(event) {
  if (!weekMenuState.visible) {
    return;
  }

  if (weekMenuState.anchor?.contains(event.target)) {
    return;
  }

  if (elements.weekMenu?.contains(event.target)) {
    return;
  }

  closeWeekMenu();
}

async function handleLogoutAction(event) {
  event.preventDefault();
  closeAppMenu();
  await performLogout();
}

function handleClearArchive(event) {
  event.preventDefault();
  closeAppMenu();
  const hasCompleted = (state.archivedTasks?.length ?? 0) > 0 || state.tasks.some((task) => task.completed);
  if (!hasCompleted) {
    return;
  }

  const confirmed = window.confirm('Очистить архив задач?');
  if (!confirmed) {
    return;
  }

  state.archivedTasks = [];
  persistState();
  render();
}

function selectFolder(folderId, { openTasks = false, skipPersist = false } = {}) {
  if (!state.folders.some((folder) => folder.id === folderId)) {
    return;
  }

  const previousFolderId = state.ui.selectedFolderId;
  if (previousFolderId && previousFolderId !== folderId) {
    lockFolderIfNeeded(previousFolderId);
  }
  if (previousFolderId !== folderId) {
    weekAutoScrollState.delete(folderId);
  }
  const wasTasksScreen = currentScreen === 'tasks';
  const willAnimateWithinTasks = wasTasksScreen && previousFolderId !== folderId;
  const movingDeeper = willAnimateWithinTasks && previousFolderId ? isDescendantFolder(folderId, previousFolderId) : false;
  const movingUp = willAnimateWithinTasks && previousFolderId ? isDescendantFolder(previousFolderId, folderId) : false;
  const useReverseAnimation = willAnimateWithinTasks && movingUp && !movingDeeper;

  state.ui.selectedFolderId = folderId;
  expandAncestors(folderId);

  const trackFolderContext = openTasks || wasTasksScreen;
  if (trackFolderContext) {
    pendingRestoredContext = null;
    uiContext.lastOpenedFolderId = folderId ?? null;
    uiContext.lastScreen = 'tasks';
    updateNavigationHistory(folderId ?? null);
    if (uiContextReady && !openTasks && wasTasksScreen) {
      void persistUiContext();
    }
  }

  if (!skipPersist) {
    persistState();
  }
  render();
  if (willAnimateWithinTasks) {
    triggerTasksScreenAnimation({ reverse: useReverseAnimation });
  }
  if (openTasks) {
    showScreen('tasks');
    renderTasksHeader(folderId);
  } else if (trackFolderContext && wasTasksScreen) {
    updateUiContextForScreen('tasks');
    renderTasksHeader(state.ui.selectedFolderId);
  }
}

function handleAddTaskInline({ forceComposerOnRoot = false } = {}) {
  if (!state) {
    return;
  }

  if (currentScreen === 'tasks' && state.ui.selectedFolderId === ARCHIVE_FOLDER_ID) {
    return;
  }

  const usingFoldersList = currentScreen === 'folders';
  const folderId = usingFoldersList ? null : state.ui.selectedFolderId;
  if (!usingFoldersList && requiresFolderUnlock(folderId)) {
    openFolderUnlockModal(folderId);
    return;
  }
  const usingWeekView = !usingFoldersList && isWeekViewActive(folderId);
  let targetList = usingFoldersList ? elements.folderList : elements.taskList;
  let plannedFor;

  if (usingWeekView) {
    const weekStart = getWeekStartForFolder(folderId);
    const selectedDate = getWeekSelectedDateForFolder(folderId, weekStart);
    plannedFor = selectedDate ?? formatISODate(weekStart);
    if (selectedDate) {
      setWeekSelectedDateForFolder(folderId, selectedDate);
    }
    const list = getWeekDayListByDate(plannedFor);
    if (!list) {
      renderWeekView(folderId);
    }
    targetList = getWeekDayListByDate(plannedFor) || elements.taskList;
  }

  if (inlineComposer && inlineComposer.targetList === targetList) {
    inlineComposer.input.focus({ preventScroll: true });
    inlineComposer.input.select();
    return;
  }

  if (usingFoldersList && !forceComposerOnRoot) {
    return;
  }

  cancelInlineComposer(true);
  const composer = createInlineComposer({
    targetList,
    placeholder: 'Введите задачу',
    folderId,
    plannedFor
  });
  inlineComposer = composer;

  composer.element.scrollIntoView({ behavior: 'smooth', block: 'end' });

  if (targetList === elements.taskList || usingWeekView) {
    elements.emptyState.classList.remove('visible');
  }

  requestAnimationFrame(() => {
    composer.input.focus({ preventScroll: true });
  });
}

function createInlineComposer({
  targetList = elements.taskList,
  placeholder = 'Введите задачу',
  folderId = null,
  plannedFor = undefined
} = {}) {
  const item = document.createElement('li');
  item.className = 'entry-card task-item new-task';
  item.dataset.composer = 'true';
  item.setAttribute('draggable', 'false');
  if (targetList === elements.folderList) {
    item.classList.add('task-root-item');
  }

  const checkbox = document.createElement('label');
  checkbox.className = 'checkbox';
  const checkboxInput = document.createElement('input');
  checkboxInput.type = 'checkbox';
  checkboxInput.disabled = true;
  const checkboxVisual = document.createElement('span');
  checkboxVisual.className = 'checkbox-visual';
  checkbox.append(checkboxInput, checkboxVisual);

  const body = document.createElement('div');
  body.className = 'task-body';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-inline-input';
  input.maxLength = 500;
  input.placeholder = placeholder;

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'icon-button primary task-inline-confirm';
  confirmButton.setAttribute('aria-label', 'Добавить задачу');
  confirmButton.innerHTML = '<span class="icon-plus">＋</span>';

  body.appendChild(input);
  item.append(checkbox, body, confirmButton);

  const commit = (options = {}) => commitInlineTask(input.value.trim(), options);
  const cancel = () => {
    if (!input.value.trim()) {
      cancelInlineComposer();
    }
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      commit({ continueEntry: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelInlineComposer(true);
    }
  });
  input.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      commit({ continueEntry: true });
    }
  });
  input.addEventListener('input', () => clearInvalid(input));
  input.addEventListener('blur', cancel);
  confirmButton.addEventListener('click', () => {
    playHaptic('medium');
    commit();
  });
  targetList.appendChild(item);

  return { element: item, input, targetList, folderId, plannedFor };
}

function cancelInlineComposer(force = false) {
  if (!inlineComposer) {
    return;
  }
  if (!force && inlineComposer.input.value.trim()) {
    return;
  }
  const targetList = inlineComposer.targetList;
  inlineComposer.element.remove();
  inlineComposer = null;
  if (targetList === elements.taskList && elements.taskList.children.length === 0) {
    elements.emptyState.classList.add('visible');
  }
}

function commitInlineTask(rawTitle, { continueEntry = false } = {}) {
  if (!inlineComposer) {
    return;
  }
  if (!rawTitle) {
    flagInvalid(inlineComposer.input);
    inlineComposer.input.focus({ preventScroll: true });
    return;
  }

  const context = inlineComposer;
  inlineComposer = null;
  context.element.remove();

  const createdId = createTask({
    text: rawTitle,
    folderId: context.folderId,
    plannedFor: context.plannedFor
  });

  if (continueEntry) {
    requestAnimationFrame(() => {
      handleAddTaskInline();
    });
  }

  return createdId;
}

function handleTaskListClick(event) {
  if (isWeekViewActive()) {
    const dayColumn = event.target.closest('.week-day');
    const isoDate = dayColumn?.dataset?.date;
    if (isoDate && isValidISODate(isoDate)) {
      const isTaskClick = Boolean(event.target.closest('.task-item'));
      const alreadySelected = dayColumn.classList.contains('is-selected-day');
      if (alreadySelected && !isTaskClick) {
        clearWeekSelectedDateForFolder(state.ui.selectedFolderId);
        dayColumn.classList.remove('is-selected-day');
      } else {
        setWeekSelectedDateForFolder(state.ui.selectedFolderId, isoDate);
        const currentSelected = elements.weekGrid?.querySelector('.week-day.is-selected-day');
        if (currentSelected && currentSelected !== dayColumn) {
          currentSelected.classList.remove('is-selected-day');
        }
        dayColumn.classList.add('is-selected-day');
      }
    } else {
      clearWeekSelectedDateForFolder(state.ui.selectedFolderId);
      const currentSelected = elements.weekGrid?.querySelector('.week-day.is-selected-day');
      currentSelected?.classList.remove('is-selected-day');
    }
  }
  const menuButton = event.target.closest('.folder-menu-button');
  if (menuButton) {
    event.stopPropagation();
    const folderId = menuButton.closest('.folder-item')?.dataset.folderId;
    if (!folderId || PROTECTED_FOLDER_IDS.has(folderId)) {
      closeFolderMenu();
      return;
    }
    openFolderMenu(folderId, menuButton);
    return;
  }

  const subfolderItem = event.target.closest('.subfolder-item');
  if (subfolderItem) {
    const folderId = subfolderItem.dataset.folderId;
    if (folderId) {
      openFolderWithUnlock(folderId, { openTasks: true });
    }
    return;
  }

  const removeButton = event.target.closest('.task-remove');
  if (removeButton) {
    removeButton.disabled = true;
    const item = removeButton.closest('.task-item');
    if (!item) return;
    const taskId = item.dataset.taskId;
    if (state.ui.selectedFolderId === ARCHIVE_FOLDER_ID) {
      removeCompletedTask(taskId, item);
    } else {
      requestAnimationFrame(() => {
        removeButton.disabled = false;
      });
    }
    return;
  }

  if (event.target.classList.contains('task-inline-confirm')) {
    if (!inlineComposer) return;
    commitInlineTask(inlineComposer.input.value.trim());
    return;
  }
}

function handleTaskChange(event) {
  if (event.target.type !== 'checkbox') {
    return;
  }
  const item = event.target.closest('.task-item');
  if (!item) return;
  const taskId = item.dataset.taskId;
  const weekViewActive = isWeekViewActive();
  let task = state.tasks.find((entry) => entry.id === taskId);
  let isArchivedContext = false;

  if (!task && (weekViewActive || (currentScreen === 'tasks' && state.ui.selectedFolderId === ARCHIVE_FOLDER_ID))) {
    task = state.archivedTasks.find((entry) => entry.id === taskId);
    isArchivedContext = true;
  }

  if (!task) {
    render();
    return;
  }
  if (task.folderId && requiresFolderUnlock(task.folderId)) {
    event.preventDefault();
    openFolderUnlockModal(task.folderId);
    return;
  }

  if (weekViewActive) {
    if (!task.completed && event.target.checked) {
      event.target.disabled = true;
      completeTask(taskId, item);
    } else {
      event.target.checked = false;
    }
    return;
  }

  if (currentScreen === 'tasks' && state.ui.selectedFolderId === ARCHIVE_FOLDER_ID) {
    if (isArchivedContext && task.completed && !event.target.checked) {
      event.target.disabled = true;
      reopenTask(taskId, item);
    } else {
      event.target.checked = true;
    }
    return;
  }

  if (!task.completed && event.target.checked) {
    event.target.disabled = true;
    completeTask(taskId, item);
  } else {
    event.target.checked = false;
  }
}

function handleTaskDblClick(event) {
  const subfolderItem = event.target.closest('.subfolder-item');
  if (subfolderItem) {
    const folderId = subfolderItem.dataset.folderId;
    if (folderId) {
      openFolderWithUnlock(folderId, { openTasks: true });
    }
    return;
  }
  const titleNode = event.target.closest('.task-title');
  if (!titleNode) return;
  beginTaskEdit(titleNode);
}

function handleTaskKeydown(event) {
  const subfolderItem = event.target.closest('.subfolder-item');
  if (subfolderItem) {
    const folderId = subfolderItem.dataset.folderId;
    if (!folderId) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFolderWithUnlock(folderId, { openTasks: true });
    }
    return;
  }
  const titleNode = event.target.closest('.task-title');
  if (!titleNode) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    beginTaskEdit(titleNode);
  }
}

function animateTaskCollapse(item, callback, duration = 520) {
  const list = item?.parentElement || elements.taskList;
  if (!list) {
    callback();
    return;
  }

  const following = [];
  let cursor = item?.nextElementSibling || null;
  while (cursor) {
    if (!cursor.dataset.composer) {
      following.push(cursor);
    }
    cursor = cursor.nextElementSibling;
  }

  const styles = getComputedStyle(list);
  const gapValue = parseFloat(styles.rowGap || styles.gap || '0');
  const shift = (item?.offsetHeight || 0) + gapValue;

  following.forEach((node) => {
    node.style.transition = 'transform 0.28s ease';
    node.style.transform = `translateY(-${shift}px)`;
  });

  setTimeout(() => {
    callback();
    following.forEach((node) => {
      node.style.transition = '';
      node.style.transform = '';
    });
  }, duration);
}

function beginTaskEdit(titleNode) {
  const item = titleNode.closest('.task-item');
  if (!item) return;
  const taskId = item.dataset.taskId;
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task) return;

  cancelInlineComposer(true);

  const input = document.createElement('textarea');
  input.value = task.text ?? '';
  input.className = 'task-title-input';
  input.maxLength = 2000;
  input.rows = 1;
  input.style.minHeight = '0';
  input.style.overflowY = 'hidden';

  const computeBaseHeight = () => {
    const styles = window.getComputedStyle(input);
    const lineHeight = parseFloat(styles.lineHeight) || 0;
    const paddingTop = parseFloat(styles.paddingTop) || 0;
    const paddingBottom = parseFloat(styles.paddingBottom) || 0;
    const borderTop = parseFloat(styles.borderTopWidth) || 0;
    const borderBottom = parseFloat(styles.borderBottomWidth) || 0;
    return Math.ceil(lineHeight + paddingTop + paddingBottom + borderTop + borderBottom);
  };

  const autoResize = () => {
    const baseHeight = computeBaseHeight();
    input.style.height = 'auto';
    const scrollHeight = Math.ceil(input.scrollHeight);
    const nextHeight = Math.max(scrollHeight, baseHeight);
    input.style.height = `${nextHeight}px`;
  };

  const finish = (shouldSave) => {
    if (shouldSave) {
      const newTitle = input.value.trim();
      if (!newTitle) {
        flagInvalid(input);
        input.focus({ preventScroll: true });
        return;
      }
      if (newTitle !== task.text) {
        task.text = newTitle;
        task.updatedAt = Date.now();
        persistState();
      }
    }
    input.removeEventListener('blur', handleBlur);
    input.removeEventListener('keydown', handleKey);
    renderTasks();
  };

  const handleBlur = () => finish(true);
  const handleKey = (event) => {
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : event.key;
    if (key === 'enter') {
      if (event.shiftKey) {
        requestAnimationFrame(autoResize);
        return;
      }
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  };

  input.addEventListener('input', () => {
    clearInvalid(input);
    autoResize();
  });
  input.addEventListener('blur', handleBlur);
  input.addEventListener('keydown', handleKey);

  titleNode.classList.add('editing');
  titleNode.after(input);
  input.focus({ preventScroll: true });
  autoResize();
  const end = input.value.length;
  try {
    input.setSelectionRange(end, end);
  } catch (error) {
    // setSelectionRange may fail on some platforms, fallback to default cursor placement
  }
}

function completeTaskInWeekView(taskId) {
  const index = state.tasks.findIndex((entry) => entry.id === taskId);
  if (index === -1) {
    renderTasks();
    return;
  }

  const [task] = state.tasks.splice(index, 1);
  const timestamp = Date.now();
  const archivedTask = {
    ...task,
    completed: true,
    completedAt: timestamp,
    updatedAt: timestamp
  };
  const existingIndex = state.archivedTasks.findIndex((entry) => entry.id === archivedTask.id);
  if (existingIndex !== -1) {
    state.archivedTasks.splice(existingIndex, 1);
  }
  state.archivedTasks.unshift(archivedTask);
  persistState();
  renderTasks();
}

function reopenTaskInWeekView(taskId) {
  const index = state.archivedTasks.findIndex((entry) => entry.id === taskId);
  if (index === -1) {
    renderTasks();
    return;
  }

  const [archivedTask] = state.archivedTasks.splice(index, 1);
  const timestamp = Date.now();
  const folderId = archivedTask.folderId;
  const orders = state.tasks
    .filter((entry) => entry.folderId === folderId && !entry.completed)
    .map((entry) => entry.order ?? 0);
  const nextOrder = orders.length ? Math.max(...orders) + 1 : 0;

  state.tasks.push({
    ...archivedTask,
    completed: false,
    completedAt: undefined,
    updatedAt: timestamp,
    order: nextOrder
  });
  persistState();
  renderTasks();
}


function completeTask(taskId, item) {
  const index = state.tasks.findIndex((entry) => entry.id === taskId);
  if (index === -1) {
    render();
    return;
  }

  const [task] = state.tasks.splice(index, 1);

  const title = item?.querySelector('.task-title');
  title?.classList.add('completed');
  item?.classList.add('completed');

  animateTaskCollapse(item, () => {
    const timestamp = Date.now();
    const archivedTask = {
      ...task,
      completed: true,
      completedAt: timestamp,
      updatedAt: timestamp
    };
    const existingIndex = state.archivedTasks.findIndex((entry) => entry.id === archivedTask.id);
    if (existingIndex !== -1) {
      state.archivedTasks.splice(existingIndex, 1);
    }
    state.archivedTasks.unshift(archivedTask);
    persistState();
    render();
  });
}

function reopenTask(taskId, item) {
  const index = state.archivedTasks.findIndex((entry) => entry.id === taskId);
  if (index === -1) {
    render();
    return;
  }

  const [archivedTask] = state.archivedTasks.splice(index, 1);

  item?.classList.add('completed');
  const title = item?.querySelector('.task-title');
  title?.classList.add('completed');

  animateTaskCollapse(item, () => {
    const timestamp = Date.now();
    const folderId = archivedTask.folderId;
    const orders = state.tasks
      .filter((entry) => entry.folderId === folderId && !entry.completed)
      .map((entry) => entry.order ?? 0);
    const nextOrder = orders.length ? Math.max(...orders) + 1 : 0;

    state.tasks.push({
      ...archivedTask,
      completed: false,
      completedAt: undefined,
      updatedAt: timestamp,
      order: nextOrder
    });
    persistState();
    render();
  });
}

function removeCompletedTask(taskId, item) {
  const index = state.archivedTasks.findIndex((entry) => entry.id === taskId);
  if (index === -1) {
    render();
    return;
  }

  item?.classList.add('completed');
  const title = item?.querySelector('.task-title');
  title?.classList.add('completed');

  animateTaskCollapse(item, () => {
    state.archivedTasks.splice(index, 1);
    persistState();
    render();
  });
}

function getSubfolderItems() {
  if (!elements.taskList) {
    return [];
  }
  return Array.from(elements.taskList.children)
    .filter((node) => node instanceof HTMLElement && node.classList.contains('subfolder-item'));
}

function syncSubfolderOrderFromDom() {
  const items = getSubfolderItems();
  if (!items.length) {
    return;
  }
  let index = 0;
  items.forEach((node) => {
    const id = node.dataset.folderId;
    if (!id || PROTECTED_FOLDER_IDS.has(id)) {
      return;
    }
    const folder = getFolderById(id);
    if (!folder) {
      return;
    }
    folder.order = index;
    folder.updatedAt = Date.now();
    index += 1;
  });
  persistState();
}

function handleDragStart(event) {
  if (isWeekViewActive()) {
    return;
  }
  const subfolderItem = event.target.closest('.subfolder-item');
  if (subfolderItem) {
    if (subfolderItem.classList.contains('is-readonly')) {
      event.preventDefault();
      return;
    }
    draggingSubfolderId = subfolderItem.dataset.folderId;
    draggingSubfolderParentId = state.ui.selectedFolderId ?? null;
    subfolderItem.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggingSubfolderId ?? '');
    createDragGhost(subfolderItem, event);
    return;
  }
  const item = event.target.closest('.task-item');
  if (!item || item.dataset.composer || item.classList.contains('is-readonly')) {
    event.preventDefault();
    return;
  }
  draggingTaskId = item.dataset.taskId;
  item.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggingTaskId);
  createDragGhost(item, event);
}

function handleDragOver(event) {
  if (isWeekViewActive()) {
    return;
  }
  if (draggingSubfolderId) {
    event.preventDefault();
    const draggingItem = elements.taskList.querySelector(
      `.subfolder-item[data-folder-id="${draggingSubfolderId}"]`
    );
    if (!draggingItem) {
      return;
    }
    const items = getSubfolderItems().filter((item) => item !== draggingItem);
    if (!items.length) {
      return;
    }

    let insertBefore = null;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        insertBefore = item;
        break;
      }
    }

    applyWeekFlip(elements.taskList, () => {
      if (insertBefore) {
        insertBefore.before(draggingItem);
        return;
      }
      const lastItem = items[items.length - 1];
      lastItem.after(draggingItem);
    });
    return;
  }
  if (!draggingTaskId) return;
  event.preventDefault();

  const draggingItem = elements.taskList.querySelector(`[data-task-id="${draggingTaskId}"]`);
  if (!draggingItem) return;

  const overItem = event.target.closest('.task-item');
  if (!overItem || overItem.dataset.composer) {
    applyWeekFlip(elements.taskList, () => {
      elements.taskList.appendChild(draggingItem);
    });
    return;
  }

  if (overItem === draggingItem) {
    return;
  }

  const overRect = overItem.getBoundingClientRect();
  const isAfter = event.clientY > overRect.top + overRect.height / 2;
  applyWeekFlip(elements.taskList, () => {
    if (isAfter) {
      overItem.after(draggingItem);
    } else {
      overItem.before(draggingItem);
    }
  });
}

function handleDragEnd() {
  if (isWeekViewActive()) {
    draggingTaskId = null;
    draggingSubfolderId = null;
    draggingSubfolderParentId = null;
    return;
  }
  if (draggingSubfolderId) {
    const draggingItem = elements.taskList.querySelector(
      `.subfolder-item[data-folder-id="${draggingSubfolderId}"]`
    );
    draggingItem?.classList.remove('dragging');
    syncSubfolderOrderFromDom();
    renderTasks();
    clearDragGhost();
    draggingSubfolderId = null;
    draggingSubfolderParentId = null;
    return;
  }
  const draggingItem = elements.taskList.querySelector(`[data-task-id="${draggingTaskId}"]`);
  if (draggingItem) {
    draggingItem.classList.remove('dragging');
  }

  if (draggingTaskId) {
    syncTaskOrder();
    renderTasks();
  }
  clearDragGhost();
  draggingTaskId = null;
}

function clearWeekDropTarget() {
  if (weekDropTarget) {
    weekDropTarget.classList.remove('is-drop-target');
    weekDropTarget = null;
  }
}

function createDragGhost(item, event) {
  if (!item || !event?.dataTransfer) {
    return;
  }
  const rect = item.getBoundingClientRect();
  const ghost = item.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.classList.remove('dragging');
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.left = '-9999px';
  ghost.style.top = '-9999px';
  document.body.appendChild(ghost);

  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;
  try {
    event.dataTransfer.setDragImage(ghost, offsetX, offsetY);
  } catch (error) {
    // Ignore drag image errors in unsupported browsers.
  }
  dragGhost = ghost;
}

function clearDragGhost() {
  if (dragGhost) {
    dragGhost.remove();
    dragGhost = null;
  }
}

function captureFlipPositions(list) {
  if (!list) {
    return null;
  }
  const positions = new Map();
  Array.from(list.children).forEach((item) => {
    if (!(item instanceof HTMLElement) || item.classList.contains('dragging')) {
      return;
    }
    positions.set(item, item.getBoundingClientRect());
  });
  return positions;
}

function playFlipAnimation(list, positions) {
  if (!list || !positions) {
    return;
  }
  Array.from(list.children).forEach((item) => {
    if (!(item instanceof HTMLElement) || item.classList.contains('dragging')) {
      return;
    }
    const first = positions.get(item);
    if (!first) {
      return;
    }
    const last = item.getBoundingClientRect();
    const deltaX = first.left - last.left;
    const deltaY = first.top - last.top;
    if (!deltaX && !deltaY) {
      return;
    }
    item.style.transition = 'transform 0s';
    item.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    requestAnimationFrame(() => {
    item.style.transition = 'transform 220ms cubic-bezier(0.25, 0.8, 0.25, 1)';
      item.style.transform = '';
    });
    const cleanup = () => {
      item.style.transition = '';
      item.removeEventListener('transitionend', cleanup);
    };
    item.addEventListener('transitionend', cleanup);
  });
}

function applyWeekFlip(list, mutate) {
  if (!list || typeof mutate !== 'function') {
    return;
  }
  const positions = captureFlipPositions(list);
  mutate();
  playFlipAnimation(list, positions);
}

function getFolderBlockItems(item) {
  if (!item) {
    return [];
  }
  const block = [];
  const baseDepth = Number(item.dataset.depth) || 0;
  let cursor = item;
  while (cursor) {
    if (!(cursor instanceof HTMLElement) || !cursor.classList.contains('folder-item')) {
      break;
    }
    if (cursor !== item) {
      const depth = Number(cursor.dataset.depth) || 0;
      if (depth <= baseDepth) {
        break;
      }
    }
    block.push(cursor);
    cursor = cursor.nextElementSibling;
  }
  return block;
}

function getFolderSiblingsByParent(parentKey) {
  if (!elements.folderList) {
    return [];
  }
  return Array.from(elements.folderList.children)
    .filter((node) => node instanceof HTMLElement && node.classList.contains('folder-item'))
    .filter((node) => node.dataset.parentKey === parentKey);
}

function syncFolderOrderFromDom() {
  if (!elements.folderList) {
    return;
  }
  const indices = new Map();
  const items = Array.from(elements.folderList.children)
    .filter((node) => node instanceof HTMLElement && node.classList.contains('folder-item'));

  items.forEach((node) => {
    const id = node.dataset.folderId;
    if (!id || PROTECTED_FOLDER_IDS.has(id)) {
      return;
    }
    const parentKey = node.dataset.parentKey ?? 'root';
    const folder = getFolderById(id);
    if (!folder) {
      return;
    }
    const index = indices.get(parentKey) ?? 0;
    folder.order = index;
    folder.updatedAt = Date.now();
    indices.set(parentKey, index + 1);
  });

  persistState();
}

function handleFolderDragStart(event) {
  const item = event.target.closest('.folder-item');
  if (!item || item.classList.contains('is-readonly') || item.classList.contains('is-editing')) {
    event.preventDefault();
    return;
  }
  suppressFolderClickUntil = Date.now() + 500;
  draggingFolderId = item.dataset.folderId;
  draggingFolderParentKey = item.dataset.parentKey ?? 'root';
  draggingFolderBlock = getFolderBlockItems(item);
  draggingFolderAccepted = false;
  draggingFolderBlock.forEach((node) => node.classList.add('dragging'));
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggingFolderId);
  createDragGhost(item, event);
}

function handleFolderDragOver(event) {
  if (!draggingFolderId) {
    return;
  }
  event.preventDefault();
  draggingFolderAccepted = true;

  const draggingItem = elements.folderList.querySelector(`[data-folder-id="${draggingFolderId}"]`);
  if (!draggingItem) {
    return;
  }

  const hasLiveBlock = draggingFolderBlock?.length
    && draggingFolderBlock.every((node) => node && node.isConnected);
  const block = hasLiveBlock ? draggingFolderBlock : getFolderBlockItems(draggingItem);
  if (!block.length) {
    return;
  }
  if (!hasLiveBlock) {
    draggingFolderBlock = block;
  }
  const siblings = getFolderSiblingsByParent(draggingFolderParentKey ?? 'root')
    .filter((node) => !block.includes(node))
    .filter((node) => !PROTECTED_FOLDER_IDS.has(node.dataset.folderId));

  if (!siblings.length) {
    return;
  }

  let insertBefore = null;
  for (const sibling of siblings) {
    const rect = sibling.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      insertBefore = sibling;
      break;
    }
  }

  applyWeekFlip(elements.folderList, () => {
    const fragment = document.createDocumentFragment();
    block.forEach((node) => fragment.appendChild(node));
    if (insertBefore) {
      insertBefore.before(fragment);
      return;
    }
    const lastSibling = siblings[siblings.length - 1];
    if (lastSibling) {
      const lastBlock = getFolderBlockItems(lastSibling);
      const insertAfter = lastBlock[lastBlock.length - 1] || lastSibling;
      insertAfter.after(fragment);
    } else {
      elements.folderList.appendChild(fragment);
    }
  });
}

function handleFolderDrop(event) {
  if (!draggingFolderId) {
    return;
  }
  event.preventDefault();
  suppressFolderClickUntil = Date.now() + 250;
  draggingFolderAccepted = true;
}

function syncFolderOrder(parentKey) {
  if (!parentKey) {
    return;
  }
  const items = Array.from(elements.folderList.children)
    .filter((node) => node instanceof HTMLElement && node.classList.contains('folder-item'))
    .filter((node) => node.dataset.parentKey === parentKey);

  let index = 0;
  items.forEach((node) => {
    const id = node.dataset.folderId;
    if (!id || PROTECTED_FOLDER_IDS.has(id)) {
      return;
    }
    const folder = getFolderById(id);
    if (!folder) {
      return;
    }
    folder.order = index;
    folder.updatedAt = Date.now();
    index += 1;
  });

  persistState();
}

function handleFolderDragEnd() {
  if (!draggingFolderId) {
    return;
  }
  if (draggingFolderBlock?.length) {
    draggingFolderBlock.forEach((node) => node.classList.remove('dragging'));
  } else {
    const item = elements.folderList.querySelector(`[data-folder-id="${draggingFolderId}"]`);
    item?.classList.remove('dragging');
  }
  if (!draggingFolderAccepted) {
    draggingFolderAccepted = false;
    clearDragGhost();
    draggingFolderId = null;
    draggingFolderParentKey = null;
    draggingFolderBlock = null;
    renderFolders();
    return;
  }
  syncFolderOrderFromDom();
  suppressFolderClickUntil = Date.now() + 250;
  clearDragGhost();
  draggingFolderId = null;
  draggingFolderParentKey = null;
  draggingFolderBlock = null;
  draggingFolderAccepted = false;
  renderFolders();
}

function handleWeekDragStart(event) {
  const item = event.target.closest('.task-item');
  if (!item || item.dataset.composer) {
    event.preventDefault();
    return;
  }
  draggingTaskId = item.dataset.taskId;
  item.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggingTaskId);
  createDragGhost(item, event);
}

function handleWeekDragOver(event) {
  if (!draggingTaskId) {
    return;
  }
  const dayColumn = event.target.closest('.week-day');
  if (!dayColumn) {
    clearWeekDropTarget();
    return;
  }
  event.preventDefault();
  const dayList = dayColumn.querySelector('.week-day-list');
  const draggingItem = elements.weekView?.querySelector(`[data-task-id="${draggingTaskId}"]`);
  if (!dayList || !draggingItem) {
    return;
  }

  const sourceList = draggingItem.parentElement;
  const sourcePositions = sourceList && sourceList !== dayList ? captureFlipPositions(sourceList) : null;
  const overItem = event.target.closest('.task-item');
  if (overItem && overItem !== draggingItem) {
    const overRect = overItem.getBoundingClientRect();
    const isAfter = event.clientY > overRect.top + overRect.height / 2;
    applyWeekFlip(dayList, () => {
      if (isAfter) {
        overItem.after(draggingItem);
      } else {
        overItem.before(draggingItem);
      }
    });
  } else {
    if (draggingItem.parentElement !== dayList || !overItem) {
      applyWeekFlip(dayList, () => {
        dayList.appendChild(draggingItem);
      });
    }
  }
  if (sourcePositions && sourceList) {
    playFlipAnimation(sourceList, sourcePositions);
  }

  if (weekDropTarget !== dayColumn) {
    clearWeekDropTarget();
    weekDropTarget = dayColumn;
    weekDropTarget.classList.add('is-drop-target');
  }
}

function handleWeekDrop(event) {
  if (!draggingTaskId) {
    return;
  }
  const dayColumn = event.target.closest('.week-day');
  if (!dayColumn) {
    return;
  }
  event.preventDefault();
  const targetDate = dayColumn.dataset.date;
  const dayList = dayColumn.querySelector('.week-day-list');
  if (isValidISODate(targetDate)) {
    let prevId = null;
    let nextId = null;
    if (dayList) {
      const items = Array.from(dayList.querySelectorAll('.task-item'))
        .filter((item) => item.dataset.taskId);
      const index = items.findIndex((item) => item.dataset.taskId === draggingTaskId);
      if (index !== -1) {
        prevId = items[index - 1]?.dataset.taskId ?? null;
        nextId = items[index + 1]?.dataset.taskId ?? null;
      }
    }
    updateTaskPlannedFor(draggingTaskId, targetDate, { prevId, nextId });
  }
  const draggingItem = elements.weekView?.querySelector(`[data-task-id="${draggingTaskId}"]`);
  draggingItem?.classList.remove('dragging');
  clearWeekDropTarget();
  clearDragGhost();
  draggingTaskId = null;
}

function handleWeekDragEnd() {
  if (draggingTaskId) {
    const draggingItem = elements.weekView?.querySelector(`[data-task-id="${draggingTaskId}"]`);
    draggingItem?.classList.remove('dragging');
    renderTasks();
  }
  clearWeekDropTarget();
  clearDragGhost();
  draggingTaskId = null;
}

function updateTaskPlannedFor(taskId, plannedFor, { prevId = null, nextId = null } = {}) {
  if (!taskId || !isValidISODate(plannedFor)) {
    return;
  }
  const task = state.tasks.find((entry) => entry.id === taskId)
    ?? state.archivedTasks.find((entry) => entry.id === taskId);
  if (!task) {
    return;
  }
  const prevTask = prevId
    ? (state.tasks.find((entry) => entry.id === prevId) ?? state.archivedTasks.find((entry) => entry.id === prevId))
    : null;
  const nextTask = nextId
    ? (state.tasks.find((entry) => entry.id === nextId) ?? state.archivedTasks.find((entry) => entry.id === nextId))
    : null;
  const prevOrder = Number.isFinite(prevTask?.order) ? prevTask.order : null;
  const nextOrder = Number.isFinite(nextTask?.order) ? nextTask.order : null;
  let nextOrderValue = task.order ?? 0;

  if (prevOrder === null && nextOrder === null) {
    const siblings = getTasksForWeekView(task.folderId)
      .filter((entry) => entry.id !== task.id && normalizePlannedFor(entry.plannedFor) === plannedFor);
    const maxOrder = siblings.reduce((acc, entry) => {
      const value = Number.isFinite(entry.order) ? entry.order : acc;
      return value > acc ? value : acc;
    }, -Infinity);
    nextOrderValue = Number.isFinite(maxOrder) ? maxOrder + 1 : 0;
  } else if (prevOrder === null && nextOrder !== null) {
    nextOrderValue = nextOrder - 1;
  } else if (prevOrder !== null && nextOrder === null) {
    nextOrderValue = prevOrder + 1;
  } else if (prevOrder !== null && nextOrder !== null) {
    nextOrderValue = prevOrder === nextOrder ? prevOrder + 0.5 : (prevOrder + nextOrder) / 2;
  }

  const plannedForChanged = task.plannedFor !== plannedFor;
  const orderChanged = Number.isFinite(nextOrderValue) && task.order !== nextOrderValue;
  if (!plannedForChanged && !orderChanged) {
    return;
  }

  task.plannedFor = plannedFor;
  if (Number.isFinite(nextOrderValue)) {
    task.order = nextOrderValue;
  }
  task.updatedAt = Date.now();
  rememberTaskPlannedFor(task.id, plannedFor);
  persistState();
  renderTasks();
}

function syncTaskOrder() {
  const selectedFolder = state.ui.selectedFolderId;
  if (selectedFolder === ALL_FOLDER_ID) {
    return;
  }
  const ids = Array.from(elements.taskList.children)
    .map((node) => node.dataset.taskId)
    .filter(Boolean);

  ids.forEach((id, index) => {
    const task = state.tasks.find((entry) => entry.id === id);
    if (task && task.folderId === selectedFolder) {
      task.order = index;
    }
  });
  persistState();
}

function clearEmptyStateTimer() {
  if (emptyStateTimer) {
    clearTimeout(emptyStateTimer);
    emptyStateTimer = null;
  }
  emptyStateTimerFolderId = null;
}

function ensureEmptyStateMeta() {
  state.meta = state.meta ?? {};
  state.meta.emptyStateTimestamps = state.meta.emptyStateTimestamps ?? {};
  return state.meta.emptyStateTimestamps;
}

function getEmptyStateDeadline(folderId) {
  if (!folderId) {
    return null;
  }
  return state.meta?.emptyStateTimestamps?.[folderId] ?? null;
}

function setEmptyStateDeadline(folderId, deadline) {
  if (!folderId) {
    return;
  }
  const timestamps = ensureEmptyStateMeta();
  const current = timestamps[folderId] ?? null;
  if (deadline) {
    const nextDeadline = Math.trunc(deadline);
    if (current === nextDeadline) {
      return;
    }
    timestamps[folderId] = nextDeadline;
  } else {
    if (!(folderId in timestamps)) {
      return;
    }
    delete timestamps[folderId];
  }
  saveState(state, { skipRemote: true, updateMeta: false });
}

function showDefaultEmptyStateMessage() {
  const illustration = elements.emptyState.querySelector('.empty-illustration');
  if (illustration) {
    illustration.remove();
  }
  const message = elements.emptyState.querySelector('.empty-message');
  if (message) {
    message.style.display = '';
    message.textContent = 'Задач пока нет';
    delete message.dataset.state;
  }
}

function handleEmptyState(hasTasks) {
  const selectedFolderId = state.ui.selectedFolderId;

  if (!hasTasks) {
    if (emptyStateTimer && emptyStateTimerFolderId && emptyStateTimerFolderId !== selectedFolderId) {
      clearEmptyStateTimer();
    }

    elements.emptyState.classList.add('visible');

    const message = elements.emptyState.querySelector('.empty-message');
    if (selectedFolderId === ARCHIVE_FOLDER_ID) {
      clearEmptyStateTimer();
      emptyStateExpired = false;
      const illustration = elements.emptyState.querySelector('.empty-illustration');
      if (illustration) {
        illustration.remove();
      }
      if (message) {
        message.textContent = 'Архив пуст';
        message.style.display = '';
        message.dataset.state = 'archive';
      }
      setEmptyStateDeadline(selectedFolderId, null);
      return;
    }

    const now = Date.now();
    const existingDeadline = getEmptyStateDeadline(selectedFolderId);
    const canShowSuccess = shouldShowSuccessIllustration(selectedFolderId);

    if (!canShowSuccess) {
      clearEmptyStateTimer();
      emptyStateExpired = true;
      showDefaultEmptyStateMessage();
      setEmptyStateDeadline(selectedFolderId, null);
      return;
    }

    if (existingDeadline === null) {
      emptyStateExpired = false;
      setEmptyStateDeadline(selectedFolderId, now + EMPTY_STATE_TIMEOUT);
    } else {
      emptyStateExpired = now >= existingDeadline;
    }

    let illustration = elements.emptyState.querySelector('.empty-illustration');
    if (!illustration && !emptyStateExpired) {
      illustration = document.createElement('img');
      illustration.className = 'empty-illustration';
      elements.emptyState.appendChild(illustration);
    }

    if (!emptyStateExpired) {
      if (illustration) {
        illustration.src = resolveAssetPath('icons/gofima_success.png', { webPath: './gofima_success.png' });
        illustration.alt = 'Все задачи выполнены';
        illustration.style.display = '';
      }
      if (message) {
        message.style.display = 'none';
        message.dataset.state = 'tasks';
      }

      const deadline = getEmptyStateDeadline(selectedFolderId) ?? now + EMPTY_STATE_TIMEOUT;
      const timeLeft = Math.max(0, deadline - now);
      if (!emptyStateTimer && timeLeft > 0) {
        emptyStateTimerFolderId = selectedFolderId;
        emptyStateTimer = setTimeout(() => {
          emptyStateTimer = null;
          emptyStateTimerFolderId = null;
          emptyStateExpired = true;
          showDefaultEmptyStateMessage();
        }, timeLeft);
      }
    } else {
      showDefaultEmptyStateMessage();
    }
    return;
  }

  elements.emptyState.classList.remove('visible');
  clearEmptyStateTimer();
  emptyStateExpired = false;
  showDefaultEmptyStateMessage();
  if (selectedFolderId) {
    setEmptyStateDeadline(selectedFolderId, null);
  }
}

function renderFolders() {
  closeFolderMenu();
  if (inlineComposer?.targetList === elements.folderList) {
    inlineComposer = null;
  }
  elements.folderList.innerHTML = '';

  if (currentScreen === 'folders') {
    renderRootFolders();
    return;
  }

  const showArchive = settingsManager.get('showArchive');
  const showCounter = settingsManager.get('showCounter');

  const folders = state.folders.slice();
  const { counts } = computeFolderTaskCounts();

  const childrenMap = new Map();
  folders.forEach((folder) => {
    const parentKey = folder.parentId ?? null;
    if (!childrenMap.has(parentKey)) {
      childrenMap.set(parentKey, []);
    }
    childrenMap.get(parentKey).push(folder);
  });

  childrenMap.forEach((list) => {
    list.sort((a, b) => {
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      if (orderA === orderB) {
        return a.name.localeCompare(b.name, 'ru');
      }
      return orderA - orderB;
    });
  });

  const fragment = document.createDocumentFragment();

  const renderBranch = (parentId, depth) => {
    const children = childrenMap.get(parentId) || [];
    children.forEach((folder) => {
      if (!showArchive && folder.id === ARCHIVE_FOLDER_ID) {
        return;
      }

      const node = elements.folderTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.folderId = folder.id;
      node.dataset.depth = String(depth);
      node.dataset.parentKey = folder.parentId ?? 'root';
      node.style.setProperty('--depth', depth);

      const isSelected = state.ui.selectedFolderId === folder.id;
      node.classList.toggle('active', currentScreen === 'tasks' && isSelected);
      node.classList.toggle('is-selected', isSelected);
      const isExpanded = state.ui.expandedFolderIds.includes(folder.id);
      node.classList.toggle('is-expanded', isExpanded);
      node.setAttribute('aria-expanded', childrenMap.get(folder.id)?.length ? String(isExpanded) : 'false');

      const content = node.querySelector('.folder-content');
      const nameSpan = node.querySelector('.folder-name');
      const countSpan = node.querySelector('.folder-count');
      const menuButton = node.querySelector('.folder-menu-button');

      nameSpan.textContent = folder.name;
      const locked = isFolderLocked(folder.id);
      node.classList.toggle('is-locked', locked);

      const totalCount = counts.get(folder.id) ?? 0;
      countSpan.textContent = String(totalCount);
      if (!showCounter || totalCount === 0 || (locked && !isFolderUnlocked(folder.id))) {
        countSpan.style.display = 'none';
      } else {
        countSpan.style.display = '';
      }

      const childrenCount = (childrenMap.get(folder.id) || []).length;
      if (childrenCount > 0) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'folder-toggle';
        toggle.dataset.folderId = folder.id;
        toggle.classList.toggle('is-expanded', isExpanded);
        toggle.setAttribute('aria-label', isExpanded ? 'Свернуть папку' : 'Раскрыть папку');
        toggle.setAttribute('aria-expanded', String(isExpanded));
        content.prepend(toggle);
        node.classList.add('has-children');
      } else {
        node.classList.add('leaf');
      }

      const isMenuHidden = folder.id === ALL_FOLDER_ID || folder.id === ARCHIVE_FOLDER_ID;
      menuButton.classList.toggle('hidden', isMenuHidden);
      const isDraggable = !PROTECTED_FOLDER_IDS.has(folder.id) && editingFolderId !== folder.id;
      node.setAttribute('draggable', String(isDraggable));
      node.classList.toggle('is-readonly', !isDraggable);

      if (editingFolderId === folder.id) {
        node.classList.add('is-editing');
        menuButton.classList.add('hidden');

        const input = document.createElement('input');
        input.className = 'folder-edit-input';
        input.value = folder.name;
        input.maxLength = 100;

        const finish = (shouldSave) => {
          if (shouldSave) {
            const newTitle = input.value.trim();
            if (!newTitle) {
              flagInvalid(input);
              input.focus({ preventScroll: true });
              return;
            }
            if (newTitle !== folder.name) {
              folder.name = newTitle;
              folder.updatedAt = Date.now();
              ensureSystemFolders(state);
              persistState();
            }
          }
          input.removeEventListener('blur', handleBlur);
          input.removeEventListener('keydown', handleKey);
          editingFolderId = null;
          render();
        };

        const handleBlur = () => finish(true);
        const handleKey = (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            editingFolderId = null;
            renderFolders();
          }
        };

        input.addEventListener('input', () => clearInvalid(input));
        input.addEventListener('blur', handleBlur);
        input.addEventListener('keydown', handleKey);

        content.innerHTML = '';
        content.append(input, countSpan);

        requestAnimationFrame(() => {
          input.focus({ preventScroll: true });
          input.select();
        });
      }

      fragment.appendChild(node);

      if (childrenCount > 0 && isExpanded) {
        renderBranch(folder.id, depth + 1);
      }
    });
  };

  renderBranch(null, 0);
  elements.folderList.appendChild(fragment);
}

function renderRootFolders() {
  const fragment = document.createDocumentFragment();
  const showArchive = settingsManager.get('showArchive');
  const showCounter = settingsManager.get('showCounter');
  const { counts } = computeFolderTaskCounts();

  const rootFolders = state.folders.filter((folder) => {
    if (folder.id === ALL_FOLDER_ID) {
      return false;
    }
    if (folder.parentId === null) {
      return true;
    }
    return folder.parentId === ALL_FOLDER_ID;
  }).sort((a, b) => {
    const orderA = a.order ?? 0;
    const orderB = b.order ?? 0;
    if (orderA === orderB) {
      return a.name.localeCompare(b.name, 'ru');
    }
    return orderA - orderB;
  });

  if (showArchive) {
    const archiveIndex = rootFolders.findIndex((folder) => folder.id === ARCHIVE_FOLDER_ID);
    if (archiveIndex !== -1 && archiveIndex !== rootFolders.length - 1) {
      const [archiveFolder] = rootFolders.splice(archiveIndex, 1);
      rootFolders.push(archiveFolder);
    }
  }

  rootFolders.forEach((folder) => {
    if (!showArchive && folder.id === ARCHIVE_FOLDER_ID) {
      return;
    }

    const node = elements.folderTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.folderId = folder.id;
    node.dataset.depth = '0';
    node.dataset.parentKey = 'root';
    node.classList.remove('has-children', 'leaf', 'is-expanded');
    node.style.setProperty('--depth', 0);
    node.classList.toggle('is-selected', state.ui.selectedFolderId === folder.id && currentScreen === 'tasks');

    const content = node.querySelector('.folder-content');
    const nameSpan = node.querySelector('.folder-name');
    const countSpan = node.querySelector('.folder-count');
    const menuButton = node.querySelector('.folder-menu-button');
    const toggle = node.querySelector('.folder-toggle');

    if (toggle) {
      toggle.remove();
    }

    nameSpan.textContent = folder.name;
    const locked = isFolderLocked(folder.id);
    node.classList.toggle('is-locked', locked);

    const totalCount = counts.get(folder.id) ?? 0;
    countSpan.textContent = String(totalCount);
    countSpan.style.display = !showCounter || totalCount === 0 || (locked && !isFolderUnlocked(folder.id))
      ? 'none'
      : '';

    const hideMenu = PROTECTED_FOLDER_IDS.has(folder.id);
    menuButton.classList.toggle('hidden', hideMenu);
    const isDraggable = !PROTECTED_FOLDER_IDS.has(folder.id);
    node.setAttribute('draggable', String(isDraggable));
    node.classList.toggle('is-readonly', !isDraggable);

    fragment.appendChild(node);
  });

  const rootTasks = state.tasks
    .filter((task) => !task.completed && !task.folderId)
    .sort((a, b) => {
      const orderA = Number.isFinite(a.order) ? a.order : 0;
      const orderB = Number.isFinite(b.order) ? b.order : 0;
      if (orderA === orderB) {
        return (a.createdAt ?? 0) - (b.createdAt ?? 0);
      }
      return orderA - orderB;
    });

  rootTasks.forEach((task) => {
    const node = elements.taskTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.taskId = task.id;
    node.dataset.composer = 'false';
    node.classList.add('task-root-item');
    node.setAttribute('draggable', 'false');
    node.classList.remove('is-archive');

    const title = node.querySelector('.task-title');
    const folderLabel = node.querySelector('.task-folder-label');
    const checkbox = node.querySelector('.checkbox input');
    const removeButton = node.querySelector('.task-remove');

    if (removeButton) {
      removeButton.classList.add('hidden');
    }

    const body = node.querySelector('.task-body');
    const previewHref = renderTaskLinkPreview(body, task.text);
    renderTaskTitle(title, task.text, { previewHref });
    folderLabel.textContent = '';
    node.classList.remove('show-folder');

    checkbox.checked = Boolean(task.completed);
    checkbox.disabled = false;

    fragment.appendChild(node);
  });

  elements.folderList.appendChild(fragment);
}

function toggleFolderExpansion(folderId, expand) {
  if (!folderId || folderId === ARCHIVE_FOLDER_ID) {
    return;
  }

  const expanded = new Set(Array.isArray(state.ui.expandedFolderIds) ? state.ui.expandedFolderIds : [ALL_FOLDER_ID]);
  const shouldExpand = typeof expand === 'boolean' ? expand : !expanded.has(folderId);

  if (shouldExpand) {
    expanded.add(folderId);
  } else if (folderId !== ALL_FOLDER_ID) {
    expanded.delete(folderId);
  }

  state.ui.expandedFolderIds = Array.from(expanded);
  persistState();
  renderFolders();
}

function setTasksViewMode(viewMode) {
  const isWeek = viewMode === VIEW_MODES.WEEK;
  elements.taskList?.classList.toggle('hidden', isWeek);
  elements.weekView?.classList.toggle('hidden', !isWeek);
  elements.weekToolbar?.classList.toggle('hidden', !isWeek);
  elements.weekMenuButton?.classList.toggle('hidden', !isWeek);
  document.body?.classList.toggle('is-week-wide', isWeek);
  if (!isWeek) {
    closeWeekMenu();
  }
}

function getWeekDayListByDate(isoDate) {
  if (!isoDate || !elements.weekGrid) {
    return null;
  }
  return elements.weekGrid.querySelector(`.week-day-list[data-date="${isoDate}"]`);
}

function getTasksForWeekView(folderId) {
  if (!folderId) {
    return [];
  }
  const active = Array.isArray(state?.tasks) ? state.tasks : [];
  if (getWeekShowCompleted(folderId)) {
    const archived = Array.isArray(state?.archivedTasks) ? state.archivedTasks : [];
    return active.concat(archived).filter((task) => task?.folderId === folderId);
  }
  return active.filter((task) => task?.folderId === folderId);
}

function updateWeekToolbar(weekStart) {
  if (elements.weekRangeLabel) {
    elements.weekRangeLabel.textContent = formatWeekRangeLabel(weekStart);
  }
  if (elements.weekTodayButton) {
    const currentWeekStart = formatISODate(getStartOfISOWeek(new Date()));
    elements.weekTodayButton.disabled = formatISODate(weekStart) === currentWeekStart;
  }
}

function alignWeekGridToToday(folderId, weekStart) {
  if (!elements.weekGrid || !folderId || !weekStart) {
    return;
  }
  const today = new Date();
  const currentWeekStart = formatISODate(getStartOfISOWeek(today));
  if (formatISODate(weekStart) !== currentWeekStart) {
    return;
  }
  if (weekAutoScrollState.get(folderId) === currentWeekStart) {
    return;
  }
  const todayIso = formatISODate(today);
  const column = elements.weekGrid.querySelector(`.week-day[data-date="${todayIso}"]`);
  if (!column) {
    return;
  }
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  requestAnimationFrame(() => {
    if (!elements.weekGrid || !column.isConnected) {
      return;
    }
    const targetLeft = column.offsetLeft;
    try {
      elements.weekGrid.scrollTo({
        left: targetLeft,
        behavior: prefersReducedMotion ? 'auto' : 'smooth'
      });
    } catch (error) {
      elements.weekGrid.scrollLeft = targetLeft;
    }
    weekAutoScrollState.set(folderId, currentWeekStart);
  });
}

function scrollWeekGridToDate(isoDate) {
  if (!elements.weekGrid || !isoDate) {
    return;
  }
  const column = elements.weekGrid.querySelector(`.week-day[data-date="${isoDate}"]`);
  if (!column) {
    return;
  }
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  requestAnimationFrame(() => {
    if (!elements.weekGrid || !column.isConnected) {
      return;
    }
    const targetLeft = column.offsetLeft;
    try {
      elements.weekGrid.scrollTo({
        left: targetLeft,
        behavior: prefersReducedMotion ? 'auto' : 'smooth'
      });
    } catch (error) {
      elements.weekGrid.scrollLeft = targetLeft;
    }
  });
}

function openFolderWithUnlock(folderId, { openTasks = false } = {}) {
  if (!folderId) {
    return;
  }
  if (requiresFolderUnlock(folderId)) {
    selectFolder(folderId, { openTasks });
    if (unlockModalState.folderId !== folderId) {
      openFolderUnlockModal(folderId);
    }
    return;
  }
  selectFolder(folderId, { openTasks });
}

function renderWeekView(folderId = state.ui.selectedFolderId) {
  if (!elements.weekGrid) {
    return;
  }

  const weekStart = getWeekStartForFolder(folderId);
  updateWeekToolbar(weekStart);
  const selectedDate = getWeekSelectedDateForFolder(folderId, weekStart);
  updateWeekMenuState(folderId);

  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const tasksByDate = new Map();
  weekDates.forEach((date) => {
    tasksByDate.set(formatISODate(date), []);
  });

  getTasksForWeekView(folderId).forEach((task) => {
    const plannedFor = normalizePlannedFor(task?.plannedFor);
    if (!plannedFor || !tasksByDate.has(plannedFor)) {
      return;
    }
    tasksByDate.get(plannedFor).push(task);
  });

  tasksByDate.forEach((items) => {
    items.sort((a, b) => {
      const orderA = Number.isFinite(a.order) ? a.order : 0;
      const orderB = Number.isFinite(b.order) ? b.order : 0;
      if (orderA === orderB) {
        return (a.createdAt ?? 0) - (b.createdAt ?? 0);
      }
      return orderA - orderB;
    });
  });

  elements.weekGrid.innerHTML = '';
  const fragment = document.createDocumentFragment();

  weekDates.forEach((date) => {
    const isoDate = formatISODate(date);
    const column = document.createElement('div');
    column.className = 'week-day';
    column.dataset.date = isoDate;
    if (selectedDate && isoDate === selectedDate) {
      column.classList.add('is-selected-day');
    }

    const header = document.createElement('div');
    header.className = 'week-day-header';
    header.textContent = formatWeekdayLabel(date);

    const list = document.createElement('ul');
    list.className = 'week-day-list';
    list.dataset.date = isoDate;
    list.setAttribute('role', 'list');

    (tasksByDate.get(isoDate) || []).forEach((task) => {
      const node = elements.taskTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.taskId = task.id;
      node.classList.remove('is-archive');
      node.classList.toggle('is-completed', Boolean(task.completed));
      node.setAttribute('draggable', 'true');

      const title = node.querySelector('.task-title');
      const folderLabel = node.querySelector('.task-folder-label');
      const checkbox = node.querySelector('.checkbox input');

      const body = node.querySelector('.task-body');
      const previewHref = renderTaskLinkPreview(body, task.text);
      renderTaskTitle(title, task.text, { previewHref });
      title?.classList.toggle('completed', Boolean(task.completed));
      folderLabel.textContent = '';
      node.classList.remove('show-folder');

      checkbox.checked = Boolean(task.completed);
      checkbox.disabled = false;

      list.appendChild(node);
    });

    column.append(header, list);
    fragment.appendChild(column);
  });

  elements.weekGrid.appendChild(fragment);
  alignWeekGridToToday(folderId, weekStart);
}

function shiftWeek(offset) {
  const folderId = state.ui.selectedFolderId;
  if (!isWeekViewActive(folderId)) {
    return;
  }
  const current = getWeekStartForFolder(folderId);
  const next = addDays(current, offset * 7);
  setWeekStartForFolder(folderId, next);
  renderTasks();
}

function jumpToCurrentWeek() {
  const folderId = state.ui.selectedFolderId;
  if (!isWeekViewActive(folderId)) {
    return;
  }
  const current = getStartOfISOWeek(new Date());
  setWeekStartForFolder(folderId, current);
  renderTasks();
}

function moveUnfinishedTasksToNextWeek() {
  const folderId = state.ui.selectedFolderId;
  if (!isWeekViewActive(folderId)) {
    return;
  }
  const weekStart = getWeekStartForFolder(folderId);
  const nextWeekStart = addDays(weekStart, 7);
  const nextMonday = formatISODate(nextWeekStart);
  const tasksToMove = (state.tasks ?? [])
    .filter((task) => task?.folderId === folderId && !task.completed)
    .filter((task) => isISODateInWeek(normalizePlannedFor(task?.plannedFor), weekStart));

  if (!tasksToMove.length) {
    return;
  }

  const confirmed = window.confirm('Перенести все незавершённые задачи этой недели на следующий понедельник?');
  if (!confirmed) {
    return;
  }

  const timestamp = Date.now();
  tasksToMove.forEach((task) => {
    task.plannedFor = nextMonday;
    task.updatedAt = timestamp;
  });

  if (!uiContext.taskPlannedFor || typeof uiContext.taskPlannedFor !== 'object') {
    uiContext.taskPlannedFor = {};
  }
  tasksToMove.forEach((task) => {
    uiContext.taskPlannedFor[task.id] = nextMonday;
  });
  void persistUiContext({ force: true });

  persistState();
  renderTasks();
}

function renderLockedFolderState(folderId) {
  if (!elements.emptyState) {
    return;
  }
  elements.taskList.innerHTML = '';
  elements.weekGrid.innerHTML = '';
  elements.taskList.classList.add('hidden');
  elements.weekView.classList.add('hidden');
  elements.weekToolbar.classList.add('hidden');
  elements.weekMenuButton.classList.add('hidden');
  document.body?.classList.remove('is-week-wide');
  clearEmptyStateTimer();

  const illustration = elements.emptyState.querySelector('.empty-illustration');
  if (illustration) {
    illustration.remove();
  }
  const message = elements.emptyState.querySelector('.empty-message');
  if (message) {
    message.style.display = '';
    message.textContent = 'Папка заблокирована';
    message.dataset.state = 'locked';
  }
  elements.emptyState.classList.add('visible');
}

function renderTasks() {
  cancelInlineComposer(true);

  const selectedFolder = state.ui.selectedFolderId;
  if (requiresFolderUnlock(selectedFolder)) {
    renderLockedFolderState(selectedFolder);
    if (currentScreen === 'tasks') {
      renderTasksHeader(selectedFolder);
    }
    updateFloatingAction();
    return;
  }
  const useWeekView = isWeekViewActive(selectedFolder);
  setTasksViewMode(useWeekView ? VIEW_MODES.WEEK : VIEW_MODES.LIST);

  if (useWeekView) {
    elements.taskList.innerHTML = '';
    renderWeekView(selectedFolder);
    clearEmptyStateTimer();
    elements.emptyState.classList.remove('visible');
    showDefaultEmptyStateMessage();

    if (currentScreen === 'tasks') {
      renderTasksHeader(selectedFolder);
    }

    if (lastCreatedTaskId) {
      focusTaskTitle(lastCreatedTaskId);
      lastCreatedTaskId = null;
    }

    updateFloatingAction();
    return;
  }

  elements.taskList.innerHTML = '';
  const isAllFolder = selectedFolder === ALL_FOLDER_ID;

  let tasks = [];
  const showFolderLabels = isAllFolder || selectedFolder === ARCHIVE_FOLDER_ID;
  const showCounter = settingsManager.get('showCounter');
  const childFolders = state.folders
    .filter((folder) => {
      if (selectedFolder === ARCHIVE_FOLDER_ID) {
        return false;
      }
      if (folder.id === ARCHIVE_FOLDER_ID) {
        return false;
      }
      if (selectedFolder !== ALL_FOLDER_ID && PROTECTED_FOLDER_IDS.has(folder.id)) {
        return false;
      }
      if (selectedFolder === ALL_FOLDER_ID) {
        return folder.parentId === null || folder.parentId === ALL_FOLDER_ID;
      }
      return folder.parentId === selectedFolder;
    })
    .sort((a, b) => {
      const orderA = Number.isFinite(a.order) ? a.order : 0;
      const orderB = Number.isFinite(b.order) ? b.order : 0;
      if (orderA === orderB) {
        return a.name.localeCompare(b.name, 'ru');
      }
      return orderA - orderB;
    });
  const { counts } = computeFolderTaskCounts();

  if (selectedFolder === ARCHIVE_FOLDER_ID) {
    tasks = (state.archivedTasks ?? [])
      .filter((task) => {
        if (!task?.folderId) {
          return true;
        }
        return !requiresFolderUnlock(task.folderId);
      })
      .slice()
      .sort((a, b) => {
        const completedA = Number.isFinite(a.completedAt) ? a.completedAt : (a.updatedAt ?? 0);
        const completedB = Number.isFinite(b.completedAt) ? b.completedAt : (b.updatedAt ?? 0);
        return completedB - completedA;
      });
  } else {
    tasks = state.tasks
      .filter((task) => {
        if (task.completed) {
          return false;
        }
        if (isAllFolder) {
          if (!task.folderId) {
            return true;
          }
          return !requiresFolderUnlock(task.folderId);
        }
        return task.folderId === selectedFolder;
      })
      .sort((a, b) => {
        const orderA = a.order ?? 0;
        const orderB = b.order ?? 0;
        if (orderA === orderB) {
          return (a.createdAt ?? 0) - (b.createdAt ?? 0);
        }
        return orderA - orderB;
      });
  }

  const hadTasks = tasks.length > 0;
  handleEmptyState(hadTasks || childFolders.length > 0);

  const fragment = document.createDocumentFragment();

  if (childFolders.length) {
    childFolders.forEach((folder) => {
      const node = elements.folderTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.folderId = folder.id;
      node.classList.add('subfolder-item');
      node.dataset.depth = '1';
      node.style.setProperty('--depth', 1);
      const allowDrag = selectedFolder !== ALL_FOLDER_ID && selectedFolder !== ARCHIVE_FOLDER_ID;
      const isDraggable = allowDrag && !PROTECTED_FOLDER_IDS.has(folder.id);
      node.setAttribute('draggable', String(isDraggable));
      node.classList.toggle('is-readonly', !isDraggable);

      const content = node.querySelector('.folder-content');
      const nameSpan = node.querySelector('.folder-name');
      const countSpan = node.querySelector('.folder-count');
      const menuButton = node.querySelector('.folder-menu-button');
      const toggle = node.querySelector('.folder-toggle');

      if (toggle) {
        toggle.remove();
      }

      nameSpan.textContent = folder.name;
      const locked = isFolderLocked(folder.id);
      node.classList.toggle('is-locked', locked);
      const totalCount = counts.get(folder.id) ?? 0;
      countSpan.textContent = String(totalCount);
      if (!showCounter || totalCount === 0 || (locked && !isFolderUnlocked(folder.id))) {
        countSpan.style.display = 'none';
      } else {
        countSpan.style.display = '';
      }

      const hideMenu = PROTECTED_FOLDER_IDS.has(folder.id);
      menuButton.classList.toggle('hidden', hideMenu);

      fragment.appendChild(node);
    });
  }

  tasks.forEach((task) => {
    const node = elements.taskTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.taskId = task.id;
    const isArchiveView = selectedFolder === ARCHIVE_FOLDER_ID;
    const isReadonly = isAllFolder || isArchiveView;
    node.classList.toggle('is-readonly', isReadonly);
    node.classList.toggle('is-archive', isArchiveView);
    node.setAttribute('draggable', isReadonly ? 'false' : 'true');

    const title = node.querySelector('.task-title');
    const folderLabel = node.querySelector('.task-folder-label');
    const checkbox = node.querySelector('.checkbox input');

    const body = node.querySelector('.task-body');
    const previewHref = renderTaskLinkPreview(body, task.text);
    renderTaskTitle(title, task.text, { previewHref });
    if (showFolderLabels) {
      folderLabel.textContent = getFolderName(task.folderId);
      node.classList.add('show-folder');
    } else {
      folderLabel.textContent = '';
      node.classList.remove('show-folder');
    }

    checkbox.checked = Boolean(task.completed);
    checkbox.disabled = false;
    node.classList.toggle('completed', !isArchiveView && Boolean(task.completed));

    fragment.appendChild(node);
  });

  elements.taskList.appendChild(fragment);

  if (currentScreen === 'tasks') {
    renderTasksHeader(selectedFolder);
  }

  if (lastCreatedTaskId) {
    focusTaskTitle(lastCreatedTaskId);
    lastCreatedTaskId = null;
  }

  updateFloatingAction();
}

function updateFloatingAction() {
  const fab = elements.floatingActionButton;
  if (!fab) {
    return;
  }

  if (currentScreen === 'folders') {
    fab.classList.remove('is-hidden');
    fab.dataset.mode = 'task';
    fab.setAttribute('aria-label', 'Добавить задачу');
    fab.textContent = '＋';
    return;
  }

  if (currentScreen === 'tasks') {
    const selectedFolder = state.ui.selectedFolderId;
    const disableAdd = selectedFolder === ARCHIVE_FOLDER_ID;
    if (disableAdd) {
      fab.classList.add('is-hidden');
    } else {
      fab.classList.remove('is-hidden');
      fab.dataset.mode = 'task';
      fab.setAttribute('aria-label', 'Добавить задачу');
      fab.textContent = '＋';
    }
    return;
  }

  fab.classList.add('is-hidden');
}

function updateThemeControls() {
  const autoEnabled = settingsManager.get('autoTheme');
  const activeDarkMode = settingsManager.isDarkModeActive();

  if (elements.autoThemeToggle) {
    elements.autoThemeToggle.checked = autoEnabled;
  }
  if (elements.darkModeToggle) {
    elements.darkModeToggle.checked = activeDarkMode;
    elements.darkModeToggle.disabled = autoEnabled;
    const container = elements.darkModeToggle.closest('.settings-item');
    container?.classList.toggle('is-disabled', autoEnabled);
    if (autoEnabled) {
      elements.darkModeToggle.setAttribute('aria-disabled', 'true');
    } else {
      elements.darkModeToggle.removeAttribute('aria-disabled');
    }
  }
}

function getFolderName(folderId) {
  if (!folderId) {
    return 'Без папки';
  }
  return state.folders.find((folder) => folder.id === folderId)?.name ?? 'Папка';
}

function focusTaskTitle(taskId) {
  requestAnimationFrame(() => {
    const selector = `[data-task-id="${taskId}"] .task-title`;
    const node = (isWeekViewActive() ? elements.weekView?.querySelector(selector) : null)
      || elements.taskList.querySelector(selector);
    node?.focus({ preventScroll: true });
  });
}

function flagInvalid(input) {
  input.classList.add('input-invalid');
}

function clearInvalid(input) {
  input.classList.remove('input-invalid');
}

function persistState() {
  ensureSystemFolders(state);
  saveState(state);
}

function createTask({ text, folderId = undefined, plannedFor = undefined }) {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) {
    return null;
  }
  let targetFolderId = folderId;
  if (targetFolderId === undefined) {
    const selectedFolder = state.ui.selectedFolderId;
    targetFolderId = (selectedFolder && selectedFolder !== ALL_FOLDER_ID && selectedFolder !== ARCHIVE_FOLDER_ID)
      ? selectedFolder
      : null;
  }
  if (targetFolderId === ARCHIVE_FOLDER_ID || targetFolderId === ALL_FOLDER_ID) {
    targetFolderId = null;
  }
  const orders = state.tasks
    .filter((task) => task.folderId === targetFolderId && !task.completed)
    .map((task) => task.order ?? 0);
  const nextOrder = orders.length ? Math.max(...orders) + 1 : 0;
  const normalizedPlannedFor = normalizePlannedFor(plannedFor) ?? formatISODate(new Date());

  const id = uid();
  const now = Date.now();
  state.tasks.push({
    id,
    text: normalizedText,
    folderId: targetFolderId,
    completed: false,
    createdAt: now,
    updatedAt: now,
    order: nextOrder,
    ...(normalizedPlannedFor ? { plannedFor: normalizedPlannedFor } : {})
  });

  if (normalizedPlannedFor) {
    rememberTaskPlannedFor(id, normalizedPlannedFor);
  }
  lastCreatedTaskId = id;
  persistState();
  render();
  return id;
}

function render() {
  renderFolders();
  renderTasks();
  updateFloatingAction();
  updateSyncStatusLabel({ syncing: manualSyncInFlight });
}

render();
const initialScreen = state.ui.activeScreen === 'tasks' ? 'tasks' : 'folders';
showScreen(initialScreen, { skipPersist: true });

document.querySelector('.app-shell')?.classList.add('is-ready');

// Settings handlers
if (elements.settingsAction) {
  elements.settingsAction.addEventListener('click', (event) => {
    event.preventDefault();
    closeAppMenu();
    showSettingsScreen();
  });
}

if (elements.backToFoldersFromSettings) {
  elements.backToFoldersFromSettings.addEventListener('click', () => {
    hideSettingsScreen();
  });
}

if (elements.autoThemeToggle) {
  elements.autoThemeToggle.addEventListener('change', async (event) => {
    await settingsManager.set('autoTheme', event.target.checked);
    updateThemeControls();
  });
}

if (elements.darkModeToggle) {
  elements.darkModeToggle.addEventListener('change', async (event) => {
    await settingsManager.set('darkMode', event.target.checked);
    updateThemeControls();
  });
}

if (elements.showCounterToggle) {
  elements.showCounterToggle.addEventListener('change', async (event) => {
    await settingsManager.set('showCounter', event.target.checked);
    render(); // Re-render to show/hide counters
  });
}

if (elements.showArchiveToggle) {
  elements.showArchiveToggle.addEventListener('change', async (event) => {
    await settingsManager.set('showArchive', event.target.checked);
    render(); // Re-render to show/hide archive folder
  });
}

if (elements.clearArchiveButton) {
  elements.clearArchiveButton.addEventListener('click', () => {
    const hasCompleted = (state.archivedTasks?.length ?? 0) > 0 || state.tasks.some((task) => task.completed);
    if (!hasCompleted) {
      return;
    }
    const confirmed = window.confirm('Очистить архив задач?');
    if (!confirmed) {
      return;
    }
    state.archivedTasks = [];
    persistState();
    render();
  });
}

if (elements.changePasswordButton) {
  elements.changePasswordButton.addEventListener('click', async () => {
    const currentPassword = prompt('Введите текущий пароль:');
    if (!currentPassword) return;
    
    const newPassword = prompt('Введите новый пароль (минимум 6 символов):');
    if (!newPassword || newPassword.length < 6) {
      alert('Пароль должен содержать минимум 6 символов');
      return;
    }
    
    const confirmPassword = prompt('Подтвердите новый пароль:');
    if (newPassword !== confirmPassword) {
      alert('Пароли не совпадают');
      return;
    }
    
    try {
      const token = authStore.getToken();
      console.log('🔑 Changing password, token:', !!token);
      
      // Try both possible endpoints
      const endpoints = ['/api/auth/password', '/api/auth/change-password'];
      let success = false;
      let lastError = null;
      
      for (const endpoint of endpoints) {
        try {
          console.log(`📡 Trying endpoint: ${endpoint}`);
          const response = await fetch(buildAuthUrl(endpoint), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              oldPassword: currentPassword,
              newPassword: newPassword,
              currentPassword: currentPassword,
              password: newPassword
            }),
            credentials: shouldUseAuthCookies ? 'include' : 'omit'
          });
          
          console.log(`📡 Response status: ${response.status}`);
          
          if (response.ok) {
            success = true;
            break;
          }
          
          const data = await response.json().catch(() => ({}));
          lastError = data?.message || data?.error || `HTTP ${response.status}`;
          console.log(`❌ Error from ${endpoint}:`, lastError);
        } catch (err) {
          console.log(`❌ Request failed for ${endpoint}:`, err);
          lastError = err.message;
        }
      }
      
      if (success) {
        alert('Пароль успешно изменён');
      } else {
        throw new Error(lastError || 'Не удалось изменить пароль');
      }
    } catch (error) {
      console.error('❌ Password change error:', error);
      alert(error.message || 'Ошибка при изменении пароля');
    }
  });
}

if (elements.logoutButton) {
  elements.logoutButton.addEventListener('click', async () => {
    const confirmed = window.confirm('Выйти из аккаунта?');
    if (confirmed) {
      await performLogout();
      hideSettingsScreen();
    }
  });
}

if (elements.syncNowButton) {
  elements.syncNowButton.addEventListener('click', () => {
    void handleManualSyncClick({ source: 'button' });
  });
}

function showSettingsScreen() {
  resetPullToRefresh({ immediate: true });
  if (currentScreen === 'tasks') {
    lockFolderIfNeeded(state?.ui?.selectedFolderId);
  }
  // Hide other screens
  elements.screenFolders.classList.remove('is-active', 'screen-enter');
  elements.screenTasks.classList.remove('is-active', 'screen-enter');
  
  // Show settings screen
  elements.screenSettings.classList.remove('hidden');
  elements.screenSettings.classList.add('is-active');
  requestAnimationFrame(() => {
    elements.screenSettings.classList.add('screen-enter');
    elements.screenSettings.addEventListener('animationend', () => {
      elements.screenSettings.classList.remove('screen-enter');
    }, { once: true });
  });
  
  currentScreen = 'settings';
  updateFloatingAction();
}

function hideSettingsScreen() {
  elements.screenSettings.classList.remove('is-active', 'screen-enter');
  elements.screenSettings.classList.add('hidden');
  
  // Return to folders screen
  showScreen('folders');
}

// Subscribe to settings changes
settingsManager.subscribe((settings) => {
  // Update UI based on settings
  if (settings.autoTheme !== undefined || settings.darkMode !== undefined) {
    updateThemeControls();
  }
  if (settings.showCounter !== undefined) {
    render();
  }
  if (settings.showArchive !== undefined) {
    render();
  }
});

// Инициализация свайп-навигации для PWA
initSwipeNavigation();

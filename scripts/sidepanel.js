import { createSyncManager } from './sync.js';
import { syncConfig } from './sync-config.js';

const STORAGE_KEY = 'vuexyTodoState';
const ALL_FOLDER_ID = 'all';
const ARCHIVE_FOLDER_ID = 'archive';

const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage?.local;
let syncManager = null;
let storageKey = STORAGE_KEY;

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

const defaultState = () => ({
  meta: {
    version: 0,
    updatedAt: Date.now()
  },
  folders: [
    { id: ALL_FOLDER_ID, name: 'Все' },
    { id: 'inbox', name: 'Основные' },
    { id: 'personal', name: 'Личное' },
    { id: ARCHIVE_FOLDER_ID, name: 'Архив' }
  ],
  tasks: [],
  archivedTasks: [],
  ui: {
    selectedFolderId: 'inbox',
    activeScreen: 'folders'
  }
});

const uid = () => {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
};

const safeClone = (value) => JSON.parse(JSON.stringify(value));

async function bootstrapAuthContext() {
  const hasChromeRuntime = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  const storedUserId = (() => {
    try {
      return localStorage.getItem(USER_ID_STORAGE_KEY) || '';
    } catch (error) {
      return '';
    }
  })();

  const shouldUseSession = syncConfig.useSessionAuth !== false || !hasChromeRuntime;

  if (shouldUseSession) {
    syncConfig.useSessionAuth = true;
    try {
      const response = await fetch(buildApiUrl('/api/auth/me'), {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.authenticated && data.user?.id) {
          const userId = data.user.id;
          syncConfig.userId = userId;
          storageKey = `${STORAGE_KEY}:${userId}`;
          try {
            localStorage.setItem(USER_ID_STORAGE_KEY, userId);
          } catch (error) {
            console.warn('Todo sync: unable to persist user id', error);
          }
          return;
        }
      }
    } catch (error) {
      console.warn('Todo sync: unable to resolve auth context', error);
    }

    if (storedUserId) {
      syncConfig.userId = storedUserId;
      storageKey = `${STORAGE_KEY}:${storedUserId}`;
      return;
    }
  }

  if (syncConfig.userId) {
    storageKey = `${STORAGE_KEY}:${syncConfig.userId}`;
  } else if (storedUserId) {
    syncConfig.userId = storedUserId;
    storageKey = `${STORAGE_KEY}:${storedUserId}`;
  } else {
    storageKey = STORAGE_KEY;
  }
}

async function loadState() {
  if (!hasChromeStorage) {
    try {
      const raw = globalThis.localStorage?.getItem(storageKey);
      if (!raw) {
        return defaultState();
      }
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn('Failed to load state from localStorage:', error);
      return defaultState();
    }
  }

  try {
    const stored = await chrome.storage.local.get(storageKey);
    const raw = stored?.[storageKey];
    if (!raw) {
      return defaultState();
    }
    return normalizeState(raw);
  } catch (error) {
    console.warn('Failed to load saved state:', error);
    return defaultState();
  }
}

function normalizeState(rawState) {
  const base = defaultState();
  const merged = {
    folders: Array.isArray(rawState.folders) && rawState.folders.length ? rawState.folders : base.folders,
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

  if (merged.ui.activeScreen !== 'tasks' && merged.ui.activeScreen !== 'folders') {
    merged.ui.activeScreen = base.ui.activeScreen;
  }

  merged.meta.version = Number.isFinite(merged.meta.version)
    ? merged.meta.version
    : parseInt(merged.meta.version ?? base.meta.version, 10) || base.meta.version;

  const rawUpdatedAt = merged.meta.updatedAt;
  if (Number.isFinite(rawUpdatedAt)) {
    merged.meta.updatedAt = rawUpdatedAt;
  } else if (typeof rawUpdatedAt === 'string') {
    const parsed = Date.parse(rawUpdatedAt);
    merged.meta.updatedAt = Number.isFinite(parsed) ? parsed : base.meta.updatedAt;
  } else {
    merged.meta.updatedAt = base.meta.updatedAt;
  }

  return merged;
}

async function saveState(state, options = {}) {
  const { skipRemote = false, updateMeta = true } = options;

  if (updateMeta) {
    const nextVersion = Number.isFinite(state.meta?.version) ? state.meta.version + 1 : 1;
    state.meta = {
      version: nextVersion,
      updatedAt: Date.now()
    };
  } else if (!state.meta) {
    state.meta = { version: 0, updatedAt: Date.now() };
  }

  const snapshot = safeClone(state);

  if (hasChromeStorage) {
    try {
      await chrome.storage.local.set({ [storageKey]: snapshot });
    } catch (error) {
      console.warn('Failed to persist state:', error);
    }
  } else if (globalThis.localStorage) {
    try {
      globalThis.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch (error) {
      console.warn('Failed to persist state to localStorage:', error);
    }
  }

  if (!skipRemote) {
    syncManager?.schedulePush();
  }
}

function ensureAllFolder(state) {
  const baselineAll = { id: ALL_FOLDER_ID, name: 'Все' };
  const baselineArchive = { id: ARCHIVE_FOLDER_ID, name: 'Архив' };

  const filtered = state.folders.filter((folder) => folder.id !== ALL_FOLDER_ID && folder.id !== ARCHIVE_FOLDER_ID);
  const allFolder = state.folders.find((folder) => folder.id === ALL_FOLDER_ID);
  const archiveFolder = state.folders.find((folder) => folder.id === ARCHIVE_FOLDER_ID);

  const normalizedAll = allFolder ? { ...baselineAll, ...allFolder, id: ALL_FOLDER_ID } : baselineAll;
  const normalizedArchive = archiveFolder ? { ...baselineArchive, ...archiveFolder, id: ARCHIVE_FOLDER_ID } : baselineArchive;

  state.folders = [normalizedAll, ...filtered, normalizedArchive];

  const existingIds = new Set(state.folders.map((folder) => folder.id));
  if (!existingIds.has(state.ui.selectedFolderId)) {
    state.ui.selectedFolderId = ALL_FOLDER_ID;
    if (state.ui.activeScreen === 'tasks') {
      state.ui.activeScreen = 'folders';
    }
  }
}

function applyRemoteState(remoteState) {
  if (!remoteState) {
    return;
  }

  const normalized = normalizeState(remoteState);
  const preservedUI = { ...state.ui };

  state.folders = normalized.folders;
  state.tasks = normalized.tasks;
  state.archivedTasks = normalized.archivedTasks;
  state.ui = {
    ...normalized.ui,
    ...preservedUI,
    selectedFolderId: preservedUI.selectedFolderId ?? normalized.ui?.selectedFolderId,
    activeScreen: preservedUI.activeScreen ?? normalized.ui?.activeScreen
  };
  state.meta = normalized.meta;

  ensureAllFolder(state);
  saveState(state, { skipRemote: true, updateMeta: false });
  render();
}

await bootstrapAuthContext();

const state = await loadState();
ensureAllFolder(state);
state.tasks = state.tasks.map((task, index) => ({
  ...task,
  order: typeof task.order === 'number' ? task.order : index
}));
state.meta = state.meta ?? { version: 0, updatedAt: Date.now() };

const elements = {
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
  taskList: document.getElementById('taskList'),
  taskTemplate: document.getElementById('taskTemplate'),
  emptyState: document.getElementById('emptyState'),
  backButton: document.getElementById('backToFolders'),
  tasksHeaderTitle: document.getElementById('tasksHeaderTitle'),
  appMenuButtons: Array.from(document.querySelectorAll('.app-menu-button')),
  appMenu: document.getElementById('appMenu'),
  logoutAction: document.getElementById('logoutAction'),
  clearArchiveAction: document.getElementById('clearArchiveAction'),
  floatingActionButton: document.getElementById('floatingActionButton')
};

let currentScreen = null;
let draggingTaskId = null;
let editingFolderId = null;
let folderMenuAnchor = null;
let inlineComposer = null;
let lastCreatedTaskId = null;

const folderMenuState = {
  visible: false,
  folderId: null
};

const appMenuState = {
  visible: false,
  anchor: null
};

elements.folderModalForm.addEventListener('submit', handleFolderModalSubmit);
elements.folderModalCancel.addEventListener('click', closeFolderModal);
elements.modalBackdrop.addEventListener('click', closeFolderModal);

elements.folderList.addEventListener('click', handleFolderClick);
elements.folderList.addEventListener('keydown', handleFolderKeydown);
elements.folderMenu.addEventListener('click', handleFolderMenuClick);
document.addEventListener('click', handleDocumentClick, true);
window.addEventListener('resize', () => {
  closeFolderMenu();
  closeAppMenu();
});
document.addEventListener('scroll', () => {
  closeFolderMenu();
  closeAppMenu();
}, true);

elements.appMenuButtons.forEach((button) => {
  button?.addEventListener('click', handleAppMenuToggle);
});
elements.logoutAction?.addEventListener('click', handleLogoutAction);
elements.clearArchiveAction?.addEventListener('click', handleClearArchive);
elements.floatingActionButton?.addEventListener('click', handleFloatingActionClick);
document.addEventListener('click', handleAppMenuDocumentClick, true);

elements.taskList.addEventListener('click', handleTaskListClick);
elements.taskList.addEventListener('change', handleTaskChange);
elements.taskList.addEventListener('dblclick', handleTaskDblClick);
elements.taskList.addEventListener('keydown', handleTaskKeydown);
elements.taskList.addEventListener('dragstart', handleDragStart);
elements.taskList.addEventListener('dragover', handleDragOver);
elements.taskList.addEventListener('dragend', handleDragEnd);

elements.backButton.addEventListener('click', () => showScreen('folders'));

document.addEventListener('keydown', handleGlobalKeydown);

function handleGlobalKeydown(event) {
  if (event.key === 'Escape') {
    if (appMenuState.visible) {
      closeAppMenu();
    }
    if (!elements.folderModal.classList.contains('hidden')) {
      event.preventDefault();
      closeFolderModal();
    }
    return;
  }

  if (event.key !== 'Enter') {
    return;
  }

  const target = event.target;
  const tagName = (target?.tagName || '').toLowerCase();
  const isEditable = target?.isContentEditable || tagName === 'input' || tagName === 'textarea';
  if (isEditable) {
    return;
  }
  if (currentScreen !== 'tasks') {
    return;
  }
  if (!elements.folderModal.classList.contains('hidden')) {
    return;
  }
  if (folderMenuState.visible) {
    return;
  }

  event.preventDefault();

  if (inlineComposer) {
    commitInlineTask(inlineComposer.input.value.trim());
  } else {
    handleAddTaskInline();
  }
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
    return;
  }

  const entering = screenName === 'folders' ? elements.screenFolders : elements.screenTasks;
  const leaving = screenName === 'folders' ? elements.screenTasks : elements.screenFolders;

  closeAppMenu();
  currentScreen = screenName;

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
  }

  state.ui.activeScreen = screenName;
  if (!skipPersist) {
    persistState();
  }
  renderFolders();
  updateFloatingAction();
}

function openFolderModal() {
  closeFolderMenu();
  elements.folderModalInput.value = '';
  clearInvalid(elements.folderModalInput);
  elements.folderModal.classList.remove('hidden');
  elements.modalBackdrop.classList.remove('hidden');
  requestAnimationFrame(() => {
    elements.folderModal.classList.add('show');
    elements.modalBackdrop.classList.add('show');
    elements.folderModalInput.focus({ preventScroll: true });
  });
}

function closeFolderModal() {
  elements.folderModal.classList.remove('show');
  elements.modalBackdrop.classList.remove('show');
  const hide = () => {
    elements.folderModal.classList.add('hidden');
    elements.modalBackdrop.classList.add('hidden');
    elements.folderModal.removeEventListener('transitionend', hide);
  };
  elements.folderModal.addEventListener('transitionend', hide, { once: true });
}

function handleFolderModalSubmit(event) {
  event.preventDefault();
  const title = elements.folderModalInput.value.trim();
  if (!title) {
    flagInvalid(elements.folderModalInput);
    elements.folderModalInput.focus({ preventScroll: true });
    return;
  }

  addFolder(title);
  closeFolderModal();
}

function addFolder(name) {
  const id = uid();
  state.folders.splice(state.folders.length - 1, 0, { id, name });
  ensureAllFolder(state);
  persistState();
  render();
  return id;
}

function handleFolderClick(event) {
  const menuButton = event.target.closest('.folder-menu-button');
  if (menuButton) {
    event.stopPropagation();
    const folderId = menuButton.closest('.folder-item')?.dataset.folderId;
    if (!folderId || folderId === ALL_FOLDER_ID) {
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
  selectFolder(folderId, { openTasks: true });
}

function handleFolderKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  const item = event.target.closest('.folder-item');
  if (!item) return;
  event.preventDefault();
  selectFolder(item.dataset.folderId, { openTasks: true });
}

function handleFolderMenuClick(event) {
  const action = event.target.dataset.action;
  if (!action || !folderMenuState.folderId) {
    return;
  }

  if (action === 'rename') {
    startFolderRename(folderMenuState.folderId);
  } else if (action === 'delete') {
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
  if (folderId === ALL_FOLDER_ID) {
    return;
  }
  editingFolderId = folderId;
  closeFolderMenu();
  renderFolders();
}

function deleteFolder(folderId) {
  if (folderId === ALL_FOLDER_ID) {
    return;
  }
  const index = state.folders.findIndex((item) => item.id === folderId);
  if (index === -1) {
    return;
  }

  state.folders.splice(index, 1);
  state.tasks = state.tasks.filter((task) => task.folderId !== folderId);
  state.archivedTasks = state.archivedTasks.filter((task) => task.folderId !== folderId);

  if (state.ui.selectedFolderId === folderId) {
    state.ui.selectedFolderId = ALL_FOLDER_ID;
    showScreen('folders');
  }

  ensureAllFolder(state);
  persistState();
  render();
}

function openFolderMenu(folderId, anchor) {
  closeAppMenu();
  folderMenuState.visible = true;
  folderMenuState.folderId = folderId;
  folderMenuAnchor = anchor;

  const menu = elements.folderMenu;
  menu.dataset.folderId = folderId;
  menu.classList.remove('hidden');
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

async function handleLogoutAction(event) {
  event.preventDefault();
  closeAppMenu();

  let logoutUrl = '/api/auth/logout';
  let redirectUrl = '/auth/';

  if (syncConfig?.baseUrl) {
    try {
      const target = new URL(syncConfig.baseUrl, window.location.origin);
      logoutUrl = `${target.origin}/api/auth/logout`;
      redirectUrl = `${target.origin}/auth/`;
    } catch (error) {
      console.warn('Todo sync: unable to resolve logout URL from config', error);
    }
  }

  try {
    await fetch(logoutUrl, { method: 'POST', credentials: 'include' });
  } catch (error) {
    console.warn('Todo sync: logout failed', error);
  } finally {
    window.location.href = redirectUrl;
  }
}

function handleClearArchive(event) {
  event.preventDefault();
  closeAppMenu();
  if (!state.archivedTasks.length) {
    return;
  }

  const confirmed = window.confirm('Очистить архив задач?');
  if (!confirmed) {
    return;
  }

  state.archivedTasks = [];
  persistState();

  if (state.ui.selectedFolderId === ARCHIVE_FOLDER_ID) {
    render();
  }
}

function handleFloatingActionClick() {
  closeAppMenu();
  if (currentScreen === 'folders') {
    openFolderModal();
  } else if (currentScreen === 'tasks') {
    handleAddTaskInline();
  }
}

function selectFolder(folderId, { openTasks = false, skipPersist = false } = {}) {
  if (!state.folders.some((folder) => folder.id === folderId)) {
    return;
  }
  state.ui.selectedFolderId = folderId;
  if (!skipPersist) {
    persistState();
  }
  render();
  if (openTasks) {
    showScreen('tasks');
  }
}

function handleAddTaskInline() {
  if (state.ui.selectedFolderId === ALL_FOLDER_ID || state.ui.selectedFolderId === ARCHIVE_FOLDER_ID) {
    return;
  }

  if (inlineComposer) {
    inlineComposer.input.focus({ preventScroll: true });
    inlineComposer.input.select();
    return;
  }

  const composer = createInlineComposer();
  inlineComposer = composer;
  elements.taskList.appendChild(composer.element);
  composer.element.scrollIntoView({ behavior: 'smooth', block: 'end' });
  elements.emptyState.classList.remove('visible');
  requestAnimationFrame(() => {
    composer.input.focus({ preventScroll: true });
  });
}

function createInlineComposer() {
  const item = document.createElement('li');
  item.className = 'entry-card task-item new-task';
  item.dataset.composer = 'true';
  item.setAttribute('draggable', 'false');

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
  input.placeholder = 'Введите задачу';

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'task-inline-confirm';
  confirmButton.textContent = '＋';

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
  confirmButton.addEventListener('click', commit);

  return { element: item, input };
}

function cancelInlineComposer(force = false) {
  if (!inlineComposer) {
    return;
  }
  if (!force && inlineComposer.input.value.trim()) {
    return;
  }
  inlineComposer.element.remove();
  inlineComposer = null;
  if (elements.taskList.children.length === 0) {
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

  const composerElement = inlineComposer.element;
  inlineComposer = null;
  composerElement.remove();

  createTask({ title: rawTitle });

  if (continueEntry) {
    requestAnimationFrame(() => {
      handleAddTaskInline();
    });
  }
}

function handleTaskListClick(event) {
  const removeButton = event.target.closest('.task-remove');
  if (removeButton) {
    removeButton.disabled = true;
    const item = removeButton.closest('.task-item');
    if (!item) return;
    const taskId = item.dataset.taskId;
    removeTaskFromArchive(taskId, item);
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

  if (state.ui.selectedFolderId === ARCHIVE_FOLDER_ID) {
    if (!event.target.checked) {
      event.target.disabled = true;
      restoreTaskFromArchive(taskId, item);
    } else {
      event.target.checked = true;
    }
    return;
  }

  event.target.disabled = true;
  markTaskCompleted(taskId, item);
}

function handleTaskDblClick(event) {
  const titleNode = event.target.closest('.task-title');
  if (!titleNode) return;
  beginTaskEdit(titleNode);
}

function handleTaskKeydown(event) {
  const titleNode = event.target.closest('.task-title');
  if (!titleNode) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    beginTaskEdit(titleNode);
  }
}

function animateTaskCollapse(item, callback, duration = 520) {
  const list = elements.taskList;
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

  const input = document.createElement('input');
  input.type = 'text';
  input.value = task.title;
  input.className = 'task-title-input';
  input.maxLength = 500;

  const finish = (shouldSave) => {
    if (shouldSave) {
      const newTitle = input.value.trim();
      if (!newTitle) {
        flagInvalid(input);
        input.focus({ preventScroll: true });
        return;
      }
      if (newTitle !== task.title) {
        task.title = newTitle;
        persistState();
      }
    }
    input.removeEventListener('blur', handleBlur);
    input.removeEventListener('keydown', handleKey);
    renderTasks();
  };

  const handleBlur = () => finish(true);
  const handleKey = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  };

  input.addEventListener('input', () => clearInvalid(input));
  input.addEventListener('blur', handleBlur);
  input.addEventListener('keydown', handleKey);

  titleNode.classList.add('editing');
  titleNode.after(input);
  input.focus({ preventScroll: true });
  input.select();
}


function restoreTaskFromArchive(taskId, item) {
  const archivedIndex = state.archivedTasks.findIndex((task) => task.id === taskId);
  if (archivedIndex === -1) {
    render();
    return;
  }

  const archivedTask = state.archivedTasks.splice(archivedIndex, 1)[0];

  item.classList.add('completed');
  const archivedTitle = item.querySelector('.task-title');
  archivedTitle?.classList.add('completed');

  animateTaskCollapse(item, () => {
    const folderId = archivedTask.folderId ?? 'inbox';
    const orders = state.tasks
      .filter((task) => task.folderId === folderId)
      .map((task) => task.order ?? 0);
    const nextOrder = orders.length ? Math.max(...orders) + 1 : 0;

    const restoredTask = {
      ...archivedTask,
      order: nextOrder
    };
    delete restoredTask.completedAt;

    state.tasks.push(restoredTask);

        persistState();
    render();
  });
}

function removeTaskFromArchive(taskId, item) {
  const archivedIndex = state.archivedTasks.findIndex((task) => task.id === taskId);
  if (archivedIndex === -1) {
    render();
    return;
  }

  state.archivedTasks.splice(archivedIndex, 1);

  item.classList.add('completed');
  const archivedTitle = item.querySelector('.task-title');
  archivedTitle?.classList.add('completed');

  animateTaskCollapse(item, () => {
        persistState();
    render();
  });
}

function markTaskCompleted(taskId, item) {
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task) return;

  const title = item.querySelector('.task-title');
  title?.classList.add('completed');
  item.classList.add('completed');

  animateTaskCollapse(item, () => {
    deleteTask(taskId);
  });
}

function deleteTask(taskId) {
  const taskIndex = state.tasks.findIndex((task) => task.id === taskId);
  let removedTask = null;
  if (taskIndex !== -1) {
    removedTask = state.tasks.splice(taskIndex, 1)[0];
  } else {
    const archivedIndex = state.archivedTasks.findIndex((task) => task.id === taskId);
    if (archivedIndex !== -1) {
      state.archivedTasks.splice(archivedIndex, 1);
      persistState();
      render();
      return;
    }
  }

  if (removedTask) {
    state.archivedTasks.unshift({
      ...removedTask,
      completedAt: Date.now()
    });
      } else {
      }

  persistState();
  render();
}

function handleDragStart(event) {
  const item = event.target.closest('.task-item');
  if (!item || item.dataset.composer || item.classList.contains('is-readonly')) {
    event.preventDefault();
    return;
  }
  draggingTaskId = item.dataset.taskId;
  item.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggingTaskId);
}

function handleDragOver(event) {
  if (!draggingTaskId) return;
  event.preventDefault();

  const draggingItem = elements.taskList.querySelector(`[data-task-id="${draggingTaskId}"]`);
  if (!draggingItem) return;

  const overItem = event.target.closest('.task-item');
  if (!overItem || overItem.dataset.composer) {
    elements.taskList.appendChild(draggingItem);
    return;
  }

  if (overItem === draggingItem) {
    return;
  }

  const overRect = overItem.getBoundingClientRect();
  const isAfter = event.clientY > overRect.top + overRect.height / 2;
  if (isAfter) {
    overItem.after(draggingItem);
  } else {
    overItem.before(draggingItem);
  }
}

function handleDragEnd() {
  const draggingItem = elements.taskList.querySelector(`[data-task-id="${draggingTaskId}"]`);
  if (draggingItem) {
    draggingItem.classList.remove('dragging');
  }

  if (draggingTaskId) {
    syncTaskOrder();
    renderTasks();
  }
  draggingTaskId = null;
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

function handleEmptyState(hasTasks) {
  if (!hasTasks) {
    elements.emptyState.classList.add('visible');

    const message = elements.emptyState.querySelector('.empty-message');
    if (state.ui.selectedFolderId === ARCHIVE_FOLDER_ID) {
      const illustration = elements.emptyState.querySelector('.empty-illustration');
      if (illustration) {
        illustration.remove();
      }
      if (message) {
        message.textContent = 'Архив пуст';
        message.style.display = '';
        message.dataset.state = 'archive';
      }
      return;
    }

    let illustration = elements.emptyState.querySelector('.empty-illustration');
    if (!illustration) {
      illustration = document.createElement('img');
      illustration.className = 'empty-illustration';
      elements.emptyState.appendChild(illustration);
    }
    illustration.src = resolveAssetPath('icons/gofima_success.png', { webPath: './gofima_success.png' });
    illustration.alt = 'Все задачи выполнены';

    if (message) {
      message.style.display = 'none';
      message.dataset.state = 'tasks';
    }
  } else {
    elements.emptyState.classList.remove('visible');
    const illustration = elements.emptyState.querySelector('.empty-illustration');
    if (illustration) {
      illustration.remove();
    }
    const message = elements.emptyState.querySelector('.empty-message');
    if (message) {
      delete message.dataset.state;
      message.style.display = '';
      message.textContent = 'Задач пока нет';
    }
  }
}

function renderFolders() {
  closeFolderMenu();
  elements.folderList.innerHTML = '';

  const counts = state.tasks.reduce((acc, task) => {
    acc[task.folderId] = (acc[task.folderId] ?? 0) + 1;
    acc[ALL_FOLDER_ID] = (acc[ALL_FOLDER_ID] ?? 0) + 1;
    return acc;
  }, {});

  counts[ARCHIVE_FOLDER_ID] = state.archivedTasks.length;

  const fragment = document.createDocumentFragment();

  state.folders.forEach((folder) => {
    const node = elements.folderTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.folderId = folder.id;
    const highlight = currentScreen === 'tasks' && state.ui.selectedFolderId === folder.id;
    node.classList.toggle('active', highlight);

    const content = node.querySelector('.folder-content');
    const nameSpan = node.querySelector('.folder-name');
    const countSpan = node.querySelector('.folder-count');
    const menuButton = node.querySelector('.folder-menu-button');

    const folderCount = counts[folder.id] ?? 0;
    countSpan.textContent = folderCount;
    if (folderCount === 0) {
      countSpan.style.display = 'none';
    } else {
      countSpan.style.display = '';
    }

    if (folder.id === ALL_FOLDER_ID || folder.id === ARCHIVE_FOLDER_ID) {
      menuButton.classList.add('hidden');
    }

    if (editingFolderId === folder.id) {
      node.classList.add('is-editing');
      menuButton.classList.add('hidden');

      const input = document.createElement('input');
      input.className = 'folder-edit-input';
      input.value = folder.name;
      input.maxLength = 60;

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
            ensureAllFolder(state);
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
    } else {
      nameSpan.textContent = folder.name;
    }

    fragment.appendChild(node);
  });

  elements.folderList.appendChild(fragment);
}

function renderTasks() {
  cancelInlineComposer(true);

  elements.taskList.innerHTML = '';
  const selectedFolder = state.ui.selectedFolderId;
  const isAllFolder = selectedFolder === ALL_FOLDER_ID;

  let tasks = [];
  const showFolderLabels = isAllFolder || selectedFolder === ARCHIVE_FOLDER_ID;

  if (selectedFolder === ARCHIVE_FOLDER_ID) {
    tasks = state.archivedTasks
      .slice()
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  } else {
    tasks = state.tasks
      .filter((task) => isAllFolder || task.folderId === selectedFolder)
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
  handleEmptyState(hadTasks);

  const fragment = document.createDocumentFragment();

  tasks.forEach((task) => {
    const node = elements.taskTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.taskId = task.id;
    const isReadonly = isAllFolder || selectedFolder === ARCHIVE_FOLDER_ID;
    node.classList.toggle('is-readonly', isReadonly);
    node.classList.toggle('is-archive', selectedFolder === ARCHIVE_FOLDER_ID);
    node.setAttribute('draggable', isReadonly ? 'false' : 'true');

    const title = node.querySelector('.task-title');
    const folderLabel = node.querySelector('.task-folder-label');
    const checkbox = node.querySelector('.checkbox input');

    title.textContent = task.title;
    if (showFolderLabels) {
      folderLabel.textContent = getFolderName(task.folderId);
      node.classList.add('show-folder');
    } else {
      folderLabel.textContent = '';
      node.classList.remove('show-folder');
    }

    if (selectedFolder === ARCHIVE_FOLDER_ID) {
      checkbox.checked = true;
      checkbox.disabled = false;
    } else {
      checkbox.checked = false;
      checkbox.disabled = false;
    }

    fragment.appendChild(node);
  });

  elements.taskList.appendChild(fragment);

  const folder = state.folders.find((item) => item.id === selectedFolder);
  elements.tasksHeaderTitle.textContent = folder?.name ?? 'Папка';

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
    fab.dataset.mode = 'folder';
    fab.setAttribute('aria-label', 'Создать папку');
    fab.textContent = '＋';
    return;
  }

  if (currentScreen === 'tasks') {
    const selectedFolder = state.ui.selectedFolderId;
    const disableAdd = selectedFolder === ALL_FOLDER_ID || selectedFolder === ARCHIVE_FOLDER_ID;
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

function getFolderName(folderId) {
  return state.folders.find((folder) => folder.id === folderId)?.name ?? 'Папка';
}

function focusTaskTitle(taskId) {
  requestAnimationFrame(() => {
    const node = elements.taskList.querySelector(`[data-task-id="${taskId}"] .task-title`);
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
  ensureAllFolder(state);
  saveState(state);
}

function createTask({ title }) {
  const folderId = state.ui.selectedFolderId;
  const orders = state.tasks
    .filter((task) => task.folderId === folderId)
    .map((task) => task.order ?? 0);
  const nextOrder = orders.length ? Math.max(...orders) + 1 : 0;

  const id = uid();
  state.tasks.push({
    id,
    title,
    folderId,
    createdAt: Date.now(),
    order: nextOrder
  });

  lastCreatedTaskId = id;
  persistState();
  render();
  return id;
}

function render() {
  renderFolders();
  renderTasks();
  updateFloatingAction();
}

syncManager = createSyncManager({
  getState: () => state,
  applyRemoteState
});

if (syncManager.enabled) {
  let initialResult = null;
  if (syncConfig.pullOnStartup !== false) {
    initialResult = await syncManager.pullInitial();
  }

  if (typeof syncManager.startPolling === 'function') {
    syncManager.startPolling();
  }

  if (initialResult?.notFound) {
    const fresh = defaultState();
    state.folders = fresh.folders;
    state.tasks = fresh.tasks;
    state.archivedTasks = fresh.archivedTasks;
    state.ui = { ...state.ui, ...fresh.ui };
    state.meta = { ...fresh.meta };
    ensureAllFolder(state);
    await saveState(state, { skipRemote: true, updateMeta: false });
    await syncManager.forcePush();
  }
}

render();
const initialScreen = state.ui.activeScreen === 'tasks' ? 'tasks' : 'folders';
showScreen(initialScreen, { skipPersist: true });
const USER_ID_STORAGE_KEY = 'todoAuthUserId';

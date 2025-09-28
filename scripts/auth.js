const STORAGE_TOKEN_KEY = 'todoAuthToken';
const STORAGE_USER_KEY = 'todoAuthUser';

const isChromeExtension = typeof chrome !== 'undefined' && chrome.storage?.local;

let currentToken = null;
let currentUser = null;
const listeners = new Set();

function emit() {
  const snapshot = { token: currentToken, user: currentUser };
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('Auth store listener failed', error);
    }
  });
}

function normalizeUser(user) {
  if (!user) {
    return null;
  }
  if (typeof user === 'string') {
    return { email: user };
  }
  if (user.email) {
    return { email: user.email };
  }
  return null;
}

function readLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn('Auth store: unable to read localStorage', error);
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch (error) {
    console.warn('Auth store: unable to write localStorage', error);
  }
}

function readChromeStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (items) => {
      if (chrome.runtime?.lastError) {
        console.warn('Auth store: unable to read chrome.storage', chrome.runtime.lastError);
        resolve({});
        return;
      }
      resolve(items || {});
    });
  });
}

function writeChromeStorage(entries) {
  return new Promise((resolve) => {
    chrome.storage.local.set(entries, () => {
      if (chrome.runtime?.lastError) {
        console.warn('Auth store: unable to write chrome.storage', chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

function removeChromeStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime?.lastError) {
        console.warn('Auth store: unable to remove chrome.storage', chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

async function loadFromStorage() {
  console.log('📋 AuthStore: loadFromStorage() called, isChromeExtension:', isChromeExtension);
  
  if (isChromeExtension) {
    const items = await readChromeStorage([STORAGE_TOKEN_KEY, STORAGE_USER_KEY]);
    console.log('📋 AuthStore: chrome storage items:', items);
    currentToken = items[STORAGE_TOKEN_KEY] ?? null;
    currentUser = normalizeUser(items[STORAGE_USER_KEY]);
    return;
  }
  currentToken = readLocalStorage(STORAGE_TOKEN_KEY);
  const rawUser = readLocalStorage(STORAGE_USER_KEY);
  console.log('📋 AuthStore: localStorage data - token:', !!currentToken, 'rawUser:', rawUser);
  currentUser = rawUser ? normalizeUser(JSON.parse(rawUser)) : null;
}

async function persistToStorage() {
  if (isChromeExtension) {
    if (currentToken || currentUser) {
      await writeChromeStorage({
        [STORAGE_TOKEN_KEY]: currentToken ?? null,
        [STORAGE_USER_KEY]: currentUser ?? null
      });
    } else {
      await removeChromeStorage([STORAGE_TOKEN_KEY, STORAGE_USER_KEY]);
    }
    return;
  }
  if (currentToken) {
    writeLocalStorage(STORAGE_TOKEN_KEY, currentToken);
  } else {
    writeLocalStorage(STORAGE_TOKEN_KEY, null);
  }
  if (currentUser) {
    writeLocalStorage(STORAGE_USER_KEY, JSON.stringify(currentUser));
  } else {
    writeLocalStorage(STORAGE_USER_KEY, null);
  }
}

export const authStore = {
  async init() {
    console.log('🔑 AuthStore: init() called');
    await loadFromStorage();
    console.log('🔑 AuthStore: loaded from storage, token:', !!currentToken, 'user:', currentUser);
    return { token: currentToken, user: currentUser };
  },
  getToken() {
    return currentToken;
  },
  getUser() {
    return currentUser;
  },
  async setSession(session) {
    currentToken = session?.token ?? null;
    currentUser = normalizeUser(session?.user);
    await persistToStorage();
    emit();
  },
  async clearSession() {
    currentToken = null;
    currentUser = null;
    await persistToStorage();
    emit();
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};

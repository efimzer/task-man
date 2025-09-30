const STORAGE_TOKEN_KEY = 'todoAuthToken';
const STORAGE_USER_KEY = 'todoAuthUser';
const COOKIE_URL = 'https://task-man-rf22.onrender.com';
const TOKEN_COOKIE_NAME = 'todo_token'; // Исправлено: было 'token', должно быть 'todo_token'

const isChromeExtension = typeof chrome !== 'undefined' && chrome.storage?.local;
const hasCookieAPI = typeof chrome !== 'undefined' && chrome.cookies;

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

async function getTokenFromCookie() {
  if (!hasCookieAPI) {
    return null;
  }
  
  try {
    const cookie = await chrome.cookies.get({
      url: COOKIE_URL,
      name: TOKEN_COOKIE_NAME
    });
    return cookie?.value || null;
  } catch (error) {
    console.warn('Auth store: unable to read cookie', error);
    return null;
  }
}

async function loadFromStorage() {
  console.log('📋 AuthStore: loadFromStorage() called, isChromeExtension:', isChromeExtension);
  
  if (isChromeExtension) {
    // В расширении: сначала проверяем chrome.storage, потом cookies
    const items = await readChromeStorage([STORAGE_TOKEN_KEY, STORAGE_USER_KEY]);
    console.log('📋 AuthStore: chrome storage items:', items);
    
    currentToken = items[STORAGE_TOKEN_KEY] ?? null;
    currentUser = normalizeUser(items[STORAGE_USER_KEY]);
    
    // Если токена нет в storage, проверим cookie
    if (!currentToken) {
      console.log('📋 AuthStore: No token in storage, checking cookie...');
      currentToken = await getTokenFromCookie();
      if (currentToken) {
        console.log('✅ AuthStore: Found token in cookie, saving to storage');
        await writeChromeStorage({
          [STORAGE_TOKEN_KEY]: currentToken
        });
      }
    }
    
    return;
  }
  
  // В веб-версии: используем только localStorage
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
  
  // В веб-версии: сохраняем И token И user в localStorage
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
    
    // Подписываемся на изменения в chrome.storage (для синхронизации)
    if (isChromeExtension) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (changes[STORAGE_TOKEN_KEY]) {
            const newToken = changes[STORAGE_TOKEN_KEY].newValue;
            if (newToken !== currentToken) {
              console.log('🔔 AuthStore: Token changed in storage, updating...');
              currentToken = newToken || null;
              emit();
            }
          }
          if (changes[STORAGE_USER_KEY]) {
            const newUser = normalizeUser(changes[STORAGE_USER_KEY].newValue);
            if (JSON.stringify(newUser) !== JSON.stringify(currentUser)) {
              console.log('🔔 AuthStore: User changed in storage, updating...');
              currentUser = newUser;
              emit();
            }
          }
        }
      });
    }
    
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

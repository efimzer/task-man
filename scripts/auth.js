const STORAGE_TOKEN_KEY = 'todoAuthToken';
const STORAGE_USER_KEY = 'todoAuthUser';
const COOKIE_URL = 'https://gofima.online/web/';
const TOKEN_COOKIE_NAME = 'todo_token'; // Исправлено: было 'token', должно быть 'todo_token'
const BROWSER_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 дней

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

function setBrowserCookie(name, value, { maxAge = BROWSER_COOKIE_MAX_AGE } = {}) {
  if (typeof document === 'undefined') {
    return;
  }
  try {
    const encoded = encodeURIComponent(value);
    document.cookie = `${name}=${encoded}; max-age=${maxAge}; path=/; SameSite=Lax`;
  } catch (error) {
    console.warn('Auth store: unable to set browser cookie', error);
  }
}

function deleteBrowserCookie(name) {
  if (typeof document === 'undefined') {
    return;
  }
  try {
    document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`;
  } catch (error) {
    console.warn('Auth store: unable to delete browser cookie', error);
  }
}

function readBrowserCookie(name) {
  if (typeof document === 'undefined') {
    return null;
  }
  try {
    return document.cookie
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.split('='))
      .find(([key]) => key === name)?.[1] || null;
  } catch (error) {
    console.warn('Auth store: unable to read browser cookie', error);
    return null;
  }
}

async function setExtensionCookie(value) {
  if (!hasCookieAPI) {
    return;
  }
  try {
    const expirationDate = Math.floor(Date.now() / 1000) + BROWSER_COOKIE_MAX_AGE;
    await chrome.cookies.set({
      url: COOKIE_URL,
      name: TOKEN_COOKIE_NAME,
      value,
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
      expirationDate
    });
  } catch (error) {
    console.warn('Auth store: unable to set extension cookie', error);
  }
}

async function deleteExtensionCookie() {
  if (!hasCookieAPI) {
    return;
  }
  try {
    await chrome.cookies.remove({
      url: COOKIE_URL,
      name: TOKEN_COOKIE_NAME
    });
  } catch (error) {
    console.warn('Auth store: unable to delete extension cookie', error);
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
  if (!currentToken) {
    const cookieToken = readBrowserCookie(TOKEN_COOKIE_NAME);
    if (cookieToken) {
      currentToken = decodeURIComponent(cookieToken);
      console.log('📋 AuthStore: recovered token from browser cookie');
    }
  }
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

    if (currentToken) {
      await setExtensionCookie(currentToken);
    } else {
      await deleteExtensionCookie();
    }
    return;
  }
  
  // В веб-версии: сохраняем И token И user в localStorage
  if (currentToken) {
    writeLocalStorage(STORAGE_TOKEN_KEY, currentToken);
    setBrowserCookie(TOKEN_COOKIE_NAME, currentToken);
  } else {
    writeLocalStorage(STORAGE_TOKEN_KEY, null);
    deleteBrowserCookie(TOKEN_COOKIE_NAME);
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

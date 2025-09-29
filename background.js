const COOKIE_DOMAIN = 'task-man-rf22.onrender.com';
const COOKIE_URL = 'https://task-man-rf22.onrender.com';
const TOKEN_COOKIE_NAME = 'token';
const STORAGE_TOKEN_KEY = 'todoAuthToken';
const STORAGE_USER_KEY = 'todoAuthUser';

const enableSidePanel = () => {
  if (!chrome.sidePanel) {
    return;
  }

  chrome.sidePanel.setOptions({
    path: 'sidepanel.html',
    enabled: true
  }).catch((error) => {
    console.warn('Unable to set side panel options:', error);
  });
};

// Синхронизация cookies -> chrome.storage
async function syncCookieToStorage() {
  try {
    console.log('🔄 Background: Syncing cookie to storage...');
    
    const cookie = await chrome.cookies.get({
      url: COOKIE_URL,
      name: TOKEN_COOKIE_NAME
    });

    if (cookie?.value) {
      console.log('✅ Background: Found cookie, saving to storage');
      await chrome.storage.local.set({
        [STORAGE_TOKEN_KEY]: cookie.value
      });
    } else {
      console.log('❌ Background: No cookie found, clearing storage');
      await chrome.storage.local.remove([STORAGE_TOKEN_KEY, STORAGE_USER_KEY]);
    }
  } catch (error) {
    console.warn('Background: Cookie sync failed', error);
  }
}

// Слушаем изменения cookies
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.cookie.name === TOKEN_COOKIE_NAME && 
      changeInfo.cookie.domain.includes(COOKIE_DOMAIN)) {
    console.log('🍪 Background: Cookie changed:', changeInfo);
    
    if (changeInfo.removed) {
      console.log('🗑️ Background: Cookie removed, clearing storage');
      chrome.storage.local.remove([STORAGE_TOKEN_KEY, STORAGE_USER_KEY]);
    } else {
      console.log('💾 Background: Cookie set, syncing to storage');
      syncCookieToStorage();
    }
  }
});

// Слушаем изменения в chrome.storage (от расширения)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    console.log('📦 Background: Storage changed:', changes);
    
    // Если токен удален из storage, удалим и cookie
    if (changes[STORAGE_TOKEN_KEY] && !changes[STORAGE_TOKEN_KEY].newValue) {
      console.log('🗑️ Background: Token removed from storage, removing cookie');
      chrome.cookies.remove({
        url: COOKIE_URL,
        name: TOKEN_COOKIE_NAME
      }).catch((error) => {
        console.warn('Background: Failed to remove cookie', error);
      });
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanel();
  // Синхронизируем при установке
  syncCookieToStorage();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanel();
  // Синхронизируем при запуске
  syncCookieToStorage();
});

chrome.action.onClicked.addListener(async (tab) => {
  // Синхронизируем при открытии
  await syncCookieToStorage();
  
  if (chrome.sidePanel && tab?.windowId !== undefined) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return;
    } catch (error) {
      console.warn('Unable to open side panel:', error);
    }
  }

  // Fallback: open the UI in a new tab if side panel API is unavailable
  chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
});

console.log('🚀 Background script loaded');

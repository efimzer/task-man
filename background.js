// Supabase configuration
const SUPABASE_URL = 'https://jkyhbvihckgsinhoygey.supabase.co';
const STORAGE_SESSION_KEY = 'supabase.auth.token';

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

// Проверяем наличие сессии Supabase
async function checkSupabaseSession() {
  try {
    console.log('🔄 Background: Checking Supabase session...');
    
    const storage = await chrome.storage.local.get(STORAGE_SESSION_KEY);
    const session = storage[STORAGE_SESSION_KEY];

    if (session) {
      console.log('✅ Background: Supabase session found');
    } else {
      console.log('❌ Background: No Supabase session');
    }
  } catch (error) {
    console.warn('Background: Session check failed', error);
  }
}

// Слушаем изменения в chrome.storage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    console.log('📦 Background: Storage changed:', Object.keys(changes));
    
    // Логируем изменения в сессии Supabase
    if (changes[STORAGE_SESSION_KEY]) {
      const hasSession = !!changes[STORAGE_SESSION_KEY].newValue;
      console.log(`🔐 Background: Supabase session ${hasSession ? 'set' : 'removed'}`);
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('🚀 Extension installed');
  enableSidePanel();
  checkSupabaseSession();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('🚀 Extension started');
  enableSidePanel();
  checkSupabaseSession();
});

chrome.action.onClicked.addListener(async (tab) => {
  console.log('👆 Extension icon clicked');
  
  // Проверяем сессию при открытии
  checkSupabaseSession();
  
  // Открываем side panel
  if (chrome.sidePanel && tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
      console.warn('Unable to open side panel:', error);
    });
  }
});

console.log('🚀 Background script loaded (Supabase mode)');

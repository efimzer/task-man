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

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanel();
});

chrome.action.onClicked.addListener(async (tab) => {
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

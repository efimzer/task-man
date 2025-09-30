// Settings management
const SETTINGS_KEY = 'todoSettings';

const defaultSettings = {
  darkMode: false,
  showCounter: true,
  showArchive: true
};

class SettingsManager {
  constructor() {
    this.settings = { ...defaultSettings };
    this.listeners = new Set();
  }

  async init() {
    await this.load();
    this.applyDarkMode();
  }

  async load() {
    try {
      const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage?.local;
      
      if (hasChromeStorage) {
        const result = await chrome.storage.local.get(SETTINGS_KEY);
        if (result[SETTINGS_KEY]) {
          this.settings = { ...defaultSettings, ...result[SETTINGS_KEY] };
        }
      } else {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (stored) {
          this.settings = { ...defaultSettings, ...JSON.parse(stored) };
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async save() {
    try {
      const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage?.local;
      
      if (hasChromeStorage) {
        await chrome.storage.local.set({ [SETTINGS_KEY]: this.settings });
      } else {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      }
      
      this.notifyListeners();
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  get(key) {
    return this.settings[key];
  }

  async set(key, value) {
    this.settings[key] = value;
    await this.save();
    
    // Apply specific settings immediately
    if (key === 'darkMode') {
      this.applyDarkMode();
    }
  }

  applyDarkMode() {
    if (this.settings.darkMode) {
      document.documentElement.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners() {
    this.listeners.forEach(listener => {
      try {
        listener(this.settings);
      } catch (error) {
        console.error('Settings listener error:', error);
      }
    });
  }

  getAll() {
    return { ...this.settings };
  }
}

export const settingsManager = new SettingsManager();

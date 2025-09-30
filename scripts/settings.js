// Settings management
const SETTINGS_KEY = 'todoSettings';

const defaultSettings = {
  autoTheme: true,
  darkMode: false,
  showCounter: true,
  showArchive: true
};

class SettingsManager {
  constructor() {
    this.settings = { ...defaultSettings };
    this.listeners = new Set();
    this.systemPreference = null;
    this.handleSystemPreferenceChange = (event) => {
      if (!this.settings.autoTheme) {
        return;
      }
      const prefersDark = typeof event?.matches === 'boolean'
        ? event.matches
        : this.systemPreference?.matches;
      this.applyDarkMode(prefersDark);
      this.notifyListeners();
    };
  }

  async init() {
    await this.load();
    this.setupSystemPreferenceListener();
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
    if (key === 'darkMode' || key === 'autoTheme') {
      this.applyDarkMode();
    }
  }

  setupSystemPreferenceListener() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    if (this.systemPreference) {
      return;
    }
    this.systemPreference = window.matchMedia('(prefers-color-scheme: dark)');
    if (typeof this.systemPreference.addEventListener === 'function') {
      this.systemPreference.addEventListener('change', this.handleSystemPreferenceChange);
    } else if (typeof this.systemPreference.addListener === 'function') {
      this.systemPreference.addListener(this.handleSystemPreferenceChange);
    }
  }

  isDarkModeActive() {
    if (this.settings.autoTheme) {
      if (this.systemPreference) {
        return this.systemPreference.matches;
      }
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
    }
    return Boolean(this.settings.darkMode);
  }

  applyDarkMode(forceValue) {
    const root = document.documentElement;
    const useAuto = this.settings.autoTheme;
    const isDark = typeof forceValue === 'boolean' ? forceValue : this.isDarkModeActive();
    root.classList.toggle('dark-mode', isDark);
    root.classList.toggle('light-mode', !isDark);
    root.dataset.themeMode = useAuto ? 'system' : (isDark ? 'dark' : 'light');
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners() {
    if (!this.listeners.size) {
      return;
    }
    const snapshot = this.getAll();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
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

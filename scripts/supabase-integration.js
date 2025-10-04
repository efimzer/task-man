/**
 * Адаптер для интеграции Supabase в существующий код
 * Этот файл обеспечивает совместимость между старым API и новым Supabase
 */

import { supabaseAuth } from './supabase-auth.js';
import { supabaseSync } from './supabase-sync.js';
import { getCurrentUser, isAuthenticated } from './supabase-client.js';

/**
 * Адаптер authStore для работы с Supabase
 * Совместим с существующим кодом, который использует authStore
 */
export const authStoreAdapter = {
  _listeners: new Set(),
  _currentUser: null,

  async init() {
    console.log('🔑 AuthStore (Supabase): init()');
    
    // Проверяем текущую сессию
    const user = await getCurrentUser();
    this._currentUser = user;
    
    // Подписываемся на изменения auth состояния
    supabaseAuth.onAuthStateChange((event, session) => {
      console.log('🔐 Auth state changed:', event);
      
      this._currentUser = session?.user || null;
      
      // Уведомляем всех подписчиков
      this._notifyListeners();
    });

    return this._currentUser;
  },

  async login(email, password) {
    console.log('🔐 AuthStore (Supabase): login()');
    const { user, session } = await supabaseAuth.signIn(email, password);
    this._currentUser = user;
    this._notifyListeners();
    return { user, session };
  },

  async register(email, password) {
    console.log('📝 AuthStore (Supabase): register()');
    const { user, session } = await supabaseAuth.signUp(email, password);
    this._currentUser = user;
    this._notifyListeners();
    return { user, session };
  },

  async logout() {
    console.log('🚪 AuthStore (Supabase): logout()');
    await supabaseAuth.signOut();
    this._currentUser = null;
    this._notifyListeners();
  },

  getUser() {
    return this._currentUser;
  },

  async isAuthenticated() {
    return await isAuthenticated();
  },

  subscribe(callback) {
    this._listeners.add(callback);
    
    // Сразу вызываем callback с текущим пользователем
    callback(this._currentUser);

    // Возвращаем функцию отписки
    return () => {
      this._listeners.delete(callback);
    };
  },

  _notifyListeners() {
    this._listeners.forEach(callback => {
      callback(this._currentUser);
    });
  }
};

/**
 * Адаптер syncManager для работы с Supabase
 * Совместим с существующим кодом
 */
export const syncManagerAdapter = {
  _realtimeChannel: null,
  _onStateUpdate: null,

  async loadState() {
    console.log('📥 SyncManager (Supabase): loadState()');
    return await supabaseSync.loadState();
  },

  async saveState(state) {
    console.log('💾 SyncManager (Supabase): saveState()');
    await supabaseSync.saveState(state);
  },

  async startSync(onStateUpdate) {
    console.log('🔄 SyncManager (Supabase): startSync()');
    this._onStateUpdate = onStateUpdate;
    
    // Подписываемся на realtime обновления
    this._realtimeChannel = await supabaseSync.subscribe((newState) => {
      console.log('🔔 Realtime update received');
      if (this._onStateUpdate) {
        this._onStateUpdate(newState);
      }
    });
  },

  async stopSync() {
    console.log('⏹️ SyncManager (Supabase): stopSync()');
    await supabaseSync.unsubscribe();
    this._realtimeChannel = null;
    this._onStateUpdate = null;
  },

  // Для совместимости со старым API
  setStatus() {
    // Supabase не требует явного управления статусом
  },

  getStatus() {
    return { syncing: false, error: null };
  }
};

/**
 * Функция для миграции данных со старого бэкенда на Supabase
 */
export async function migrateFromOldBackend(oldToken, email, password) {
  try {
    console.log('🔄 Starting migration from old backend...');
    
    // 1. Получаем данные со старого API
    const response = await fetch('https://task-man-rf22.onrender.com/state', {
      headers: {
        'Authorization': `Bearer ${oldToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch old state');
    }

    const oldState = await response.json();
    console.log('✅ Old state fetched');

    // 2. Входим в Supabase (или регистрируемся)
    try {
      await supabaseAuth.signIn(email, password);
    } catch (error) {
      if (error.message.includes('Invalid login')) {
        // Пользователь не существует, создаём
        await supabaseAuth.signUp(email, password);
      } else {
        throw error;
      }
    }
    console.log('✅ Authenticated in Supabase');

    // 3. Сохраняем данные в Supabase
    await supabaseSync.saveState({
      meta: oldState.meta || { version: 0, updatedAt: Date.now() },
      folders: oldState.folders || [],
      tasks: oldState.tasks || [],
      archivedTasks: oldState.archivedTasks || [],
      ui: oldState.ui || {}
    });
    console.log('✅ State saved to Supabase');

    console.log('🎉 Migration completed successfully!');
    return true;
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

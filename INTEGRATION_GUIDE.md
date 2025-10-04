# Инструкция по интеграции Supabase

## ✅ Что уже сделано

1. **manifest.json** - обновлен для работы с Supabase
2. **background.js** - переписан для работы без cookies
3. **Supabase модули созданы**:
   - `scripts/supabase-client.js` - клиент Supabase
   - `scripts/supabase-auth.js` - аутентификация
   - `scripts/supabase-sync.js` - синхронизация данных
   - `scripts/supabase-integration.js` - адаптеры для совместимости

## 🔧 Что нужно сделать

### 1. Проверить настройки Supabase

Откройте `scripts/supabase-client.js` и убедитесь, что указаны правильные данные:

```javascript
const SUPABASE_URL = 'https://jkyhbvihckgsinhoygey.supabase.co';
const SUPABASE_ANON_KEY = 'ваш-ключ-здесь';
```

### 2. Создать таблицу в Supabase

Выполните SQL из файла `SUPABASE_MIGRATION.md` в Supabase SQL Editor.

### 3. Обновить sidepanel.js

Ваш `sidepanel.js` уже импортирует модули Supabase. Нужно переключить флаг:

```javascript
// В начале файла sidepanel.js найдите:
const USE_SUPABASE = true;  // ✅ Должно быть true
```

Проверьте, что функции используют Supabase версии:

```javascript
// Пример: замените старый код на новый

// БЫЛО (старый MongoDB/Render бэкенд):
import { createSyncManager } from './sync.js';
const syncManager = createSyncManager({...});

// СТАЛО (Supabase):
import { syncManagerAdapter } from './supabase-integration.js';
const syncManager = syncManagerAdapter;
```

### 4. Обновить обработчики аутентификации

Замените обработчики входа/регистрации на Supabase версии:

```javascript
// БЫЛО:
async function handleLogin(email, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  // ...
}

// СТАЛО:
import { authStoreAdapter } from './supabase-integration.js';

async function handleAuthSubmit(e) {
  e.preventDefault();
  
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  
  try {
    if (authMode === 'login') {
      await authStoreAdapter.login(email, password);
    } else {
      await authStoreAdapter.register(email, password);
    }
    
    // После успешного входа
    await initApp();
    
  } catch (error) {
    console.error('Auth error:', error);
    showAuthError(error.message);
  }
}
```

### 5. Настроить подписку на realtime обновления

```javascript
// После успешного входа:
await syncManagerAdapter.startSync((newState) => {
  console.log('🔔 Получено обновление в реальном времени!');
  
  // Обновляем UI
  setState(newState);
  renderFolderList();
  if (currentScreen === 'tasks') {
    renderTaskList();
  }
});
```

### 6. Обновить функции сохранения

```javascript
// БЫЛО:
async function saveState() {
  await syncManager.pushState(state);
}

// СТАЛО:
async function saveState() {
  await syncManagerAdapter.saveState(getState());
}
```

## 📝 Пример полного flow в sidepanel.js

```javascript
// ============================================
// 1. Импорты
// ============================================
import { authStoreAdapter, syncManagerAdapter } from './supabase-integration.js';

// ============================================
// 2. Инициализация при загрузке
// ============================================
async function initApp() {
  console.log('🚀 Starting app (Supabase mode)...');
  
  // Инициализируем auth
  const user = await authStoreAdapter.init();
  
  if (!user) {
    // Показываем форму входа
    showAuthOverlay();
    return;
  }
  
  console.log('✅ User authenticated:', user.email);
  
  // Загружаем состояние
  showLoadingIndicator('Загрузка данных...');
  const state = await syncManagerAdapter.loadState();
  
  if (state) {
    setState(state);
  } else {
    // Создаём начальное состояние
    setState(defaultState());
    await syncManagerAdapter.saveState(getState());
  }
  
  hideLoadingIndicator();
  
  // Подписываемся на realtime обновления
  await syncManagerAdapter.startSync((newState) => {
    console.log('🔔 Realtime update received');
    setState(newState);
    renderFolderList();
    if (currentScreen === 'tasks') {
      renderTaskList();
    }
  });
  
  // Показываем приложение
  hideAuthOverlay();
  renderFolderList();
}

// ============================================
// 3. Обработчики аутентификации
// ============================================
async function handleAuthSubmit(e) {
  e.preventDefault();
  
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  
  try {
    if (authMode === 'login') {
      await authStoreAdapter.login(email, password);
    } else {
      await authStoreAdapter.register(email, password);
    }
    
    // После успешного входа перезагружаем приложение
    await initApp();
    
  } catch (error) {
    console.error('Auth error:', error);
    showAuthError(error.message || 'Ошибка входа');
  }
}

async function handleLogout() {
  try {
    // Останавливаем синхронизацию
    await syncManagerAdapter.stopSync();
    
    // Выходим
    await authStoreAdapter.logout();
    
    // Очищаем состояние
    setState(defaultState());
    
    // Показываем форму входа
    showAuthOverlay();
    
  } catch (error) {
    console.error('Logout error:', error);
  }
}

// ============================================
// 4. Сохранение изменений
// ============================================
async function addTask(taskData) {
  const state = getState();
  
  // Добавляем задачу
  const newTask = {
    id: crypto.randomUUID(),
    ...taskData,
    createdAt: Date.now()
  };
  
  state.tasks.push(newTask);
  state.meta.version++;
  state.meta.updatedAt = Date.now();
  
  setState(state);
  
  // Сохраняем в Supabase
  await syncManagerAdapter.saveState(state);
  
  // Обновляем UI
  renderTaskList();
}

async function updateTask(taskId, updates) {
  const state = getState();
  
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  
  Object.assign(task, updates);
  state.meta.version++;
  state.meta.updatedAt = Date.now();
  
  setState(state);
  
  // Сохраняем в Supabase
  await syncManagerAdapter.saveState(state);
  
  // Обновляем UI
  renderTaskList();
}

async function deleteTask(taskId) {
  const state = getState();
  
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  state.meta.version++;
  state.meta.updatedAt = Date.now();
  
  setState(state);
  
  // Сохраняем в Supabase
  await syncManagerAdapter.saveState(state);
  
  // Обновляем UI
  renderTaskList();
}

// ============================================
// 5. Запуск приложения
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initElements();
  initEventListeners();
  initApp();
});
```

## 🧪 Тестирование

### Тест 1: Регистрация
1. Откройте расширение
2. Нажмите "Регистрация"
3. Введите email и пароль
4. Должно создаться:
   - Пользователь в Supabase Auth
   - Запись в таблице `states`

### Тест 2: Вход
1. Перезагрузите расширение
2. Введите email и пароль
3. Должно:
   - Войти без ошибок
   - Загрузить сохранённое состояние

### Тест 3: Realtime синхронизация
1. Откройте расширение в двух окнах/вкладках
2. Войдите под одним аккаунтом в обоих
3. Создайте задачу в первом окне
4. В консоли второго окна должно появиться:
   ```
   🔔 Realtime update received
   ```
5. Задача должна **мгновенно** появиться во втором окне

### Тест 4: Выход
1. Нажмите "Выйти" в меню
2. Должно:
   - Остановить realtime подписку
   - Очистить сессию
   - Показать форму входа

## 🐛 Отладка

### Проблема: "Failed to fetch"
- Проверьте SUPABASE_URL и SUPABASE_ANON_KEY
- Убедитесь, что домен в `manifest.json` совпадает с SUPABASE_URL

### Проблема: "Row Level Security"
- Выполните SQL скрипт из `SUPABASE_MIGRATION.md`
- Проверьте, что RLS включён и политики созданы

### Проблема: Realtime не работает
1. В Supabase Dashboard → Database → Replication
2. Убедитесь, что `states` добавлена в `supabase_realtime` publication
3. Проверьте в консоли:
   ```
   📡 Subscription status: SUBSCRIBED
   ```

### Проблема: Дублирование данных
- Проверьте, что используется `upsert` с `onConflict: 'user_id'`
- В БД не должно быть нескольких записей с одним `user_id`

## 📊 Проверка в Supabase Dashboard

1. **Table Editor → states**
   - Должны видеть записи пользователей
   - Каждая запись содержит: folders, tasks, archived_tasks, ui

2. **Authentication → Users**
   - Список зарегистрированных пользователей

3. **Database → Replication**
   - `states` должна быть в списке Realtime tables

## 🎯 Следующие шаги

1. ✅ Создайте таблицу в Supabase (SQL из `SUPABASE_MIGRATION.md`)
2. ✅ Проверьте ключи в `supabase-client.js`
3. 🔄 Обновите `sidepanel.js` (используйте адаптеры)
4. 🧪 Протестируйте вход/регистрацию
5. 🧪 Протестируйте realtime синхронизацию
6. 🚀 Готово!

## 💡 Полезные команды

```javascript
// Проверить текущего пользователя
const user = await authStoreAdapter.getUser();
console.log('Current user:', user);

// Проверить аутентификацию
const isAuth = await authStoreAdapter.isAuthenticated();
console.log('Is authenticated:', isAuth);

// Загрузить состояние вручную
const state = await syncManagerAdapter.loadState();
console.log('State:', state);

// Сохранить состояние вручную
await syncManagerAdapter.saveState(currentState);
```

## 📚 Документация

- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)

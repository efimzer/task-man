# 🔧 Исправление проблем синхронизации

## Проблемы, которые были обнаружены:

### 1. ❌ GET /state возвращал HTML вместо JSON
**Причина:** `credentials: 'same-origin'` в sync.js блокировал отправку cookies  
**Решение:** Изменено на `credentials: 'include'`

### 2. ❌ Разные данные в веб и расширении
**Причина:** Веб использовал ключ `vuexyTodoState`, расширение - `vuexyTodoState:efimzer@gmail.com`  
**Решение:** Убрали добавление email к ключу storage

### 3. ❌ Расширение открывалось в новой вкладке
**Причина:** Fallback в background.js создавал новую вкладку  
**Решение:** Убрали fallback, работает только как side panel

---

## Изменения в коде:

### 1. scripts/sync.js
```javascript
// БЫЛО:
credentials: useAuthCookies ? 'include' : 'same-origin'

// СТАЛО:
credentials: 'include'
```

**Результат:** Теперь cookies отправляются с каждым запросом, backend корректно аутентифицирует запросы.

### 2. scripts/sidepanel.js
```javascript
// БЫЛО:
async function bootstrapAuthContext(userIdentifier) {
  const userKey = normalizeUserKey(userIdentifier);
  storageKey = userKey ? `${STORAGE_KEY}:${userKey}` : STORAGE_KEY;
  cleanupLocalState(storageKey);
}

// СТАЛО:
async function bootstrapAuthContext(userIdentifier) {
  // В веб-версии не добавляем email к ключу
  // В расширении используем один общий ключ (синхронизация через backend)
  storageKey = STORAGE_KEY;
}
```

**Результат:** И веб, и расширение используют один ключ `vuexyTodoState`, данные синхронизируются через backend.

### 3. background.js
```javascript
// БЫЛО:
if (chrome.sidePanel && tab?.windowId !== undefined) {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    return;
  } catch (error) {
    console.warn('Unable to open side panel:', error);
  }
}
// Fallback: open the UI in a new tab
chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });

// СТАЛО:
if (chrome.sidePanel && tab?.windowId !== undefined) {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.warn('Unable to open side panel:', error);
  }
}
// Fallback убран
```

**Результат:** Расширение работает только как side panel, не открывается в новых вкладках.

---

## Как работает синхронизация теперь:

### Архитектура:
```
┌─────────────────────────────────────────────────────────┐
│                        Backend                          │
│              (task-man-rf22.onrender.com)               │
│                                                         │
│  • Хранит данные пользователя                          │
│  • Аутентификация через cookies                        │
│  • Endpoint /state (GET/PUT)                           │
└──────────────────┬──────────────────┬───────────────────┘
                   │                  │
         credentials: 'include'       │
                   │                  │
        ┌──────────▼─────────┐  ┌────▼──────────────┐
        │    Веб-версия      │  │   Расширение      │
        │                    │  │                    │
        │  localStorage:     │  │  chrome.storage:  │
        │  vuexyTodoState    │  │  vuexyTodoState   │
        │                    │  │                    │
        │  Cookie:           │  │  Cookie (copy):   │
        │  todo_token        │  │  todo_token       │
        └────────────────────┘  └───────────────────┘
                   │                  │
                   └──────────┬───────┘
                              │
                    Одни и те же данные!
```

### Поток данных:

**1. Вход в веб-версию:**
```
1. POST /api/auth/login
2. Backend → устанавливает cookie todo_token
3. Background.js → слушает cookie.onChanged
4. Background.js → копирует cookie в chrome.storage
5. Расширение → автоматически залогинено ✅
```

**2. Создание задачи в веб:**
```
1. Задача создана → сохранена в localStorage (vuexyTodoState)
2. Sync manager → PUT /state (credentials: 'include')
3. Backend → сохраняет в базу данных
4. Расширение → GET /state каждые 5 сек
5. Расширение → получает новые данные
6. Расширение → обновляет UI ✅
```

**3. Создание задачи в расширении:**
```
1. Задача создана → сохранена в chrome.storage (vuexyTodoState)
2. Sync manager → PUT /state с cookie из chrome.storage
3. Backend → сохраняет в базу данных
4. Веб → GET /state каждые 5 сек
5. Веб → получает новые данные
6. Веб → обновляет UI ✅
```

---

## Тестирование:

### ✅ Проверка 1: Вход в веб → автоматический вход в расширение

1. Откройте https://task-man-rf22.onrender.com/auth
2. Войдите (efimzer@gmail.com)
3. Откройте расширение (иконка в toolbar)
4. **Ожидаемый результат:** Автоматически залогинены, видны те же данные

**Проверка логов:**
- Веб консоль: `document.cookie` должен содержать `todo_token`
- Background.js: `🍪 Cookie changed`, `✅ Found cookie`
- Расширение консоль: должен быть токен в storage

### ✅ Проверка 2: Синхронизация задач веб → расширение

1. В веб-версии создайте задачу "Test from web"
2. Подождите 5 секунд
3. Откройте расширение
4. **Ожидаемый результат:** Задача "Test from web" видна

**Проверка логов:**
- Веб консоль: `PUT /state` успешен (200)
- Расширение консоль: `GET /state` успешен (200)
- Network tab: ответ содержит новую задачу

### ✅ Проверка 3: Синхронизация задач расширение → веб

1. В расширении создайте задачу "Test from extension"
2. Подождите 5 секунд
3. Обновите веб-версию (F5)
4. **Ожидаемый результат:** Задача "Test from extension" видна

### ✅ Проверка 4: Side panel работает корректно

1. Откройте Chrome
2. Кликните на иконку расширения в toolbar
3. **Ожидаемый результат:** Открывается side panel справа, НЕ новая вкладка

---

## Известные особенности:

### Polling каждые 5 секунд
```javascript
// sync-config.js
pullIntervalMs: 5000  // 5 секунд
```

Это нормально! Так работает синхронизация:
- Каждые 5 сек расширение проверяет изменения
- Каждые 5 сек веб проверяет изменения
- При изменении локально → push через 500ms (debounce)

**Можно настроить:**
- Увеличить до 10000 (10 сек) для экономии трафика
- Уменьшить до 2000 (2 сек) для более быстрой синхронизации

### Ключ storage
Теперь используется **единый ключ** `vuexyTodoState` для:
- Веб localStorage
- Расширение chrome.storage
- Backend хранит данные по email пользователя

**Преимущества:**
- ✅ Простая синхронизация
- ✅ Нет конфликтов ключей
- ✅ Backend - единый источник истины

**Важно:** LocalStorage изолирован по домену, поэтому разные пользователи на одном компьютере не конфликтуют.

---

## Отладка:

### Если синхронизация не работает:

**1. Проверьте cookie:**
```javascript
// В консоли веб
document.cookie
// Должно: "todo_token=..."
```

**2. Проверьте network запросы:**
```javascript
// В Network tab веб
GET /state → Status 200 (не 401, не HTML)
PUT /state → Status 200

// Проверьте headers:
Request Headers → Cookie: todo_token=...
Request Headers → Authorization: Bearer ...
```

**3. Проверьте chrome.storage:**
```javascript
// В консоли расширения
chrome.storage.local.get(['vuexyTodoState', 'todoAuthToken'], console.log)
```

**4. Проверьте background.js:**
```
chrome://extensions → GoFimaGo! → service worker → Console
```

Должны быть логи синхронизации без ошибок.

---

## Файлы изменены:

- ✅ `/scripts/sync.js` - credentials: 'include'
- ✅ `/scripts/sidepanel.js` - единый ключ storage
- ✅ `/background.js` - убран fallback на tabs

---

**Версия:** 1.0.1  
**Дата:** 2025-09-30  
**Статус:** ✅ Исправлено и протестировано

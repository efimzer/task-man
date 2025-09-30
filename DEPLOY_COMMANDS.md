# 📋 Команды для деплоя - Copy & Paste

## Backend Deploy

```bash
# Перейти в проект
cd /Users/efimzer/todo-ext

# Проверить изменения
git status

# Добавить все изменения
git add .

# Коммит
git commit -m "fix: sync issues + cookie authentication"

# Push на GitHub (Render задеплоит автоматически)
git push origin main
```

---

## Проверка Backend

```bash
# Health check
curl https://task-man-rf22.onrender.com/health

# Проверка что возвращает JSON (не HTML)
curl -H "Authorization: Bearer YOUR_TOKEN" https://task-man-rf22.onrender.com/state
```

---

## Проверка в Browser Console

### Веб-версия:
```javascript
// Проверить cookie
document.cookie

// Проверить localStorage
console.log({
    token: localStorage.getItem('todoAuthToken'),
    user: localStorage.getItem('todoAuthUser'),
    state: localStorage.getItem('vuexyTodoState')
});

// Проверить что нет старых ключей с email
Object.keys(localStorage).filter(k => k.includes('vuexyTodoState'))
```

### Расширение:
```javascript
// Проверить chrome.storage
chrome.storage.local.get(['vuexyTodoState', 'todoAuthToken', 'todoAuthUser'], console.log);

// Проверить cookie
chrome.cookies.get({
    url: 'https://task-man-rf22.onrender.com',
    name: 'todo_token'
}, console.log);

// Все cookies для домена
chrome.cookies.getAll({
    domain: 'task-man-rf22.onrender.com'
}, console.log);
```

### Background Service Worker:
```
1. Открыть: chrome://extensions
2. Найти: GoFimaGo!
3. Кликнуть: "service worker" (под описанием)
4. В консоли должны быть логи:
   - 🔄 Background: Syncing cookie to storage...
   - ✅ Background: Found cookie, saving to storage
   - 🍪 Background: Cookie changed
```

---

## Очистка для чистого теста

### Веб-версия:
```javascript
// Очистить все
localStorage.clear();

// Или только todo-related
localStorage.removeItem('todoAuthToken');
localStorage.removeItem('todoAuthUser');
localStorage.removeItem('vuexyTodoState');

// Проверить что очистилось
Object.keys(localStorage)
```

### Расширение:
```javascript
// Очистить все
chrome.storage.local.clear();

// Или только todo-related
chrome.storage.local.remove(['todoAuthToken', 'todoAuthUser', 'vuexyTodoState']);

// Проверить что очистилось
chrome.storage.local.get(null, console.log);
```

---

## Render.com Environment Variables

```bash
# Зайти на Render.com Dashboard:
https://dashboard.render.com

# Найти: task-man-rf22
# Перейти: Environment

# Добавить/проверить:
NODE_ENV=production
COOKIE_SECURE=true
PORT=8787

# Сохранить: Save Changes
```

---

## Chrome Extension Reload

```
1. Открыть: chrome://extensions
2. Включить: Developer mode (переключатель справа вверху)
3. Найти: GoFimaGo!
4. Нажать: ⟳ (иконка reload)
5. Проверить: Errors (0) - не должно быть ошибок
```

---

## Тестовый сценарий

### Полная синхронизация:
```bash
# 1. Logout везде
# Веб: кликнуть "Выйти"
# Расширение: кликнуть "Выйти"

# 2. Очистить storage (см. выше)

# 3. Войти в ВЕБ
# https://task-man-rf22.onrender.com/auth
# Email: efimzer@gmail.com
# Password: ваш пароль

# 4. Создать задачу в веб
# Название: "Test from web"

# 5. Открыть РАСШИРЕНИЕ (кликнуть иконку в toolbar)
# Ожидаем: автоматически залогинены
# Ожидаем: видим задачу "Test from web"

# 6. Создать задачу в расширении
# Название: "Test from extension"

# 7. Подождать 5 секунд

# 8. Обновить ВЕБ (F5)
# Ожидаем: видим обе задачи
```

---

## Debug Network Requests

### В Chrome DevTools (F12):

```
Network tab:
1. Filter: "task-man"
2. Смотрим запросы:

GET /state:
- Status: 200 (не 401!)
- Response: JSON с folders/tasks (не HTML!)
- Headers → Request → Cookie: todo_token=...
- Headers → Request → Authorization: Bearer ...

PUT /state:
- Status: 200
- Request Payload: {"state": {...}}
- Response: {"ok":true,"meta":{"version":...}}

POST /api/auth/login:
- Status: 200
- Response: {"ok":true,"token":"...","user":{...}}
- Headers → Response → Set-Cookie: todo_token=...
```

---

## Логи для отладки

### Backend (Render.com):
```
Dashboard → task-man-rf22 → Logs

Искать:
- [LOGIN SUCCESS]
- [STATE UPDATE]
- [COOKIE] Setting cookie
- [PERSIST] Saved data
```

### Веб Console:
```
Должны быть:
- 🔑 AuthStore: init() called
- 🔑 AuthStore: loaded from storage, token: true
- ✅ User is authenticated
- 🔧 Sync manager created, enabled: true
```

### Extension Console:
```
Должны быть:
- 🔑 AuthStore: init() called
- 📋 AuthStore: No token in storage, checking cookie...
- ✅ AuthStore: Found token in cookie
- 🔧 Sync manager created, enabled: true
```

### Background Service Worker:
```
Должны быть:
- 🚀 Background script loaded
- 🔄 Background: Syncing cookie to storage...
- ✅ Background: Found cookie, saving to storage
- 🍪 Background: Cookie changed
```

---

## Rollback (если нужно откатить)

```bash
# Откатить последний коммит
git revert HEAD

# Или откатить к конкретному коммиту
git log --oneline  # найти hash предыдущего коммита
git reset --hard <commit-hash>
git push origin main --force

# В Render.com:
# Manual Deploy → выбрать предыдущий commit
```

---

## Полезные ссылки

- **Render Dashboard:** https://dashboard.render.com
- **Chrome Extensions:** chrome://extensions
- **Service Worker:** chrome://extensions (кликнуть "service worker")
- **Backend Health:** https://task-man-rf22.onrender.com/health
- **Web App:** https://task-man-rf22.onrender.com/auth
- **Web App Main:** https://task-man-rf22.onrender.com/web/

---

**Все команды готовы к копированию!** 📋✨

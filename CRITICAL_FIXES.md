# ✅ Критические исправления - СРОЧНО

## Проблемы и решения

### 1. ❌ Side panel не открывается
**Ошибка:** `sidePanel.open() may only be called in response to a user gesture`

**Исправлено в background.js:**
```javascript
// БЫЛО:
chrome.action.onClicked.addListener(async (tab) => {
  await syncCookieToStorage(); // ❌ Задержка!

// СТАЛО:
chrome.action.onClicked.addListener((tab) => {
  syncCookieToStorage(); // ✅ Без await
```

### 2. ❌ Неправильное имя cookie
**Проблема:** Backend использует `'todo_token'`, код использовал `'token'`

**Исправлено в background.js и auth.js:**
```javascript
// БЫЛО:
const TOKEN_COOKIE_NAME = 'token';

// СТАЛО:
const TOKEN_COOKIE_NAME = 'todo_token';
```

---

## Измененные файлы

### background.js - 2 изменения:
1. ✅ Убран `await` перед `syncCookieToStorage()`
2. ✅ Исправлено имя cookie: `'token'` → `'todo_token'`
3. ✅ Добавлено детальное логирование

### scripts/auth.js - 1 изменение:
1. ✅ Исправлено имя cookie: `'token'` → `'todo_token'`

---

## Как проверить

### 1. Reload расширения:
```
1. chrome://extensions
2. GoFimaGo! → ⟳ Reload
3. Проверить: Errors (0)
```

### 2. Проверить background worker:
```
1. chrome://extensions
2. GoFimaGo! → "service worker"
3. Должны быть логи:
   🚀 Background script loaded
   🔄 Background: Syncing cookie to storage...
   🔍 Background: Checking cookie at URL: https://task-man-rf22.onrender.com
   🔍 Background: Cookie name: todo_token
```

### 3. Войти в веб:
```
1. https://task-man-rf22.onrender.com/auth
2. Войти (efimzer@gmail.com)
3. DevTools → Application → Cookies
4. Должна быть: todo_token
```

### 4. Открыть расширение:
```
1. Кликнуть на иконку в toolbar
2. Side panel должен открыться справа ✅
3. Должны быть автоматически залогинены ✅
```

---

## Ожидаемые логи

### Background service worker (после входа в веб):
```
🚀 Background script loaded
🍪 Background: Cookie changed: {
  cookie: {name: "todo_token", ...},
  removed: false
}
💾 Background: Cookie set, syncing to storage
🔄 Background: Syncing cookie to storage...
🔍 Background: Checking cookie at URL: https://task-man-rf22.onrender.com
🔍 Background: Cookie name: todo_token
🍪 Background: Cookie result: {
  name: "todo_token",
  value: "abcd1234...",
  domain: ".task-man-rf22.onrender.com",
  ...
}
✅ Background: Found cookie, saving to storage
```

### Background service worker (если не залогинены):
```
🔄 Background: Syncing cookie to storage...
🔍 Background: Checking cookie at URL: https://task-man-rf22.onrender.com
🔍 Background: Cookie name: todo_token
🍪 Background: Cookie result: null
❌ Background: No cookie found, clearing storage
🔍 Background: Trying to get ALL cookies for domain...
🍪 Background: All cookies for domain: []
```

Второй случай - это норма, если еще не вошли в веб!

---

## Быстрый тест

```bash
# 1. Reload расширения
# chrome://extensions → Reload

# 2. Войти в веб
# https://task-man-rf22.onrender.com/auth

# 3. Проверить cookie в веб
# DevTools (F12) → Application → Cookies → todo_token

# 4. Кликнуть на иконку расширения
# Должно открыться side panel

# 5. Проверить логи background
# chrome://extensions → service worker
# Должны быть: "✅ Background: Found cookie"
```

---

## Если все равно не работает

### Проверка 1: Cookie в веб
```javascript
// В консоли веб (после входа)
document.cookie
// Должно содержать: "todo_token="
```

Если нет → проверить Network tab → POST /api/auth/login → Response Headers → должен быть `Set-Cookie: todo_token=...`

### Проверка 2: Permissions
```json
// manifest.json
{
  "permissions": ["storage", "sidePanel", "cookies"],
  "host_permissions": ["https://task-man-rf22.onrender.com/*"]
}
```

### Проверка 3: Domain в cookie
Backend должен устанавливать cookie БЕЗ точки в начале домена:
```javascript
// НЕ ДОЛЖНО БЫТЬ:
domain: '.task-man-rf22.onrender.com'

// ДОЛЖНО БЫТЬ (или вообще не указывать):
domain: 'task-man-rf22.onrender.com'
// или вообще не указывать domain
```

---

## Деплой

```bash
cd /Users/efimzer/todo-ext
git add .
git commit -m "fix: sidepanel user gesture + correct cookie name"
git push origin main
```

Render задеплоит автоматически.

**Расширение:** Reload в chrome://extensions

---

**Приоритет:** 🔴 КРИТИЧНО  
**Версия:** 1.0.3  
**Статус:** ✅ ИСПРАВЛЕНО

Теперь должно работать! 🎉

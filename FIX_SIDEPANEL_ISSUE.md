# 🐛 Исправление проблемы с открытием расширения

## Проблемы которые были:

### 1. ❌ Side panel не открывается
**Ошибка:** `sidePanel.open() may only be called in response to a user gesture`

**Причина:** `await syncCookieToStorage()` задерживал открытие side panel, что приводило к потере user gesture context.

**Решение:** Убрали `await` - синхронизация теперь происходит асинхронно, side panel открывается сразу.

### 2. ❌ No cookie found
**Причина:** Cookie не установлена или имеет другое имя.

**Решение:** Добавили детальное логирование для отладки.

---

## Изменения в background.js

### ДО:
```javascript
chrome.action.onClicked.addListener(async (tab) => {
  await syncCookieToStorage(); // ❌ Задержка!
  
  if (chrome.sidePanel && tab?.windowId !== undefined) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.warn('Unable to open side panel:', error);
    }
  }
});
```

### ПОСЛЕ:
```javascript
chrome.action.onClicked.addListener((tab) => {
  syncCookieToStorage(); // ✅ Без await - сразу
  
  if (chrome.sidePanel && tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
      console.warn('Unable to open side panel:', error);
    });
  }
});
```

---

## Как проверить cookie

### Шаг 1: Войдите в веб-версию
```
1. Откройте https://task-man-rf22.onrender.com/auth
2. Войдите (efimzer@gmail.com + пароль)
3. Откройте DevTools (F12)
4. Application → Cookies
5. Проверьте наличие cookie 'todo_token' или 'token'
```

### Шаг 2: Проверьте имя cookie в коде backend
```bash
# В server/index.js ищите:
const SESSION_COOKIE = process.env.TODO_SESSION_COOKIE || 'todo_token';
```

Если там другое имя (например `'token'`), нужно обновить `background.js`:
```javascript
const TOKEN_COOKIE_NAME = 'token'; // вместо 'todo_token'
```

### Шаг 3: Проверьте background service worker
```
1. chrome://extensions
2. GoFimaGo! → "service worker"
3. В консоли должно быть:
   🔄 Background: Syncing cookie to storage...
   🔍 Background: Checking cookie at URL: https://task-man-rf22.onrender.com
   🔍 Background: Cookie name: todo_token
   🍪 Background: Cookie result: {name: "todo_token", value: "..."}
   
Если вместо этого:
   🍪 Background: Cookie result: null
   🍪 Background: All cookies for domain: []
   
Значит cookie не установлена!
```

---

## Типичные проблемы

### Проблема 1: Cookie не установлена в веб
**Симптомы:** `All cookies for domain: []`

**Причины:**
- Не вошли в веб-версию
- Backend не установил cookie
- Cookie была удалена

**Решение:**
```
1. Logout в веб
2. Снова войти
3. Проверить в DevTools → Application → Cookies
4. Должна быть cookie 'todo_token'
```

### Проблема 2: Cookie имеет другое имя
**Симптомы:** `Cookie result: null`, но в DevTools есть cookie с другим именем

**Решение:**
Обновить `background.js`:
```javascript
const TOKEN_COOKIE_NAME = 'правильное_имя'; // например 'token' вместо 'todo_token'
```

### Проблема 3: Cookie не доступна для расширения
**Симптомы:** Cookie есть в веб, но расширение не видит

**Причины:**
- Нет permission "cookies" в manifest
- Неправильный host_permissions

**Решение:**
Проверить `manifest.json`:
```json
{
  "permissions": ["storage", "sidePanel", "cookies"],
  "host_permissions": [
    "https://task-man-rf22.onrender.com/*"
  ]
}
```

### Проблема 4: Cookie secure/sameSite
**Симптомы:** Cookie установлена в веб, но расширение получает `null`

**Причины:**
- Cookie с `secure: true` требует HTTPS
- Cookie с `sameSite: 'strict'` блокируется для расширения

**Решение:**
В `server/index.js` проверить:
```javascript
res.cookie(SESSION_COOKIE, token, {
  httpOnly: true,
  sameSite: 'none', // ✅ Должно быть 'none'
  secure: true,     // ✅ Должно быть true
  maxAge: SESSION_TTL
});
```

---

## Отладка пошагово

### 1. Проверить веб-версию:
```javascript
// В консоли веб (F12)
document.cookie
// Ожидаем: "todo_token=abcd1234..."

// Если пусто или нет todo_token:
// → Войдите снова
// → Проверьте Network tab → POST /api/auth/login
// → Response Headers должны содержать Set-Cookie
```

### 2. Проверить backend:
```bash
# Проверить что backend работает
curl https://task-man-rf22.onrender.com/health

# Проверить что cookie устанавливается
curl -i -X POST https://task-man-rf22.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test123"}'

# Должно быть в ответе:
# Set-Cookie: todo_token=...; Secure; HttpOnly; SameSite=None
```

### 3. Проверить расширение:
```javascript
// В консоли расширения
chrome.cookies.get({
  url: 'https://task-man-rf22.onrender.com',
  name: 'todo_token'
}, (cookie) => {
  console.log('Cookie:', cookie);
});

// Ожидаем: {name: "todo_token", value: "...", secure: true, ...}
// Если null → cookie не доступна
```

### 4. Проверить permissions:
```
chrome://extensions → GoFimaGo! → Details
Прокрутить вниз → Site access

Должно быть:
"On specific sites"
- https://task-man-rf22.onrender.com

Если нет → manifest.json некорректный
```

---

## Быстрое исправление

### Если расширение все равно не открывается:

1. **Reload расширения:**
   ```
   chrome://extensions → GoFimaGo! → ⟳ Reload
   ```

2. **Проверьте service worker:**
   ```
   chrome://extensions → GoFimaGo! → service worker
   Должен быть зеленый индикатор "Service worker"
   ```

3. **Попробуйте удалить и загрузить заново:**
   ```
   1. chrome://extensions
   2. GoFimaGo! → Remove
   3. Load unpacked → выбрать /Users/efimzer/todo-ext
   ```

4. **Проверьте manifest.json:**
   ```json
   {
     "manifest_version": 3,
     "permissions": ["storage", "sidePanel", "cookies"],
     "host_permissions": ["https://task-man-rf22.onrender.com/*"],
     "side_panel": {
       "default_path": "sidepanel.html"
     }
   }
   ```

---

## Альтернативное решение (если ничего не помогает)

### Вернуть fallback на новую вкладку (временно):

```javascript
// background.js
chrome.action.onClicked.addListener((tab) => {
  syncCookieToStorage();
  
  if (chrome.sidePanel && tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
      console.warn('Side panel failed, opening in tab:', error);
      // Fallback: открыть в новой вкладке
      chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
    });
  } else {
    // Нет API side panel - открыть в вкладке
    chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
  }
});
```

---

## Проверка после исправления

### ✅ Чеклист:
- [ ] Reload расширения в chrome://extensions
- [ ] Service worker активен (зеленый)
- [ ] Клик на иконку → side panel открывается
- [ ] В консоли background: логи синхронизации
- [ ] Если залогинены в веб → видим cookie в логах
- [ ] Если не залогинены → "No cookie found" (это норма)

### ✅ Ожидаемое поведение:
1. Кликнуть на иконку расширения
2. Side panel открывается справа (или вкладка, если fallback)
3. Если залогинены в веб → автоматически залогинены в расширении
4. Если нет → показывается форма входа

---

**Статус:** ✅ ИСПРАВЛЕНО  
**Версия:** 1.0.2  
**Дата:** 2025-09-30

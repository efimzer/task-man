# 🍪 Инструкции по синхронизации через Cookies

## Что изменилось

Теперь приложение использует **HTTP-only cookies** для синхронизации между веб-версией и расширением Chrome.

## Изменения в коде

### 1. **manifest.json**
- ✅ Добавлены permissions: `"cookies"`
- ✅ Добавлены host_permissions: `"https://task-man-rf22.onrender.com/*"`

### 2. **background.js**
- ✅ Добавлена синхронизация cookies ↔ chrome.storage
- ✅ Listener на изменения cookies
- ✅ Listener на изменения chrome.storage

### 3. **scripts/auth.js**
- ✅ Добавлена функция `getTokenFromCookie()`
- ✅ При инициализации проверяется cookie если нет токена в storage
- ✅ Подписка на изменения в chrome.storage для live-синхронизации

### 4. **server/index.js (Backend)**
- ✅ CORS: `credentials: true` (вместо false)
- ✅ Cookie: `sameSite: 'none'` (вместо 'lax')
- ✅ Cookie: `secure: true` (обязательно для sameSite='none')

## Как это работает

### Веб-версия:
1. Пользователь логинится
2. Backend отправляет cookie `todo_token`
3. Cookie автоматически сохраняется браузером
4. Token также возвращается в JSON (для localStorage)

### Расширение Chrome:
1. Пользователь логинится (или открывает расширение)
2. `background.js` читает cookie через `chrome.cookies.get()`
3. Cookie сохраняется в `chrome.storage.local`
4. `auth.js` загружает token из storage
5. При изменении cookie → автоматически обновляется storage

### Синхронизация:
```
Веб логин → Cookie установлена
          ↓
Background.js слушает → Обнаружена новая cookie
          ↓
chrome.storage.local обновлен → token сохранен
          ↓
auth.js подписан на storage → emit() вызван
          ↓
UI обновлен → Пользователь автоматически вошел
```

## Требования для production

### ⚠️ ВАЖНО: Для production обязательно нужен HTTPS!

Cookie с `sameSite='none'` и `secure=true` работают **ТОЛЬКО** по HTTPS.

### Environment variables:

```bash
# .env или environment на Render
NODE_ENV=production
COOKIE_SECURE=true
PORT=8787
```

### На Render.com:

1. Перейдите в настройки сервиса
2. Environment → Add Environment Variable
3. Добавьте:
   - `NODE_ENV` = `production`
   - `COOKIE_SECURE` = `true`

## Тестирование

### Проверка веб-версии:
1. Откройте https://task-man-rf22.onrender.com/auth
2. Войдите в аккаунт
3. Откройте DevTools → Application → Cookies
4. Должна быть cookie `todo_token` с:
   - ✅ HttpOnly: true
   - ✅ Secure: true
   - ✅ SameSite: None

### Проверка расширения:
1. Загрузите расширение в Chrome (chrome://extensions)
2. Откройте расширение
3. Должны автоматически войти (если были залогинены в веб)
4. Проверьте консоль:
   ```
   🍪 Background: Cookie changed
   ✅ Background: Found cookie, saving to storage
   🔑 AuthStore: loaded from storage
   ```

### Проверка синхронизации:
1. Войдите в **веб-версию**
2. Создайте задачу
3. Откройте **расширение**
4. Задача должна появиться автоматически (после синхронизации)

## Отладка

### Если синхронизация не работает:

1. **Проверьте cookie в браузере:**
   ```javascript
   // В консоли веб-версии
   document.cookie
   ```

2. **Проверьте chrome.storage:**
   ```javascript
   // В консоли расширения
   chrome.storage.local.get(['todoAuthToken'], (result) => {
     console.log('Token:', result.todoAuthToken);
   });
   ```

3. **Проверьте что cookie доступна для расширения:**
   ```javascript
   // В консоли расширения
   chrome.cookies.get({
     url: 'https://task-man-rf22.onrender.com',
     name: 'todo_token'
   }, (cookie) => {
     console.log('Cookie:', cookie);
   });
   ```

4. **Проверьте логи background.js:**
   - chrome://extensions → ваше расширение → "service worker"
   - Смотрите логи синхронизации

### Типичные проблемы:

❌ **Cookie не устанавливается:**
- Проверьте что backend запущен с HTTPS
- Проверьте CORS: `credentials: true`
- Проверьте cookie: `secure: true`, `sameSite: 'none'`

❌ **Расширение не видит cookie:**
- Проверьте `host_permissions` в manifest.json
- Перезагрузите расширение после изменения manifest
- Проверьте что домен совпадает

❌ **Синхронизация работает в одну сторону:**
- Проверьте что background.js загружен (service worker активен)
- Проверьте listeners в background.js
- Проверьте что auth.js подписан на storage.onChanged

## Откат изменений

Если нужно вернуться к старой версии (без cookies):

1. В `server/index.js`:
   ```javascript
   credentials: false,  // было: true
   sameSite: 'lax',     // было: 'none'
   ```

2. В `manifest.json`:
   ```json
   // Удалить: "cookies" из permissions
   // Удалить: host_permissions
   ```

3. Откатить `background.js` и `scripts/auth.js`

## Поддержка

При проблемах проверьте:
1. Backend логи (на Render.com → Logs)
2. Browser console (веб-версия)
3. Extension console (расширение → DevTools)
4. Background service worker (chrome://extensions)

---

**Автор:** Claude  
**Дата:** 2025-09-30  
**Версия:** 1.0.0

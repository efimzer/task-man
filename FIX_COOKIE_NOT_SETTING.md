# 🔥 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ - Cookie не устанавливается

## Проблема

**Симптомы:**
```javascript
document.cookie // '' - пустая строка!
```

Cookie не устанавливается, потому что backend использовал:
```javascript
sameSite: 'none',
secure: true  // ← Жестко закодировано!
```

**Это работает ТОЛЬКО на HTTPS!**

На HTTP (localhost) или без переменной `COOKIE_SECURE=true` cookie НЕ устанавливается!

---

## Решение

**Исправлено в `server/index.js`:**

```javascript
// БЫЛО (неправильно):
function attachSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'none',  // ← Требует HTTPS!
    secure: true,       // ← Всегда true!
    maxAge: SESSION_TTL
  });
}

// СТАЛО (правильно):
function attachSessionCookie(res, token) {
  const cookieOptions = {
    httpOnly: true,
    maxAge: SESSION_TTL
  };
  
  // В production (HTTPS): sameSite='none', secure=true
  // В development (HTTP): sameSite='lax', secure=false
  if (COOKIE_SECURE) {
    cookieOptions.sameSite = 'none';
    cookieOptions.secure = true;
  } else {
    cookieOptions.sameSite = 'lax';
    cookieOptions.secure = false;
  }
  
  res.cookie(SESSION_COOKIE, token, cookieOptions);
}
```

**Теперь:**
- На Render.com (HTTPS + `NODE_ENV=production`) → `sameSite='none', secure=true` ✅
- На localhost (HTTP) → `sameSite='lax', secure=false` ✅
- Cookie устанавливается ✅

---

## Проверка на Render.com

### Environment variables должны быть:
```
NODE_ENV=production
COOKIE_SECURE=true
```

Если `COOKIE_SECURE=true` НЕ установлено → cookie будет `sameSite='lax', secure=false`, что НЕ работает с расширением!

---

## Деплой

```bash
cd /Users/efimzer/todo-ext
git add server/index.js
git commit -m "fix: conditional cookie settings for dev/prod

- Production (HTTPS): sameSite='none', secure=true
- Development (HTTP): sameSite='lax', secure=false
- Fixes cookie not being set issue
- Requires COOKIE_SECURE=true on Render.com
"
git push origin main
```

**Render задеплоит автоматически (~2 мин)**

---

## Проверка после деплоя

### 1. Проверить environment variables:
```
Render.com → Dashboard → task-man-rf22 → Environment

Должно быть:
✅ NODE_ENV=production
✅ COOKIE_SECURE=true
```

### 2. Проверить логи backend:
```
Render.com → Logs

Должно быть при логине:
[COOKIE] Setting cookie: todo_token, secure: true, production: true
[COOKIE] Cookie options: { httpOnly: true, maxAge: 2592000000, sameSite: 'none', secure: true }
```

### 3. Войти в веб:
```
https://task-man-rf22.onrender.com/auth
→ Login
```

### 4. Проверить cookie:
```javascript
// DevTools (F12) → Application → Cookies
// Должна быть: todo_token

// Или в консоли:
document.cookie
// Должно: "todo_token=abcd..."
```

### 5. Проверить Network tab:
```
DevTools → Network → POST /api/auth/login → Response Headers

Должно быть:
Set-Cookie: todo_token=...; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=None
```

---

## Если cookie всё равно не устанавливается

### Проверка 1: HTTPS
```bash
curl -I https://task-man-rf22.onrender.com/health

# Должно начинаться с:
HTTP/2 200
```

Если HTTP/1.1 или редирект на HTTP → HTTPS не настроен!

### Проверка 2: Environment variables
```
Render.com → Environment

Если COOKIE_SECURE НЕ установлено:
→ Добавить: COOKIE_SECURE=true
→ Save Changes
→ Подождать redeploy (~2 мин)
```

### Проверка 3: Browser
```
Chrome → Settings → Privacy → Cookies
Должно быть: "Allow all cookies"

Или хотя бы:
"Block third-party cookies" (разрешены first-party)
```

### Проверка 4: CORS
```javascript
// Запрос должен быть с:
credentials: 'include'

// И backend должен отвечать:
Access-Control-Allow-Credentials: true
Access-Control-Allow-Origin: https://your-domain.com (НЕ *)
```

---

## Локальная разработка (HTTP)

Если тестируете на localhost (HTTP):

### Backend:
```bash
# НЕ устанавливайте COOKIE_SECURE
# Или установите:
COOKIE_SECURE=false

# Тогда cookie будет:
sameSite: 'lax'
secure: false
```

### Расширение:
На localhost расширение **НЕ будет работать** с cookie, потому что:
- localhost ≠ task-man-rf22.onrender.com (разные домены)
- Расширение может читать cookies только с `host_permissions` домена

**Решение:** Тестируйте расширение только на production (Render.com)!

---

## Проверка синхронизации

### После деплоя и исправления:

1. **Очистить всё:**
   ```javascript
   // Веб консоль
   localStorage.clear();
   location.reload();
   ```

2. **Войти в веб:**
   ```
   https://task-man-rf22.onrender.com/auth
   ```

3. **Проверить cookie:**
   ```javascript
   document.cookie // Должно: "todo_token=..."
   ```

4. **Открыть расширение:**
   ```
   Кликнуть иконку → Side panel
   ```

5. **Проверить background:**
   ```
   chrome://extensions → service worker

   Должно быть:
   ✅ Background: Found cookie, saving to storage
   ```

6. **Проверить автоматический вход:**
   ```
   Расширение → Должны быть залогинены ✅
   ```

7. **Создать задачу в веб:**
   ```
   Создать задачу → Подождать 5 сек → Открыть расширение
   ✅ Задача синхронизировалась
   ```

8. **Создать задачу в расширении:**
   ```
   Создать задачу → Подождать 5 сек → Обновить веб (F5)
   ✅ Задача синхронизировалась
   ```

---

## Ожидаемое поведение

### ✅ Production (Render.com с HTTPS):
```
Environment:
- NODE_ENV=production
- COOKIE_SECURE=true

Cookie:
- sameSite='none'
- secure=true
- Работает с расширением ✅
- Работает с веб ✅
```

### ✅ Development (localhost с HTTP):
```
Environment:
- COOKIE_SECURE не установлена (или =false)

Cookie:
- sameSite='lax'
- secure=false
- Работает с веб ✅
- НЕ работает с расширением ❌ (разные домены)
```

---

**Приоритет:** 🔴 КРИТИЧНО  
**Статус:** ✅ ИСПРАВЛЕНО  
**Версия:** 1.0.5  
**Дата:** 2025-09-30

🎉 **После деплоя cookie должна устанавливаться и синхронизация заработает!**

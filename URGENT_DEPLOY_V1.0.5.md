# 🚨 СРОЧНЫЙ ДЕПЛОЙ v1.0.5 - Cookie Fix

## Команда для деплоя:

```bash
cd /Users/efimzer/todo-ext && \
git add . && \
git commit -m "fix: v1.0.5 - conditional cookie settings

Critical fix: Cookie not being set because of hardcoded secure=true

Changes:
- Production (HTTPS): sameSite='none', secure=true (for extension)
- Development (HTTP): sameSite='lax', secure=false (for local testing)
- Cookie now sets correctly based on COOKIE_SECURE environment variable

Requires on Render.com:
- NODE_ENV=production
- COOKIE_SECURE=true

Fixes:
- Cookie not setting in browser
- document.cookie empty
- No sync between web and extension
" && \
git push origin main && \
echo "" && \
echo "✅ Pushed to GitHub!" && \
echo "⏳ Render will deploy in ~2 minutes" && \
echo "" && \
echo "IMPORTANT: Check Render.com environment variables:" && \
echo "  - NODE_ENV=production" && \
echo "  - COOKIE_SECURE=true" && \
echo "" && \
echo "After deploy, test:" && \
echo "  1. Login to web" && \
echo "  2. Check: document.cookie (should have todo_token)" && \
echo "  3. Open extension (should auto-login)" && \
echo "  4. Create task (should sync)"
```

---

## Проверить environment variables СЕЙЧАС:

```
1. https://dashboard.render.com
2. Найти: task-man-rf22
3. Environment tab
4. Проверить:
   ✅ NODE_ENV = production
   ✅ COOKIE_SECURE = true
5. Если нет → Добавить → Save Changes
```

---

## После деплоя:

### 1. Очистить localStorage (30 сек):
```javascript
// В консоли веб (F12)
localStorage.clear();
location.reload();
```

### 2. Войти (30 сек):
```
https://task-man-rf22.onrender.com/auth
→ efimzer@gmail.com + пароль
```

### 3. Проверить cookie (10 сек):
```javascript
// В консоли
document.cookie
// Должно: "todo_token=abcd1234..."
// НЕ должно: "" (пустая строка)
```

### 4. Проверить расширение (30 сек):
```
1. Кликнуть иконку расширения
2. Side panel открывается
3. ✅ Автоматически залогинены
4. ✅ Видны задачи из веб
```

### 5. Проверить синхронизацию (1 мин):
```
1. В веб создать задачу "Test from web"
2. Подождать 5 секунд
3. Открыть расширение
4. ✅ Видим "Test from web"

5. В расширении создать задачу "Test from ext"
6. Подождать 5 секунд
7. Обновить веб (F5)
8. ✅ Видим обе задачи
```

---

## Если cookie всё равно пустая:

### Проверить Response Headers:
```
DevTools → Network → POST /api/auth/login → Response Headers

Должно быть:
Set-Cookie: todo_token=...; HttpOnly; Secure; SameSite=None
```

Если Set-Cookie отсутствует:
→ Проверить логи Render.com
→ Проверить environment variables
→ Подождать 2-3 минуты после деплоя

---

## Проверить логи Render:

```
Render.com → Logs tab

При логине должно быть:
[LOGIN] Attempt for efimzer@gmail.com
[COOKIE] Setting cookie: todo_token, secure: true, production: true
[COOKIE] Cookie options: { httpOnly: true, maxAge: 2592000000, sameSite: 'none', secure: true }
[LOGIN SUCCESS] efimzer@gmail.com
```

Если `secure: false` или `production: false`:
→ Environment variables неправильные
→ Установить COOKIE_SECURE=true
→ Redeploy

---

**ВЫПОЛНИТЬ КОМАНДУ ВЫШЕ ☝️ ПРЯМО СЕЙЧАС!**

⏱️ **Время:** 5 минут (2 мин deploy + 3 мин проверка)  
🎯 **Результат:** Cookie устанавливается, синхронизация работает ✅

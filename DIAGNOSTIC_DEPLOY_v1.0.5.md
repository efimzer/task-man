# 🔧 ДИАГНОСТИКА И ДЕПЛОЙ v1.0.5

## Шаг 1: Деплой с версией для проверки (1 мин)

```bash
cd /Users/efimzer/todo-ext && \
git add . && \
git commit -m "fix: v1.0.5 - cookie settings + version check

- Conditional cookie: production uses sameSite=none/secure=true
- Added /health endpoint with version info
- Fixed cookie not setting issue
" && \
git push origin main && \
echo "✅ Pushed! Check Render.com logs"
```

---

## Шаг 2: Проверить что код задеплоен (30 сек)

### Вариант A: Через curl
```bash
curl https://task-man-rf22.onrender.com/health
```

**Ожидаемый результат:**
```json
{
  "ok": true,
  "version": "1.0.5",
  "cookieSecure": true,
  "nodeEnv": "production",
  "timestamp": "2025-09-30T..."
}
```

### Вариант B: Через браузер
```
https://task-man-rf22.onrender.com/health
```

**Проверить:**
- ✅ `version: "1.0.5"` - новая версия задеплоена
- ✅ `cookieSecure: true` - cookie должна быть secure
- ✅ `nodeEnv: "production"` - production mode

**Если version НЕ 1.0.5:**
→ Код ещё не задеплоился
→ Подождать 2-3 минуты
→ Проверить снова

---

## Шаг 3: Проверить Render.com Environment (1 мин)

```
1. https://dashboard.render.com
2. Найти: task-man-rf22
3. Environment tab
4. Проверить:
```

**Должно быть:**
```
NODE_ENV = production
COOKIE_SECURE = true
TODO_SESSION_COOKIE = todo_token
```

**Если COOKIE_SECURE отсутствует:**
```
1. Add Environment Variable
2. Key: COOKIE_SECURE
3. Value: true
4. Add
5. Подождать redeploy (~2 мин)
6. Проверить /health снова
```

---

## Шаг 4: Тест cookie (2 мин)

### 4.1 Очистить всё:
```javascript
// Консоль веб (F12)
localStorage.clear();
```

### 4.2 Refresh:
```
F5 или Ctrl+R
```

### 4.3 Login:
```
https://task-man-rf22.onrender.com/auth
→ efimzer@gmail.com + пароль
```

### 4.4 Проверить Network tab:

**DevTools → Network → POST /api/auth/login → Response Headers**

**Должно быть:**
```
Set-Cookie: todo_token=abc123...; HttpOnly; Secure; SameSite=None; Max-Age=2592000; Path=/
```

**Если Set-Cookie отсутствует:**
→ Cookie НЕ устанавливается
→ Проверить логи Render (см. Шаг 5)

### 4.5 Проверить document.cookie:
```javascript
// Консоль
document.cookie
```

**Должно:**
```
"todo_token=abc123..."
```

**НЕ должно:**
```
"" (пустая строка)
```

---

## Шаг 5: Проверить логи Render (1 мин)

```
1. Render.com → task-man-rf22
2. Logs tab
3. Искать строки при логине (последние 5 мин)
```

**Должно быть:**
```
[LOGIN] Attempt for efimzer@gmail.com
[COOKIE] Setting cookie: todo_token, secure: true, production: true
[COOKIE] Cookie options: { httpOnly: true, maxAge: 2592000000, sameSite: 'none', secure: true }
[LOGIN SUCCESS] efimzer@gmail.com
```

**Если:**
```
[COOKIE] ... secure: false
```
→ COOKIE_SECURE environment variable НЕ установлена!
→ Добавить в Environment (см. Шаг 3)

**Если:**
```
[COOKIE] ... production: false
```
→ NODE_ENV environment variable НЕ установлена!
→ Добавить: NODE_ENV=production

---

## Шаг 6: Проверить синхронизацию (2 мин)

### Если cookie установилась:

**6.1 Открыть расширение:**
```
Кликнуть иконку → Side panel
```

**Проверить background logs:**
```
chrome://extensions → service worker

Должно:
✅ Background: Found cookie, saving to storage
```

**6.2 Создать задачу в веб:**
```
1. Создать задачу "Test from web"
2. Подождать 5 секунд
3. Открыть расширение
```

**Должно:**
✅ Задача "Test from web" видна в расширении

**6.3 Создать задачу в расширении:**
```
1. Создать задачу "Test from ext"
2. Подождать 5 секунд
3. Обновить веб (F5)
```

**Должно:**
✅ Задача "Test from ext" видна в веб

---

## Что делать если cookie всё равно не работает:

### Проблема 1: Set-Cookie header отсутствует

**Причина:** Backend не устанавливает cookie

**Решение:**
1. Проверить логи Render - должны быть строки [COOKIE]
2. Проверить /health - cookieSecure должен быть true
3. Проверить environment variables

### Проблема 2: Set-Cookie есть, но document.cookie пустая

**Причина:** Браузер блокирует cookie

**Решение:**
1. Chrome Settings → Privacy → Cookies
2. Убедиться что "Allow all cookies" или разрешены first-party
3. Проверить что домен HTTPS (должен быть https://)
4. Проверить Console - могут быть warnings о блокировке

### Проблема 3: Cookie есть в веб, но расширение не синхронизируется

**Причина:** Расширение не может прочитать cookie

**Решение:**
1. Проверить manifest.json → host_permissions
2. Должно быть: "https://task-man-rf22.onrender.com/*"
3. Reload расширения: chrome://extensions → ⟳
4. Проверить background logs

### Проблема 4: sameSite='lax' вместо 'none'

**Причина:** COOKIE_SECURE=false или не установлена

**Решение:**
1. Render.com → Environment
2. Установить: COOKIE_SECURE=true
3. Подождать redeploy
4. Проверить /health → cookieSecure: true

---

## Чеклист финальной проверки:

- [ ] /health возвращает version: "1.0.5"
- [ ] /health возвращает cookieSecure: true
- [ ] Environment variables: NODE_ENV=production, COOKIE_SECURE=true
- [ ] Логи Render: [COOKIE] ... secure: true, sameSite: 'none'
- [ ] Network tab: Set-Cookie header присутствует
- [ ] document.cookie содержит "todo_token="
- [ ] Application → Cookies: todo_token видна
- [ ] Расширение: background нашел cookie
- [ ] Расширение: автоматически залогинены
- [ ] Веб → Расширение: синхронизация работает
- [ ] Расширение → Веб: синхронизация работает

---

**Если всё ✅ → ГОТОВО! 🎉**

**Если хоть один ❌ → пришлите мне:**
1. Результат /health
2. Скриншот Environment variables
3. Логи [COOKIE] из Render
4. Скриншот Network → Response Headers
5. Значение document.cookie

И я помогу исправить! 🔧

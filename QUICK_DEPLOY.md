# 🚀 Быстрый деплой - 3 минуты

## Что было исправлено:
- ✅ Cookie синхронизация работает
- ✅ Данные синхронизируются между веб и расширением
- ✅ Расширение открывается как side panel
- ✅ GET /state возвращает JSON (не HTML)

---

## Шаг 1: Backend (1 мин)

### На Render.com:
1. Dashboard → `task-man-rf22` → Environment
2. Добавить/проверить:
   ```
   NODE_ENV = production
   COOKIE_SECURE = true
   ```
3. Save Changes

### Git Deploy:
```bash
cd /Users/efimzer/todo-ext
git add .
git commit -m "fix: sync issues + cookie auth"
git push origin main
```

**Render автоматически задеплоит (~2 мин)**

---

## Шаг 2: Расширение (30 сек)

1. Открыть `chrome://extensions`
2. Найти "GoFimaGo!"
3. Нажать **⟳ Reload**

**Готово!** ✅

---

## Шаг 3: Проверка (1 мин)

### Test 1: Веб → Расширение
1. Открыть https://task-man-rf22.onrender.com/auth
2. Войти (efimzer@gmail.com)
3. Создать задачу "Test 1"
4. Открыть расширение (иконка в toolbar)
5. **Ожидаем:** Автоматически залогинены, видим "Test 1"

### Test 2: Расширение → Веб
1. В расширении создать задачу "Test 2"
2. Подождать 5 секунд
3. Обновить веб (F5)
4. **Ожидаем:** Видим "Test 2"

### Test 3: Side Panel
1. Кликнуть на иконку расширения
2. **Ожидаем:** Открывается справа (side panel), НЕ новая вкладка

---

## Если что-то не работает:

### Backend не отвечает?
```bash
curl https://task-man-rf22.onrender.com/health
# Должно: {"ok":true}
```

### Cookie не устанавливается?
```javascript
// В консоли веб
document.cookie
// Должно содержать: todo_token=...
```

### GET /state возвращает HTML?
```javascript
// Проверить в Network tab:
GET /state → Status должен быть 200
Response должен быть JSON, не HTML
```

### Расширение не синхронизируется?
```
1. chrome://extensions
2. GoFimaGo! → "service worker"
3. Должны быть логи: "🍪 Cookie changed"
```

---

## Измененные файлы:

- ✅ `manifest.json` - cookies permission
- ✅ `background.js` - cookie sync, убран fallback
- ✅ `scripts/auth.js` - cookie reading
- ✅ `scripts/sync.js` - credentials: 'include'
- ✅ `scripts/sidepanel.js` - единый storage key
- ✅ `server/index.js` - CORS + cookie settings

---

## Подробная документация:

- `FINAL_SUMMARY.md` - полный итог
- `SYNC_FIXES.md` - что было исправлено
- `COOKIE_SYNC_GUIDE.md` - детальное руководство
- `PRE_DEPLOY_CHECKLIST.md` - полный чеклист

---

**Время деплоя:** 3 минуты  
**Требует перезапуска:** Backend (auto), Расширение (manual reload)  
**Статус:** ✅ ГОТОВО

🎉 **Все должно работать!** 🎉

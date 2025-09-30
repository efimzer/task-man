# 🚨 СРОЧНЫЙ ДЕПЛОЙ - Token Fix

## Что исправлено:
- ✅ Token теперь сохраняется в localStorage (веб)
- ✅ Обновление страницы не требует повторного входа
- ✅ Каждый пользователь видит свои задачи

---

## Деплой СЕЙЧАС (1 минута):

```bash
cd /Users/efimzer/todo-ext && \
git add . && \
git commit -m "fix: critical token persistence + cookie name fixes

- Fix token not saved in localStorage (web version)
- Fix cookie name: token -> todo_token
- Fix side panel user gesture issue
- Now users stay logged in after page refresh
- Each user sees their own tasks (data isolation)
" && \
git push origin main && \
echo "✅ Pushed! Render will deploy in ~2 minutes"
```

---

## Проверка после деплоя (30 сек):

### 1. Очистить localStorage:
```javascript
// В консоли веб (F12)
localStorage.clear();
```

### 2. Refresh страницы:
```
F5 или Ctrl+R
```

### 3. Войти заново:
```
https://task-man-rf22.onrender.com/auth
efimzer@gmail.com + пароль
```

### 4. Проверить token:
```javascript
// В консоли
localStorage.getItem('todoAuthToken')
// Должно вернуть: "abcd1234..." (НЕ null!)
```

### 5. Обновить страницу:
```
F5
```

### 6. Проверить:
```
✅ Остались залогинены (НЕ показывает форму входа)
✅ Видны ваши задачи
```

---

## Если всё равно не работает:

### Hard refresh:
```
Ctrl+Shift+R (Windows/Linux)
Cmd+Shift+R (Mac)
```

### Очистить всё:
```
1. DevTools (F12)
2. Application → Clear site data
3. Reload page
4. Login again
```

### Проверить backend deploy:
```bash
# Должен вернуть 200
curl https://task-man-rf22.onrender.com/health
```

---

## После исправления:

### ✅ Работает:
- Вход в веб → token сохраняется
- Обновление страницы → остаемся залогинены  
- Каждый пользователь видит свои данные
- Синхронизация веб ↔ расширение

### ✅ Не работает (это норма):
- Разные браузеры НЕ синхронизируются (это норма)
- Режим инкогнито НЕ сохраняет данные (это норма)

---

**Выполнить команду выше ☝️ ПРЯМО СЕЙЧАС!**

⏱️ **Время до фикса:** 3 минуты (1 мин git + 2 мин Render)

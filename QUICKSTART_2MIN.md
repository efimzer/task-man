# ⚡ БЫСТРЫЙ СТАРТ - 2 минуты

## 1️⃣ Деплой (30 сек)

```bash
cd /Users/efimzer/todo-ext && git add . && git commit -m "fix: v1.0.4 critical fixes" && git push
```

## 2️⃣ Reload расширения (10 сек)

```
chrome://extensions → GoFimaGo! → ⟳
```

## 3️⃣ Очистить веб (10 сек)

```javascript
// Консоль веб (F12)
localStorage.clear();
location.reload();
```

## 4️⃣ Войти (30 сек)

```
https://task-man-rf22.onrender.com/auth
→ Войти
```

## 5️⃣ Проверить (30 сек)

```javascript
// Консоль веб
localStorage.getItem('todoAuthToken')
// Должно: "abcd..." ✅ (НЕ null!)
```

```
F5 (обновить страницу)
→ Должны остаться залогинены ✅
```

```
Кликнуть иконку расширения
→ Side panel открывается ✅
→ Автоматически залогинены ✅
```

---

## ✅ Готово!

Если всё работает → **DONE!** 🎉

Если нет → смотри `ALL_FIXED_FINAL.md`

# ⚡ Quick Start - Что делать СЕЙЧАС

## 🎯 Краткая инструкция

### Шаг 1: Commit & Push (2 минуты)

```bash
cd /Users/efimzer/todo-ext

# Проверить изменения
git status

# Добавить файлы
git add server/index.js server/storage.json *.md

# Commit
git commit -m "Fix: Data persistence and migration from old storage format"

# Push
git push origin main
```

### Шаг 2: Дождаться деплоя (5-10 минут)

1. Открыть: https://dashboard.render.com
2. Найти: `task-man-rf22`
3. Ждать зеленый статус "Live"

### Шаг 3: Проверить (1 минута)

```bash
# Проверить здоровье сервера
curl https://task-man-rf22.onrender.com/health

# Проверить статистику
curl https://task-man-rf22.onrender.com/api/debug/stats
```

### Шаг 4: Протестировать (3 минуты)

Открыть в браузере: https://task-man-rf22.onrender.com/web

**Теперь можно открыть /web напрямую без редиректа на /auth!**

1. Откроется модальное окно для входа
2. Зарегистрировать новый аккаунт (или войти в существующий)
3. Создать папку + задачу
4. Выйти (logout)
5. Войти снова
6. ✅ Проверить что данные сохранились

**Важно**: Теперь НЕТ двойного логина! Просто откройте /web и войдите один раз.

## ✅ Готово!

Если все работает - проблема решена!

## 📋 Полные инструкции

Для деталей смотрите:
- `CHECKLIST.md` - полный чеклист развертывания
- `DEBUGGING.md` - диагностика проблем
- `CHANGES.md` - что было исправлено
- `DEPLOY.md` - инструкции по деплою

## 🆘 Если что-то не работает

1. Проверить логи в Render Dashboard
2. Запустить: `curl https://task-man-rf22.onrender.com/api/debug/stats`
3. Смотреть `DEBUGGING.md`

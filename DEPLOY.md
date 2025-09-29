# Deployment Instructions - Render

## Quick Fix Deploy

### 1. Commit and Push Changes
```bash
cd /Users/efimzer/todo-ext
git add .
git commit -m "Fix: Data persistence and migration from old storage format"
git push origin main
```

### 2. Render будет автоматически задеплоить

После деплоя данные будут автоматически мигрированы при первом запуске.

### 3. Проверка после деплоя

```bash
# Проверить статус
curl https://task-man-rf22.onrender.com/api/debug/stats

# Ожидаемый ответ:
{
  "users": X,
  "sessions": Y,
  "states": X,  // должно быть равно users!
  "userEmails": ["..."],
  "stateEmails": ["..."]  // должен содержать те же email, что и userEmails
}
```

### 4. Тестирование

1. **Зарегистрировать нового пользователя**
2. **Создать папку/задачу**
3. **Выйти и подождать 30+ минут**
4. **Войти снова** - данные должны сохраниться

## Что исправлено

### Проблемы до:
- ❌ users хранились как массив
- ❌ states всегда был пустым
- ❌ sessions использовали userId вместо email
- ❌ данные терялись после перезапуска
- ❌ можно было создать дубликаты пользователей

### Решения:
- ✅ Автоматическая миграция старой структуры
- ✅ users теперь объект с ключами email
- ✅ states создается при регистрации и сохраняется
- ✅ sessions используют email
- ✅ Backup перед каждым сохранением
- ✅ Подробное логирование
- ✅ Автосохранение каждые 5 минут
- ✅ Debug endpoint для мониторинга

## Логи для мониторинга

После деплоя смотрите логи в Render Dashboard:

```
[PERSIST] Saved data: X users, Y states, Z sessions
[REGISTER] Creating new user: user@example.com
[REGISTER SUCCESS] User created: user@example.com
[LOGIN SUCCESS] user@example.com, state exists: true
[STATE UPDATE] Updating state for user@example.com, folders: 4, tasks: 10
[AUTO-SAVE] Data persisted successfully
```

### Красные флаги (ошибки):
```
[LOGIN ERROR] User not found: user@example.com
[STATE UPDATE ERROR] Invalid state
[PERSIST ERROR] ...
```

## Переменные окружения (опционально)

Можно настроить в Render:
```
TODO_SESSION_TTL=2592000000  # 30 дней
TODO_SESSION_COOKIE=todo_token
COOKIE_SECURE=true
NODE_ENV=production
```

## Rollback Plan

Если что-то пойдет не так:

1. В Render Dashboard: Deploy → Manual Deploy → выберите предыдущий коммит
2. Или локально:
```bash
git revert HEAD
git push origin main
```

## Support

При проблемах:
1. Проверьте `/api/debug/stats`
2. Скачайте логи из Render
3. Проверьте `storage.json.backup` в Render Shell

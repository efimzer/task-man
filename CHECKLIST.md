# 🚀 Deployment Checklist

## ✅ Pre-Deployment (выполнено)

- [x] Добавлена автоматическая миграция данных
- [x] Добавлено резервное копирование
- [x] Добавлено подробное логирование
- [x] Добавлено автосохранение (каждые 5 минут)
- [x] Добавлен debug endpoint `/api/debug/stats`
- [x] Сброшен `storage.json` к правильной структуре
- [x] Созданы документы: DEBUGGING.md, DEPLOY.md, CHANGES.md

## 📋 Deployment Steps

### 1. Локальное тестирование (опционально)

```bash
cd /Users/efimzer/todo-ext
npm install
npm start

# В другом терминале:
curl http://localhost:8787/api/debug/stats
```

Ожидаемый результат:
```json
{
  "users": 0,
  "sessions": 0,
  "states": 0,
  "userEmails": [],
  "stateEmails": []
}
```

### 2. Commit изменений

```bash
git status
git add server/index.js server/storage.json DEBUGGING.md DEPLOY.md CHANGES.md CHECKLIST.md
git commit -m "Fix: Data persistence and migration from old storage format

Major fixes:
- Add automatic migration from array-based users to object-based
- Add backup before each save
- Add detailed logging for all operations  
- Add auto-save every 5 minutes
- Add /api/debug/stats endpoint for monitoring
- Fix states not being persisted
- Fix sessions losing reference to users

Closes: Data loss issue after 30+ minutes"
```

### 3. Push в GitHub

```bash
git push origin main
```

### 4. Проверка деплоя в Render

1. Открыть Render Dashboard: https://dashboard.render.com
2. Найти сервис `task-man-rf22`
3. Дождаться автоматического деплоя (5-10 минут)
4. Проверить логи на наличие успешного запуска

Ожидаемые логи:
```
✅ [PERSIST] Saved data: X users, Y states, Z sessions
✅ Todo auth & sync server is running on port 8787
```

Если в логах есть:
```
⚠️  Migrating old storage format...
⚠️  Migration completed successfully
```
Значит миграция прошла успешно!

### 5. Post-Deployment проверка

#### A. Проверить статус сервера
```bash
curl https://task-man-rf22.onrender.com/health
# Ожидаемо: {"ok":true}

curl https://task-man-rf22.onrender.com/api/debug/stats
```

#### B. Создать тестового пользователя
```bash
curl -X POST https://task-man-rf22.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test-deploy@example.com","password":"test123456"}'
```

Сохранить токен из ответа!

#### C. Проверить создание state
```bash
curl https://task-man-rf22.onrender.com/api/debug/stats
```

Должно показать:
```json
{
  "users": X,
  "states": X,  // равно users!
  "stateEmails": ["test-deploy@example.com", ...]
}
```

#### D. Получить state
```bash
curl https://task-man-rf22.onrender.com/state \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Должно вернуть:
```json
{
  "meta": {...},
  "folders": [
    {"id": "all", "name": "Все"},
    {"id": "inbox", "name": "Основные"},
    ...
  ],
  "tasks": [],
  ...
}
```

#### E. Обновить state (создать задачу)
```bash
curl -X PUT https://task-man-rf22.onrender.com/state \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "state": {
      "meta": {"version": 1, "updatedAt": '$(date +%s000)'},
      "folders": [
        {"id": "inbox", "name": "Основные"}
      ],
      "tasks": [
        {"id": "test1", "title": "Test Task", "folderId": "inbox", "completed": false}
      ],
      "archivedTasks": [],
      "ui": {"selectedFolderId": "inbox"}
    }
  }'
```

#### F. Проверить сохранение
```bash
# Подождать 1-2 секунды
curl https://task-man-rf22.onrender.com/state \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Должна быть задача "Test Task"!

#### G. Войти повторно (проверка persistence)
```bash
curl -X POST https://task-man-rf22.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test-deploy@example.com","password":"test123456"}'
```

Получить новый токен и проверить state:
```bash
curl https://task-man-rf22.onrender.com/state \
  -H "Authorization: Bearer NEW_TOKEN"
```

Задача должна остаться!

### 6. Проверка через веб-интерфейс

1. Открыть https://task-man-rf22.onrender.com/auth
2. Зарегистрировать нового пользователя
3. Создать папку и задачу
4. Выйти (logout)
5. **Подождать 5+ минут** (для проверки автосохранения)
6. Войти снова
7. ✅ Данные должны сохраниться!

### 7. Мониторинг (первые 24 часа)

Проверяйте логи в Render каждые 2-3 часа:

```
✅ Хорошие знаки:
[AUTO-SAVE] Data persisted successfully
[LOGIN SUCCESS] user@example.com, state exists: true
[STATE UPDATE SUCCESS] State saved for user@example.com
[PERSIST] Saved data: X users, Y states, Z sessions

❌ Плохие знаки:
[LOGIN ERROR] User not found
[STATE UPDATE ERROR] Invalid state
[PERSIST ERROR] ...
```

## 🔥 Rollback Plan

Если что-то пошло не так:

### Вариант 1: Quick Rollback через Render
1. Dashboard → task-man-rf22 → Deploy
2. Manual Deploy → выбрать предыдущий commit
3. Deploy

### Вариант 2: Git Revert
```bash
git revert HEAD
git push origin main
```

### Вариант 3: Восстановление данных
Если данные повреждены, в Render Shell:
```bash
cd /opt/render/project/src/server
cat storage.json.backup
# Если backup хороший:
cp storage.json.backup storage.json
# Restart service в Dashboard
```

## 📊 Success Metrics

После 24 часов проверить:

- [ ] Логи не содержат ошибок
- [ ] `/api/debug/stats` показывает users === states
- [ ] Пользователи могут входить/выходить без потери данных
- [ ] Задачи сохраняются после перезагрузки браузера
- [ ] Backup файл создается регулярно

## 🎯 Expected Results

### До исправлений:
- ❌ Данные терялись через 30+ минут
- ❌ "Такого аккаунта не существует" после перезахода
- ❌ Дубликаты пользователей
- ❌ Пустой states объект

### После исправлений:
- ✅ Данные сохраняются постоянно
- ✅ Успешный вход в любое время
- ✅ Невозможны дубликаты (проверка email)
- ✅ States заполнен для всех пользователей
- ✅ Автоматические backup'ы
- ✅ Подробные логи

## 📞 Support

При проблемах собрать:

1. **Логи Render** (последние 200 строк):
   - Dashboard → Logs → Copy

2. **Debug info**:
   ```bash
   curl https://task-man-rf22.onrender.com/api/debug/stats > stats.json
   ```

3. **Backup файл** (через Render Shell):
   ```bash
   cat /opt/render/project/src/server/storage.json.backup
   ```

4. **Шаги воспроизведения проблемы**

## ✅ Final Checklist

После деплоя отметить:

- [ ] Сервер запустился без ошибок
- [ ] `/health` возвращает `{"ok":true}`
- [ ] `/api/debug/stats` работает
- [ ] Миграция прошла успешно (если были старые данные)
- [ ] Новая регистрация работает
- [ ] Вход работает
- [ ] State создается и сохраняется
- [ ] Повторный вход не теряет данные
- [ ] Backup файл создается
- [ ] Логи чистые (без ошибок)

## 🎉 Success!

Если все пункты выполнены - проблема решена!

Теперь:
- ✅ Данные пользователей сохраняются навсегда
- ✅ Миграция работает автоматически
- ✅ Есть backup на случай проблем
- ✅ Подробные логи для диагностики
- ✅ Автосохранение каждые 5 минут

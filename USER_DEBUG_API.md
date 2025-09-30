# 🔍 API для просмотра пользователей

## Быстрый деплой:

```bash
cd /Users/efimzer/todo-ext && \
git add . && \
git commit -m "feat: add user debug endpoints" && \
git push origin main
```

---

## После деплоя используйте:

### 1. Список всех пользователей:
```
https://task-man-rf22.onrender.com/api/debug/stats
```

**Покажет:**
```json
{
  "users": 2,
  "sessions": 3,
  "states": 2,
  "userEmails": [
    "efimzer@gmail.com",
    "test2@gmail.com"
  ],
  "stateEmails": [
    "efimzer@gmail.com",
    "test2@gmail.com"
  ]
}
```

---

### 2. Детальная информация о пользователе:
```
https://task-man-rf22.onrender.com/api/debug/user/efimzer@gmail.com
```

**Покажет:**
```json
{
  "email": "efimzer@gmail.com",
  "createdAt": "2025-09-30T12:34:56.789Z",
  "activeSessions": 2,
  "sessions": [
    {
      "token": "78be5482...",
      "createdAt": "2025-09-30T12:34:56.789Z"
    },
    {
      "token": "c74c5089...",
      "createdAt": "2025-09-30T13:45:12.345Z"
    }
  ],
  "state": {
    "folders": 5,
    "tasks": 3,
    "archivedTasks": 0,
    "lastUpdate": "2025-09-30T14:23:45.678Z"
  }
}
```

---

## Примеры использования:

### Проверить какие пользователи зарегистрированы:
```bash
curl https://task-man-rf22.onrender.com/api/debug/stats
```

### Посмотреть данные конкретного пользователя:
```bash
curl https://task-man-rf22.onrender.com/api/debug/user/efimzer@gmail.com
```

### Проверить сколько задач у пользователя:
```bash
curl https://task-man-rf22.onrender.com/api/debug/user/efimzer@gmail.com | jq '.state.tasks'
```

---

## Безопасность:

⚠️ **Эти endpoints открыты для всех!** 

Если хотите защитить (в production):

1. Добавить API key:
```javascript
app.get('/api/debug/stats', (req, res) => {
  if (req.headers['x-api-key'] !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // ...
});
```

2. Или сделать доступными только для authenticated users:
```javascript
app.get('/api/debug/stats', requireAuth, (req, res) => {
  // ...
});
```

3. Или добавить IP whitelist в Render.com настройках

---

## Альтернатива: Render.com Shell

Если нужен полный доступ к `storage.json`:

```
1. Render.com → task-man-rf22
2. Shell tab
3. Выполнить:
```

```bash
# Показать весь файл
cat server/storage.json

# Показать только emails
cat server/storage.json | grep -o '"email":"[^"]*"' | sort | uniq

# Показать с форматированием
cat server/storage.json | python3 -m json.tool
```

---

**После деплоя попробуйте:** 
```
https://task-man-rf22.onrender.com/api/debug/stats
```

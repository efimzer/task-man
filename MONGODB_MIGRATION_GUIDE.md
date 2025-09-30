# 🚀 МИГРАЦИЯ НА MONGODB - Пошаговая инструкция

## ✅ Что уже готово:

1. ✅ `package.json` - добавлен mongodb драйвер
2. ✅ `server/index-mongodb.js` - новый код с MongoDB
3. ⏳ Ждём ваш MongoDB connection string

---

## Шаг 1: Получить Connection String из MongoDB Atlas

После создания кластера в MongoDB Atlas:

```
Database → Connect → Drivers → Node.js

Скопируйте строку вида:
mongodb+srv://todoapp:<password>@todo-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

**Замените `<password>` на реальный пароль!**

---

## Шаг 2: Добавить MONGO_URI в Render.com

```
1. Render.com → task-man-rf22
2. Environment tab
3. Add Environment Variable:

Key: MONGO_URI
Value: mongodb+srv://todoapp:YOUR_PASSWORD@todo-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

**ВАЖНО:** Не забудьте заменить YOUR_PASSWORD на реальный пароль!

---

## Шаг 3: Заменить файл и задеплоить

```bash
cd /Users/efimzer/todo-ext

# Backup старого файла (на всякий случай)
cp server/index.js server/index-old.js

# Заменить на новый с MongoDB
cp server/index-mongodb.js server/index.js

# Commit и push
git add .
git commit -m "feat: migrate to MongoDB Atlas

- Replace JSON file storage with MongoDB
- Persistent storage survives deploys
- Automatic session cleanup with TTL
- Version 1.0.6-mongodb
"
git push origin main
```

---

## Шаг 4: Проверить деплой (2 мин)

### 4.1 Проверить логи Render:
```
Render.com → Logs

Должно быть:
🔄 Connecting to MongoDB...
✅ Connected to MongoDB successfully
✅ Todo sync server running on port 8787
```

**Если ошибка:**
```
❌ MongoDB connection failed: MongoServerError: bad auth
```
→ Неправильный пароль в MONGO_URI

```
❌ MONGO_URI environment variable is required!
```
→ MONGO_URI не добавлена в Environment

### 4.2 Проверить /health:
```
https://task-man-rf22.onrender.com/health
```

**Должно быть:**
```json
{
  "ok": true,
  "version": "1.0.6-mongodb",
  "cookieSecure": true,
  "nodeEnv": "production",
  "dbConnected": true,
  "timestamp": "2025-09-30T..."
}
```

**Если `dbConnected: false`:**
→ Проблема с подключением к MongoDB
→ Проверить логи Render

---

## Шаг 5: Создать первого пользователя (1 мин)

```
1. https://task-man-rf22.onrender.com/auth
2. Register с вашим email
3. Создать задачу
```

---

## Шаг 6: Проверить что данные в MongoDB (30 сек)

```
https://task-man-rf22.onrender.com/api/debug/stats
```

**Должно быть:**
```json
{
  "users": 1,
  "sessions": 1,
  "states": 1,
  "userEmails": ["efimzer@gmail.com"],
  "stateEmails": ["efimzer@gmail.com"]
}
```

**Если users: 0:**
→ Регистрация не прошла
→ Проверить логи

---

## Шаг 7: Тест persistence (1 мин)

### 7.1 Создать задачу:
```
Создать задачу "Test task 1"
```

### 7.2 Redeploy (симуляция deploy):
```
Render.com → Manual Deploy
```

### 7.3 После deploy проверить:
```
1. Login
2. ✅ Задача "Test task 1" всё ещё там!
```

**Если задача пропала:**
→ Что-то не так с MongoDB
→ Проверить логи

---

## Шаг 8: Проверить синхронизацию (2 мин)

### 8.1 В веб создать задачу:
```
"Task from web"
```

### 8.2 Открыть расширение:
```
Подождать 5 сек
→ ✅ "Task from web" видна
```

### 8.3 В расширении создать задачу:
```
"Task from extension"
```

### 8.4 Обновить веб (F5):
```
→ ✅ Обе задачи видны
```

---

## Преимущества MongoDB:

### ✅ БЫЛО (JSON файл):
```
❌ Данные теряются при deploy
❌ Нет concurrent access control
❌ Весь файл в памяти
❌ Нет автоматических backup
```

### ✅ СТАЛО (MongoDB):
```
✅ Данные НЕ теряются при deploy
✅ Concurrent access
✅ Индексы для быстрого поиска
✅ Автоматические backup
✅ TTL индексы для auto-cleanup
✅ Масштабируемость
✅ 512MB бесплатно
```

---

## Структура MongoDB:

### Database: `todo_app`

### Collection: `users`
```json
{
  "_id": ObjectId("..."),
  "email": "efimzer@gmail.com",
  "salt": "abc123...",
  "hash": "def456...",
  "createdAt": 1759193652949
}
```

### Collection: `sessions`
```json
{
  "_id": ObjectId("..."),
  "token": "78be5482...",
  "email": "efimzer@gmail.com",
  "createdAt": ISODate("2025-09-30T12:34:56.789Z")
}
```

### Collection: `states`
```json
{
  "_id": ObjectId("..."),
  "email": "efimzer@gmail.com",
  "folders": [...],
  "tasks": [...],
  "archivedTasks": [],
  "meta": { version: 3, updatedAt: 1759193652949 }
}
```

---

## Индексы (автоматически создаются):

```javascript
users: { email: 1 } unique
sessions: { token: 1 } unique
sessions: { email: 1 }
sessions: { createdAt: 1 } TTL (auto-delete старые)
states: { email: 1 } unique
```

---

## Если что-то пошло не так:

### Проблема 1: MongoDB connection failed
```
Render Logs:
❌ MongoServerError: bad auth

Решение:
1. Проверить пароль в MONGO_URI
2. Убедиться что < и > удалены
3. URL encode специальные символы в пароле
```

### Проблема 2: MONGO_URI not found
```
Render Logs:
❌ MONGO_URI environment variable is required!

Решение:
1. Render.com → Environment
2. Add: MONGO_URI = mongodb+srv://...
3. Redeploy
```

### Проблема 3: Network timeout
```
Render Logs:
❌ MongoNetworkError: connection timeout

Решение:
1. MongoDB Atlas → Network Access
2. Убедиться что 0.0.0.0/0 разрешен
3. Подождать 2-3 минуты
```

### Проблема 4: Database не создалась
```
/api/debug/stats возвращает users: 0

Решение:
1. Создать первого пользователя через /auth
2. MongoDB создаёт базу автоматически при первой записи
```

---

## Мониторинг MongoDB Atlas:

```
MongoDB Atlas → Clusters → todo-cluster

Metrics:
- Connections
- Operations
- Network
- Storage
```

**Free tier лимиты:**
- 512 MB storage
- 500 connections
- Shared RAM

Для todo-приложения этого более чем достаточно! ✅

---

## Backup (автоматически):

MongoDB Atlas **НЕ** делает backup на free tier, но данные персистентны.

Для ручного backup:

### Вариант A: Через mongodump (если есть локальный MongoDB)
```bash
mongodump --uri="mongodb+srv://..." --out=backup/
```

### Вариант B: Через endpoint
```bash
# Скачать все данные
curl https://task-man-rf22.onrender.com/api/debug/stats > backup.json
```

### Вариант C: Upgrade to M2+ для автоматических backup
```
MongoDB Atlas → Upgrade
M2 tier: $9/месяц с автоматическими backup
```

---

## Просмотр данных в MongoDB Atlas:

```
1. MongoDB Atlas → Database → Browse Collections
2. Выбрать todo_app
3. Выбрать collection (users/sessions/states)
4. Посмотреть документы
```

**Можно:**
- Смотреть документы
- Редактировать вручную
- Удалять
- Фильтровать
- Экспортировать в JSON

---

## Следующие шаги после миграции:

### 1. Создать первого пользователя:
```
https://task-man-rf22.onrender.com/auth
→ Register
```

### 2. Проверить что данные сохраняются:
```
1. Создать задачу
2. Manual Deploy в Render
3. Проверить что задача осталась
```

### 3. Проверить синхронизацию веб ↔ расширение:
```
1. Создать задачу в веб
2. Открыть расширение → видна
3. Создать задачу в расширении
4. Обновить веб → видна
```

### 4. Протестировать logout/login:
```
1. Logout
2. Login
3. Все данные на месте
```

---

## Чеклист миграции:

- [ ] MongoDB Atlas кластер создан
- [ ] Database user создан (todoapp)
- [ ] Network access настроен (0.0.0.0/0)
- [ ] Connection string получен
- [ ] MONGO_URI добавлен в Render Environment
- [ ] server/index.js заменён на MongoDB версию
- [ ] package.json обновлён (mongodb dependency)
- [ ] Код закоммичен и запушен
- [ ] Deploy успешный
- [ ] /health показывает dbConnected: true
- [ ] Создан первый пользователь
- [ ] /api/debug/stats показывает users: 1
- [ ] Задача создана и сохранилась после redeploy
- [ ] Синхронизация работает

---

## Время миграции:

- MongoDB Atlas setup: 5-10 мин
- Render Environment setup: 2 мин
- Deploy: 2-3 мин
- Тестирование: 5 мин

**Всего: ~15-20 минут** ⏱️

---

## Что делать СЕЙЧАС:

1. **Завершить создание MongoDB Atlas** (если ещё не сделали)
2. **Скопировать Connection String**
3. **Прислать мне** (можно замазать пароль)
4. **Я помогу добавить в Render и задеплоить**

---

**Готовы? Пришлите Connection String и начнём! 🚀**

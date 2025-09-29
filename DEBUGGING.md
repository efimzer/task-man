# Todo Extension - Debugging Guide

## Проблема: Потеря данных пользователей

### Симптомы
- После входа через 30+ минут данные (папки/задачи) пропадают
- При повторном /login показывает "такого аккаунта не существует"
- Можно зарегистрировать второй аккаунт на ту же почту

### Причины
1. **Несоответствие структуры данных** - старая структура `users` как массив vs новая как объект
2. **Состояния не сохраняются** - `states` остается пустым объектом
3. **Сессии теряются** - маппинг userId -> email не работает после перезапуска

### Исправления

#### 1. Миграция данных
Сервер теперь автоматически мигрирует старую структуру:
- Конвертирует `users` из массива в объект с ключами email
- Обновляет `sessions` для использования email вместо userId
- Создает резервные копии перед сохранением

#### 2. Логирование
Добавлено подробное логирование для отслеживания:
```
[REGISTER] Creating new user: user@example.com
[LOGIN] Attempt for user@example.com
[LOGIN SUCCESS] user@example.com, state exists: true
[STATE UPDATE] Updating state for user@example.com, folders: 4, tasks: 10
[PERSIST] Saved data: 5 users, 5 states, 12 sessions
```

#### 3. Автосохранение
- Автоматическое сохранение каждые 5 минут
- Backup файл создается перед каждым сохранением

### Диагностика

#### Проверить текущее состояние
```bash
curl http://localhost:8787/api/debug/stats
```

Ответ покажет:
```json
{
  "users": 5,
  "sessions": 12,
  "states": 5,
  "userEmails": ["user1@example.com", "user2@example.com"],
  "stateEmails": ["user1@example.com", "user2@example.com"]
}
```

#### Проверить логи сервера
```bash
# При запуске сервера
npm start

# Смотрите логи для диагностики:
[PERSIST] Saved data: X users, Y states, Z sessions
[LOGIN ERROR] User not found: user@example.com. Available users: ...
```

### Восстановление данных

#### Если данные потеряны
1. Остановите сервер
2. Проверьте backup файл:
```bash
cat server/storage.json.backup
```

3. Восстановите из backup (если нужно):
```bash
cp server/storage.json.backup server/storage.json
```

4. Запустите сервер - миграция произойдет автоматически

### Структура storage.json

#### Правильная структура:
```json
{
  "users": {
    "user@example.com": {
      "email": "user@example.com",
      "salt": "...",
      "hash": "...",
      "createdAt": 1234567890
    }
  },
  "sessions": {
    "token123": {
      "email": "user@example.com",
      "createdAt": 1234567890
    }
  },
  "states": {
    "user@example.com": {
      "meta": { "version": 0, "updatedAt": 1234567890 },
      "folders": [...],
      "tasks": [...],
      "archivedTasks": [],
      "ui": { ... }
    }
  },
  "legacyState": null
}
```

#### Старая (неправильная) структура:
```json
{
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "passwordHash": "..."
    }
  ],
  "sessions": {
    "token123": {
      "userId": "uuid",
      ...
    }
  },
  "states": {}  // ПУСТО!
}
```

### Тестирование

1. **Регистрация нового пользователя**:
```bash
curl -X POST http://localhost:8787/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

2. **Проверка создания состояния**:
```bash
curl http://localhost:8787/api/debug/stats
# Должно показать test@example.com в stateEmails
```

3. **Вход**:
```bash
curl -X POST http://localhost:8787/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

4. **Получение состояния**:
```bash
curl http://localhost:8787/state \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Мониторинг

Следите за логами для выявления проблем:
- `[PERSIST ERROR]` - проблемы с сохранением
- `[LOGIN ERROR] User not found` - пользователь исчез из памяти
- `[STATE UPDATE ERROR]` - проблемы с обновлением состояния

### Превентивные меры

1. Регулярно проверяйте `/api/debug/stats`
2. Следите за размером `storage.json`
3. Проверяйте backup файлы
4. Мониторьте логи сервера
5. Проверяйте, что `states` не пустой после регистрации/входа

### Production Checklist

- [ ] Настроены переменные окружения (SESSION_TTL, COOKIE_SECURE)
- [ ] Настроено регулярное резервное копирование storage.json
- [ ] Настроен мониторинг логов
- [ ] Проверено, что миграция работает корректно
- [ ] Протестирован полный цикл: регистрация -> вход -> сохранение состояния -> выход -> вход

### Контакты для поддержки

При обнаружении проблем соберите:
1. Логи сервера (последние 100 строк)
2. Вывод `/api/debug/stats`
3. Содержимое `storage.json` (без паролей!)
4. Шаги для воспроизведения проблемы

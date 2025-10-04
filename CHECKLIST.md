# 🚀 Чеклист миграции на Supabase

## ✅ Уже сделано

- [x] Обновлен `manifest.json` (версия 2.0.0, host_permissions для Supabase)
- [x] Обновлен `background.js` (убраны cookies, добавлена работа с Supabase session)
- [x] Создан `scripts/supabase-client.js` (клиент Supabase)
- [x] Создан `scripts/supabase-auth.js` (методы аутентификации)
- [x] Создан `scripts/supabase-sync.js` (синхронизация + realtime)
- [x] Создан `scripts/supabase-integration.js` (адаптеры для совместимости)
- [x] Создана документация:
  - `SUPABASE_MIGRATION.md` - детальная информация о миграции
  - `INTEGRATION_GUIDE.md` - пошаговая инструкция по интеграции
- [x] Установлена зависимость `@supabase/supabase-js@^2.58.0`

## 📋 Что нужно сделать

### 1. Настройка Supabase проекта

- [ ] Зайти в [Supabase Dashboard](https://supabase.com/dashboard)
- [ ] Создать новый проект (или использовать существующий)
- [ ] Скопировать `SUPABASE_URL` и `SUPABASE_ANON_KEY` из Settings → API
- [ ] Вставить ключи в `scripts/supabase-client.js`:
  ```javascript
  const SUPABASE_URL = 'https://your-project.supabase.co';
  const SUPABASE_ANON_KEY = 'your-anon-key';
  ```

### 2. Создание таблицы в БД

- [ ] Открыть SQL Editor в Supabase Dashboard
- [ ] Скопировать SQL из файла `SUPABASE_MIGRATION.md` (раздел "Структура базы данных")
- [ ] Выполнить SQL-скрипт
- [ ] Проверить результат:
  - [ ] Таблица `states` создана
  - [ ] Индексы созданы
  - [ ] Триггер `update_states_updated_at` создан
  - [ ] RLS включён (Row Level Security)
  - [ ] 4 политики созданы
  - [ ] Realtime включён для таблицы `states`

### 3. Настройка Email Authentication

Выберите один из вариантов:

**Вариант A: Отключить подтверждение email (для тестирования)**
- [ ] Settings → Authentication → Email → **Enable email confirmations**: OFF

**Вариант B: Настроить SMTP (для продакшна)**
- [ ] Settings → Authentication → SMTP Settings
- [ ] Заполнить данные SMTP-сервера

### 4. Обновление кода приложения

- [ ] Открыть `scripts/sidepanel.js`
- [ ] Найти строку: `const USE_SUPABASE = true;`
- [ ] Убедиться, что флаг установлен в `true`
- [ ] Заменить импорты:
  ```javascript
  // БЫЛО:
  import { createSyncManager } from './sync.js';
  import { authStore } from './auth.js';
  
  // СТАЛО:
  import { authStoreAdapter, syncManagerAdapter } from './supabase-integration.js';
  ```
- [ ] Заменить использование:
  ```javascript
  // БЫЛО:
  const syncManager = createSyncManager({...});
  await authStore.login(email, password);
  
  // СТАЛО:
  const syncManager = syncManagerAdapter;
  await authStoreAdapter.login(email, password);
  ```

### 5. Обновление обработчиков событий

**Вход/Регистрация:**
- [ ] Заменить `handleAuthSubmit()` на Supabase версию (см. `INTEGRATION_GUIDE.md`)

**Загрузка состояния:**
- [ ] Заменить `loadState()` на `syncManagerAdapter.loadState()`

**Сохранение состояния:**
- [ ] Заменить все вызовы сохранения на `syncManagerAdapter.saveState(state)`

**Realtime подписка:**
- [ ] Добавить `syncManagerAdapter.startSync(callback)` после успешного входа

**Выход:**
- [ ] Добавить `syncManagerAdapter.stopSync()` перед выходом

### 6. Тестирование расширения

**Регистрация:**
- [ ] Открыть расширение
- [ ] Нажать "Регистрация"
- [ ] Ввести email и пароль (минимум 6 символов)
- [ ] Проверить в Supabase Dashboard → Authentication → Users
- [ ] Проверить в Supabase Dashboard → Table Editor → states

**Вход:**
- [ ] Перезагрузить расширение
- [ ] Войти с теми же данными
- [ ] Убедиться, что состояние загрузилось

**Синхронизация:**
- [ ] Создать задачу
- [ ] Проверить в Table Editor → states, что данные сохранились
- [ ] Проверить в консоли: `💾 Saved state to Supabase`

**Realtime:**
- [ ] Открыть расширение в двух окнах Chrome
- [ ] Войти в обоих под одним аккаунтом
- [ ] Создать задачу в первом окне
- [ ] Проверить, что задача **мгновенно** появилась во втором окне
- [ ] Проверить в консоли второго окна: `🔔 Realtime update received`

**Выход:**
- [ ] Нажать "Выйти"
- [ ] Проверить, что показывается форма входа
- [ ] Проверить, что сессия очищена

### 7. Отладка (если что-то не работает)

**Проблема: "Failed to fetch"**
- [ ] Проверить SUPABASE_URL в `supabase-client.js`
- [ ] Проверить SUPABASE_ANON_KEY в `supabase-client.js`
- [ ] Проверить `host_permissions` в `manifest.json`
- [ ] Перезагрузить расширение: chrome://extensions → ⟳

**Проблема: "Invalid login credentials"**
- [ ] Проверить, что email подтверждён (если включено)
- [ ] Попробовать зарегистрировать нового пользователя
- [ ] Проверить в Authentication → Users, что пользователь существует

**Проблема: "Row Level Security"**
- [ ] Открыть SQL Editor
- [ ] Выполнить: `SELECT * FROM public.states;`
- [ ] Если ошибка RLS - выполнить политики из `SUPABASE_MIGRATION.md`

**Проблема: Realtime не работает**
- [ ] Database → Replication → проверить, что `states` в списке
- [ ] В консоли должно быть: `📡 Subscription status: SUBSCRIBED`
- [ ] Если нет - выполнить: `ALTER PUBLICATION supabase_realtime ADD TABLE public.states;`

**Проблема: Данные не сохраняются**
- [ ] Открыть консоль DevTools
- [ ] Проверить наличие ошибок
- [ ] Проверить, что `user_id` совпадает в auth.users и states
- [ ] Выполнить вручную в консоли:
  ```javascript
  const state = await syncManagerAdapter.loadState();
  console.log('State:', state);
  ```

### 8. Веб-версия (опционально)

Если есть веб-версия приложения:

- [ ] Обновить `web/index.html` - подключить Supabase модули
- [ ] Создать отдельный конфиг для веб-версии
- [ ] Протестировать вход/регистрацию в браузере
- [ ] Протестировать синхронизацию между расширением и веб-версией

### 9. Финальная проверка

- [ ] Создать несколько папок и задач
- [ ] Архивировать задачи
- [ ] Проверить все CRUD операции
- [ ] Протестировать на разных устройствах
- [ ] Убедиться, что realtime работает стабильно
- [ ] Проверить производительность (должна быть лучше, чем на Render)

### 10. Очистка старого кода (опционально)

После успешной миграции можно удалить:
- [ ] `scripts/sync.js` (старый sync manager)
- [ ] `scripts/auth.js` (старый auth store)
- [ ] `scripts/sync-config.js` (конфиг для Render)
- [ ] Старые ссылки на `task-man-rf22.onrender.com`

## 📊 Ожидаемый результат

После выполнения всех пунктов:

✅ **Аутентификация через Supabase**
- Регистрация и вход работают
- Сессия сохраняется при перезагрузке
- Выход корректно очищает данные

✅ **Синхронизация данных**
- Состояние сохраняется в PostgreSQL
- Загрузка работает при каждом входе
- Изменения сразу сохраняются в БД

✅ **Realtime обновления**
- Изменения на одном устройстве мгновенно отображаются на других
- Работает между расширением и веб-версией
- Работает между несколькими окнами расширения

✅ **Безопасность**
- RLS защищает данные каждого пользователя
- Пользователи видят только свои данные
- JWT токены обновляются автоматически

✅ **Производительность**
- Быстрее, чем на Render
- Нет задержек при загрузке
- Realtime работает без лагов

## 🎉 Готово!

Поздравляю! Ваше расширение теперь работает на Supabase с realtime синхронизацией!

## 📚 Полезные ссылки

- [Supabase Dashboard](https://supabase.com/dashboard)
- [Supabase Docs](https://supabase.com/docs)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Realtime Guide](https://supabase.com/docs/guides/realtime)

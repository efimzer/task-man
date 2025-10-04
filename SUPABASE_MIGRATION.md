# Миграция на Supabase

## Изменения в проекте

### 1. Обновлен `manifest.json`
- Версия изменена на `2.0.0`
- Убрано разрешение `cookies` (больше не нужно)
- `host_permissions` теперь указывает на Supabase: `https://jkyhbvihckgsinhoygey.supabase.co/*`
- Добавлен `type: "module"` для service worker
- Добавлена `content_security_policy` для поддержки WebAssembly (требуется для Supabase)

### 2. Обновлен `background.js`
- Удалена логика работы с cookies (не нужна для Supabase)
- Добавлена проверка сессии Supabase через `chrome.storage.local`
- Supabase автоматически сохраняет сессию в localStorage/storage

### 3. Структура базы данных Supabase

Создайте таблицу `states` в Supabase:

```sql
-- Таблица для хранения состояния пользователей
CREATE TABLE public.states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  email TEXT NOT NULL,
  meta JSONB DEFAULT '{"version": 0, "updatedAt": 0}'::jsonb,
  folders JSONB DEFAULT '[]'::jsonb,
  tasks JSONB DEFAULT '[]'::jsonb,
  archived_tasks JSONB DEFAULT '[]'::jsonb,
  ui JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы для быстрого поиска
CREATE INDEX idx_states_user_id ON public.states(user_id);
CREATE INDEX idx_states_email ON public.states(email);

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_states_updated_at ON public.states;
CREATE TRIGGER update_states_updated_at
  BEFORE UPDATE ON public.states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Включаем Realtime для таблицы
ALTER PUBLICATION supabase_realtime ADD TABLE public.states;

-- Включаем Row Level Security
ALTER TABLE public.states ENABLE ROW LEVEL SECURITY;

-- Политики безопасности
DROP POLICY IF EXISTS "Users can read own state" ON public.states;
DROP POLICY IF EXISTS "Users can insert own state" ON public.states;
DROP POLICY IF EXISTS "Users can update own state" ON public.states;
DROP POLICY IF EXISTS "Users can delete own state" ON public.states;

CREATE POLICY "Users can read own state"
  ON public.states FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own state"
  ON public.states FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own state"
  ON public.states FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own state"
  ON public.states FOR DELETE
  USING (auth.uid() = user_id);
```

### 4. Настройка Supabase Email

В Supabase Dashboard:
1. Перейдите в **Authentication → Email Templates**
2. Отключите подтверждение email (для тестирования):
   - **Settings → Auth → Email confirmation**: OFF
3. Или настройте SMTP для отправки писем подтверждения

### 5. Архитектура синхронизации

#### Файлы:
- `scripts/supabase-client.js` - клиент Supabase с настройками
- `scripts/supabase-auth.js` - методы аутентификации
- `scripts/supabase-sync.js` - синхронизация состояния + realtime

#### Как это работает:

1. **Аутентификация**:
   - Вход/регистрация через `supabaseAuth.signIn()` / `signUp()`
   - Сессия автоматически сохраняется в chrome.storage.local
   - При перезагрузке сессия восстанавливается

2. **Синхронизация**:
   - `supabaseSync.loadState()` - загрузка состояния из БД
   - `supabaseSync.saveState(state)` - сохранение в БД (upsert)
   - Автоматический upsert по `user_id`

3. **Realtime обновления**:
   - `supabaseSync.subscribe(onUpdate)` - подписка на изменения
   - При изменении в БД срабатывает callback `onUpdate(newState)`
   - Работает между всеми устройствами пользователя в реальном времени

### 6. Использование в коде

```javascript
import { supabaseAuth } from './scripts/supabase-auth.js';
import { supabaseSync } from './scripts/supabase-sync.js';

// Вход
await supabaseAuth.signIn('user@example.com', 'password');

// Загрузка состояния
const state = await supabaseSync.loadState();

// Сохранение
await supabaseSync.saveState(currentState);

// Подписка на обновления
supabaseSync.subscribe((newState) => {
  console.log('State updated from another device!', newState);
  // Обновляем UI
});

// Выход
await supabaseAuth.signOut();
await supabaseSync.unsubscribe();
```

### 7. Преимущества миграции на Supabase

✅ **Realtime синхронизация** - изменения мгновенно отображаются на всех устройствах  
✅ **Безопасность** - Row Level Security защищает данные каждого пользователя  
✅ **Масштабируемость** - PostgreSQL + автоматический бэкап  
✅ **Простота** - меньше кода, нет необходимости в собственном сервере  
✅ **Бесплатный tier** - 500 МБ БД + 50 МБ файлов + 2 ГБ трафика  

### 8. Что нужно сделать для запуска

1. ✅ Создать проект в Supabase
2. ✅ Выполнить SQL-скрипт для создания таблицы `states`
3. ✅ Скопировать `SUPABASE_URL` и `SUPABASE_ANON_KEY` в `supabase-client.js`
4. ✅ Обновить `manifest.json` (уже сделано)
5. ✅ Обновить `background.js` (уже сделано)
6. 🔄 Интегрировать supabase-sync в sidepanel.js вместо старого sync.js
7. 🔄 Протестировать вход/регистрацию
8. 🔄 Протестировать realtime синхронизацию между устройствами

### 9. Отличия от старой версии

| Старая версия (Render) | Новая версия (Supabase) |
|------------------------|-------------------------|
| Cookies для auth | JWT токены в storage |
| REST API запросы | Supabase SDK |
| Ручная синхронизация | Автоматический realtime |
| Custom backend | Managed backend |
| Проверка конфликтов вручную | Встроенная работа с конфликтами |

### 10. Миграция данных пользователей

Если нужно мигрировать существующих пользователей:

```javascript
// Скрипт миграции (запустить один раз)
async function migrateFromRender() {
  // 1. Получить данные со старого API
  const response = await fetch('https://task-man-rf22.onrender.com/state', {
    headers: { 'Authorization': `Bearer ${oldToken}` }
  });
  const oldState = await response.json();
  
  // 2. Войти в Supabase
  await supabaseAuth.signIn(email, password);
  
  // 3. Сохранить в Supabase
  await supabaseSync.saveState({
    meta: oldState.meta,
    folders: oldState.folders,
    tasks: oldState.tasks,
    archivedTasks: oldState.archivedTasks,
    ui: oldState.ui
  });
  
  console.log('Migration complete!');
}
```

## Готово! 🎉

Теперь ваше расширение использует Supabase для аутентификации и синхронизации в реальном времени.

# 🚀 Быстрый старт: Миграция на Supabase

## Команды для копирования

### 1. Создать ветку
```bash
cd /Users/efimzer/todo-ext

# Сохранить текущее состояние
git add .
git commit -m "chore: save state before supabase migration"

# Создать новую ветку
git checkout -b feature/supabase-realtime

# Проверить
git branch
```

### 2. Установить Supabase SDK
```bash
npm install @supabase/supabase-js
```

### 3. Создать Supabase проект

1. https://supabase.com → New Project
2. Name: `gofimago-todo`
3. Region: `East US`
4. Plan: `Free`

### 4. SQL Schema (скопировать в SQL Editor)

```sql
-- Enable UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- States table
CREATE TABLE public.states (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  meta JSONB DEFAULT '{"version": 0}'::jsonb,
  folders JSONB DEFAULT '[]'::jsonb,
  tasks JSONB DEFAULT '[]'::jsonb,
  archived_tasks JSONB DEFAULT '[]'::jsonb,
  ui JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_states_user_id ON public.states(user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_states_updated_at
  BEFORE UPDATE ON public.states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.states;

-- Enable RLS
ALTER TABLE public.states ENABLE ROW LEVEL SECURITY;

-- RLS Policies
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

### 5. Получить API Keys

```
Supabase Dashboard → Settings → API

Скопировать:
- Project URL (SUPABASE_URL)
- anon public key (SUPABASE_ANON_KEY)
```

### 6. Создать файлы

#### `scripts/supabase-client.js`
```javascript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xxxxx.supabase.co'; // ← ЗАМЕНИТЬ
const SUPABASE_ANON_KEY = 'eyJhbGc...'; // ← ЗАМЕНИТЬ

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
```

#### `scripts/supabase-auth.js`
```javascript
import { supabase } from './supabase-client.js';

export const supabaseAuth = {
  async signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  },

  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  }
};
```

#### `scripts/supabase-sync.js`
```javascript
import { supabase, getCurrentUser } from './supabase-client.js';

let channel = null;

export const supabaseSync = {
  async loadState() {
    const user = await getCurrentUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('states')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;

    return {
      meta: data.meta,
      folders: data.folders,
      tasks: data.tasks,
      archivedTasks: data.archived_tasks,
      ui: data.ui
    };
  },

  async saveState(state) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('states')
      .upsert({
        user_id: user.id,
        email: user.email,
        meta: state.meta,
        folders: state.folders,
        tasks: state.tasks,
        archived_tasks: state.archivedTasks,
        ui: state.ui
      }, { onConflict: 'user_id' });

    if (error) throw error;
  },

  async subscribe(onUpdate) {
    const user = await getCurrentUser();
    if (!user) return;

    if (channel) {
      await supabase.removeChannel(channel);
    }

    channel = supabase
      .channel('states-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'states',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        console.log('🔔 Realtime update:', payload);
        if (payload.new) {
          onUpdate({
            meta: payload.new.meta,
            folders: payload.new.folders,
            tasks: payload.new.tasks,
            archivedTasks: payload.new.archived_tasks,
            ui: payload.new.ui
          });
        }
      })
      .subscribe();
  },

  async unsubscribe() {
    if (channel) {
      await supabase.removeChannel(channel);
      channel = null;
    }
  }
};
```

### 7. Минимальные изменения в sidepanel.js

Добавить в начало файла:
```javascript
import { supabase } from './supabase-client.js';
import { supabaseAuth } from './supabase-auth.js';
import { supabaseSync } from './supabase-sync.js';
```

Заменить инициализацию:
```javascript
// Проверить сессию
const { data: { session } } = await supabase.auth.getSession();

if (session) {
  // Загрузить состояние
  let loadedState = await supabaseSync.loadState();
  if (loadedState) {
    state = loadedState;
  } else {
    state = defaultState();
    await supabaseSync.saveState(state);
  }
  
  // Подписаться на обновления
  await supabaseSync.subscribe((newState) => {
    state = newState;
    render();
  });
  
  render();
} else {
  showAuthOverlay();
}

// Следить за auth
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN') {
    hideAuthOverlay();
    let loadedState = await supabaseSync.loadState();
    if (loadedState) {
      state = loadedState;
    }
    await supabaseSync.subscribe((newState) => {
      state = newState;
      render();
    });
    render();
  } else if (event === 'SIGNED_OUT') {
    await supabaseSync.unsubscribe();
    showAuthOverlay();
  }
});
```

Обновить `persistState()`:
```javascript
function persistState() {
  state.meta.version = (state.meta.version || 0) + 1;
  state.meta.updatedAt = Date.now();
  
  supabaseSync.saveState(state).catch((err) => {
    console.error('Failed to save:', err);
  });
}
```

Обновить обработчики auth формы:
```javascript
// В обработчике submit формы
if (authMode === 'login') {
  await supabaseAuth.signIn(email, password);
} else {
  await supabaseAuth.signUp(email, password);
}

// В обработчике logout
await supabaseAuth.signOut();

// В обработчике forgot password
await supabaseAuth.resetPassword(email);
```

### 8. Тест

```bash
# Запустить локально
npx serve web -p 8787

# Открыть 2 вкладки
# http://localhost:8787
```

**Проверить:**
```
✅ Регистрация
✅ Вход
✅ Создать задачу → сохраняется
✅ Открыть 2 вкладку → задача появляется МГНОВЕННО!
✅ Изменить в одной → меняется в другой < 100ms
```

### 9. Деплой на Vercel

```bash
# Установить Vercel CLI
npm i -g vercel

# Деплой
cd /Users/efimzer/todo-ext
vercel

# Настроить:
# Root: ./
# Output: web
```

В Vercel Dashboard → Settings → Environment Variables:
```
SUPABASE_URL = https://xxxxx.supabase.co
SUPABASE_ANON_KEY = eyJhbGc...
```

### 10. Коммит

```bash
git add .
git commit -m "feat: migrate to Supabase with WebSocket realtime

- Replace MongoDB with PostgreSQL (Supabase)
- Replace polling with WebSocket real-time
- Add Supabase Auth
- Remove Express backend (not needed)
- < 100ms sync latency (vs 5 sec polling)
"

git push origin feature/supabase-realtime
```

---

## Сравнение производительности

### Было (MongoDB + Polling):
```
Задержка синхронизации: ~5000ms
Запросов в минуту: 12 (polling)
Backend: Render.com $9/мес
Конфликты: Ручная обработка
```

### Стало (Supabase + WebSocket):
```
Задержка синхронизации: < 100ms ⚡
Запросов: 1 WebSocket (постоянное соединение)
Backend: Не нужен ($0) ✅
Конфликты: PostgreSQL MVCC
```

---

## Checklist

```
☐ Создать ветку feature/supabase-realtime
☐ Создать Supabase проект
☐ Запустить SQL schema
☐ Получить API keys
☐ npm install @supabase/supabase-js
☐ Создать supabase-client.js
☐ Создать supabase-auth.js
☐ Создать supabase-sync.js
☐ Обновить sidepanel.js
☐ Тест: регистрация работает
☐ Тест: real-time работает (2 вкладки)
☐ Деплой на Vercel
☐ Тест production
☐ Merge в main
```

---

## Помощь

**Документация:**
- https://supabase.com/docs
- https://supabase.com/docs/guides/auth
- https://supabase.com/docs/guides/realtime

**Troubleshooting:**
```javascript
// Проверить подключение
console.log(await supabase.from('states').select('count'));

// Проверить auth
console.log(await supabase.auth.getSession());

// Проверить realtime
supabase.channel('test').subscribe((status) => {
  console.log('Status:', status);
});
```

---

**Ветка:** `feature/supabase-realtime`  
**Время миграции:** ~2-3 часа  
**Результат:** ⚡ Мгновенная синхронизация!

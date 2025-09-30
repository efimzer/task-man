# 🔥 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ - Token не сохранялся

## Проблема

**Симптомы:**
- Каждое обновление страницы требует авторизации
- Token = null в localStorage
- Все пользователи видят одни задачи

**Причина:**
`scripts/auth.js` в веб-версии **НЕ** сохранял token в localStorage (только user).

```javascript
// БЫЛО (НЕПРАВИЛЬНО):
async function persistToStorage() {
  // В веб-версии: сохраняем только user
  if (currentUser) {
    writeLocalStorage(STORAGE_USER_KEY, JSON.stringify(currentUser));
  }
  // ❌ Token НЕ сохраняется!
}
```

**Результат:**
- При обновлении страницы → `token: null`
- AuthStore считает что не залогинены
- Показывает форму входа
- Backend берет `legacyState` для всех (одни задачи)

---

## Решение

**Исправлено в `/scripts/auth.js`:**

```javascript
// СТАЛО (ПРАВИЛЬНО):
async function persistToStorage() {
  // В веб-версии: сохраняем И token И user
  if (currentToken) {
    writeLocalStorage(STORAGE_TOKEN_KEY, currentToken); // ✅ Сохраняем token!
  } else {
    writeLocalStorage(STORAGE_TOKEN_KEY, null);
  }
  
  if (currentUser) {
    writeLocalStorage(STORAGE_USER_KEY, JSON.stringify(currentUser));
  } else {
    writeLocalStorage(STORAGE_USER_KEY, null);
  }
}
```

**Теперь:**
- Token сохраняется в localStorage
- При обновлении страницы → token загружается
- Не требует повторного входа ✅
- Каждый пользователь видит свои задачи ✅

---

## Как проверить

### 1. Очистить старые данные:
```javascript
// В консоли веб (F12)
localStorage.clear();
location.reload();
```

### 2. Войти заново:
```
1. https://task-man-rf22.onrender.com/auth
2. Email: efimzer@gmail.com
3. Password: ваш пароль
4. Войти
```

### 3. Проверить localStorage:
```javascript
// В консоли веб
console.log({
  token: localStorage.getItem('todoAuthToken'),
  user: localStorage.getItem('todoAuthUser')
});

// Должно вернуть:
{
  token: "abcd1234..." // ✅ Токен есть!
  user: '{"email":"efimzer@gmail.com"}'
}
```

### 4. Обновить страницу (F5):
```
✅ Должны остаться залогинены
❌ НЕ должно показывать форму входа
```

### 5. Создать задачу:
```
1. Создать папку "Test"
2. Создать задачу "My Task"
3. Обновить страницу (F5)
4. ✅ Задача остается
5. ✅ Не требует входа
```

---

## Почему cookie недостаточно

**Cookie есть, но:**
- Cookie отправляется на backend
- Frontend всё равно проверяет `authStore.getToken()`
- AuthStore грузит token из localStorage
- Если token = null → считает что не залогинены
- Показывает форму входа

**Поэтому нужны ОБА:**
- ✅ Cookie (для backend аутентификации)
- ✅ Token в localStorage (для frontend состояния)

---

## Изоляция данных по пользователям

**До:**
- Token не сохранялся
- Backend не знал пользователя
- Возвращал `legacyState` всем
- Все видели одни задачи ❌

**После:**
- Token сохраняется
- Backend идентифицирует пользователя
- Возвращает данные конкретного пользователя
- Каждый видит свои задачи ✅

---

## Backend логика

```javascript
// server/index.js

// GET /state - требует auth
app.get('/state', requireAuth, (req, res) => {
  const email = req.auth.email; // Из токена!
  const state = getStateForUser(email); // Данные этого пользователя
  res.json(state);
});

function getStateForUser(email) {
  if (!data.states[email]) {
    data.states[email] = defaultState();
  }
  return data.states[email];
}
```

**Без токена:**
- `req.auth.email` = undefined
- Middleware `requireAuth` редиректит на /auth
- Данные не загружаются

**С токеном:**
- `req.auth.email` = "efimzer@gmail.com"
- `data.states["efimzer@gmail.com"]` = ваши задачи
- Каждый пользователь изолирован ✅

---

## Проверка изоляции

### Тест 1: Разные пользователи
```
1. Войти как user1@test.com
2. Создать задачу "User 1 task"
3. Logout
4. Войти как user2@test.com
5. ✅ НЕ видим "User 1 task"
6. Создать задачу "User 2 task"
7. Logout
8. Войти как user1@test.com
9. ✅ Видим "User 1 task"
10. ✅ НЕ видим "User 2 task"
```

### Тест 2: Обновление страницы
```
1. Войти
2. Создать задачу
3. Обновить страницу (F5)
4. ✅ Остались залогинены
5. ✅ Задача осталась
```

### Тест 3: Закрытие/открытие вкладки
```
1. Войти
2. Создать задачу
3. Закрыть вкладку
4. Открыть https://task-man-rf22.onrender.com/web/
5. ✅ Автоматически залогинены
6. ✅ Задача видна
```

---

## Деплой

```bash
cd /Users/efimzer/todo-ext
git add scripts/auth.js
git commit -m "fix: save token to localStorage in web version"
git push origin main
```

**Render задеплоит автоматически (~2 мин)**

**Расширение:** Не требует reload (изменение только для веб)

---

## Ожидаемое поведение после исправления

### Веб-версия:
- ✅ Вход → token сохраняется
- ✅ Обновление страницы → остаемся залогинены
- ✅ Задачи сохраняются
- ✅ Каждый пользователь видит свои данные

### Расширение:
- ✅ Вход → token в chrome.storage
- ✅ Синхронизация с веб через backend
- ✅ Каждый пользователь видит свои данные

### Синхронизация:
- ✅ Веб → Расширение
- ✅ Расширение → Веб
- ✅ Данные изолированы по пользователям

---

**Приоритет:** 🔴 КРИТИЧНО  
**Статус:** ✅ ИСПРАВЛЕНО  
**Версия:** 1.0.4  
**Дата:** 2025-09-30

🎉 **Теперь всё должно работать правильно!**

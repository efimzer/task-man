# 🚀 Быстрый деплой с поддержкой Cookie синхронизации

## Шаг 1: Настройка Render.com

1. Зайдите на https://dashboard.render.com
2. Найдите ваш сервис `task-man-rf22`
3. Перейдите в **Environment**
4. Добавьте переменные:
   ```
   NODE_ENV = production
   COOKIE_SECURE = true
   ```
5. Нажмите **Save Changes**

## Шаг 2: Деплой backend

```bash
cd /Users/efimzer/todo-ext
git add .
git commit -m "feat: add cookie-based authentication sync"
git push origin main
```

Render автоматически задеплоит изменения.

## Шаг 3: Обновление расширения Chrome

### Для разработки:
1. Откройте `chrome://extensions`
2. Включите "Режим разработчика"
3. Нажмите "Загрузить распакованное расширение"
4. Выберите папку `/Users/efimzer/todo-ext`
5. Готово! ✅

### Для публикации в Chrome Web Store:
1. Создайте ZIP архив:
   ```bash
   cd /Users/efimzer/todo-ext
   zip -r gofimago-extension.zip . \
     -x "*.git*" \
     -x "*node_modules*" \
     -x "*server*" \
     -x "*web*" \
     -x "*.md"
   ```

2. Загрузите на https://chrome.google.com/webstore/devconsole

## Шаг 4: Проверка работы

### Проверьте веб-версию:
```bash
curl -i https://task-man-rf22.onrender.com/health
```

Должен вернуть:
```
HTTP/2 200 
set-cookie: todo_token=...; SameSite=None; Secure; HttpOnly
```

### Проверьте расширение:
1. Откройте расширение
2. Войдите в аккаунт
3. Откройте консоль (F12)
4. Должны увидеть:
   ```
   🍪 Background: Cookie changed
   ✅ AuthStore: Found token in cookie
   ```

## Проблемы?

Смотрите подробную документацию в `COOKIE_SYNC_GUIDE.md`

---

**Время деплоя:** ~2-3 минуты  
**Требует перезагрузки расширения:** Да  
**Обратная совместимость:** Да (token все еще в JSON)

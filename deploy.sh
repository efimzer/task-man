#!/bin/bash

# 🚀 Скрипт для быстрого деплоя исправлений

echo "📋 Todo Extension - Deploy Fixes"
echo "================================="
echo ""

# Проверка директории
if [ ! -f "server/index.js" ]; then
    echo "❌ Ошибка: запустите скрипт из корня проекта todo-ext"
    exit 1
fi

echo "✅ Проверка изменений..."
git status

echo ""
echo "📦 Файлы для коммита:"
echo "  - server/index.js (исправления)"
echo "  - server/storage.json (сброс)"
echo "  - *.md (документация)"
echo ""

read -p "Продолжить? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Отменено"
    exit 1
fi

echo "📝 Добавление файлов..."
git add server/index.js server/storage.json *.md

echo "💾 Создание коммита..."
git commit -m "Fix: Data persistence and remove double login

Major fixes:
- Add automatic migration from array-based users to object-based
- Add backup before each save  
- Add detailed logging for all operations
- Add auto-save every 5 minutes
- Add /api/debug/stats endpoint for monitoring
- Fix states not being persisted
- Fix sessions losing reference to users
- Remove requireAuth from /web routes (fix double login)

Closes: #data-loss #double-login"

echo "🚀 Push в GitHub..."
git push origin main

echo ""
echo "✅ Деплой запущен!"
echo ""
echo "📊 Следующие шаги:"
echo "1. Дождитесь деплоя в Render (5-10 минут)"
echo "2. Проверьте: curl https://task-man-rf22.onrender.com/health"
echo "3. Проверьте: curl https://task-man-rf22.onrender.com/api/debug/stats"
echo "4. Откройте: https://task-man-rf22.onrender.com/web"
echo ""
echo "📚 Документация:"
echo "  - QUICK_START.md - быстрый старт"
echo "  - SUMMARY.md - резюме изменений"
echo "  - CHECKLIST.md - полный чеклист"
echo ""

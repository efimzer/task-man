/**
 * Swipe Navigation Module
 * Handles left/right swipe gestures for internal screen navigation (SPA)
 */

export function initSwipeNavigation() {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;
  let isSwiping = false;
  let swipeTarget = null;
  
  const MIN_SWIPE_DISTANCE = 80; // минимальная дистанция для срабатывания свайпа
  const MAX_VERTICAL_DRIFT = 50; // максимальное вертикальное отклонение
  const EDGE_THRESHOLD = 50; // зона у края экрана для начала свайпа
  
  // Элементы для анимации
  const screenTasks = document.getElementById('screenTasks');
  const screenFolders = document.getElementById('screenFolders');
  const backButton = document.getElementById('backToFolders');
  
  if (!screenTasks || !screenFolders) {
    console.warn('Swipe navigation: screens not found');
    return;
  }
  
  /**
   * Применить transform для эффекта свайпа
   */
  function applySwipeTransform(element, translateX, opacity = 1) {
    if (!element) return;
    element.style.transform = `translateX(${translateX}px)`;
    element.style.opacity = String(opacity);
    element.style.transition = 'none';
  }
  
  /**
   * Сбросить transform с анимацией
   */
  function resetSwipeTransform(element, animate = true) {
    if (!element) return;
    if (animate) {
      element.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease';
    }
    element.style.transform = 'translateX(0)';
    element.style.opacity = '1';
    
    if (animate) {
      setTimeout(() => {
        element.style.transition = '';
      }, 300);
    }
  }
  
  /**
   * Анимация перехода назад к папкам
   */
  function animateNavigateBack() {
    if (!screenTasks || !backButton) return;
    
    console.log('🔙 Swipe: Navigating back to folders');
    
    // Анимация: экран задач уезжает вправо
    screenTasks.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease';
    screenTasks.style.transform = 'translateX(100%)';
    screenTasks.style.opacity = '0';
    
    // Через 100ms кликаем на кнопку "Назад" для настоящей навигации
    setTimeout(() => {
      backButton.click();
      // Сброс стилей после завершения
      setTimeout(() => {
        screenTasks.style.transition = '';
        screenTasks.style.transform = '';
        screenTasks.style.opacity = '';
      }, 100);
    }, 100);
  }
  
  /**
   * Проверка: можно ли свайпнуть назад
   */
  function canSwipeBack() {
    // Свайп назад работает только когда экран задач активен
    return screenTasks && !screenTasks.classList.contains('hidden') && screenTasks.classList.contains('is-active');
  }
  
  /**
   * Обработка начала касания
   */
  function handleTouchStart(e) {
    if (!canSwipeBack()) {
      return;
    }
    
    // Игнорируем если это input/textarea/button
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')) {
      return;
    }
    
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    
    // Проверяем что касание началось у левого края (для свайпа вправо)
    const isLeftEdge = touchStartX < EDGE_THRESHOLD;
    
    if (isLeftEdge) {
      isSwiping = true;
      swipeTarget = 'back';
    }
  }
  
  /**
   * Обработка движения
   */
  function handleTouchMove(e) {
    if (!isSwiping || !canSwipeBack()) return;
    
    const touch = e.touches[0];
    touchEndX = touch.clientX;
    touchEndY = touch.clientY;
    
    const deltaX = touchEndX - touchStartX;
    const deltaY = Math.abs(touchEndY - touchStartY);
    
    // Если слишком большое вертикальное движение - отменяем свайп
    if (deltaY > MAX_VERTICAL_DRIFT) {
      isSwiping = false;
      resetSwipeTransform(screenTasks, false);
      return;
    }
    
    // Свайп вправо (→ назад к папкам)
    if (swipeTarget === 'back' && deltaX > 0) {
      const progress = Math.max(0, Math.min(1, deltaX / window.innerWidth));
      const translateX = progress * window.innerWidth;
      const opacity = 1 - (progress * 0.3); // Лёгкое затемнение
      
      applySwipeTransform(screenTasks, translateX, opacity);
      
      // Предотвращаем прокрутку страницы если свайп достаточно горизонтальный
      if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > deltaY) {
        e.preventDefault();
      }
    }
  }
  
  /**
   * Обработка окончания касания
   */
  function handleTouchEnd(e) {
    if (!isSwiping) return;
    
    const deltaX = touchEndX - touchStartX;
    const deltaY = Math.abs(touchEndY - touchStartY);
    const absDeltaX = Math.abs(deltaX);
    
    // Проверяем что это горизонтальный свайп
    const isHorizontalSwipe = absDeltaX > deltaY;
    
    if (isHorizontalSwipe && absDeltaX > MIN_SWIPE_DISTANCE) {
      // Свайп вправо (→ назад к папкам)
      if (deltaX > 0 && swipeTarget === 'back' && canSwipeBack()) {
        animateNavigateBack();
      } else {
        resetSwipeTransform(screenTasks);
      }
    } else {
      // Свайп не завершён - возвращаем на место
      resetSwipeTransform(screenTasks);
    }
    
    isSwiping = false;
    swipeTarget = null;
    touchStartX = 0;
    touchStartY = 0;
    touchEndX = 0;
    touchEndY = 0;
  }
  
  /**
   * Обработка отмены касания
   */
  function handleTouchCancel() {
    if (isSwiping) {
      resetSwipeTransform(screenTasks);
      isSwiping = false;
      swipeTarget = null;
    }
  }
  
  // Добавляем слушатели событий
  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('touchmove', handleTouchMove, { passive: false });
  document.addEventListener('touchend', handleTouchEnd, { passive: true });
  document.addEventListener('touchcancel', handleTouchCancel, { passive: true });
  
  console.log('✅ Swipe navigation initialized (SPA mode)');
  
  // Возвращаем функцию для очистки
  return function cleanup() {
    document.removeEventListener('touchstart', handleTouchStart);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
    document.removeEventListener('touchcancel', handleTouchCancel);
  };
}

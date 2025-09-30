/**
 * Swipe Navigation Module
 * Handles left/right swipe gestures for PWA navigation
 */

export function initSwipeNavigation() {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;
  let isSwiping = false;
  let swipeTarget = null;
  
  const MIN_SWIPE_DISTANCE = 50; // минимальная дистанция для срабатывания свайпа
  const MAX_VERTICAL_DRIFT = 50; // максимальное вертикальное отклонение
  const EDGE_THRESHOLD = 50; // зона у края экрана для начала свайпа
  
  // Элементы для анимации
  const screenTasks = document.getElementById('screenTasks');
  const screenFolders = document.getElementById('screenFolders');
  
  if (!screenTasks || !screenFolders) {
    console.warn('Swipe navigation: screens not found');
    return;
  }
  
  /**
   * Применить transform для эффекта свайпа
   */
  function applySwipeTransform(element, translateX) {
    if (!element) return;
    element.style.transform = `translateX(${translateX}px)`;
    element.style.transition = 'none';
  }
  
  /**
   * Сбросить transform с анимацией
   */
  function resetSwipeTransform(element, animate = true) {
    if (!element) return;
    if (animate) {
      element.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    }
    element.style.transform = 'translateX(0)';
    
    if (animate) {
      setTimeout(() => {
        element.style.transition = '';
      }, 300);
    }
  }
  
  /**
   * Анимация навигации назад
   */
  function animateNavigateBack() {
    if (!screenTasks) return;
    
    screenTasks.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    screenTasks.style.transform = 'translateX(100%)';
    
    setTimeout(() => {
      history.back();
      // Сброс после навигации произойдёт автоматически при смене экрана
    }, 100);
  }
  
  /**
   * Проверка: можно ли свайпнуть назад
   */
  function canSwipeBack() {
    // Свайп назад работает только на экране задач
    return screenTasks && !screenTasks.classList.contains('hidden');
  }
  
  /**
   * Проверка: можно ли свайпнуть вперёд
   */
  function canSwipeForward() {
    // Свайп вперёд работает только если есть history forward
    // Пока не реализовано, можно добавить позже
    return false;
  }
  
  /**
   * Обработка начала касания
   */
  function handleTouchStart(e) {
    // Игнорируем если касание не у края экрана
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    
    // Проверяем что касание началось у левого или правого края
    const isLeftEdge = touchStartX < EDGE_THRESHOLD;
    const isRightEdge = touchStartX > window.innerWidth - EDGE_THRESHOLD;
    
    if (!isLeftEdge && !isRightEdge) {
      return;
    }
    
    // Проверяем что можем свайпнуть
    if (isRightEdge && canSwipeBack()) {
      isSwiping = true;
      swipeTarget = 'back';
    } else if (isLeftEdge && canSwipeForward()) {
      isSwiping = true;
      swipeTarget = 'forward';
    }
  }
  
  /**
   * Обработка движения
   */
  function handleTouchMove(e) {
    if (!isSwiping) return;
    
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
    
    // Применяем визуальный эффект
    if (swipeTarget === 'back' && deltaX < 0) {
      // Свайп влево (назад) - двигаем экран задач вправо
      const progress = Math.max(0, Math.min(1, Math.abs(deltaX) / window.innerWidth));
      const translateX = progress * window.innerWidth;
      applySwipeTransform(screenTasks, translateX);
      
      // Предотвращаем прокрутку страницы
      if (Math.abs(deltaX) > 10) {
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
      // Свайп влево (назад)
      if (deltaX < 0 && swipeTarget === 'back' && canSwipeBack()) {
        animateNavigateBack();
      }
      // Свайп вправо (вперёд) - пока не реализовано
      else if (deltaX > 0 && swipeTarget === 'forward' && canSwipeForward()) {
        // history.forward();
      }
      else {
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
  
  console.log('✅ Swipe navigation initialized');
  
  // Возвращаем функцию для очистки
  return function cleanup() {
    document.removeEventListener('touchstart', handleTouchStart);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
    document.removeEventListener('touchcancel', handleTouchCancel);
  };
}

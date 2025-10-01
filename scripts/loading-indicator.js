// Loading indicator for slow initial sync
export function showLoadingIndicator() {
  const existing = document.getElementById('sync-loading');
  if (existing) return;
  
  const loader = document.createElement('div');
  loader.id = 'sync-loading';
  loader.innerHTML = `
    <div class="sync-loading-backdrop"></div>
    <div class="sync-loading-card">
      <div class="sync-loading-spinner"></div>
      <p class="sync-loading-text">Загрузка данных...</p>
      <p class="sync-loading-hint">Первая загрузка может занять до 15 секунд</p>
    </div>
  `;
  document.body.appendChild(loader);
}

export function hideLoadingIndicator() {
  const loader = document.getElementById('sync-loading');
  if (loader) {
    loader.style.opacity = '0';
    setTimeout(() => loader.remove(), 300);
  }
}

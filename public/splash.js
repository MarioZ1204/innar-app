// public/splash.js
// Splash screen + handlers triviales sin lógica de negocio. Cargado con `defer`
// para no bloquear el render del HTML.

(function () {
  const currentYearEl = document.getElementById('currentYear');
  if (currentYearEl) currentYearEl.textContent = new Date().getFullYear();

  const splashScreen = document.getElementById('splashScreen');
  function hideSplashScreen() {
    if (!splashScreen) return;
    splashScreen.classList.add('hidden-splash');
    setTimeout(() => {
      if (splashScreen.parentNode) splashScreen.parentNode.removeChild(splashScreen);
    }, 500);
  }

  function preloadImages() {
    const images = [
      'images/bck3.webp',
      'images/fondo.webp',
      'images/logo.webp',
      'images/logo1.webp',
      'images/logo3.webp',
      'images/icon.png'
    ];
    let loaded = 0;
    images.forEach((src) => {
      const img = new Image();
      const done = () => {
        loaded += 1;
        if (loaded === images.length) setTimeout(hideSplashScreen, 300);
      };
      img.onload = done;
      img.onerror = done;
      img.src = src;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', preloadImages);
  } else {
    preloadImages();
  }

  setTimeout(() => {
    if (splashScreen && !splashScreen.classList.contains('hidden-splash')) {
      hideSplashScreen();
    }
  }, 3000);

  // Cerrar cualquier modal con [data-close-modal] (delegación)
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const closer = t.closest('[data-close-modal]');
    if (!closer) return;
    const sel = closer.getAttribute('data-close-modal');
    const modal = sel === 'parent'
      ? closer.closest('.modal-overlay')
      : (sel ? document.getElementById(sel) : null);
    if (modal) modal.classList.add('hidden');
  });
})();

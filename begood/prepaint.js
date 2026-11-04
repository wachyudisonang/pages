(function () {
  'use strict';
  try {
    var theme = localStorage.getItem('begood_theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    var language = localStorage.getItem('begood_lang');
    document.documentElement.setAttribute('lang', language === 'en' || language === 'id' ? language : 'id');
  } catch (_error) {
    document.documentElement.setAttribute('lang', 'id');
  }
})();

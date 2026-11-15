(function (global) {
  'use strict';

  var LS_PREFIX = 'begood_';
  var TAB_ORDER = ['summary', 'transactions', 'trash', 'record', 'wallets', 'zakat', 'settings'];
  var TOAST_MS = 2600;
  var TO_TOP_SHOW_PX = 400;
  var THEME_COLORS = Object.freeze({ light: '#089163', dark: '#101c18' });
  var activeTab = 'summary';
  var toastTimer;

  var $ = function (selector, root) {
    return (root || document).querySelector(selector);
  };
  var $$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  function setScrollLocked(locked) {
    document.body.classList.toggle('scroll-locked', locked);
  }

  function applyTab() {
    $$('section[data-view]').forEach(function (section) {
      section.classList.toggle('on', section.dataset.view === activeTab);
    });
    $$('[data-tab]').forEach(function (button) {
      button.classList.toggle('on', button.dataset.tab === activeTab);
      if (button.dataset.tab === activeTab) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function setMenu(open) {
    var tabs = $('#tabs');
    var burger = $('#burger');
    var scrim = $('#navScrim');
    if (!tabs || tabs.classList.contains('open') === open) return;
    tabs.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    scrim.hidden = !open;
    scrim.classList.toggle('on', open);
    setScrollLocked(open);
  }

  function switchTab(tab) {
    if (TAB_ORDER.indexOf(tab) < 0) return;
    // The record form keeps its state in the page. Leaving it or entering it tells main.js, which resets or prepares it.
    if (activeTab === 'record' && tab !== 'record') document.dispatchEvent(new CustomEvent('record-form:closed'));
    activeTab = tab;
    applyTab();
    setMenu(false);
    if (tab === 'record') document.dispatchEvent(new CustomEvent('record-form:opened'));
    document.dispatchEvent(new CustomEvent('tab:changed', { detail: { tab: tab } }));
  }

  function currentTheme() {
    try {
      return localStorage.getItem(LS_PREFIX + 'theme') || 'system';
    } catch (_error) {
      return 'system';
    }
  }

  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
    try {
      localStorage.setItem(LS_PREFIX + 'theme', mode);
    } catch (_error) {}
    var dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    var themeMeta = $('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = dark ? THEME_COLORS.dark : THEME_COLORS.light;
    $$('#themeSeg button').forEach(function (button) {
      button.classList.toggle('on', button.dataset.theme === mode);
    });
  }

  function toast(message) {
    var element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      element.classList.remove('show');
    }, TOAST_MS);
  }

  function updateOnlineStatus() {
    var status = $('#onlineStatus');
    if (!status) return;
    status.textContent = I18N.t(navigator.onLine ? 'settings.online' : 'settings.offline');
    status.dataset.online = navigator.onLine ? 'true' : 'false';
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !global.isSecureContext) return;
    var version = ($('meta[name="app-version"]') || {}).content || '';
    if (!version || version === 'unset') return;
    global.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js?v=' + encodeURIComponent(version)).catch(function () {});
    });
  }

  function boot() {
    I18N.applyI18n(document);
    applyTheme(currentTheme());
    applyTab();
    updateOnlineStatus();

    $('#burger').addEventListener('click', function () {
      setMenu(!$('#tabs').classList.contains('open'));
    });
    $('#navScrim').addEventListener('click', function () {
      setMenu(false);
    });
    // The logo goes to the summary inside the app. The plain href would reload the page, which locks the vault.
    // The logo is the home link, so it also drops ?tab after switchTab has written it.
    $('.brand').addEventListener('click', function (event) {
      event.preventDefault();
      switchTab('summary');
      history.replaceState(history.state, '', location.pathname + location.hash);
    });
    $$('[data-tab]').forEach(function (button) {
      button.addEventListener('click', function () {
        switchTab(button.dataset.tab);
      });
    });
    $$('#themeSeg button').forEach(function (button) {
      button.addEventListener('click', function () {
        applyTheme(button.dataset.theme);
      });
    });
    $$('#langSeg button').forEach(function (button) {
      button.addEventListener('click', function () {
        I18N.setLang(button.dataset.lang);
      });
    });
    $$('[data-toggle-password]').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = button.parentNode.querySelector('input');
        var reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        button.setAttribute('aria-pressed', reveal ? 'true' : 'false');
      });
    });
    global.addEventListener('online', updateOnlineStatus);
    global.addEventListener('offline', updateOnlineStatus);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setMenu(false);
    });
    try {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (currentTheme() === 'system') applyTheme('system');
      });
    } catch (_error) {}

    var toTop = $('#toTop');
    global.addEventListener('scroll', function () {
      toTop.classList.toggle('show', global.scrollY > TO_TOP_SHOW_PX);
    }, { passive: true });
    toTop.addEventListener('click', function () {
      var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      global.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    });
  }

  global.BeGoodShell = {
    switchTab: switchTab,
    toast: toast,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  registerServiceWorker();
})(window);

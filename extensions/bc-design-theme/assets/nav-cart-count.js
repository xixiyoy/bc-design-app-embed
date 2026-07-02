/**
 * Keeps header cart count badges in sync after AJAX cart changes.
 * Initial count is rendered server-side via cart.item_count in nav_header_icons.liquid.
 */
(function () {
  'use strict';

  var COUNT_SELECTOR = '[data-cart-count]';
  var CART_LINK_SELECTOR = '.icon-btn--cart';
  var CART_ENDPOINT_RE = /\/cart\/(?:add|change|update|clear)(?:\.js)?(?:\?|$)/;

  function getBadges() {
    return document.querySelectorAll(COUNT_SELECTOR);
  }

  function getCartLinks() {
    return document.querySelectorAll(CART_LINK_SELECTOR);
  }

  function formatCount(itemCount) {
    var count = Math.max(0, parseInt(itemCount, 10) || 0);
    return {
      count: count,
      label: count > 0 ? 'Cart, ' + count + ' items' : 'Cart',
      text: count > 99 ? '99+' : String(count),
    };
  }

  function updateCount(itemCount) {
    var formatted = formatCount(itemCount);

    getCartLinks().forEach(function (link) {
      link.setAttribute('aria-label', formatted.label);
    });

    getBadges().forEach(function (badge) {
      if (formatted.count > 0) {
        badge.textContent = formatted.text;
        badge.classList.remove('cart-count-badge--hidden');
        badge.setAttribute('aria-hidden', 'false');
      } else {
        badge.textContent = '0';
        badge.classList.add('cart-count-badge--hidden');
        badge.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function refreshFromServer() {
    return fetch('/cart.js', { credentials: 'same-origin' })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (cart) {
        if (cart && typeof cart.item_count === 'number') {
          updateCount(cart.item_count);
        }
      })
      .catch(function () {});
  }

  function patchFetch() {
    if (typeof window.fetch !== 'function' || window.fetch.__bcNavCartPatched) return;

    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var response = originalFetch(input, init);

      if (CART_ENDPOINT_RE.test(url)) {
        response.then(function (res) {
          if (res && res.ok) refreshFromServer();
          return res;
        });
      }

      return response;
    };

    window.fetch.__bcNavCartPatched = true;
  }

  function listenForCartEvents() {
    ['cart:updated', 'cart:refresh', 'cart:change'].forEach(function (eventName) {
      document.addEventListener(eventName, refreshFromServer);
    });
  }

  function init() {
    patchFetch();
    listenForCartEvents();
    window.addEventListener('pageshow', refreshFromServer);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

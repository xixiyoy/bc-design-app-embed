(function () {
  const PENDING_CLASS = 'bc-design-embed--pending';
  const REVEAL_FALLBACK_MS = 3000;
  const NAV_SELECTOR = '[data-bc-design-embed="navigation"]';
  const BANNER_SELECTOR = '[data-bc-design-embed="banner"]';
  const BLOCK_SELECTOR = '[id^="shopify-block-"]';

  let revealFallbackTimer = null;
  let resizeTimer = null;
  let hasRevealed = false;

  /** @returns {{ node: Element | null, position: 'after' | 'before' | 'prepend' }} */
  function findInsertAnchor() {
    const skipSelectors = ['a[href="#MainContent"]', '.skip-to-content', '[class*="skip"]'];
    for (const selector of skipSelectors) {
      const match = document.querySelector(selector);
      if (match) return { node: match, position: 'after' };
    }
    const mainLandmark = document.querySelector('main, #MainContent, .shopify-section');
    if (mainLandmark) return { node: mainLandmark, position: 'before' };
    return { node: null, position: 'prepend' };
  }

  function getBlockWrapper(embedEl) {
    return embedEl ? embedEl.closest(BLOCK_SELECTOR) : null;
  }

  function insertAfter(node, reference) {
    if (!node || !reference || !reference.parentNode) return false;
    if (reference.nextElementSibling === node) return true;
    reference.parentNode.insertBefore(node, reference.nextSibling);
    return true;
  }

  function insertBefore(node, reference) {
    if (!node || !reference || !reference.parentNode) return false;
    if (reference.previousElementSibling === node) return true;
    reference.parentNode.insertBefore(node, reference);
    return true;
  }

  function prependToBody(node) {
    if (!node) return;
    if (document.body.firstElementChild === node) return;
    document.body.insertBefore(node, document.body.firstChild);
  }

  function isAlreadyAfter(node, reference) {
    return Boolean(node && reference && reference.nextElementSibling === node);
  }

  function isAlreadyBefore(node, reference) {
    return Boolean(node && reference && reference.previousElementSibling === node);
  }

  function isPlacementCorrect(navBlock, bannerBlock, anchor) {
    if (!anchor?.node) return false;

    if (anchor.position === 'after') {
      if (navBlock && !isAlreadyAfter(navBlock, anchor.node)) return false;
      if (bannerBlock) {
        const bannerRef = navBlock || anchor.node;
        return isAlreadyAfter(bannerBlock, bannerRef);
      }
      return true;
    }

    if (anchor.position === 'before') {
      const main = anchor.node;
      if (navBlock && bannerBlock) {
        return navBlock.nextElementSibling === bannerBlock && isAlreadyBefore(bannerBlock, main);
      }
      if (navBlock && !bannerBlock) return isAlreadyBefore(navBlock, main);
      if (!navBlock && bannerBlock) return isAlreadyBefore(bannerBlock, main);
      return true;
    }

    return false;
  }

  function moveBlock(block, anchor) {
    if (!block) return;
    if (!anchor || !anchor.node) {
      prependToBody(block);
      return;
    }
    if (anchor.position === 'after') {
      insertAfter(block, anchor.node);
      return;
    }
    if (anchor.position === 'before') {
      insertBefore(block, anchor.node);
      return;
    }
    prependToBody(block);
  }

  function measureNavHeight(navEmbed) {
    if (!navEmbed) return 0;
    const navbar = navEmbed.querySelector('.navbar');
    if (navbar) return navbar.getBoundingClientRect().height;
    const empty = navEmbed.querySelector('.phaetus-nav-empty');
    if (empty) return empty.getBoundingClientRect().height;
    return navEmbed.getBoundingClientRect().height;
  }

  function applyBannerSpacing(navEmbed, bannerBlock) {
    if (!bannerBlock) return;

    const navHeight = measureNavHeight(navEmbed);
    document.documentElement.style.setProperty('--bc-design-nav-height', `${navHeight}px`);

    // Nav already reserves height in document flow; never add banner margin-top.
    bannerBlock.style.marginTop = '';
  }

  function cancelInlineRevealFallback(embedEl) {
    if (!embedEl?.dataset?.bcDesignRevealFallback) return;
    clearTimeout(Number(embedEl.dataset.bcDesignRevealFallback));
    delete embedEl.dataset.bcDesignRevealFallback;
  }

  function revealEmbeds() {
    document.querySelectorAll('[data-bc-design-embed]').forEach((el) => {
      el.classList.remove(PENDING_CLASS);
      cancelInlineRevealFallback(el);
    });
    if (!hasRevealed) {
      hasRevealed = true;
      cancelRevealFallback();
    }
  }

  function scheduleRevealFallback() {
    if (revealFallbackTimer) return;
    revealFallbackTimer = window.setTimeout(revealEmbeds, REVEAL_FALLBACK_MS);
  }

  function cancelRevealFallback() {
    if (!revealFallbackTimer) return;
    clearTimeout(revealFallbackTimer);
    revealFallbackTimer = null;
  }

  function runPlacement() {
    try {
      const navEmbed = document.querySelector(NAV_SELECTOR);
      const bannerEmbed = document.querySelector(BANNER_SELECTOR);
      const navBlock = getBlockWrapper(navEmbed);
      const bannerBlock = getBlockWrapper(bannerEmbed);
      const anchor = findInsertAnchor();

      if (!isPlacementCorrect(navBlock, bannerBlock, anchor)) {
        moveBlock(navBlock, anchor);

        const bannerAnchor = navBlock
          ? { node: navBlock, position: 'after' }
          : anchor;
        moveBlock(bannerBlock, bannerAnchor);
      }

      applyBannerSpacing(navEmbed, bannerBlock);
    } catch (error) {
      console.warn('[BC Design] embed placement failed', error);
    } finally {
      revealEmbeds();
    }
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const navEmbed = document.querySelector(NAV_SELECTOR);
      const bannerBlock = getBlockWrapper(document.querySelector(BANNER_SELECTOR));
      applyBannerSpacing(navEmbed, bannerBlock);
    }, 150);
  }

  window.BCDesignEmbedPlacement = window.BCDesignEmbedPlacement || { run: runPlacement };

  if (!window.__BC_DESIGN_EMBED_PLACEMENT_LOADED__) {
    window.__BC_DESIGN_EMBED_PLACEMENT_LOADED__ = true;
    scheduleRevealFallback();
    window.addEventListener('resize', onResize);

    const start = () => window.BCDesignEmbedPlacement.run();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }
})();

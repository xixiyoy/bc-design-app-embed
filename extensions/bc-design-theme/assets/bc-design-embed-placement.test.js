import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function bridgeTimers(window) {
  window.setTimeout = globalThis.setTimeout.bind(globalThis);
  window.clearTimeout = globalThis.clearTimeout.bind(globalThis);
  if (globalThis.setInterval) {
    window.setInterval = globalThis.setInterval.bind(globalThis);
    window.clearInterval = globalThis.clearInterval.bind(globalThis);
  }
}

function mountGlobals(window) {
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Node = window.Node;
  bridgeTimers(window);
  globalThis.requestAnimationFrame = (cb) => globalThis.setTimeout(cb, 0);
}

function navBannerFixture({ skipLink = true, reversed = false, nav = true, banner = true } = {}) {
  const skip = skipLink ? '<a href="#MainContent" class="skip-to-content">Skip</a>' : '';
  const navBlock = nav
    ? `<div id="shopify-block-nav"><div data-bc-design-embed="navigation" class="bc-design-embed--pending"><div class="phaetus-nav-root phaetus-nav-root--fixed"><nav class="navbar" style="height:80px"></nav></div></div></div>`
    : '';
  const bannerBlock = banner
    ? `<div id="shopify-block-banner"><div data-bc-design-embed="banner" class="bc-design-embed--pending"><banner-carousel class="bc-banner-carousel"></banner-carousel></div></div>`
    : '';
  const blocks = reversed ? bannerBlock + navBlock : navBlock + bannerBlock;
  return `${skip}<main id="MainContent"></main>${blocks}`;
}

async function reloadPlacement(window, fixtureOptions = {}) {
  vi.resetModules();
  window.document.body.innerHTML = navBannerFixture(fixtureOptions);
  mountGlobals(window);
  await import('./bc-design-embed-placement.js');
}

describe('bc-design-embed-placement', () => {
  let window;
  let document;

  beforeEach(() => {
    window = new Window();
    document = window.document;
  });

  it('places navigation after skip link and banner after navigation', async () => {
    await reloadPlacement(window);
    window.BCDesignEmbedPlacement.run();
    const skip = document.querySelector('.skip-to-content');
    const navBlock = document.getElementById('shopify-block-nav');
    const bannerBlock = document.getElementById('shopify-block-banner');
    expect(skip.nextElementSibling).toBe(navBlock);
    expect(navBlock.nextElementSibling).toBe(bannerBlock);
  });

  it('without skip link, inserts nav then banner before main landmark', async () => {
    await reloadPlacement(window, { skipLink: false });
    window.BCDesignEmbedPlacement.run();
    const main = document.getElementById('MainContent');
    const navBlock = document.getElementById('shopify-block-nav');
    const bannerBlock = document.getElementById('shopify-block-banner');
    expect(navBlock.nextElementSibling).toBe(bannerBlock);
    expect(bannerBlock.nextElementSibling).toBe(main);
  });

  it('keeps navigation above banner when DOM starts reversed (banner before nav at body end)', async () => {
    await reloadPlacement(window, { reversed: true });
    window.BCDesignEmbedPlacement.run();
    const navBlock = document.getElementById('shopify-block-nav');
    const bannerBlock = document.getElementById('shopify-block-banner');
    expect(navBlock.compareDocumentPosition(bannerBlock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(navBlock.nextElementSibling).toBe(bannerBlock);
  });

  it('nav-only: places navigation without shifting main below banner', async () => {
    await reloadPlacement(window, { banner: false });
    window.BCDesignEmbedPlacement.run();
    const skip = document.querySelector('.skip-to-content');
    const navBlock = document.getElementById('shopify-block-nav');
    const main = document.getElementById('MainContent');
    expect(skip.nextElementSibling).toBe(navBlock);
    expect(main.previousElementSibling).toBe(navBlock);
    expect(document.getElementById('shopify-block-banner')).toBeNull();
  });

  it('banner-only: places banner after skip link when navigation absent', async () => {
    await reloadPlacement(window, { nav: false });
    window.BCDesignEmbedPlacement.run();
    const skip = document.querySelector('.skip-to-content');
    const bannerBlock = document.getElementById('shopify-block-banner');
    expect(skip.nextElementSibling).toBe(bannerBlock);
  });

  it('does not add banner margin-top when fixed navigation precedes banner', async () => {
    await reloadPlacement(window);
    window.BCDesignEmbedPlacement.run();
    const bannerBlock = document.getElementById('shopify-block-banner');
    expect(bannerBlock.style.marginTop).toBe('');
    expect(document.documentElement.style.getPropertyValue('--bc-design-nav-height')).not.toBe('');
  });

  it('does not add banner margin-top when non-fixed navigation precedes banner', async () => {
    await reloadPlacement(window);
    const navRoot = document.querySelector('.phaetus-nav-root');
    navRoot.classList.remove('phaetus-nav-root--fixed');
    window.BCDesignEmbedPlacement.run();
    const bannerBlock = document.getElementById('shopify-block-banner');
    expect(bannerBlock.style.marginTop).toBe('');
    expect(document.documentElement.style.getPropertyValue('--bc-design-nav-height')).not.toBe('');
  });

  it('is idempotent when run() is called twice', async () => {
    await reloadPlacement(window);
    window.BCDesignEmbedPlacement.run();
    const navBlock = document.getElementById('shopify-block-nav');
    const bannerBlock = document.getElementById('shopify-block-banner');
    const firstNavNext = navBlock.nextElementSibling;
    window.BCDesignEmbedPlacement.run();
    expect(navBlock.nextElementSibling).toBe(firstNavNext);
    expect(navBlock.nextElementSibling).toBe(bannerBlock);
  });

  it('reveals embeds when placement throws (fail-open)', async () => {
    await reloadPlacement(window);
    document.querySelectorAll('[data-bc-design-embed]').forEach((el) => {
      el.classList.add('bc-design-embed--pending');
    });
    const originalQuery = document.querySelector.bind(document);
    document.querySelector = () => { throw new Error('forced placement failure'); };
    try {
      window.BCDesignEmbedPlacement.run();
    } finally {
      document.querySelector = originalQuery;
    }
    document.querySelectorAll('[data-bc-design-embed]').forEach((el) => {
      expect(el.classList.contains('bc-design-embed--pending')).toBe(false);
    });
  });

  it('cancels per-embed inline reveal fallback timers when placement reveals early', async () => {
    await reloadPlacement(window);
    const navEmbed = document.querySelector('[data-bc-design-embed="navigation"]');
    navEmbed.dataset.bcDesignRevealFallback = String(window.setTimeout(() => {}, 3000));
    window.BCDesignEmbedPlacement.run();
    expect(navEmbed.dataset.bcDesignRevealFallback).toBeUndefined();
  });

  it('without skip link, second run() is a no-op when nav -> banner -> main is already correct', async () => {
    await reloadPlacement(window, { skipLink: false });
    window.BCDesignEmbedPlacement.run();
    const navBlock = document.getElementById('shopify-block-nav');
    const bannerBlock = document.getElementById('shopify-block-banner');
    const main = document.getElementById('MainContent');
    const insertSpy = vi.spyOn(document.body, 'insertBefore');
    window.BCDesignEmbedPlacement.run();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(navBlock.nextElementSibling).toBe(bannerBlock);
    expect(main.previousElementSibling).toBe(bannerBlock);
  });

  it('places product detail at top of main when main exists', async () => {
    const window = new Window();
    const document = window.document;
    mountGlobals(window);
    document.body.innerHTML = '<a href="#MainContent" class="skip-to-content">Skip</a><main id="MainContent"></main><div id="shopify-block-pd"><div data-bc-design-embed="product-detail" class="bc-design-embed--pending"></div></div>';
    vi.resetModules();
    await import('./bc-design-embed-placement.js');
    window.BCDesignEmbedPlacement.run();
    const main = document.getElementById('MainContent');
    const pdBlock = document.getElementById('shopify-block-pd');
    expect(main.firstElementChild).toBe(pdBlock);
  });

  it('places product detail before native product section when main absent', async () => {
    const window = new Window();
    const document = window.document;
    mountGlobals(window);
    document.body.innerHTML = '<div class="shopify-section-main-product">Native Product</div><div id="shopify-block-pd"><div data-bc-design-embed="product-detail" class="bc-design-embed--pending"></div></div>';
    vi.resetModules();
    await import('./bc-design-embed-placement.js');
    window.BCDesignEmbedPlacement.run();
    const nativeSection = document.querySelector('.shopify-section-main-product');
    const pdBlock = document.getElementById('shopify-block-pd');
    expect(nativeSection.previousElementSibling).toBe(pdBlock);
  });

  it('places product detail at body start as fallback', async () => {
    const window = new Window();
    const document = window.document;
    mountGlobals(window);
    document.body.innerHTML = '<div>Other</div><div id="shopify-block-pd"><div data-bc-design-embed="product-detail" class="bc-design-embed--pending"></div></div>';
    vi.resetModules();
    await import('./bc-design-embed-placement.js');
    window.BCDesignEmbedPlacement.run();
    const pdBlock = document.getElementById('shopify-block-pd');
    expect(document.body.firstElementChild).toBe(pdBlock);
  });

  it('coexists: nav, banner, and product detail all placed correctly', async () => {
    const window = new Window();
    const document = window.document;
    mountGlobals(window);
    document.body.innerHTML = '<a href="#MainContent" class="skip-to-content">Skip</a><main id="MainContent"></main>' +
      '<div id="shopify-block-nav"><div data-bc-design-embed="navigation" class="bc-design-embed--pending"><nav class="navbar" style="height:80px"></nav></div></div>' +
      '<div id="shopify-block-banner"><div data-bc-design-embed="banner" class="bc-design-embed--pending"></div></div>' +
      '<div id="shopify-block-pd"><div data-bc-design-embed="product-detail" class="bc-design-embed--pending"></div></div>';
    vi.resetModules();
    await import('./bc-design-embed-placement.js');
    window.BCDesignEmbedPlacement.run();
    const skip = document.querySelector('.skip-to-content');
    const navBlock = document.getElementById('shopify-block-nav');
    const bannerBlock = document.getElementById('shopify-block-banner');
    const main = document.getElementById('MainContent');
    const pdBlock = document.getElementById('shopify-block-pd');
    expect(skip.nextElementSibling).toBe(navBlock);
    expect(navBlock.nextElementSibling).toBe(bannerBlock);
    expect(main.firstElementChild).toBe(pdBlock);
  });
});

describe('bc-design-embed inline reveal fallback', () => {
  it('removes pending class when placement script never loads', async () => {
    vi.useFakeTimers();
    const window = new Window();
    const document = window.document;
    mountGlobals(window);
    document.body.innerHTML = '<div data-bc-design-embed="navigation" class="bc-design-embed--pending"></div>';
    const embed = document.querySelector('[data-bc-design-embed="navigation"]');
    const timer = window.setTimeout(() => embed.classList.remove('bc-design-embed--pending'), 3000);
    embed.dataset.bcDesignRevealFallback = String(timer);
    vi.advanceTimersByTime(3000);
    expect(embed.classList.contains('bc-design-embed--pending')).toBe(false);
  });
});

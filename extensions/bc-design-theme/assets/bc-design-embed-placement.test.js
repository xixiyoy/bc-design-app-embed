import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Window } from 'happy-dom';

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

function navBannerFixture({ skipLink = true, reversed = false } = {}) {
  const skip = skipLink ? '<a href="#MainContent" class="skip-to-content">Skip</a>' : '';
  const navBlock = `
    <div id="shopify-block-nav">
      <div data-bc-design-embed="navigation" class="bc-design-embed--pending">
        <div class="phaetus-nav-root phaetus-nav-root--fixed"><nav class="navbar" style="height:80px"></nav></div>
      </div>
    </div>`;
  const bannerBlock = `
    <div id="shopify-block-banner">
      <div data-bc-design-embed="banner" class="bc-design-embed--pending">
        <banner-carousel class="bc-banner-carousel"></banner-carousel>
      </div>
    </div>`;
  const blocks = reversed ? bannerBlock + navBlock : navBlock + bannerBlock;
  return `${skip}<main id="MainContent"></main>${blocks}`;
}

describe('bc-design-embed-placement', () => {
  let window;
  let document;

  beforeEach(async () => {
    vi.resetModules();
    window = new Window();
    document = window.document;
    mountGlobals(window);
    document.body.innerHTML = navBannerFixture();
    await import('./bc-design-embed-placement.js');
  });

  it('places navigation after skip link and banner after navigation', () => {
    window.BCDesignEmbedPlacement.run();
    const skip = document.querySelector('.skip-to-content');
    const navBlock = document.getElementById('shopify-block-nav');
    const bannerBlock = document.getElementById('shopify-block-banner');
    expect(skip.nextElementSibling).toBe(navBlock);
    expect(navBlock.nextElementSibling).toBe(bannerBlock);
  });

  it('removes pending hide class after run (fail-open reveal)', () => {
    window.BCDesignEmbedPlacement.run();
    document.querySelectorAll('[data-bc-design-embed]').forEach((el) => {
      expect(el.classList.contains('bc-design-embed--pending')).toBe(false);
    });
  });
});

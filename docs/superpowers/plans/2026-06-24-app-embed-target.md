# App Embed Target Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Navigation and Banner theme blocks from `target: "section"` to independent `target: "body"` app embeds, with DOM placement scripts that pin navigation at the top and banner directly below on the homepage.

**Architecture:** Merchants enable modules under **Theme editor → App embeds**. Shopify injects Liquid near `</body>`; a shared `bc-design-embed-placement.js` moves Shopify block wrappers (`#shopify-block-*`) to the correct top-of-page position — **after** skip links when present, **before** the first main/content landmark otherwise. Each Liquid block also ships an **inline 3s reveal fallback** so embeds become visible even if the placement script is missing or fails to load. Navigation always uses `phaetus-nav-root--fixed` in embed mode. Banner outputs only on `template.name == 'index'`. Content configuration stays in app admin metaobjects — unchanged.

**Tech Stack:** Theme App Extension (Liquid, CSS, vanilla JS), Vitest + happy-dom for placement/carousel unit tests, Shopify CLI validation.

**Spec:** `docs/superpowers/specs/2026-06-24-app-embed-target-design.md` — **complete Task 2 Step 2 (spec pseudocode sync) before writing placement script code**; spec still contains stale `findAccessibilityAnchor()` until then.

---

## File Structure

### Create

| File | Responsibility |
|------|----------------|
| `extensions/bc-design-theme/assets/bc-design-embed-placement.js` | Move block wrappers to top; CLS hide/reveal; nav height measurement |
| `extensions/bc-design-theme/assets/bc-design-embed-placement.test.js` | Unit tests for placement ordering, skip-link anchor, fail-open reveal |
| `extensions/bc-design-theme/assets/banner-carousel.lifecycle.test.js` | Unit tests for idempotent `connectedCallback` after DOM move |

### Modify

| File | Responsibility |
|------|----------------|
| `extensions/bc-design-theme/blocks/navigation_menu.liquid` | `target: "body"`, embed wrapper, forced fixed nav, inline reveal fallback, schema `stylesheet`, placement script |
| `extensions/bc-design-theme/blocks/banner_carousel.liquid` | `target: "body"`, index-only output, embed wrapper, inline reveal fallback, schema `stylesheet`, placement script |
| `extensions/bc-design-theme/assets/banner-carousel.js` | Idempotent lifecycle + `disconnectedCallback` cleanup |
| `extensions/bc-design-theme/locales/en.default.json` | Rename blocks; remove `banner_slide` |
| `extensions/bc-design-theme/locales/en.default.schema.json` | Rename blocks; remove `banner_slide` |
| `vitest.config.ts` | Add happy-dom environment + extension test glob |

### Delete

| File | Reason |
|------|--------|
| `extensions/bc-design-theme/blocks/banner_slide.liquid` | No longer needed without section sibling blocks (unreleased dev store) |

### Unchanged

- `shopify.app.toml`, `app/lib/bc-design/*`, `app/routes/app.navigation.tsx`, `app/routes/app.banner.tsx`
- All navigation/banner snippets and CSS assets (except new placement script)

---

### Task 1: Vitest + happy-dom for theme extension JS tests

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Create: `extensions/bc-design-theme/assets/bc-design-embed-placement.test.js` (stub that fails)

- [ ] **Step 1: Write the failing test stub**

Create `extensions/bc-design-theme/assets/bc-design-embed-placement.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm install -D happy-dom && npm test -- extensions/bc-design-theme/assets/bc-design-embed-placement.test.js`

Expected: FAIL — module `./bc-design-embed-placement.js` not found (or `BCDesignEmbedPlacement` undefined)

- [ ] **Step 3: Add happy-dom and extend vitest config**

In `package.json` devDependencies add `"happy-dom": "^20.0.0"` (or latest compatible).

Replace `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "extensions/**/*.test.js"],
    environmentMatchGlobs: [
      ["extensions/**/*.test.js", "happy-dom"],
    ],
  },
});
```

- [ ] **Step 4: Re-run test to confirm still fails on missing implementation**

Run: `npm test -- extensions/bc-design-theme/assets/bc-design-embed-placement.test.js`

Expected: FAIL — cannot resolve `./bc-design-embed-placement.js`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts extensions/bc-design-theme/assets/bc-design-embed-placement.test.js
git commit -m "test: add vitest harness for theme embed placement script"
```

---

### Task 2: `bc-design-embed-placement.js`

**Files:**
- Create: `extensions/bc-design-theme/assets/bc-design-embed-placement.js`
- Test: `extensions/bc-design-theme/assets/bc-design-embed-placement.test.js`

- [ ] **Step 1: Extend failing tests — spacing, idempotency, anchor modes, partial embeds, reversed order, inline fallback**

Replace `bc-design-embed-placement.test.js` with the full suite. **Important:** any test that replaces `document.body.innerHTML` must call `reloadPlacement()` so module state (`hasRevealed`, auto-run on import) matches the new DOM.

```js
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
});
```

Add a separate inline-fallback contract test in the same file (no placement script import):

```js
describe('bc-design-embed inline reveal fallback', () => {
  it('removes pending class when placement script never loads', async () => {
    vi.useFakeTimers();
    const window = new Window();
    const document = window.document;
    mountGlobals(window); // bridgeTimers() runs after useFakeTimers() so window.setTimeout uses fake timers
    document.body.innerHTML = '<div data-bc-design-embed="navigation" class="bc-design-embed--pending"></div>';
    const embed = document.querySelector('[data-bc-design-embed="navigation"]');
    const timer = window.setTimeout(() => embed.classList.remove('bc-design-embed--pending'), 3000);
    embed.dataset.bcDesignRevealFallback = String(timer);
    vi.advanceTimersByTime(3000);
    expect(embed.classList.contains('bc-design-embed--pending')).toBe(false);
  });
});
```

- [ ] **Step 2: Sync spec pseudocode before implementation (avoid plan/spec drift)**

In `docs/superpowers/specs/2026-06-24-app-embed-target-design.md`, replace the `assets/bc-design-embed-placement.js` pseudocode block with:

```js
// Pseudocode — implementation guide
function findInsertAnchor() {
  const skip = document.querySelector('a[href="#MainContent"], .skip-to-content, [class*="skip"]');
  if (skip) return { node: skip, position: 'after' };
  const main = document.querySelector('main, #MainContent, .shopify-section');
  if (main) return { node: main, position: 'before' };
  return { node: null, position: 'prepend' };
}

// Returns true when nav/banner blocks are already in correct order — run() must no-op moves.
function isPlacementCorrect(navBlock, bannerBlock, anchor) { /* see Task 2 Step 4 */ }

window.BCDesignEmbedPlacement = window.BCDesignEmbedPlacement || {
  run() {
    try {
      const navEmbed = document.querySelector('[data-bc-design-embed="navigation"]');
      const bannerEmbed = document.querySelector('[data-bc-design-embed="banner"]');
      const navBlock = navEmbed?.closest('[id^="shopify-block-"]');
      const bannerBlock = bannerEmbed?.closest('[id^="shopify-block-"]');
      const anchor = findInsertAnchor();

      if (!isPlacementCorrect(navBlock, bannerBlock, anchor)) {
        moveBlock(navBlock, anchor);
        moveBlock(bannerBlock, navBlock ? { node: navBlock, position: 'after' } : anchor);
      }

      applyBannerSpacing(navEmbed, bannerBlock);
    } catch (error) {
      console.warn('[BC Design] embed placement failed', error);
    } finally {
      revealEmbeds();
      cancelRevealFallback();
    }
  },
};
```

In the same spec file, update the CLS / fail-open section to state:
- Per-block inline Liquid `setTimeout` fallback (3s) is **required** in each embed block.
- Placement-script `scheduleRevealFallback()` is an additional safety net when the script loads.
- `revealEmbeds()` must cancel per-embed `data-bc-design-reveal-fallback` timers.

- [ ] **Step 3: Run tests to verify new cases fail**

Run: `npm test -- extensions/bc-design-theme/assets/bc-design-embed-placement.test.js`

Expected: FAIL — implementation missing (10 placement tests + 1 inline-fallback test)

- [ ] **Step 4: Write minimal implementation**

Create `extensions/bc-design-theme/assets/bc-design-embed-placement.js`:

```js
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

    const hasFixedNav = Boolean(navEmbed?.querySelector('.phaetus-nav-root--fixed'));
    if (hasFixedNav) {
      bannerBlock.style.marginTop = '';
      return;
    }

    if (navEmbed && navHeight > 0) {
      bannerBlock.style.marginTop = `${navHeight}px`;
    } else {
      bannerBlock.style.marginTop = '';
    }
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- extensions/bc-design-theme/assets/bc-design-embed-placement.test.js`

Expected: PASS (11 tests)

- [ ] **Step 6: Commit**

```bash
git add extensions/bc-design-theme/assets/bc-design-embed-placement.js extensions/bc-design-theme/assets/bc-design-embed-placement.test.js docs/superpowers/specs/2026-06-24-app-embed-target-design.md
git commit -m "feat: add embed placement script for body-target app embeds"
```

---

### Task 3: `banner-carousel.js` lifecycle hardening

**Files:**
- Modify: `extensions/bc-design-theme/assets/banner-carousel.js`
- Create: `extensions/bc-design-theme/assets/banner-carousel.lifecycle.test.js`

- [ ] **Step 1: Write the failing test**

Create `extensions/bc-design-theme/assets/banner-carousel.lifecycle.test.js`:

```js
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

function mountBrowserMocks(window) {
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.customElements = window.customElements;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  bridgeTimers(window);
  globalThis.requestAnimationFrame = (cb) => globalThis.setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = (id) => globalThis.clearTimeout(id);

  const matchMedia =
    window.matchMedia?.bind(window) ??
    (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.matchMedia = matchMedia;
  globalThis.matchMedia = matchMedia;

  const animateStub = function () {
    return { play() {}, pause() {}, cancel() {}, finish() {}, playState: 'idle', onfinish: null };
  };
  window.Element.prototype.animate = window.Element.prototype.animate || animateStub;
  globalThis.Element.prototype.animate = globalThis.Element.prototype.animate || animateStub;
}

describe('banner-carousel lifecycle', () => {
  let window;
  let document;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    window = new Window();
    document = window.document;
    mountBrowserMocks(window); // bridgeTimers() after useFakeTimers() so carousel __bcInitTimer fires on vi.runAllTimers()

    document.body.innerHTML = `
      <div id="host">
        <banner-carousel data-autoplay="false" data-show-indicators="true">
          <div class="bc-banner-carousel__track">
            <div class="bc-banner-slide"></div>
            <div class="bc-banner-slide"></div>
          </div>
          <div class="bc-banner-carousel__indicators"></div>
          <button class="bc-banner-carousel__nav bc-banner-carousel__nav--prev"></button>
          <button class="bc-banner-carousel__nav bc-banner-carousel__nav--next"></button>
        </banner-carousel>
      </div>
    `;

    await import('./banner-carousel.js');
    vi.runAllTimers();
  });

  it('after DOM move, next button click advances exactly one slide', () => {
    const host = document.getElementById('host');
    const carousel = host.querySelector('banner-carousel');
    const track = carousel.querySelector('.bc-banner-carousel__track');
    const nextBtn = carousel.querySelector('.bc-banner-carousel__nav--next');
    nextBtn.hidden = false;

    expect(track.style.transform).toBe('translateX(0%)');

    host.removeChild(carousel);
    document.body.appendChild(carousel);
    vi.runAllTimers();

    nextBtn.click();
    expect(track.style.transform).toBe('translateX(-100%)');
  });

  it('after DOM move, ArrowRight keydown advances exactly one slide', () => {
    const host = document.getElementById('host');
    const carousel = host.querySelector('banner-carousel');
    const track = carousel.querySelector('.bc-banner-carousel__track');

    host.removeChild(carousel);
    document.body.appendChild(carousel);
    vi.runAllTimers();

    carousel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(track.style.transform).toBe('translateX(-100%)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- extensions/bc-design-theme/assets/banner-carousel.lifecycle.test.js`

Expected: FAIL — transform is not `translateX(-100%)`; with 2 slides duplicate `next()` wraps modulo and typically ends at `translateX(0%)`

- [ ] **Step 3: Write minimal lifecycle implementation**

Replace `connectedCallback` and add `disconnectedCallback` in `extensions/bc-design-theme/assets/banner-carousel.js`. Full class after edit:

```js
class BcBannerCarousel extends HTMLElement {
  collectSlides() {
    if (!this.track) return;
    this.slides = Array.from(this.track.querySelectorAll('.bc-banner-slide'));
  }

  connectedCallback() {
    if (this.__bcBannerInitToken) return;
    this.__bcBannerInitToken = Symbol('bc-banner-init');

    this.track = this.querySelector('.bc-banner-carousel__track');
    this.indicatorsContainer = this.querySelector('.bc-banner-carousel__indicators');
    this.prevButton = this.querySelector('.bc-banner-carousel__nav--prev');
    this.nextButton = this.querySelector('.bc-banner-carousel__nav--next');
    this.index = 0;
    this.progressAnimation = null;
    this.isHovered = false;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.autoplaySpeed = Number(this.dataset.autoplaySpeed) || 5000;
    this.canAnimate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.__bcBoundHandlers = [];

    if (!this.track) return;

    this.__bcInitTimer = window.setTimeout(() => {
      this.__bcInitTimer = null;
      this.collectSlides();
      if (this.slides.length === 0) return;

      this.style.setProperty('--bc-banner-progress-duration', `${this.autoplaySpeed}ms`);
      this.createIndicators();
      this.setupNavigation();
      this.setupCursorNavigation();
      this.bindEvents();
      this.goTo(0);
      this.startAutoplay();
    }, 0);
  }

  disconnectedCallback() {
    if (this.__bcInitTimer) {
      clearTimeout(this.__bcInitTimer);
      this.__bcInitTimer = null;
    }

    this.cancelProgressAnimation();
    this.stopAutoplay();

    if (this.__bcBoundHandlers) {
      this.__bcBoundHandlers.forEach(({ target, type, handler, options }) => {
        target.removeEventListener(type, handler, options);
      });
      this.__bcBoundHandlers = [];
    }

    if (this.indicatorsContainer) {
      this.indicatorsContainer.textContent = '';
    }

    this.indicators = [];
    this.slides = [];
    this.progressAnimation = null;
    this.__bcBannerInitToken = null;
  }

  __bcAddListener(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.__bcBoundHandlers.push({ target, type, handler, options });
  }

  createIndicators() {
    if (!this.indicatorsContainer || this.dataset.showIndicators !== 'true' || this.slides.length <= 1) {
      if (this.indicatorsContainer) this.indicatorsContainer.hidden = true;
      this.indicators = [];
      return;
    }

    this.indicatorsContainer.textContent = '';
    this.indicators = this.slides.map((slide, slideIndex) => {
      const button = document.createElement('button');
      button.className = 'bc-banner-carousel__indicator';
      button.type = 'button';
      button.setAttribute('aria-label', `Go to slide ${slideIndex + 1}`);

      const progress = document.createElement('span');
      progress.className = 'bc-banner-carousel__indicator-progress';
      progress.setAttribute('aria-hidden', 'true');
      button.append(progress);

      const onClick = () => {
        this.stopAutoplay();
        this.goTo(slideIndex);
        this.resumeAutoplay();
      };
      this.__bcAddListener(button, 'click', onClick);
      this.indicatorsContainer.append(button);
      return button;
    });
  }

  setupNavigation() {
    const hasMultipleSlides = this.slides.length > 1;

    [this.prevButton, this.nextButton].forEach((button) => {
      if (!button) return;
      button.hidden = !hasMultipleSlides;
    });

    if (!hasMultipleSlides) return;

    if (this.prevButton) {
      this.__bcAddListener(this.prevButton, 'click', () => this.previous());
    }
    if (this.nextButton) {
      this.__bcAddListener(this.nextButton, 'click', () => this.next());
    }
  }

  setupCursorNavigation() {
    if (this.slides.length <= 1 || !window.matchMedia('(hover: hover)').matches) return;

    let cursorRafId = null;
    let pendingClientX = null;

    const updateCursor = (clientX) => {
      const isLeft = this.isLeftOfBannerCenter(clientX);
      this.classList.toggle('bc-banner-carousel--cursor-prev', isLeft);
      this.classList.toggle('bc-banner-carousel--cursor-next', !isLeft);
    };

    const onMouseMove = (event) => {
      if (this.isInteractiveTarget(event.target)) {
        this.classList.remove('bc-banner-carousel--cursor-prev', 'bc-banner-carousel--cursor-next');
        return;
      }

      pendingClientX = event.clientX;
      if (cursorRafId) return;

      cursorRafId = requestAnimationFrame(() => {
        cursorRafId = null;
        if (pendingClientX === null) return;
        updateCursor(pendingClientX);
        pendingClientX = null;
      });
    };

    const onMouseLeave = () => {
      if (cursorRafId) {
        cancelAnimationFrame(cursorRafId);
        cursorRafId = null;
      }
      pendingClientX = null;
      this.classList.remove('bc-banner-carousel--cursor-prev', 'bc-banner-carousel--cursor-next');
    };

    const onClick = (event) => {
      if (this.isInteractiveTarget(event.target)) return;
      if (this.isLeftOfBannerCenter(event.clientX)) {
        this.previous();
      } else {
        this.next();
      }
    };

    this.__bcAddListener(this, 'mousemove', onMouseMove);
    this.__bcAddListener(this, 'mouseleave', onMouseLeave);
    this.__bcAddListener(this, 'click', onClick);
  }

  // ... keep isInteractiveTarget, getBannerCenterX, isLeftOfBannerCenter,
  // isAutoplayEnabled, isProgressPaused, canResumeAutoplay,
  // getActiveProgressElement, cancelProgressAnimation, startProgressAnimation,
  // pauseProgressAnimation, resumeProgressAnimation, restartProgressIfNeeded,
  // resumeAutoplay, bindEvents (refactor to use __bcAddListener), previous, next,
  // goTo, updateIndicators, startAutoplay, stopAutoplay unchanged in behavior
}
```

**Important:** Refactor `bindEvents()` to route every `addEventListener` through `this.__bcAddListener(...)`. Do not change public carousel behavior.

- [ ] **Step 4: Run lifecycle test**

Run: `npm test -- extensions/bc-design-theme/assets/banner-carousel.lifecycle.test.js`

Expected: PASS (2 lifecycle tests)

- [ ] **Step 5: Run full test suite**

Run: `npm test`

Expected: PASS (app + extension tests)

- [ ] **Step 6: Commit**

```bash
git add extensions/bc-design-theme/assets/banner-carousel.js extensions/bc-design-theme/assets/banner-carousel.lifecycle.test.js
git commit -m "fix: make banner carousel lifecycle safe after embed DOM moves"
```

---

### Task 4: Navigation block → app embed

**Files:**
- Modify: `extensions/bc-design-theme/blocks/navigation_menu.liquid`

- [ ] **Step 1: Update schema to body embed**

Replace the `{% schema %}` block at the bottom of `navigation_menu.liquid`:

```json
{
  "name": "t:blocks.navigation_menu.name",
  "target": "body",
  "stylesheet": "navigation-menu.css",
  "settings": [
    {
      "type": "paragraph",
      "content": "Configure navigation in Apps → BC Design → Navigation. Disable your theme's Header section to avoid duplicate navigation."
    }
  ]
}
```

- [ ] **Step 2: Wrap output in embed marker + pending hide**

At line 30 (before `{% if nav_config == blank %}`), open wrapper and critical CSS:

```liquid
<style>
  .bc-design-embed--pending { visibility: hidden; }
</style>
<div data-bc-design-embed="navigation" class="bc-design-embed--pending">
```

After the closing `{% endif %}` at line 733 (before `{% schema %}`), close wrapper and add **inline reveal fallback + placement script**:

```liquid
<script>
(function () {
  var embed = document.querySelector('[data-bc-design-embed="navigation"]');
  if (!embed) return;
  var timer = window.setTimeout(function () {
    embed.classList.remove('bc-design-embed--pending');
  }, 3000);
  embed.dataset.bcDesignRevealFallback = String(timer);
})();
</script>
<script src="{{ 'bc-design-embed-placement.js' | asset_url }}" defer></script>
</div>
```

The inline fallback is independent of the placement asset — if `bc-design-embed-placement.js` 404s or is removed, the embed still becomes visible within 3s. When placement runs successfully, `revealEmbeds()` clears `data-bc-design-reveal-fallback` timers.

- [ ] **Step 3: Force fixed navigation in embed mode**

Change line 66 from:

```liquid
<div class="phaetus-nav-root{% if fixed_navigation %} phaetus-nav-root--fixed{% endif %}" id="nav-root-{{ bid }}" {{ block.shopify_attributes }}>
```

to:

```liquid
<div class="phaetus-nav-root phaetus-nav-root--fixed" id="nav-root-{{ bid }}" {{ block.shopify_attributes }}>
```

Keep `{% assign fixed_navigation = nav_config.fixed_navigation.value %}` — field stays for admin parity but no longer gates the CSS class.

- [ ] **Step 4: Remove duplicate stylesheet link**

Delete line 64:

```liquid
<link rel="stylesheet" href="{{ 'navigation-menu.css' | asset_url }}">
```

Schema `stylesheet` loads it automatically.

- [ ] **Step 5: Manual verification in dev theme**

Run (if not already running): `npm run dev:localhost`

In **Online Store → Themes → Customize → App embeds**:
- Confirm **BC Design Navigation** appears (not only under section blocks)
- Enable it; confirm navigation renders on homepage and product pages
- Confirm `data-bc-design-embed="navigation"` exists in page source
- Confirm navigation sits below skip link, not at page bottom
- On a theme **without** a skip link, confirm navigation inserts **before** `<main>` (not after it)

- [ ] **Step 6: Commit**

```bash
git add extensions/bc-design-theme/blocks/navigation_menu.liquid
git commit -m "feat: migrate navigation block to body app embed"
```

---

### Task 5: Banner block → app embed

**Files:**
- Modify: `extensions/bc-design-theme/blocks/banner_carousel.liquid`

- [ ] **Step 1: Replace entire file content**

```liquid
{% assign bid = block.id %}
{% assign banner_config = metaobjects['$app:banner_config']['global'] %}

{% if template.name == 'index' %}
<style>
  #shopify-block-{{ bid }} {
    position: relative;
    z-index: 1;
    width: 100vw;
    max-width: 100vw;
    margin-left: calc(50% - 50vw);
    margin-right: calc(50% - 50vw);
  }

  .bc-banner-carousel {
    --bc-cursor-nav-prev: url('{{ 'cursor-nav-prev.svg' | asset_url }}') 20 20, w-resize;
    --bc-cursor-nav-next: url('{{ 'cursor-nav-next.svg' | asset_url }}') 20 20, e-resize;
  }

  .bc-design-embed--pending { visibility: hidden; }
</style>

<div data-bc-design-embed="banner" class="bc-design-embed--pending">
  {% if banner_config == blank %}
    <div class="bc-banner-carousel-empty" {{ block.shopify_attributes }}>Configure the homepage banner in Apps → BC Design → Banner.</div>
  {% else %}
    <banner-carousel
      class="bc-banner-carousel"
      style="--bc-banner-aspect-ratio: 2.4 / 1; --bc-banner-mobile-height: {{ banner_config.mobile_height.value | default: 560 }}px; --bc-banner-overlay-opacity: {{ banner_config.overlay_opacity.value | default: 20 | divided_by: 100.0 }};"
      data-autoplay="{{ banner_config.autoplay.value }}"
      data-autoplay-speed="{{ banner_config.autoplay_speed.value | default: 5 | times: 1000 }}"
      data-pause-on-hover="{{ banner_config.pause_on_hover.value }}"
      data-show-indicators="{{ banner_config.show_indicators.value }}"
      tabindex="0"
      {{ block.shopify_attributes }}
    >
      <div class="bc-banner-carousel__track">
        {% for slide in banner_config.slides.value %}
          {% render 'banner_carousel_slide',
            desktop_image: slide.desktop_image.value,
            mobile_image: slide.mobile_image.value,
            video: slide.video.value,
            video_url: slide.video_url.value,
            heading: slide.heading.value,
            subheading: slide.subheading.value,
            primary_button_label: slide.primary_button_label.value,
            primary_button_link: slide.primary_button_link.value,
            secondary_button_label: slide.secondary_button_label.value,
            secondary_button_link: slide.secondary_button_link.value,
            eager_load: 'lazy'
          %}
        {% endfor %}
      </div>
      <button type="button" class="bc-banner-carousel__nav bc-banner-carousel__nav--prev" aria-label="Previous slide" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button type="button" class="bc-banner-carousel__nav bc-banner-carousel__nav--next" aria-label="Next slide" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="bc-banner-carousel__indicators" aria-label="Banner carousel pagination"></div>
    </banner-carousel>
  {% endif %}

  <script>
  (function () {
    var embed = document.querySelector('[data-bc-design-embed="banner"]');
    if (!embed) return;
    var timer = window.setTimeout(function () {
      embed.classList.remove('bc-design-embed--pending');
    }, 3000);
    embed.dataset.bcDesignRevealFallback = String(timer);
  })();
  </script>
  <script src="{{ 'banner-carousel.js' | asset_url }}" defer></script>
  <script src="{{ 'bc-design-embed-placement.js' | asset_url }}" defer></script>
</div>
{% endif %}

{% schema %}
{
  "name": "t:blocks.banner_carousel.name",
  "target": "body",
  "stylesheet": "banner-carousel.css",
  "settings": [
    {
      "type": "paragraph",
      "content": "Configure the homepage banner in Apps → BC Design → Banner. This embed only renders on the homepage."
    }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Manual verification on homepage**

With both app embeds enabled in theme editor:

| Check | Expected |
|-------|----------|
| Homepage view source | Contains `data-bc-design-embed="banner"` |
| Product page view source | No `data-bc-design-embed="banner"` |
| Banner position | First visible pixel ≤ 4px below nav bar (no double gap) |
| Reversed embed order in editor | Navigation still above banner |
| Carousel | Next/prev, autoplay, indicators work once each; after placement move, one click/keydown advances one slide |

- [ ] **Step 3: Commit**

```bash
git add extensions/bc-design-theme/blocks/banner_carousel.liquid
git commit -m "feat: migrate banner block to body app embed (homepage only)"
```

---

### Task 6: Locales + remove `banner_slide`

**Files:**
- Modify: `extensions/bc-design-theme/locales/en.default.json`
- Modify: `extensions/bc-design-theme/locales/en.default.schema.json`
- Delete: `extensions/bc-design-theme/blocks/banner_slide.liquid`

- [ ] **Step 1: Update locale files**

`extensions/bc-design-theme/locales/en.default.json`:

```json
{
  "navigation_menu": {
    "name": "BC Design Navigation"
  },
  "banner_carousel": {
    "name": "BC Design Banner"
  }
}
```

`extensions/bc-design-theme/locales/en.default.schema.json`:

```json
{
  "blocks": {
    "navigation_menu": {
      "name": "BC Design Navigation"
    },
    "banner_carousel": {
      "name": "BC Design Banner"
    }
  }
}
```

- [ ] **Step 2: Delete banner_slide block**

```bash
rm extensions/bc-design-theme/blocks/banner_slide.liquid
```

- [ ] **Step 3: Confirm no remaining references**

Run: `rg "banner_slide" extensions/bc-design-theme`

Expected: no matches (or only comments in docs outside extension)

- [ ] **Step 4: Commit**

```bash
git add extensions/bc-design-theme/locales/en.default.json extensions/bc-design-theme/locales/en.default.schema.json
git rm extensions/bc-design-theme/blocks/banner_slide.liquid
git commit -m "chore: rename app embed blocks and remove banner_slide stub"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run automated checks**

```bash
npm test
npm run typecheck
npm run lint
npm run config:use -- localhost
npm run shopify -- app config validate --path . --json
```

Expected: all pass with exit code 0

- [ ] **Step 2: Theme editor smoke test**

1. `npm run dev:localhost`
2. **Customize → App embeds** — both **BC Design Navigation** and **BC Design Banner** visible with paragraph instructions
3. Enable both; disable theme Header section
4. Configure content in **Apps → BC Design → Navigation** and **Banner**
5. Save theme

- [ ] **Step 3: Storefront checklist**

| Scenario | Expected |
|----------|----------|
| Homepage configured | Nav + banner at top; carousel works; no duplicate indicators |
| Homepage unconfigured | Empty-state messages near top (not at page bottom) |
| Product page | Navigation only; no banner in HTML source |
| Skip link (Dawn-like theme) | Still first focusable; embeds after skip link |
| Throttled CPU in preview | No visible jump from bottom to top |
| Disable / 404 `bc-design-embed-placement.js` | Inline Liquid fallback still removes `bc-design-embed--pending` within 3s per embed |
| Resize mobile ↔ desktop | Banner stays flush below nav (≤ 4px) |

- [ ] **Step 4: Commit any fixups if needed**

Only if verification uncovered issues — one commit per fix.

---

## Self-Review (spec coverage)

| Spec requirement | Task |
|------------------|------|
| Two independent `target: "body"` app embeds | Tasks 4, 5 |
| Paragraph-only theme settings | Tasks 4, 5 |
| Navigation always `phaetus-nav-root--fixed` | Task 4 |
| Banner homepage-only (`template.name == 'index'`) | Task 5 |
| `data-bc-design-embed` wrappers (configured + empty) | Tasks 4, 5 |
| Move `#shopify-block-*` wrappers, not inner roots | Task 2 |
| Skip-link-aware insert (`after` skip / `before` main / prepend) | Task 2 |
| Deterministic nav-then-banner order (incl. reversed DOM) | Task 2 |
| `run()` no-ops when blocks already correctly placed | Task 2 |
| No duplicate banner `margin-top` when fixed nav present | Task 2 |
| `--bc-design-nav-height` + resize refresh | Task 2 |
| `bc-design-embed--pending` CLS hide + fail-open reveal | Tasks 2, 4, 5 |
| Inline per-block 3s reveal when placement script absent | Tasks 4, 5 |
| `__BC_DESIGN_EMBED_PLACEMENT_LOADED__` guard | Task 2 |
| Banner carousel idempotent lifecycle (no duplicate listeners after DOM move) | Task 3 |
| Delete `banner_slide.liquid` | Task 6 |
| Locale renames + remove `banner_slide` keys | Task 6 |
| No app admin / metaobject changes | Unchanged files list |
| `npm test`, `typecheck`, `lint`, config validate | Task 7 |

## Plan Review Resolutions

Reviewed against `docs/superpowers/plans/review.md`.

| Finding | Resolution |
|---------|------------|
| No skip link → insert after main (wrong) | `findInsertAnchor()` returns `{ node, position: 'after' \| 'before' \| 'prepend' }`; main landmark uses `before` |
| ESM module cache pollutes tests | `vi.resetModules()` before every dynamic `import()` in extension tests |
| Placement-only 3s fallback can't survive script 404 | Inline per-block Liquid `setTimeout` fallback + placement `cancelInlineRevealFallback()` on early reveal |
| Placement tests miss edge contracts | Added no-skip-link, nav-only, banner-only, reversed-order, inline-fallback tests in Task 2 |
| Banner lifecycle test missing browser API mocks | `matchMedia`, `cancelAnimationFrame`, `Element.prototype.animate` stubs in Task 3 |
| Inline fallback cancel test expects `''` but `delete dataset` yields `undefined` | Test uses `toBeUndefined()` |
| No-skip-link second `run()` re-moves blocks (`nav -> banner -> main`) | `isPlacementCorrect()` skips DOM moves when order already valid |
| `matchMedia` mock binds before null-check | Optional chaining fallback; assign to both `window.matchMedia` and `globalThis.matchMedia` |
| No-skip-link test expects `main.previousElementSibling === nav` | Assert `nav -> banner -> main` chain instead |
| Banner lifecycle test only counts indicators (passes pre-fix) | Test duplicate listener behavior via single-click/keydown slide advance |
| Spec pseudocode still uses old `findAccessibilityAnchor()` | Task 2 **Step 2** syncs spec (before implementation) to `findInsertAnchor()` + `isPlacementCorrect()` |
| Fixture swap after import leaves `hasRevealed` stale | Tests use `reloadPlacement()` per fixture; `revealEmbeds()` always clears current pending nodes |
| `KeyboardEvent` not on global in lifecycle test | `mountBrowserMocks()` sets `globalThis.KeyboardEvent`; use `new window.KeyboardEvent(...)` |
| Lifecycle Expected FAIL cites `translateX(-200%)` | Correct expectation: not `-100%`, usually `0%` after modulo wrap on 2 slides |
| Throw fail-open test passes vacuously after auto-reveal on import | Re-add `bc-design-embed--pending` before mocked `querySelector` throw |
| Fake timers leak across tests | `afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); })` in extension test files |
| Manual happy-dom `window.setTimeout` not wired to Vitest fake timers | `bridgeTimers(window)` in `mountGlobals()` / `mountBrowserMocks()` after `vi.useFakeTimers()` |
| Spec pseudocode passes `navBlock` to `applyBannerSpacing` | Step 2 pseudocode uses `applyBannerSpacing(navEmbed, bannerBlock)` |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-24-app-embed-target.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

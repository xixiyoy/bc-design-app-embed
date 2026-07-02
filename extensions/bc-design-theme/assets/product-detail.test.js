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

function buildPdFixture(variants, options = []) {
  const variantJson = JSON.stringify({ variants, options });
  return `
    <div data-bc-design-embed="product-detail" class="bc-design-embed--pending">
      <script type="application/json" data-bc-pd-data>${variantJson}</script>
      <form class="bc-product-form" data-variant-id="${variants[0]?.id ?? ''}" data-add-to-cart-text="Add to cart">
        <div class="bc-option-group" data-option-name="Size">
          ${variants.map((v, i) => {
            const val = v.options[0];
            return `<button type="button" class="bc-option-pill${i === 0 ? ' bc-option-pill--active' : ''}" data-value="${val}">${val}</button>`;
          }).join('')}
        </div>
        <div class="bc-qty-stepper">
          <button type="button" class="bc-qty-minus">-</button>
          <span class="bc-qty-value">1</span>
          <button type="button" class="bc-qty-plus">+</button>
        </div>
        <div class="bc-price-row">
          <span class="bc-price-current" data-current-price>$10.00</span>
          <span class="bc-price-save" data-save-price style="display:none;"></span>
          <span class="bc-price-compare" data-compare-price style="display:none;"></span>
        </div>
        <button type="button" class="bc-add-to-cart">Add to cart</button>
      </form>
    </div>
  `;
}

async function reloadPd(window, fixtureHtml) {
  vi.resetModules();
  window.document.body.innerHTML = fixtureHtml;
  mountGlobals(window);
  await import('./product-detail.js');
}

describe('product-detail', () => {
  let window;

  beforeEach(() => {
    window = new Window();
  });

  it('switches variant and updates price on pill click', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
      { id: 2, options: ['M'], available: true, priceHtml: '$15.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));
    const btnM = window.document.querySelector('[data-value="M"]');
    btnM.click();
    const currentPrice = window.document.querySelector('.bc-price-current');
    expect(currentPrice.innerHTML).toBe('$15.00');
    expect(window.document.querySelector('.bc-product-form').dataset.variantId).toBe('2');
  });

  it('shows Unavailable when no variant matches selected options', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));
    const group = window.document.querySelector('.bc-option-group');
    const extraBtn = window.document.createElement('button');
    extraBtn.type = 'button';
    extraBtn.className = 'bc-option-pill';
    extraBtn.dataset.value = 'XL';
    extraBtn.textContent = 'XL';
    group.appendChild(extraBtn);
    extraBtn.click();
    const addBtn = window.document.querySelector('.bc-add-to-cart');
    expect(addBtn.textContent).toBe('Unavailable');
    expect(addBtn.disabled).toBe(true);
  });

  it('toggles compare and save prices when variant has compare_at_price', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: true, compareAtHtml: '$15.00', saveHtml: 'Save $5.00' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));
    const savePrice = window.document.querySelector('.bc-price-save');
    const comparePrice = window.document.querySelector('.bc-price-compare');
    expect(savePrice.style.display).not.toBe('none');
    expect(savePrice.innerHTML).toBe('Save $5.00');
    expect(comparePrice.style.display).not.toBe('none');
    expect(comparePrice.innerHTML).toBe('$15.00');
  });

  it('increments and decrements quantity', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));
    const plus = window.document.querySelector('.bc-qty-plus');
    const minus = window.document.querySelector('.bc-qty-minus');
    const qty = window.document.querySelector('.bc-qty-value');
    plus.click();
    expect(qty.textContent).toBe('2');
    minus.click();
    expect(qty.textContent).toBe('1');
    minus.click();
    expect(qty.textContent).toBe('1');
  });

  it('disables add-to-cart button when variant is out of stock', async () => {
    const variants = [
      { id: 1, options: ['S'], available: false, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));
    const addBtn = window.document.querySelector('.bc-add-to-cart');
    expect(addBtn.disabled).toBe(true);
  });
});

describe('product-detail add-to-cart', () => {
  let window;

  beforeEach(() => {
    window = new Window();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows error feedback on non-2xx response', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ description: 'Variant is out of stock' }),
    });

    const addBtn = window.document.querySelector('.bc-add-to-cart');
    addBtn.click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(addBtn.textContent).toBe('Variant is out of stock');
    vi.advanceTimersByTime(1200);
    expect(addBtn.textContent).toBe('Add to cart');
  });

  it('warns but does not fail when cart sync fails', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [{ id: 1, quantity: 1 }] }),
      })
      .mockRejectedValueOnce(new Error('Network error'));

    const addBtn = window.document.querySelector('.bc-add-to-cart');
    addBtn.click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(1200);
    expect(warnSpy).toHaveBeenCalledWith('[BC Design] Cart count sync failed:', expect.any(Error));
    warnSpy.mockRestore();
  });
});

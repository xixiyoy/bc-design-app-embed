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
    mountBrowserMocks(window);

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

  it('creates progress bar elements for each indicator', () => {
    const carousel = document.querySelector('banner-carousel');
    const indicators = carousel.querySelectorAll('.bc-banner-carousel__indicator');

    expect(indicators.length).toBe(2);
    indicators.forEach((indicator) => {
      expect(indicator.querySelector('.bc-banner-carousel__indicator-progress')).toBeTruthy();
    });
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

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

  window.matchMedia = (query) => {
    const matches =
      query === '(hover: hover)' ? true : query === '(prefers-reduced-motion: reduce)' ? false : false;
    return { matches, addEventListener() {}, removeEventListener() {} };
  };
  globalThis.matchMedia = window.matchMedia;

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

  it('clicking right half of a video slide advances to next slide', async () => {
    const host = document.getElementById('host');
    const carousel = host.querySelector('banner-carousel');
    const track = carousel.querySelector('.bc-banner-carousel__track');

    carousel.querySelectorAll('.bc-banner-slide').forEach((slide, index) => {
      slide.innerHTML = `
        <div class="bc-banner-slide__media">
          <video class="bc-banner-slide__video" src="slide-${index}.mp4"></video>
        </div>
      `;
    });

    host.removeChild(carousel);
    document.body.appendChild(carousel);
    vi.runAllTimers();

    const video = carousel.querySelector('.bc-banner-slide__video');
    const rect = carousel.getBoundingClientRect();
    const rightHalfX = rect.left + rect.width * 0.75;

    Object.defineProperty(video, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        x: rect.left,
        y: rect.top,
      }),
    });

    video.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, clientX: rightHalfX })
    );

    expect(track.style.transform).toBe('translateX(-100%)');
  });

  it('clicking left half of a video slide goes to previous slide', async () => {
    const host = document.getElementById('host');
    const carousel = host.querySelector('banner-carousel');
    const track = carousel.querySelector('.bc-banner-carousel__track');

    carousel.querySelectorAll('.bc-banner-slide').forEach((slide, index) => {
      slide.innerHTML = `
        <div class="bc-banner-slide__media">
          <video class="bc-banner-slide__video" src="slide-${index}.mp4"></video>
        </div>
      `;
    });

    host.removeChild(carousel);
    document.body.appendChild(carousel);
    vi.runAllTimers();

    carousel.goTo(1);
    expect(track.style.transform).toBe('translateX(-100%)');

    const video = carousel.querySelector('.bc-banner-slide__video');
    const rect = carousel.getBoundingClientRect();
    const leftHalfX = rect.left + rect.width * 0.25;

    Object.defineProperty(video, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        x: rect.left,
        y: rect.top,
      }),
    });

    video.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, clientX: leftHalfX })
    );

    expect(track.style.transform).toBe('translateX(0%)');
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

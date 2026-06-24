class BcBannerCarousel extends HTMLElement {
  collectSlides() {
    if (!this.track) return;
    this.slides = Array.from(this.track.querySelectorAll('.bc-banner-slide'));
  }

  connectedCallback() {
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

    if (!this.track) return;

    window.setTimeout(() => {
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

      button.addEventListener('click', () => {
        this.stopAutoplay();
        this.goTo(slideIndex);
        this.resumeAutoplay();
      });
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

    this.prevButton?.addEventListener('click', () => this.previous());
    this.nextButton?.addEventListener('click', () => this.next());
  }

  isInteractiveTarget(target) {
    return Boolean(target.closest('a, button, video'));
  }

  getBannerCenterX() {
    const rect = this.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  isLeftOfBannerCenter(clientX) {
    return clientX < this.getBannerCenterX();
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

    this.addEventListener('mousemove', (event) => {
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
    });

    this.addEventListener('mouseleave', () => {
      if (cursorRafId) {
        cancelAnimationFrame(cursorRafId);
        cursorRafId = null;
      }

      pendingClientX = null;
      this.classList.remove('bc-banner-carousel--cursor-prev', 'bc-banner-carousel--cursor-next');
    });

    this.addEventListener('click', (event) => {
      if (this.isInteractiveTarget(event.target)) return;

      if (this.isLeftOfBannerCenter(event.clientX)) {
        this.previous();
      } else {
        this.next();
      }
    });
  }

  isAutoplayEnabled() {
    return this.dataset.autoplay === 'true' && this.slides.length > 1 && this.canAnimate;
  }

  isProgressPaused() {
    if (this.dataset.pauseOnHover === 'true' && this.isHovered) return true;
    return false;
  }

  canResumeAutoplay() {
    return !this.isProgressPaused();
  }

  getActiveProgressElement() {
    return this.indicators?.[this.index]?.querySelector('.bc-banner-carousel__indicator-progress') ?? null;
  }

  cancelProgressAnimation() {
    if (this.progressAnimation) {
      this.progressAnimation.cancel();
      this.progressAnimation = null;
    }
  }

  startProgressAnimation() {
    if (!this.isAutoplayEnabled()) return;

    const progress = this.getActiveProgressElement();
    if (!progress) return;

    this.cancelProgressAnimation();

    const activeIndicator = this.indicators[this.index];
    activeIndicator?.classList.add('is-autoplaying');

    this.progressAnimation = progress.animate(
      [{ transform: 'translateX(-100%)' }, { transform: 'translateX(0)' }],
      { duration: this.autoplaySpeed, fill: 'forwards', easing: 'linear' }
    );

    this.progressAnimation.onfinish = () => {
      this.progressAnimation = null;
      if (this.isAutoplayEnabled() && !this.isProgressPaused()) {
        this.goTo(this.index + 1);
      }
    };
  }

  pauseProgressAnimation() {
    if (this.progressAnimation?.playState === 'running') {
      this.progressAnimation.pause();
    }
  }

  resumeProgressAnimation() {
    if (!this.isAutoplayEnabled()) return;

    if (this.progressAnimation?.playState === 'paused') {
      this.progressAnimation.play();
      return;
    }

    if (!this.progressAnimation) {
      this.startProgressAnimation();
    }
  }

  restartProgressIfNeeded() {
    this.cancelProgressAnimation();

    this.indicators?.forEach((indicator) => {
      indicator.classList.remove('is-autoplaying');
    });

    if (!this.isAutoplayEnabled()) return;

    this.startProgressAnimation();

    if (this.isProgressPaused()) {
      this.pauseProgressAnimation();
    }
  }

  resumeAutoplay() {
    if (!this.canResumeAutoplay()) return;
    this.resumeProgressAnimation();
  }

  bindEvents() {
    this.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') this.previous();
      if (event.key === 'ArrowRight') this.next();
    });

    if (this.dataset.pauseOnHover === 'true') {
      this.addEventListener('mouseenter', () => {
        this.isHovered = true;
        this.stopAutoplay();
      });
      this.addEventListener('mouseleave', () => {
        this.isHovered = false;
        this.resumeAutoplay();
      });
    }

    this.addEventListener('focusin', (event) => {
      if (event.target.matches(':focus-visible')) this.stopAutoplay();
    });
    this.addEventListener('focusout', (event) => {
      if (this.contains(event.relatedTarget)) return;
      this.resumeAutoplay();
    });

    this.addEventListener('touchstart', (event) => {
      this.touchStartX = event.touches[0].clientX;
      this.touchStartY = event.touches[0].clientY;
    }, { passive: true });

    this.addEventListener('touchend', (event) => {
      const touch = event.changedTouches[0];
      const distanceX = touch.clientX - this.touchStartX;
      const distanceY = touch.clientY - this.touchStartY;

      if (Math.abs(distanceX) > 40 && Math.abs(distanceX) > Math.abs(distanceY)) {
        if (distanceX < 0) this.next();
        if (distanceX > 0) this.previous();
      }
    }, { passive: true });
  }

  previous() {
    this.stopAutoplay();
    this.goTo(this.index - 1);
    this.resumeAutoplay();
  }

  next() {
    this.stopAutoplay();
    this.goTo(this.index + 1);
    this.resumeAutoplay();
  }

  goTo(nextIndex) {
    if (this.slides.length === 0) return;

    this.index = ((nextIndex % this.slides.length) + this.slides.length) % this.slides.length;
    this.track.style.transform = `translateX(${-this.index * 100}%)`;

    this.slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === this.index;
      slide.classList.toggle('is-active', isActive);
      slide.setAttribute('aria-hidden', String(!isActive));

      const video = slide.querySelector('video');
      if (!video) return;

      if (isActive) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });

    this.updateIndicators();
    this.restartProgressIfNeeded();
  }

  updateIndicators() {
    if (!this.indicators) return;

    this.indicators.forEach((indicator, indicatorIndex) => {
      indicator.classList.remove('is-active', 'is-autoplaying');
      indicator.setAttribute('aria-current', String(indicatorIndex === this.index));
    });

    const activeIndicator = this.indicators[this.index];
    if (!activeIndicator) return;

    activeIndicator.classList.add('is-active');
  }

  startAutoplay() {
    if (!this.isAutoplayEnabled() || this.isProgressPaused()) return;
    this.resumeProgressAnimation();
  }

  stopAutoplay() {
    this.pauseProgressAnimation();
  }
}

if (!customElements.get('banner-carousel')) {
  customElements.define('banner-carousel', BcBannerCarousel);
}

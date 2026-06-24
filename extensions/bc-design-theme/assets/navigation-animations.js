/**
 * =============================================================================
 * 导航 GSAP 动画 — 所有点击动效只在本文件编写
 * =============================================================================
 *
 * 路径: extensions/bc-design-mega-menu/assets/navigation-animations.js
 *
 * 业务逻辑（class 切换、preventDefault 等）在:
 *   extensions/bc-design-mega-menu/blocks/navigation_menu.liquid 底部 <script>
 *
 * 本文件不写默认动画，仅提供挂钩函数与注释说明。
 * liquid 在对应 click 处调用 window.PhaetusNavAnim.* 。
 * More 按钮磁吸 hover、产品卡片图片 hover 在 DOMContentLoaded 时自动初始化。
 *
 * 依赖: gsap.min.js（navigation_menu.liquid 中先于本文件加载）
 *
 * 编写前建议:
 *   - 用 canAnimate() 判断 gsap 是否可用、用户是否开启「减少动效」
 *   - 关闭类动画若有 onComplete，必须在动画结束后调用 onComplete()
 *   - 避免与 .dropdown / .mobile-menu 上已有 CSS transition 重复（可改 liquid 内 style）
 * =============================================================================
 */
(function (global) {
  'use strict';

  /** @returns {boolean} 是否允许播放 GSAP */
  function canAnimate() {
    return typeof global.gsap !== 'undefined' &&
      !global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * PC：一级菜单打开下拉之后调用
   * 调用位置: navigation_menu.liquid — .nav-item click，dropdown.classList.add('open') 之后
   *
   * @param {HTMLElement} dropdown — 当前 .dropdown（id 形如 dropdown-{blockId}-{navIndex}）
   *
   * 可动画目标示例:
   *   - dropdown 整体: opacity / y（注意与 .dropdown.open 的 CSS transition 二选一）
   *   - .dropdown-inner 内容区
   */
  function openDropdown(dropdown) {
    // TODO: 在此编写 GSAP 打开动画
    // if (!canAnimate() || !dropdown) return;
    // gsap.fromTo(dropdown, { ... }, { ... });
  }

  /**
   * PC：关闭单个下拉（可选，供 closeAllDropdowns 内部复用）
   *
   * @param {HTMLElement} dropdown
   * @param {function} [onComplete] — 动画结束后执行；无动画时也应立即调用
   */
  function closeDropdown(dropdown, onComplete) {
    // TODO: 在此编写 GSAP 关闭动画，结束时调用 onComplete()
    if (onComplete) onComplete();
  }

  /**
   * PC：关闭 root 内所有已打开的下拉
   * 调用位置: closeAllDropdowns() — 点关闭钮、点外部、Esc、切换另一一级菜单前
   *
   * @param {HTMLElement} root — .phaetus-nav-root（#nav-root-{blockId}）
   * @param {function} onComplete — 动画全部结束后由 liquid 移除 .open 等 class（必调）
   *
   * 查询: root.querySelectorAll('.dropdown.open')
   */
  function closeAllDropdowns(root, onComplete) {
    // TODO: 对每个 .dropdown.open 做关闭动画，全部完成后 onComplete()
    // 未实现动画时保持立即回调，以免菜单无法关闭:
    if (onComplete) onComplete();
  }

  /**
   * PC：二级分类切换之后调用
   * 调用位置: .category-item click 的 activateCategory 之后；一级菜单首次打开后也会调用一次
   *
   * @param {HTMLElement} dropdown — 所属 .dropdown
   *
   * 可动画目标示例:
   *   - 当前面板: .nav-content-panel:not(.nav-hidden)
   *   - 产品卡片: .product-card（stagger）
   */
  function onCategoryChange(dropdown) {
    // TODO: 在此编写 GSAP 分类切换动画
  }

  /**
   * PC：点击 More 展开隐藏产品之后调用
   * 调用位置: .more-btn click，panel.classList.add('is-expanded') 之后
   *
   * @param {HTMLElement} panel — .content-list（含 is-expanded）
   *
   * 可动画目标: .product-card.nav-product-extra（展开前 display:none，展开后为 flex）
   */
  function expandMore(panel) {
    // TODO: 在此编写 GSAP More 展开动画
  }

  /** More 按钮磁吸强度（0–1，相对 zone 尺寸） */
  var MORE_BTN_MAGNETIC_STRENGTH = 0.35;

  /** 产品卡片图片 hover 放大倍数 */
  var PRODUCT_CARD_IMAGE_HOVER_SCALE = 1.1;

  /**
   * PC：More 按钮磁吸 hover（仅 x/y 位移，overwrite: "auto"）
   * 目标: .more-btn-wrap（zone）内 .more-btn
   *
   * @param {HTMLElement|Document} [scope] — 默认 document 下全部 .phaetus-nav-root
   */
  function initMoreButtonMagnets(scope) {
    if (!canAnimate()) return;

    var gsap = global.gsap;
    var roots;

    if (scope && scope.nodeType === 1) {
      roots = [scope];
    } else {
      roots = Array.prototype.slice.call(document.querySelectorAll('.phaetus-nav-root'));
    }

    roots.forEach(function (root) {
      root.querySelectorAll('.more-btn-wrap:not([data-magnetic-init])').forEach(function (zone) {
        var btn = zone.querySelector('.more-btn');
        if (!btn) return;

        zone.setAttribute('data-magnetic-init', 'true');
        gsap.set(btn, { x: 0, y: 0 });

        zone.addEventListener('mousemove', function (e) {
          var rect = zone.getBoundingClientRect();
          var x = gsap.utils.mapRange(
            rect.left, rect.right, -rect.width / 2, rect.width / 2, e.clientX
          );
          var y = gsap.utils.mapRange(
            rect.top, rect.bottom, -rect.height / 2, rect.height / 2, e.clientY
          );

          gsap.to(btn, {
            x: x * MORE_BTN_MAGNETIC_STRENGTH,
            y: y * MORE_BTN_MAGNETIC_STRENGTH,
            duration: 0.4,
            ease: 'power2.out',
            overwrite: 'auto'
          });
        });

        zone.addEventListener('mouseleave', function () {
          gsap.to(btn, {
            x: 0,
            y: 0,
            duration: 0.7,
            ease: 'elastic.out(1, 0.4)',
            overwrite: 'auto'
          });
        });
      });
    });
  }

  /**
   * PC：产品卡片图片 hover 放大（paused tween，mouseenter play / mouseleave reverse）
   * 目标: .product-card-inner 内 > img
   *
   * @param {HTMLElement|Document} [scope] — 默认 document 下全部 .phaetus-nav-root
   */
  function initProductCardImageHovers(scope) {
    if (!canAnimate()) return;

    var gsap = global.gsap;
    var roots;

    if (scope && scope.nodeType === 1) {
      roots = [scope];
    } else {
      roots = Array.prototype.slice.call(document.querySelectorAll('.phaetus-nav-root'));
    }

    roots.forEach(function (root) {
      root.querySelectorAll('.product-card-inner:not([data-product-card-hover-init])').forEach(function (card) {
        var img = card.querySelector('img');
        if (!img) return;

        card.setAttribute('data-product-card-hover-init', 'true');
        gsap.set(img, { scale: 1, transformOrigin: 'left center' });

        var hoverTween = gsap.to(img, {
          scale: PRODUCT_CARD_IMAGE_HOVER_SCALE,
          duration: 0.4,
          ease: 'power2.out',
          paused: true,
          overwrite: 'auto'
        });

        card.addEventListener('mouseenter', function () {
          hoverTween.play();
        });

        card.addEventListener('mouseleave', function () {
          hoverTween.reverse();
        });
      });
    });
  }

  /**
   * 移动端：打开侧栏菜单之后调用
   * 调用位置: openMobile() — mobileMenu / overlay 已 add('open') 之后
   *
   * @param {HTMLElement} menuEl — #mobile-menu-{blockId}
   * @param {HTMLElement} [overlayEl] — #mobile-overlay-{blockId}
   *
   * 注意: .mobile-menu 已有 CSS transform: translateX，若用 GSAP 改 x 请避免与 CSS 冲突
   */
  function openMobileMenu(menuEl, overlayEl) {
    // TODO: 在此编写 GSAP 打开移动菜单动画
  }

  /**
   * 移动端：关闭侧栏菜单
   * 调用位置: closeMobile() — 汉堡键、点遮罩、Esc
   *
   * @param {HTMLElement} menuEl
   * @param {HTMLElement} [overlayEl]
   * @param {function} onComplete — 结束后由 liquid 移除 .open（必调）
   */
  function closeMobileMenu(menuEl, overlayEl, onComplete) {
    // TODO: 在此编写 GSAP 关闭移动菜单动画，结束时 onComplete()
    if (onComplete) onComplete();
  }

  /**
   * 移动端：一级手风琴展开/收起
   * 调用位置: .mobile-nav-item[data-mobile-nav-toggle] click，submenu class 切换之后
   *
   * @param {HTMLElement} submenu — .mobile-submenu
   * @param {boolean} isOpen — 当前是否展开
   */
  function toggleMobileSubmenu(submenu, isOpen) {
    // TODO: isOpen === true 时编写展开动画；收起可选
  }

  /**
   * 移动端：二级分类产品列表展开
   * 调用位置: .mobile-category[data-mobile-cat-toggle] click 之后
   *
   * @param {HTMLElement} productsEl — .mobile-cat-products
   * @param {boolean} isOpen
   *
   * 可动画目标: .mobile-product-card
   */
  function toggleMobileCategoryProducts(productsEl, isOpen) {
    // TODO: isOpen === true 时编写产品列表动画
  }

  global.PhaetusNavAnim = {
    openDropdown: openDropdown,
    closeDropdown: closeDropdown,
    closeAllDropdowns: closeAllDropdowns,
    onCategoryChange: onCategoryChange,
    expandMore: expandMore,
    initMoreButtonMagnets: initMoreButtonMagnets,
    initProductCardImageHovers: initProductCardImageHovers,
    openMobileMenu: openMobileMenu,
    closeMobileMenu: closeMobileMenu,
    toggleMobileSubmenu: toggleMobileSubmenu,
    toggleMobileCategoryProducts: toggleMobileCategoryProducts
  };

  if (typeof document !== 'undefined') {
    var bootNavHovers = function () {
      initMoreButtonMagnets();
      initProductCardImageHovers();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootNavHovers);
    } else {
      bootNavHovers();
    }
  }
})(typeof window !== 'undefined' ? window : this);

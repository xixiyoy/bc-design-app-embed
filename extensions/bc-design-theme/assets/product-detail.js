(function () {
  'use strict';

  var root = document.querySelector('[data-bc-design-embed="product-detail"]');
  if (!root) return;

  var dataScript = root.querySelector('script[data-bc-pd-data]');
  if (!dataScript) return;

  var pd;
  try {
    pd = JSON.parse(dataScript.textContent);
  } catch (e) {
    console.error('[BC Design] Failed to parse product detail data', e);
    return;
  }

  console.log('[BC Design] Product Detail Variants & Options:', { variants: pd.variants, options: pd.options });
  console.log('[BC Design] Product Detail Admin Config:', pd.config);

  var form = root.querySelector('.bc-product-form');
  var addToCartBtn = root.querySelector('.bc-add-to-cart');
  var qtyValue = root.querySelector('.bc-qty-value');
  var currentPrice = root.querySelector('.bc-price-current');
  var comparePrice = root.querySelector('.bc-price-compare');
  var savePrice = root.querySelector('.bc-price-save');
  var optionGroups = root.querySelectorAll('.bc-option-group');

  var selectedOptions = {};
  pd.options.forEach(function (opt, i) {
    var selectedBtn = null;
    optionGroups.forEach(function (group) {
      if (group.dataset.optionName === opt) {
        selectedBtn = group.querySelector('.bc-option-pill--active');
      }
    });
    selectedOptions[opt] = selectedBtn ? selectedBtn.dataset.value : (pd.variants[0] ? pd.variants[0].options[i] : '');
  });

  updateVariant(findVariantByOptions());

  function findVariantByOptions() {
    return pd.variants.find(function (v) {
      return v.options.every(function (val, i) {
        return val === selectedOptions[pd.options[i]];
      });
    });
  }

  function updateVariant(variant) {
    if (!variant) {
      if (addToCartBtn) {
        addToCartBtn.disabled = true;
        addToCartBtn.textContent = 'Unavailable';
      }
      form.removeAttribute('data-variant-id');
      if (currentPrice) currentPrice.textContent = 'Unavailable';
      if (comparePrice) { comparePrice.style.display = 'none'; comparePrice.innerHTML = ''; }
      if (savePrice) { savePrice.style.display = 'none'; savePrice.innerHTML = ''; }
      return;
    }
    form.dataset.variantId = String(variant.id);
    if (currentPrice) currentPrice.innerHTML = variant.priceHtml;
    if (comparePrice) {
      comparePrice.style.display = variant.hasCompareAt ? '' : 'none';
      comparePrice.innerHTML = variant.compareAtHtml;
    }
    if (savePrice) {
      savePrice.style.display = variant.hasCompareAt ? '' : 'none';
      savePrice.innerHTML = variant.saveHtml;
    }
    if (addToCartBtn) {
      addToCartBtn.disabled = !variant.available;
      if (addToCartBtn.textContent === 'Unavailable') {
        addToCartBtn.textContent = form.dataset.addToCartText || 'Add to cart';
      }
    }
  }

  optionGroups.forEach(function (group) {
    group.addEventListener('click', function (e) {
      var btn = e.target.closest('.bc-option-pill');
      if (!btn || !group.contains(btn)) return;
      if (btn.disabled) return;
      var optionName = group.dataset.optionName;
      var value = btn.dataset.value;
      selectedOptions[optionName] = value;

      group.querySelectorAll('.bc-option-pill').forEach(function (p) {
        p.classList.toggle('bc-option-pill--active', p.dataset.value === value);
      });

      var matched = findVariantByOptions();
      updateVariant(matched);
    });
  });

  root.querySelector('.bc-qty-minus')?.addEventListener('click', function () {
    var val = parseInt(qtyValue.textContent, 10) || 1;
    qtyValue.textContent = String(Math.max(1, val - 1));
  });
  root.querySelector('.bc-qty-plus')?.addEventListener('click', function () {
    var val = parseInt(qtyValue.textContent, 10) || 1;
    qtyValue.textContent = String(val + 1);
  });

  if (addToCartBtn) {
    addToCartBtn.addEventListener('click', function () {
      var variantId = form.dataset.variantId;
      var qty = parseInt(qtyValue.textContent, 10) || 1;
      if (!variantId) return;
      addToCartBtn.disabled = true;

      var originalText = addToCartBtn.textContent;
      var didAddToCartSucceed = false;
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: variantId, quantity: qty }] })
      })
      .then(function (res) {
        return res.json().catch(function () {
          throw new Error('Unable to add');
        }).then(function (data) {
          if (!res.ok) throw new Error(data.description || data.message || 'Unable to add');
          return data;
        });
      })
      .then(function () {
        didAddToCartSucceed = true;
        addToCartBtn.textContent = 'Added ✓';
        addToCartBtn.style.backgroundColor = 'var(--color-bc-pd-primary-500)';
        setTimeout(function () {
          addToCartBtn.textContent = originalText;
          addToCartBtn.style.backgroundColor = '';
          var matched = findVariantByOptions();
          addToCartBtn.disabled = matched ? !matched.available : true;
        }, 1200);
        fetch('/cart.js')
          .then(function (r) { return r.json(); })
          .then(function (cart) {
            document.querySelectorAll('[data-cart-count]').forEach(function (el) {
              el.textContent = String(cart.item_count);
              el.dataset.count = String(cart.item_count);
              if (el.hidden !== undefined) el.hidden = cart.item_count === 0;
            });
          })
          .catch(function (syncErr) {
            console.warn('[BC Design] Cart count sync failed:', syncErr);
          });
      })
      .catch(function (err) {
        console.error('[BC Design] Add to cart failed:', err);
        addToCartBtn.textContent = err.message || 'Failed';
        setTimeout(function () {
          addToCartBtn.textContent = originalText;
        }, 1200);
      })
      .finally(function () {
        if (!didAddToCartSucceed) {
          var matched = findVariantByOptions();
          addToCartBtn.disabled = matched ? !matched.available : true;
        }
      });
    });
  }
})();

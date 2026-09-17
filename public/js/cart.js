(function () {
  const slug = document.body.dataset.slug;
  const base = document.body.dataset.base || '/s/' + slug;
  const KEY = 'mc_' + slug;
  const fmt = n => Number(n).toLocaleString('en-US') + ' د.ع';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  function showToast(msg) {
    document.querySelectorAll('.mc-toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'mc-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
  }

  function getCart() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function saveCart(c) { localStorage.setItem(KEY, JSON.stringify(c)); updateAll(); }
  function unitPrice(it) { return (Number(it.price) || 0) + (Number(it.addonsTotal) || 0); }
  function lineTotal(it) { return unitPrice(it) * Number(it.qty); }
  function totalOf(c) { return c.reduce((s, it) => s + lineTotal(it), 0); }
  const optsKey = it => String(it.opts || '') + '|' + (it.addons || []).map(a => a.name).sort().join(',');
  const jsStr = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\u0022').replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e') + "'";

  function updateAll() {
    const c = getCart();
    const count = c.reduce((s, it) => s + Number(it.qty), 0);
    const fab = document.getElementById('cartFab');
    if (fab) fab.style.display = count > 0 ? 'flex' : 'none';
    document.querySelectorAll('.mc-count').forEach(el => { el.textContent = count; });
    const cc = document.getElementById('cartCount');
    if (cc) { cc.textContent = count; cc.classList.remove('bump'); void cc.offsetWidth; cc.classList.add('bump'); }
    const itemsEl = document.getElementById('cartItems');
    const totalEl = document.getElementById('cartTotal');
    const coEl = document.getElementById('coCheckout');
    const ccEl = document.getElementById('cartCheckout');
    const canCheckout = c.length > 0;
    if (coEl) {
      coEl.href = canCheckout ? base + '/checkout' : '#';
      coEl.classList.toggle('disabled', !canCheckout);
    }
    if (ccEl) {
      ccEl.href = canCheckout ? base + '/checkout' : '#';
      ccEl.classList.toggle('disabled', !canCheckout);
    }
    if (itemsEl) {
      if (!c.length) itemsEl.innerHTML = '<p class="co-empty">السلة فارغة</p>';
      else itemsEl.innerHTML = c.map(it => `
        <div class="co-item">
          ${it.img ? `<img src="${it.img}" alt="">` : '<span class="co-noimg"></span>'}
          <div class="co-info"><span>${esc(it.name)}</span><small>${fmt(unitPrice(it))} للواحد${it.opts ? ' — ' + esc(it.opts) : ''}</small></div>
          <div class="qty-row mini">
            <button onclick="window.__dec(${jsStr(it.id)}, ${jsStr(optsKey(it))})">−</button><input value="${it.qty}" readonly><button onclick="window.__inc(${jsStr(it.id)}, ${jsStr(optsKey(it))})">+</button>
          </div>
          <button class="co-rm" onclick="window.__rm(${jsStr(it.id)}, ${jsStr(optsKey(it))})">×</button>
        </div>`).join('');
    }
    if (totalEl) totalEl.textContent = fmt(totalOf(c));
  }

  function idxOf(c, id, key) {
    return c.findIndex(x => String(x.id) === String(id) && optsKey(x) === key);
  }

  window.__inc = (id, key) => { const c = getCart(); const i = idxOf(c, id, key || ''); if (i > -1) c[i].qty = Math.min(99, c[i].qty + 1); saveCart(c); };
  window.__dec = (id, key) => { const c = getCart(); const i = idxOf(c, id, key || ''); if (i > -1) { c[i].qty -= 1; if (c[i].qty < 1) c[i].qty = 1; } saveCart(c); };
  window.__rm = (id, key) => saveCart(getCart().filter((x, i) => !(String(x.id) === String(id) && optsKey(x) === (key || ''))));

  window.addToCart = function (btn, q, optsTxt, addons) {
    q = q || 1;
    optsTxt = optsTxt || '';
    addons = addons || [];
    const id = btn.dataset.id, name = btn.dataset.name, price = btn.dataset.price, img = btn.dataset.img;
    const addonsTotal = addons.reduce((s, a) => s + (Number(a.price) || 0), 0);
    const item = { id, name, price, img, qty: q, opts: optsTxt, addons, addonsTotal };
    const c = getCart();
    const i = idxOf(c, id, optsKey(item));
    if (i > -1) c[i].qty = Math.min(99, c[i].qty + q);
    else c.push(item);
    saveCart(c);
    showToast('✓ تمت الإضافة للسلة');
    openCart();
  };

  window.openCart = () => {
    var drawer = document.getElementById('cartDrawer');
    var overlay = document.getElementById('cartOverlay');
    if (!drawer || !overlay) return;
    drawer.style.transform = 'translateX(0)';
    drawer.classList.add('open');
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  };
  window.closeCart = () => {
    var drawer = document.getElementById('cartDrawer');
    var overlay = document.getElementById('cartOverlay');
    if (!drawer || !overlay) return;
    drawer.style.transform = 'translateX(-100%)';
    drawer.classList.remove('open');
    overlay.classList.remove('show');
    document.body.style.overflow = '';
  };

  document.addEventListener('DOMContentLoaded', function() {
    var overlay = document.getElementById('cartOverlay');
    if (overlay) {
      overlay.addEventListener('click', closeCart);
    }
  });

  window.renderCheckoutPage = function () {
    const c = getCart();
    const el = document.getElementById('coItems');
    if (el) {
      if (!c.length) el.innerHTML = '<p class="co-empty">السلة فارغة — اعد للمتجر وأضف منتجات</p>';
      else el.innerHTML = c.map(it => `
        <div class="co-item">
          ${it.img ? `<img src="${it.img}" alt="">` : '<span class="co-noimg"></span>'}
          <div class="co-info"><span>${esc(it.name)}</span><small>${fmt(unitPrice(it))} — الكمية: ${it.qty}${it.opts ? '<br>' + esc(it.opts) : ''}</small></div>
          <b>${fmt(lineTotal(it))}</b>
        </div>`).join('');
    }
    refreshTotals();
    const form = document.getElementById('coForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        if (!c.length) { e.preventDefault(); alert('السلة فارغة'); return; }
        var hid = document.getElementById('coCart');
        if (!hid) { e.preventDefault(); alert('حدث خطأ — أعد تحميل الصفحة'); return; }
        hid.value = JSON.stringify(c.map(it => ({ id: it.id, qty: it.qty, opts: it.opts || '', addons: it.addons || [] })));
      });
    }
    const applyBtn = document.getElementById('coApplyCoupon');
    if (applyBtn) applyBtn.addEventListener('click', applyCoupon);
  };

  const bodyEl = document.body;
  const DELIVERY_FEE = Number(bodyEl.dataset.deliveryFee || 0);
  const FREE_MIN = Number(bodyEl.dataset.freeMin || 0);

  function refreshTotals() {
    const c = getCart();
    const subtotal = totalOf(c);
    const discount = window.__discount || 0;
    const delivery = DELIVERY_FEE > 0 && (FREE_MIN <= 0 || subtotal - discount < FREE_MIN) ? DELIVERY_FEE : 0;
    const grand = Math.max(0, subtotal - discount) + delivery;
    const sEl = document.getElementById('coSubtotal');
    const dEl = document.getElementById('coDiscount');
    const dlEl = document.getElementById('coDelivery');
    const tEl = document.getElementById('coTotal');
    const gEl = document.getElementById('coGrand');
    if (sEl) sEl.textContent = fmt(subtotal);
    if (dEl) { dEl.textContent = discount > 0 ? '− ' + fmt(discount) : '—'; }
    if (dlEl) dlEl.textContent = delivery > 0 ? fmt(delivery) : 'مجاناً';
    if (tEl) tEl.textContent = fmt(grand);
    if (gEl) gEl.textContent = fmt(grand);
    const line = document.getElementById('coFreeDelivery');
    if (line) {
      if (DELIVERY_FEE > 0 && FREE_MIN > 0) {
        const left = Math.max(0, FREE_MIN - (subtotal - discount));
        line.style.display = '';
        line.textContent = left > 0 ? 'أضف ' + fmt(left) + ' للحصول على توصيل مجاني' : '🎉 توصيلك مجاني';
      } else line.style.display = 'none';
    }
    const discEl = document.getElementById('coDiscountLine');
    if (discEl) discEl.style.display = discount > 0 ? '' : 'none';
  }

  function applyCoupon() {
    const input = document.getElementById('coCoupon');
    const msgEl = document.getElementById('coCouponMsg');
    if (!input || !msgEl) return;
    const code = (input.value || '').trim();
    if (!code) return;
    fetch(base + '/coupon-check?code=' + encodeURIComponent(code))
      .then(r => r.json())
      .then(j => {
        const c = getCart();
        const subtotal = totalOf(c);
        const hid = document.getElementById('coCouponCode');
        if (j.ok) {
          if (j.min_total > 0 && subtotal < j.min_total) {
            msgEl.textContent = 'الكود يتطلب طلباً بمبلغ ' + fmt(j.min_total) + ' فأكثر';
            window.__discount = 0;
          } else {
            window.__discount = j.type === 'amount' ? Math.min(j.value, subtotal) : Math.min(subtotal, Math.round(subtotal * j.value / 100));
            msgEl.textContent = '✓ الكود مقبول';
            msgEl.className = 'co-coupon-msg ok';
            if (hid) hid.value = code;
          }
        } else {
          window.__discount = 0;
          if (hid) hid.value = '';
          msgEl.textContent = j.message || 'الكود غير مقبول';
          msgEl.className = 'co-coupon-msg';
        }
        refreshTotals();
      })
      .catch(() => { if (msgEl) msgEl.textContent = 'تعذر الفحص — أعد المحاولة'; });
  }

  document.addEventListener('DOMContentLoaded', updateAll);
})();
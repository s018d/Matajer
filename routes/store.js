const express = require('express');
const crypto = require('crypto');
const { db, isPro } = require('../db');
const { appendLog, checkLimit, thumb, notifyNewOrder, getLoyaltyConfig, addLoyaltyPoints, asyncHandler } = require('../util');
const zaincash = require('../zaincash');
const shipping = require('../shipping');
const TPL = require('../templates');
const router = express.Router();

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'ip';
}

function getStoreBySlug(slug) {
  const s = db.prepare("SELECT * FROM stores WHERE slug=? AND status='active'").get(String(slug).toLowerCase());
  if (s) s.ispro = isPro(s) ? 1 : 0;
  return s;
}

function tplFor(store) {
  const t = TPL.get(store.template);
  if (!t) return null;
  if (t.premium && !isPro(store)) return null;
  if (t.premium) return { classes: t.classes, style: '', css: '/css/prem-' + store.template.slice(5) + '.css' };
  return { classes: t.classes, style: TPL.cssVars(t, store.color) };
}

function storeData(store) {
  return {
    cats: db.prepare('SELECT * FROM categories WHERE store_id=? ORDER BY position, id').all(store.id),
    products: db.prepare('SELECT COUNT(*) c FROM products WHERE store_id=? AND active=1').get(store.id).c
  };
}

function withBase(store, req) {
  store.base = req.storeBase === '' ? '' : '/s/' + store.slug;
  return store;
}

/* H7: إنقاص المخزون بعد تأكيد الدفع فقط (وليس عند إنشاء طلب زين كاش المعلق) */
function decrementOrderStock(orderId) {
  const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id=? AND product_id IS NOT NULL').all(orderId);
  for (const it of items) {
    const p = db.prepare('SELECT stock FROM products WHERE id=?').get(it.product_id);
    if (p && p.stock != null) db.prepare('UPDATE products SET stock = stock - ? WHERE id=?').run(it.qty, it.product_id);
  }
}

/* H7: إلغاء طلبات زين كاش المعلقة التي مضى عليها أكثر من 15 دقيقة دون دفع */
function cancelExpiredPendingOrders() {
  const expired = db.prepare(`SELECT id, store_id FROM orders WHERE status='pending_payment' AND created_at <= datetime('now','localtime','-15 minutes')`).all();
  for (const o of expired) {
    db.prepare(`UPDATE orders SET status='cancelled' WHERE id=? AND status='pending_payment'`).run(o.id);
    appendLog(`تم إلغاء طلب زين كاش المعلق #${o.id} — انتهت 15 دقيقة دون تأكيد الدفع`);
  }
  return expired.length;
}

router.get('/s/:slug', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).render('store/notfound', {});
  withBase(store, req);
  const { cats } = storeData(store);
  const cat = req.query.cat ? Number(req.query.cat) : 0;
  const q = String(req.query.q || '').trim();
  let where = 'p.store_id=? AND p.active=1';
  const params = [store.id];
  if (cat) {
    const okCat = db.prepare('SELECT id FROM categories WHERE id=? AND store_id=?').get(cat, store.id);
    if (!okCat) where += ' AND 0';
    else { where += ' AND p.category_id=?'; params.push(cat); }
  }
  if (q) { where += ' AND (p.name LIKE ? OR p.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  const rows = db.prepare(`SELECT p.*, (SELECT path FROM product_images i WHERE i.product_id=p.id ORDER BY position, id LIMIT 1) img FROM products p WHERE ${where} ORDER BY p.id DESC`).all(...params);
  rows.forEach(r => { r.img = thumb(r.img); });
  res.render('store/home', { store, cats, cat, q, rows, tpl: tplFor(store) });
});

router.get('/s/:slug/p/:id', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).render('store/notfound', {});
  withBase(store, req);
  const product = db.prepare('SELECT * FROM products WHERE id=? AND store_id=? AND active=1').get(req.params.id, store.id);
  if (!product) return res.status(404).render('store/notfound', {});
  db.prepare('UPDATE products SET views = views + 1 WHERE id=?').run(product.id);
  const images = db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY position, id').all(product.id);
  const { cats } = storeData(store);
  const related = db.prepare(`SELECT p.*, (SELECT path FROM product_images i WHERE i.product_id=p.id ORDER BY position, id LIMIT 1) img FROM products p WHERE p.store_id=? AND p.id!=? AND p.active=1 ORDER BY RANDOM() LIMIT 4`).all(store.id, product.id);
  related.forEach(r => { r.img = thumb(r.img); });
  // low stock flag for template
  product.lowStock = (product.stock != null && product.stock > 0 && product.stock < 5);
  res.render('store/product', { store, product, images, cats, related, tpl: tplFor(store) });
});

router.post('/s/:slug/checkout', asyncHandler(async (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).render('store/notfound', {});
  withBase(store, req);
  // rate limit checkout: 5 req/min per IP
  const lim = checkLimit('checkout:' + clientIp(req), 5, 60 * 1000);
  if (!lim.ok) {
    return res.redirect(`${store.base}/checkout?err=` + encodeURIComponent('محاولات إتمام طلب كثيرة — حاول بعد دقيقة'));
  }
  const { customer_name, customer_phone, customer_address, note, cart, coupon } = req.body;
  if (!customer_name || !customer_phone) {
    return res.redirect(`${store.base}/checkout?err=` + encodeURIComponent('الاسم ورقم الهاتف مطلوبان'));
  }
  let items;
  try { items = JSON.parse(cart || '[]'); } catch { items = []; }
  if (!Array.isArray(items) || !items.length) {
    return res.redirect(`${store.base}/checkout?err=` + encodeURIComponent('السلة فارغة'));
  }
  let subtotal = 0;
  const rows = [];
  for (const it of items) {
    const p = db.prepare('SELECT * FROM products WHERE id=? AND store_id=? AND active=1').get(Number(it.id), store.id);
    if (!p) continue;
    const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
    if (p.stock != null) {
      if (p.stock <= 0) continue;
      if (qty > p.stock) {
        return res.redirect(`${store.base}/checkout?err=` + encodeURIComponent(`الكمية المطلوبة من «${p.name}» أكثر من المتوفر (المتبقي ${p.stock})`));
      }
    }
    let pa = [];
    try { pa = JSON.parse(p.addons || '[]'); } catch { pa = []; }
    const picked = Array.isArray(it.addons) ? it.addons : [];
    let addonsTotal = 0;
    for (const a of picked) {
      const found = pa.find(x => String(x.name) === String(a.name));
      if (found) addonsTotal += Number(found.price) || 0;
    }
    subtotal += (Number(p.price) + addonsTotal) * qty;
    rows.push({ p, qty, price: Number(p.price), addonsTotal, opts: String(it.opts || '').slice(0, 300) });
  }
  if (!rows.length) return res.redirect(`${store.base}?err=` + encodeURIComponent('المنتجات غير متوفرة حالياً'));
  let discount = 0;
  let couponCode = '';
  const code = String(coupon || '').trim().toUpperCase().slice(0, 40);
  if (code) {
    const c = db.prepare("SELECT * FROM coupons WHERE store_id=? AND code=? AND active=1").get(store.id, code);
    const ok = c && (c.max_uses === 0 || c.used < c.max_uses) &&
      (!c.expires || String(c.expires) >= new Date().toISOString().slice(0, 10)) &&
      subtotal >= Number(c.min_total || 0);
    if (ok) {
      couponCode = code;
      discount = c.type === 'amount'
        ? Math.min(Number(c.value), subtotal)
        : Math.min(subtotal, Math.round(subtotal * Number(c.value) / 100));
      db.prepare('UPDATE coupons SET used = used + 1 WHERE id=?').run(c.id);
    }
  }
  
  // Bundle discounts
  let bundleDiscount = 0;
  let bundleCode = '';
  const activeBundles = db.prepare('SELECT * FROM bundles WHERE store_id=? AND active=1').all(store.id);
  for (const bundle of activeBundles) {
    // Count how many products from this bundle are in the cart
    const bundleProductIds = db.prepare('SELECT product_id FROM bundle_products WHERE bundle_id=?').all(bundle.id).map(r => r.product_id);
    const bundleItemsInCart = rows.filter(r => bundleProductIds.includes(r.p.id));
    const bundleQty = bundleItemsInCart.reduce((sum, r) => sum + r.qty, 0);
    
    if (bundleQty >= bundle.min_products) {
      const bundleSubtotal = bundleItemsInCart.reduce((sum, r) => sum + (r.price + r.addonsTotal) * r.qty, 0);
      let bDiscount = 0;
      if (bundle.discount_type === 'amount') {
        bDiscount = Math.min(bundle.discount_value, bundleSubtotal);
      } else {
        bDiscount = Math.round(bundleSubtotal * bundle.discount_value / 100);
      }
      if (bDiscount > bundleDiscount) {
        bundleDiscount = bDiscount;
        bundleCode = 'BUNDLE:' + bundle.id;
      }
    }
  }
  
  // Apply the better discount (coupon or bundle, not both)
  let finalDiscount = discount;
  let finalCode = couponCode;
  if (bundleDiscount > discount) {
    finalDiscount = bundleDiscount;
    finalCode = bundleCode;
  }
  discount = finalDiscount;
  couponCode = finalCode;
  
  const df = Number(store.delivery_fee) || 0;
  const freeMin = Number(store.free_delivery_min) || 0;
  const deliveryFee = df > 0 && (freeMin <= 0 || subtotal - discount < freeMin) ? df : 0;
  const total = Math.max(0, subtotal - discount) + deliveryFee;
  let paymentMethod = req.body.payment_method || 'cod'; // 'cod' or 'zaincash'
  // v4.3: زين كاش معطّل افتراضياً — أي طلب zaincash يُعامل كدفع عند الاستلام
  if (process.env.ZAINCASH_ENABLED === 'false' && paymentMethod === 'zaincash') paymentMethod = 'cod';
  
  // For Zain Cash, create order with pending status and redirect to payment
  let orderStatus = 'new';
  if (paymentMethod === 'zaincash') {
    orderStatus = 'pending_payment';
  }
  
  /* H7: إلغاء الطلبات المعلقة المنتهية (أكثر من 15 دقيقة) عند كل طلب جديد */
  cancelExpiredPendingOrders();
  
  const doneToken = crypto.randomBytes(16).toString('hex');
  const info = db.prepare('INSERT INTO orders (store_id, customer_name, customer_phone, customer_address, note, subtotal, discount, coupon_code, delivery_fee, total, status, done_token) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(store.id, String(customer_name).trim(), String(customer_phone).trim(), String(customer_address || ''), String(note || ''), subtotal, discount, couponCode, deliveryFee, total, orderStatus, doneToken);
  const orderId = info.lastInsertRowid;
  const orderItems = [];
  for (const r of rows) {
    db.prepare('INSERT INTO order_items (order_id, product_id, product_name, product_price, qty, options, addons_price) VALUES (?,?,?,?,?,?,?)')
      .run(orderId, r.p.id, r.p.name, r.price, r.qty, r.opts, r.addonsTotal);
    orderItems.push({ product_name: r.p.name, qty: r.qty, product_price: r.price, addons_price: r.addonsTotal });
    /* H7: لا يُنقص المخزون لطلبات زين كاش المعلقة — يُنقص فقط عند تأكيد الدفع (callback) أو لطلبات الدفع عند الاستلام */
    if (orderStatus !== 'pending_payment' && r.p.stock != null) db.prepare('UPDATE products SET stock = stock - ? WHERE id=?').run(r.qty, r.p.id);
  }
  appendLog(`وصول طلب جديد (#${orderId}) إلى متجر «${store.name}» بمبلغ ${total.toLocaleString('en-US')} د.ع من «${customer_name}»`);
  // Loyalty points
  const loyalty = getLoyaltyConfig();
  const earnedPoints = Math.floor(total / 1000) * loyalty.points_per_1000;
  addLoyaltyPoints(store.id, customer_phone, earnedPoints, 'order', orderId, `طلب #${orderId}`);
  
  // Handle Zain Cash payment
  if (paymentMethod === 'zaincash') {
    const callbackUrl = `${req.protocol}://${req.get('host')}/s/${store.slug}/zaincash/callback`;
    try {
      const paymentResult = await zaincash.initiatePayment(orderId, total, customer_phone, customer_name, callbackUrl, `طلب #${orderId} من ${store.name}`);
      if (paymentResult && paymentResult.redirectUrl) {
        // Save payment record
        db.prepare('INSERT INTO zaincash_payments (store_id, order_id, amount, status, zaincash_order_id) VALUES (?,?,?,?,?)')
          .run(store.id, orderId, total, 'pending', paymentResult.orderId || paymentResult.zaincashOrderId);
        return res.redirect(paymentResult.redirectUrl);
      } else {
        // Payment initiation failed, fallback to COD
        db.prepare('UPDATE orders SET status=? WHERE id=?').run('new', orderId);
        /* H7: الطلب أصبح عند الاستلام — يُنقص المخزون الآن */
        decrementOrderStock(orderId);
      }
    } catch (e) {
      appendLog(`فشل بدء دفع زين كاش للطلب #${orderId}: ${e.message}`);
      db.prepare('UPDATE orders SET status=? WHERE id=?').run('new', orderId);
      /* H7: الطلب أصبح عند الاستلام — يُنقص المخزون الآن */
      decrementOrderStock(orderId);
    }
  }
  // Telegram notification
  notifyNewOrder(store, { id: orderId, customer_name, customer_phone, customer_address, note, total, created_at: new Date().toISOString() }, orderItems);
  // Auto-create shipment if store has enabled shipping company
  try {
    const activeCompany = shipping.getActiveShippingCompanies(store.id);
    if (activeCompany && activeCompany.length > 0 && customer_address) {
      const comp = activeCompany[0];
      shipping.createShipmentRecord(store.id, orderId, comp.id, {
        shipping_company_id: comp.id,
        tracking_number: null,
        cod_amount: paymentMethod === 'cod' ? total : 0,
        shipping_fee: Number(deliveryFee) || 0,
        weight: 0.5,
        pickup_address: store.address || '',
        delivery_address: String(customer_address || ''),
        customer_phone: String(customer_phone || ''),
        customer_name: String(customer_name || '')
      });
    }
  } catch (e) {
    appendLog(`فشل إنشاء شحنة تلقائية للطلب #${orderId}: ${e.message}`);
  }
  res.render('store/done', { store, orderId, doneToken, subtotal, discount, deliveryFee, total, couponCode, tpl: tplFor(store), earnedPoints, paid: false });
}));

router.get('/s/:slug/manifest.json', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'not found' });
  const base = '/s/' + store.slug;
  const icon = store.logo_path || '/img/logo.svg';
  res.type('application/manifest+json').send(JSON.stringify({
    name: store.name,
    short_name: store.name.slice(0, 12),
    description: store.description || store.name,
    start_url: base + '/',
    scope: base + '/',
    display: 'standalone',
    dir: 'rtl',
    lang: 'ar',
    background_color: '#ffffff',
    theme_color: store.color || '#0ea5e9',
    icons: [
      { src: icon, sizes: 'any', type: 'image/svg+xml' },
      { src: '/img/placeholder.svg', sizes: '192x192 512x512', type: 'image/svg+xml', purpose: 'any' }
    ]
  }));
});

router.get('/s/:slug/coupon-check', (req, res) => {
  const lim = checkLimit('coupon:' + clientIp(req), 30, 60 * 1000);
  if (!lim.ok) return res.json({ ok: false, message: 'فحص الكوبونات كثير من جهازك — حاول بعد دقيقة' });
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.json({ ok: false, message: 'المتجر غير موجود' });
  const code = String(req.query.code || '').trim().toUpperCase().slice(0, 40);
  if (!code) return res.json({ ok: false, message: '' });
  const c = db.prepare("SELECT * FROM coupons WHERE store_id=? AND code=? AND active=1").get(store.id, code);
  if (!c) return res.json({ ok: false, message: 'الكود غير صحيح' });
  if (c.max_uses > 0 && c.used >= c.max_uses) return res.json({ ok: false, message: 'الكود استُنفد' });
  if (c.expires && String(c.expires) < new Date().toISOString().slice(0, 10)) return res.json({ ok: false, message: 'انتهت صلاحية الكود' });
  res.json({ ok: true, type: c.type, value: Number(c.value), min_total: Number(c.min_total || 0) });
});

router.get('/s/:slug/checkout', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).render('store/notfound', {});
  withBase(store, req);
  const { cats } = storeData(store);
  res.render('store/checkout', { store, cats, err: req.query.err || '', tpl: tplFor(store) });
});

router.post('/s/:slug/abandoned-cart', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.json({ ok: false, message: 'متجر غير موجود' });
  const { session_id, cart, customer_phone, customer_name, subtotal } = req.body;
  if (!session_id || !cart) return res.json({ ok: false, message: 'بيانات ناقصة' });
  const exists = db.prepare('SELECT id FROM abandoned_carts WHERE store_id=? AND session_id=?').get(store.id, session_id);
  if (exists) {
    db.prepare("UPDATE abandoned_carts SET cart_data=?, customer_phone=?, customer_name=?, subtotal=?, created_at=datetime('now','localtime') WHERE id=?")
      .run(JSON.stringify(cart), customer_phone || '', customer_name || '', subtotal || 0, exists.id);
  } else {
    db.prepare('INSERT INTO abandoned_carts (store_id, session_id, cart_data, customer_phone, customer_name, subtotal) VALUES (?,?,?,?,?,?)')
      .run(store.id, session_id, JSON.stringify(cart), customer_phone || '', customer_name || '', subtotal || 0);
  }
  res.json({ ok: true });
});

router.get('/s/:slug/reorder/:orderId', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  const base = '/s/' + store.slug;
  if (!store) return res.redirect(base + '?err=' + encodeURIComponent('متجر غير موجود'));
  
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND store_id=?').get(req.params.orderId, store.id);
  if (!order) return res.redirect(base + '?err=' + encodeURIComponent('الطلب غير موجود'));
  if (!order.done_token || String(req.query.t || '') !== order.done_token) {
    return res.redirect(base + '?err=' + encodeURIComponent('رابط إعادة الطلب غير صالح'));
  }
  
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  const cartData = items.map(item => ({
    id: item.product_id || item.id,
    name: item.product_name,
    price: item.product_price,
    qty: item.qty,
    options: item.options || '',
    addons: []
  }));
  
  // Store reorder data in session for checkout page to pick up
  const sessionId = 'reorder_' + Date.now();
  db.prepare('INSERT INTO abandoned_carts (store_id, session_id, cart_data, customer_phone, customer_name, subtotal) VALUES (?,?,?,?,?,?)')
    .run(store.id, sessionId, JSON.stringify(cartData), order.customer_phone, order.customer_name, order.subtotal);
  
  res.redirect(base + '/checkout?reorder=' + sessionId);
});

router.get('/s/:slug/reorder-data/:sessionId', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.json({ ok: false, message: 'متجر غير موجود' });
  
  const cart = db.prepare('SELECT cart_data FROM abandoned_carts WHERE session_id=? AND store_id=?').get(req.params.sessionId, store.id);
  if (!cart) return res.json({ ok: false, message: 'بيانات إعادة الطلب غير موجودة' });
  
  try {
    const cartData = JSON.parse(cart.cart_data);
    res.json({ ok: true, cart: cartData });
  } catch (e) {
    res.json({ ok: false, message: 'بيانات تالفة' });
  }
});

router.post('/s/:slug/reviews', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.json({ ok: false, message: 'متجر غير موجود' });
  
  const { product_id, customer_name, customer_phone, rating, comment } = req.body;
  if (!product_id || !customer_name || !rating) return res.json({ ok: false, message: 'بيانات ناقصة' });
  const r = Math.floor(Number(rating));
  if (r < 1 || r > 5) return res.json({ ok: false, message: 'التقييم يجب أن يكون بين 1 و 5' });
  
  const product = db.prepare('SELECT id FROM products WHERE id=? AND store_id=? AND active=1').get(product_id, store.id);
  if (!product) return res.json({ ok: false, message: 'منتج غير موجود' });
  
  db.prepare('INSERT INTO reviews (product_id, customer_name, customer_phone, rating, comment) VALUES (?,?,?,?,?)')
    .run(product_id, customer_name.trim(), customer_phone?.trim() || '', Math.floor(Number(rating)), comment?.trim() || '');
  
  res.json({ ok: true, message: 'شكراً لتقييمك — سيظهر بعد المراجعة' });
});

router.get('/s/:slug/product/:id/reviews', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.json({ ok: false, message: 'متجر غير موجود' });
  
  const product = db.prepare('SELECT id FROM products WHERE id=? AND store_id=? AND active=1').get(req.params.id, store.id);
  if (!product) return res.json({ ok: false, message: 'منتج غير موجود' });
  
  const reviews = db.prepare('SELECT customer_name, rating, comment, created_at FROM reviews WHERE product_id=? AND approved=1 ORDER BY created_at DESC').all(req.params.id);
  
  const stats = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE product_id=? AND approved=1').get(req.params.id);
  
  res.json({ ok: true, reviews, avg: stats.avg ? Number(stats.avg).toFixed(1) : 0, count: stats.count || 0 });
});

router.get('/s/:slug/zaincash/callback', asyncHandler(async (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.redirect('/s/' + req.params.slug + '?err=' + encodeURIComponent('متجر غير موجود'));
  
  /* H7: سجل الحالة قبل المعالجة — لننقص المخزون مرة واحدة فقط عند تأكيد الدفع */
  const rawOrderId = Number(req.query.orderId || 0);
  const before = rawOrderId ? db.prepare("SELECT status FROM orders WHERE id=? AND store_id=?").get(rawOrderId, store.id) : null;
  const wasPending = !!(before && before.status === 'pending_payment');
  
  const result = zaincash.processCallback(req.query);
  
  if (!result.valid) {
    appendLog(`فشل تحقق زين كاش للطلب #${req.query.orderId}: ${result.error}`);
    return res.redirect('/s/' + store.slug + '/checkout?err=' + encodeURIComponent('فشل التحقق من الدفع'));
  }
  
  if (result.status === 'paid') {
    /* H7: تأكيد الدفع — يُنقص المخزون الآن فقط (لم يُنقص عند إنشاء الطلب المعلق) */
    if (wasPending) {
      decrementOrderStock(result.orderId);
      appendLog(`تم تأكيد دفع زين كاش للطلب #${result.orderId} — نُقص المخزون`);
    }
    const order = db.prepare('SELECT done_token FROM orders WHERE id=? AND store_id=?').get(result.orderId, store.id);
    return res.redirect('/s/' + store.slug + '/done?order=' + result.orderId + '&paid=1&t=' + ((order && order.done_token) || ''));
  } else {
    return res.redirect('/s/' + store.slug + '/checkout?err=' + encodeURIComponent('فشل الدفع — ' + (result.error || 'حالة غير معروفة')));
  }
}));

router.get('/s/:slug/done', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).render('store/notfound', {});
  withBase(store, req);
  const orderId = Number(req.query.order || 0);
  if (!orderId) return res.redirect(store.base + '/checkout?err=' + encodeURIComponent('لا يوجد طلب'));
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND store_id=?').get(orderId, store.id);
  if (!order) return res.redirect(store.base + '/checkout?err=' + encodeURIComponent('الطلب غير موجود'));
  if (!order.done_token || String(req.query.t || '') !== order.done_token) {
    return res.redirect(store.base + '/checkout?err=' + encodeURIComponent('رابط الطلب غير صالح — تواصل مع المتجر إن كنت صاحب الطلب'));
  }
  const earnedPoints = Math.floor(order.total / 1000) * (getLoyaltyConfig().points_per_1000 || 10);
  res.render('store/done', {
    store, orderId, doneToken: order.done_token, subtotal: order.subtotal, discount: order.discount,
    deliveryFee: order.delivery_fee, total: order.total, couponCode: order.coupon_code || '',
    tpl: tplFor(store), earnedPoints, paid: req.query.paid === '1'
  });
});

module.exports = router;
module.exports.tplFor = tplFor;
module.exports.getStoreBySlug = getStoreBySlug;
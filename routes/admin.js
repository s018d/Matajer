const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { db, logActivity, UPLOADS_DIR, DB_FILE } = require('../db');
const { requireAdmin, hashPassword, genPassword, genSlug, appendLog, now, money } = require('../util');
const TPL = require('../templates');
const router = express.Router();

/* H8: رسالة تُعرض مرة واحدة بعد إعادة التوجيه (كوكي قصير العمر) — بديل عن تمرير الأسرار في الرابط */
function setFlash(res, msg) {
  res.setHeader('Set-Cookie', 'flash=' + encodeURIComponent(msg) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=60');
}
function takeFlash(req, res) {
  const v = req.cookies.flash ? decodeURIComponent(req.cookies.flash) : '';
  if (v) res.setHeader('Set-Cookie', 'flash=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return v;
}

function storeStats(id) {
  return {
    products: db.prepare('SELECT COUNT(*) c FROM products WHERE store_id=?').get(id).c,
    images: db.prepare('SELECT COUNT(*) c FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.store_id=?').get(id).c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders WHERE store_id=?').get(id).c,
    revenue: db.prepare(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE store_id=? AND status != 'cancelled'`).get(id).s
  };
}

function getStore(id) {
  return db.prepare('SELECT * FROM stores WHERE id=?').get(id);
}

router.use(requireAdmin);

router.get('/', (req, res) => {
  const stores = db.prepare('SELECT s.*, u.username owner_username FROM stores s LEFT JOIN users u ON u.store_id = s.id ORDER BY s.id DESC').all();
  const totals = {
    stores: stores.length,
    users: db.prepare("SELECT COUNT(*) c FROM users WHERE role='owner'").get().c,
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status != 'cancelled'").get().s
  };
  totals.pro = db.prepare("SELECT COUNT(*) c FROM stores WHERE plan='pro'").get().c;
  totals.coupons = db.prepare('SELECT COUNT(*) c FROM coupons').get().c;
  totals.newOrders = db.prepare("SELECT COUNT(*) c FROM orders WHERE status='new'").get().c;
  totals.pendingPayments = db.prepare("SELECT COUNT(*) c FROM payments WHERE status != 'done'").get().c;
  const topStores = db.prepare(`
    SELECT s.id, s.name, s.slug, s.plan, COUNT(DISTINCT o.id) orders, COALESCE(SUM(o.total),0) revenue
    FROM stores s LEFT JOIN orders o ON o.store_id = s.id AND o.status != 'cancelled'
    GROUP BY s.id ORDER BY revenue DESC LIMIT 5`).all();
  const recentOrders = db.prepare(`
    SELECT o.*, s.name store_name FROM orders o JOIN stores s ON s.id=o.store_id
    ORDER BY o.id DESC LIMIT 6`).all();
  const recent = db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 8').all();
  res.render('admin/dashboard', { stores, totals, topStores, recentOrders, recent, money, user: req.user });
});

router.get('/review', (req, res) => {
  const newStores = db.prepare("SELECT s.*, u.username owner_username FROM stores s LEFT JOIN users u ON u.store_id=s.id WHERE date(s.created_at) >= date('now','-7 days') ORDER BY s.id DESC").all();
  const pendingReviews = db.prepare("SELECT r.*, p.name product_name, s.name store_name, s.slug store_slug FROM reviews r JOIN products p ON p.id=r.product_id JOIN stores s ON s.id=p.store_id WHERE r.approved=0 ORDER BY r.id DESC LIMIT 30").all();
  res.render('admin/review', { newStores, pendingReviews, user: req.user, ok: req.query.ok || '', err: req.query.err || '' });
});

router.get('/stores', (req, res) => {
  const q = String(req.query.q || '').trim();
  const plan = ['pro', 'free'].includes(req.query.plan) ? req.query.plan : '';
  const status = ['active', 'suspended'].includes(req.query.status) ? req.query.status : '';
  const perPage = 25;
  const page = Math.max(1, Number(req.query.page) || 1);
  let where = '1=1';
  const params = [];
  if (q) { where += ' AND (s.name LIKE ? OR s.slug LIKE ? OR u.username LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (plan) { where += ' AND s.plan=?'; params.push(plan); }
  if (status) { where += ' AND s.status=?'; params.push(status); }
  const total = db.prepare(`SELECT COUNT(*) c FROM stores s LEFT JOIN users u ON u.store_id=s.id WHERE ${where}`).get(...params).c;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const rows = db.prepare(`
    SELECT s.*, u.username owner_username,
      (SELECT COUNT(*) FROM products WHERE store_id=s.id) products,
      (SELECT COUNT(*) FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.store_id=s.id) images,
      (SELECT COUNT(*) FROM orders WHERE store_id=s.id) orders,
      (SELECT COALESCE(SUM(total),0) FROM orders WHERE store_id=s.id AND status != 'cancelled') revenue
    FROM stores s LEFT JOIN users u ON u.store_id = s.id WHERE ${where} ORDER BY s.id DESC LIMIT ? OFFSET ?`).all(...params, perPage, (page - 1) * perPage);
  res.render('admin/stores', { list: rows, money, ok: req.query.ok || takeFlash(req, res), err: req.query.err || '', user: req.user, q, plan, status, page, totalPages, total });
});

router.get('/domains', (req, res) => {
  const requests = db.prepare(`
    SELECT dr.*, s.name store_name, s.slug store_slug
    FROM domain_requests dr JOIN stores s ON s.id=dr.store_id
    ORDER BY CASE dr.status WHEN 'pending' THEN 0 ELSE 1 END, dr.id DESC`).all();
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  res.render('admin/domains', { requests, pendingCount, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

router.post('/domains/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['done','rejected','pending'].includes(status)) return res.redirect('/admin/domains?err=' + encodeURIComponent('حالة غير صحيحة'));
  const priceNote = status === 'done' && req.body.final_price ? ` — السعر النهائي: ${Number(req.body.final_price).toLocaleString('en-US')} د.ع` : '';
  db.prepare(`UPDATE domain_requests SET status=?, note=COALESCE(note,'') WHERE id=?`).run(status, req.params.id);
  const r = db.prepare(`SELECT dr.*, s.name store_name FROM domain_requests dr JOIN stores s ON s.id=dr.store_id WHERE dr.id=?`).get(req.params.id);
  appendLog(`المدير حدّث طلب دومين «${r?.domain}» لمتجر «${r?.store_name}» إلى: ${status}${priceNote}`);
  logActivity(req.user.id, req.user.username, 'طلب دومين', `${r?.domain} -> ${status}`);
  res.redirect('/admin/domains?ok=' + encodeURIComponent('تم تحديث حالة الطلب'));
});

// أدمن فقط: ربط الدومين بمتجر التاجر مباشرة
router.post('/domains/:id/link', (req, res) => {
  const domain = String(req.body.linked_domain || '').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'');
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain))
    return res.redirect('/admin/domains?err=' + encodeURIComponent('صيغة الدومين غير صحيحة'));
  const r = db.prepare(`SELECT dr.*, s.name store_name FROM domain_requests dr JOIN stores s ON s.id=dr.store_id WHERE dr.id=?`).get(req.params.id);
  if (!r) return res.redirect('/admin/domains?err=' + encodeURIComponent('الطلب غير موجود'));
  const clash = db.prepare('SELECT id FROM stores WHERE lower(custom_domain)=? AND id!=?').get(domain, r.store_id);
  if (clash) return res.redirect('/admin/domains?err=' + encodeURIComponent('هذا الدومين مربوط بمتجر آخر'));
  db.prepare(`UPDATE stores SET custom_domain=? WHERE id=?`).run(domain, r.store_id);
  db.prepare(`UPDATE domain_requests SET status='done', note=? WHERE id=?`).run(`مرتبط: ${domain}`, r.id);
  appendLog(`المدير ربط دومين «${domain}» بمتجر «${r.store_name}»`);
  logActivity(req.user.id, req.user.username, 'ربط دومين', `${domain} -> ${r.store_name}`);
  res.redirect('/admin/domains?ok=' + encodeURIComponent(`تم ربط ${domain} بمتجر ${r.store_name}`));
});

router.post('/review/bulk-approve', (req, res) => {
  let ids = req.body.ids;
  if (!ids) return res.redirect('/admin/review?err=' + encodeURIComponent('لم يتم تحديد تقييمات'));
  if (!Array.isArray(ids)) ids = [ids];
  const valid = ids.map(v => Number(v)).filter(n => Number.isInteger(n) && n > 0);
  if (valid.length === 0) return res.redirect('/admin/review?err=' + encodeURIComponent('لم يتم تحديد تقييمات'));
  const stmt = db.prepare('UPDATE reviews SET approved=1 WHERE id=?');
  const tx = db.transaction(list => { for (const id of list) stmt.run(id); });
  tx(valid);
  logActivity(req.user.id, req.user.username, 'موافقة جماعية', `وافق على ${valid.length} تقييم`);
  appendLog(`المدير وافق على ${valid.length} تقييم دفعة واحدة`);
  res.redirect('/admin/review?ok=' + encodeURIComponent(`تمت الموافقة على ${valid.length} تقييم`));
});
router.post('/review/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.redirect('/admin/review?err=' + encodeURIComponent('تقييم غير صالح'));
  db.prepare('UPDATE reviews SET approved=1 WHERE id=?').run(id);
  res.redirect('/admin/review?ok=' + encodeURIComponent('تمت الموافقة على التقييم'));
});
router.post('/review/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.redirect('/admin/review?err=' + encodeURIComponent('تقييم غير صالح'));
  db.prepare('DELETE FROM reviews WHERE id=?').run(id);
  res.redirect('/admin/review?ok=' + encodeURIComponent('تم حذف التقييم'));
});

router.post('/stores', (req, res) => {
  const { name, username, owner_name, phone, password, description } = req.body;
  if (!name || !username) return res.redirect('/admin/stores?err=' + encodeURIComponent('اسم المتجر واسم المستخدم مطلوبان'));
  const { containsForbidden, getForbiddenWord } = require('../util');
  if (containsForbidden(name)) {
    const w = getForbiddenWord(name) || 'ممنوعة';
    return res.redirect('/admin/stores?err=' + encodeURIComponent(`اسم المتجر يحتوي على كلمة غير مسموحة: "${w}"`));
  }
  const existing = db.prepare('SELECT id FROM users WHERE username=?').get(String(username).trim());
  if (existing) return res.redirect('/admin/stores?err=' + encodeURIComponent(`اسم المستخدم «${username}» مستعمل سابقاً`));
  const pass = password ? String(password) : genPassword();
  const info = db.prepare('INSERT INTO stores (name, slug, description, owner_name, phone, template, color) VALUES (?,?,?,?,?,?,?)')
    .run(String(name), genSlug(String(name)), String(description || ''), String(owner_name || ''), String(phone || ''), 'classic', '#0ea5e9');
  db.prepare('INSERT INTO users (username, password_hash, role, store_id) VALUES (?,?,?,?)')
    .run(String(username).trim(), hashPassword(pass), 'owner', info.lastInsertRowid);
  logActivity(req.user.id, req.user.username, 'إنشاء متجر', `أنشأ متجر «${name}» لمستخدم «${username}»`);
  appendLog(`المدير العام أنشأ متجر «${name}» — رابطه /s/${db.prepare('SELECT slug FROM stores WHERE id=?').get(info.lastInsertRowid).slug} — حساب المستخدم «${username}»`);
  setFlash(res, `تم إنشاء المتجر «${name}» — المستخدم: ${username} — كلمة المرور: ${pass} (تُعرض مرة واحدة فقط)`);
  res.redirect('/admin/stores');
});

router.get('/stores/:id', (req, res) => {
  const store = getStore(req.params.id);
  if (!store) return res.redirect('/admin/stores');
  const owner = db.prepare('SELECT id, username, banned, banned_reason FROM users WHERE store_id=?').get(store.id);
  const stats = storeStats(store.id);
  const referrals = db.prepare('SELECT COUNT(*) c FROM referrals WHERE referrer_store_id=?').get(store.id).c;
  const rewarded = db.prepare("SELECT COUNT(*) c FROM referrals WHERE referrer_store_id=? AND status='done'").get(store.id).c;
  let allTemplates = [];
  try { allTemplates = db.prepare('SELECT * FROM templates WHERE is_active=1 ORDER BY is_premium, position').all(); } catch { allTemplates = TPL.PREMIUM.map(p=>({id:p.id, name:p.name, is_premium:1})); allTemplates.unshift({id:'classic', name:'الواضح (مجاني)', is_premium:0}); }
  res.render('admin/store-edit', { store, owner, stats, referrals, rewarded, TPL_PREMIUM: TPL.PREMIUM, allTemplates, money, ok: req.query.ok || takeFlash(req, res), err: req.query.err || '', user: req.user });
});

router.post('/stores/:id', (req, res) => {
  const store = getStore(req.params.id);
  if (!store) return res.redirect('/admin/stores');
  const { name, slug, description, owner_name, phone, template, color, status, custom_domain, delivery_fee, free_delivery_min, meta_desc } = req.body;
  let newSlug = String(slug || store.slug).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || store.slug;
  const clash = db.prepare('SELECT id FROM stores WHERE slug=? AND id!=?').get(newSlug, store.id);
  if (clash) {
    let i = 2; const base = newSlug;
    while (db.prepare('SELECT id FROM stores WHERE slug=? AND id!=?').get(newSlug, store.id)) newSlug = `${base}-${i++}`;
  }
  let domain = String(store.custom_domain || '').toLowerCase();
  const d = String(custom_domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (d) {
    if (/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d) && !d.endsWith('.local') && !/^(\d+\.){3}\d+$/.test(d) && d !== 'localhost') {
      if (!db.prepare('SELECT id FROM stores WHERE lower(custom_domain)=? AND id!=?').get(d, store.id)) domain = d;
    }
  } else domain = '';
  let tpl = TPL.valid(template) ? template : 'classic';
  if (TPL.isPremium(tpl) && store.plan !== 'pro' && store.plan !== 'business') tpl = 'classic';
  db.prepare('UPDATE stores SET name=?, slug=?, description=?, owner_name=?, phone=?, template=?, color=?, status=?, custom_domain=?, delivery_fee=?, free_delivery_min=?, meta_desc=? WHERE id=?')
    .run(String(name || store.name), newSlug, String(description ?? store.description), String(owner_name ?? ''), String(phone ?? ''), tpl, String(color || '#0ea5e9'), status === 'active' ? 'active' : 'suspended', domain,
      Math.max(0, Number(delivery_fee) || 0), Math.max(0, Number(free_delivery_min) || 0), String(meta_desc || '').slice(0, 200), store.id);
  const owner = db.prepare('SELECT username FROM users WHERE store_id=?').get(store.id);
  logActivity(req.user.id, req.user.username, 'تعديل متجر', `عدّل متجر «${name}»`);
  appendLog(`المدير العام عدّل متجر «${name}» (حالة: ${status === 'active' ? 'نشط' : 'موقوف'})`);
  res.redirect('/admin/stores/' + store.id + '?ok=' + encodeURIComponent('تم حفظ التعديلات'));
});

router.post('/stores/:id/resetpass', (req, res) => {
  const store = getStore(req.params.id);
  if (!store) return res.redirect('/admin/stores');
  const owner = db.prepare('SELECT id, username FROM users WHERE store_id=?').get(store.id);
  if (!owner) return res.redirect('/admin/stores/' + store.id + '?ok=لا يوجد حساب مرافق لهذا المتجر');
  const pass = genPassword();
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(pass), owner.id);
  logActivity(req.user.id, req.user.username, 'تصفير كلمة مرور', `صفّر كلمة مرور «${owner.username}»`);
  appendLog(`تم تصفير كلمة مرور مستخدم «${owner.username}»`);
  setFlash(res, `كلمة المرور الجديدة للمستخدم ${owner.username} هي: ${pass} (تُعرض مرة واحدة فقط)`);
  res.redirect('/admin/stores/' + store.id);
});

router.post('/stores/:id/delete', (req, res) => {
  const store = getStore(req.params.id);
  if (!store) return res.redirect('/admin/stores');
  // حذف متتالي آمن بمعاملة واحدة — يمنع الأيتام (P0-2)
  try {
    db.exec('BEGIN IMMEDIATE');
    // احذف صور المنتجات المرتبطة أولاً عبر المنتجات
    const pIds = db.prepare('SELECT id FROM products WHERE store_id=?').all(store.id).map(r=>r.id);
    if (pIds.length) {
      const ph = pIds.map(()=>'?').join(',');
      db.prepare(`DELETE FROM product_images WHERE product_id IN (${ph})`).run(...pIds);
      // احذف بنود الطلبات المرتبطة بطلبات المتجر
      const oIds = db.prepare('SELECT id FROM orders WHERE store_id=?').all(store.id).map(r=>r.id);
      if (oIds.length) {
        const oph = oIds.map(()=>'?').join(',');
        db.prepare(`DELETE FROM order_items WHERE order_id IN (${oph})`).run(...oIds);
      }
    }
    db.prepare('DELETE FROM orders WHERE store_id=?').run(store.id);
    db.prepare('DELETE FROM products WHERE store_id=?').run(store.id);
    db.prepare('DELETE FROM categories WHERE store_id=?').run(store.id);
    db.prepare('DELETE FROM coupons WHERE store_id=?').run(store.id);
    db.prepare('DELETE FROM abandoned_carts WHERE store_id=?').run(store.id);
    db.prepare('DELETE FROM reviews WHERE store_id=?').run(store.id);
    db.prepare('DELETE FROM payments WHERE store_id=?').run(store.id);
    try { db.prepare('DELETE FROM referrals WHERE store_id=?').run(store.id); } catch{}
    try { db.prepare('DELETE FROM loyalty_points WHERE store_id=?').run(store.id); } catch{}
    try { db.prepare('DELETE FROM loyalty_transactions WHERE store_id=?').run(store.id); } catch{}
    try { db.prepare('DELETE FROM cash_flow_entries WHERE store_id=?').run(store.id); } catch{}
    try { db.prepare('DELETE FROM support_messages WHERE store_id=?').run(store.id); } catch{}
    try { db.prepare('DELETE FROM support_tickets WHERE store_id=?').run(store.id); } catch{}
    db.prepare('DELETE FROM users WHERE store_id=?').run(store.id);
    db.prepare('DELETE FROM stores WHERE id=?').run(store.id);
    db.exec('COMMIT');
  } catch(e){ try{db.exec('ROLLBACK')}catch{}; return res.status(500).render('error',{msg:'فشل حذف المتجر: '+(e.message||e), user:req.user}) }
  const folder = path.join(UPLOADS_DIR, 'store_' + store.id);
  if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
  logActivity(req.user.id, req.user.username, 'حذف متجر', `حذف متجر «${store.name}» بكل محتواه`);
  appendLog(`المدير العام حذف متجر «${store.name}» بكل منتجاته وصوره نهائياً`);
  res.redirect('/admin/stores?ok=' + encodeURIComponent('تم حذف المتجر نهائياً'));
});

router.get('/activity', (req, res) => {
  const rows = db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 200').all();
  res.render('admin/activity', { rows, now, user: req.user });
});

function makeBackup() {
  const zip = new AdmZip();
  if (DB_FILE && !require('../db').isPg && fs.existsSync(DB_FILE)) zip.addLocalFile(DB_FILE, '', 'data/matajer.db');
  else if (require('../db').isPg) zip.addFile('data/pg-note.txt', Buffer.from('PostgreSQL mode — use pg_dump for DB backup'));
  if (fs.existsSync(UPLOADS_DIR)) {
    const walk = (dir, prefix) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, path.join(prefix, entry.name));
        else zip.addLocalFile(full, prefix);
      }
    };
    walk(UPLOADS_DIR, 'uploads');
  }
  const buf = zip.toBuffer();
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backupsDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const zipFile = path.join(backupsDir, `matajer-backup-${stamp}.zip`);
  fs.writeFileSync(zipFile, buf);
  return zipFile;
}

router.get('/backup', (req, res) => {
  const zipFile = makeBackup();
  logActivity(req.user.id, req.user.username, 'نسخة احتياطية', 'صَنَع نسخة احتياطية كاملة');
  appendLog(`المدير العام أنشأ نسخة احتياطية كاملة (قاعدة البيانات + كل الصور) — ${path.basename(zipFile)}`);
  res.download(zipFile);
});

router.get('/password', (req, res) => res.render('admin/password', { ok: req.query.ok || '', err: req.query.err || '', user: req.user }));

/* ====== إعدادات المنصة ====== */
const { siteSettings, setSetting, isPro } = require('../db');

router.get('/site', (req, res) => {
  const cfg = siteSettings();
  res.render('admin/site', { cfg, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

router.post('/site', (req, res) => {
  const { site_name, tagline, site_whatsapp, pay_account, free_products, pro_price, pro_price_3, pro_price_12, business_price, trial_days, telegram_bot_token, telegram_admin_chat_id } = req.body;
  setSetting('site_name', String(site_name || '').trim() || 'دُكّان Dukkan');
  setSetting('tagline', String(tagline || ''));
  setSetting('site_whatsapp', String(site_whatsapp || '').trim());
  setSetting('pay_account', String(pay_account || '').trim());
  setSetting('free_products', String(Math.max(1, Math.min(100, Number(free_products) || 25))));
  setSetting('pro_price', String(Math.max(1000, Number(pro_price) || 10000)));
  setSetting('pro_price_3', String(Math.max(1000, Number(pro_price_3) || 25000)));
  setSetting('pro_price_12', String(Math.max(1000, Number(pro_price_12) || 100000)));
  setSetting('business_price', String(Math.max(1000, Number(business_price) || 25000)));
  setSetting('trial_days', String(Math.max(0, Math.min(30, Number(trial_days) || 0))));
  setSetting('telegram_bot_token', String(telegram_bot_token || '').trim());
  setSetting('telegram_admin_chat_id', String(telegram_admin_chat_id || '').trim());
  logActivity(req.user.id, req.user.username, 'إعدادات المنصة', 'عدّل إعدادات الموقع العامة');
  appendLog(`المدير العام عدّل إعدادات المنصة (الاسم/الواتساب/جهة الدفع/حدود الباقة/تيليجرام)`);
  res.redirect('/admin/site?ok=' + encodeURIComponent('تم حفظ إعدادات المنصة'));
});

/* ====== المدفوعات والباقات ====== */
router.get('/payments', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, s.name store_name, s.slug store_slug, u.username owner_username
    FROM payments p JOIN stores s ON s.id=p.store_id LEFT JOIN users u ON u.store_id=s.id
    ORDER BY (p.status='done'), p.id DESC`).all();
  const referred = {};
  for (const r of db.prepare("SELECT new_store_id FROM referrals").all()) referred[r.new_store_id] = 1;
  const proStores = db.prepare("SELECT * FROM stores WHERE plan='pro'").all().map(s => ({ ...s, expired: !isPro(s) }));
  res.render('admin/payments', { rows, proStores, referred, money, now, ok: req.query.ok || '', user: req.user });
});

/* عرض إثبات الدفع — للمدير العام فقط */
router.get('/payments/receipt/:paymentId', (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.paymentId);
  if (!p || !p.receipt_path) return res.redirect('/admin/payments');
  // P0-5: منع تسريب مسار — تحقق صارم
  if (!/^private-receipts\//.test(p.receipt_path) || p.receipt_path.includes('..')) return res.status(403).render('error',{msg:'مسار غير صالح', user:req.user});
  const abs = path.resolve(path.join(__dirname, '..', p.receipt_path));
  const root = path.resolve(path.join(__dirname,'..'));
  if (!abs.startsWith(root)) return res.status(403).render('error',{msg:'مسار خارج النطاق', user:req.user});
  if (!require('fs').existsSync(abs)) return res.redirect('/admin/payments');
  res.sendFile(abs);
});

router.post('/payments/:id/confirm', (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
  if (!p) return res.redirect('/admin/payments');
  const days = Math.max(1, Number(p.months) || Number(req.body.months) || 1) * 30;
  const exp = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const newPlan = p.plan === 'business' ? 'business' : 'pro';
  db.prepare('UPDATE stores SET plan=?, plan_expires=? WHERE id=?').run(newPlan, exp, p.store_id);
  db.prepare("UPDATE payments SET status='done' WHERE id=?").run(p.id);
  const ref = db.prepare("SELECT * FROM referrals WHERE new_store_id=? AND status='pending'").get(p.store_id);
  if (ref) {
    db.prepare("UPDATE referrals SET status='done' WHERE id=?").run(ref.id);
    const referrer = db.prepare('SELECT * FROM stores WHERE id=?').get(ref.referrer_store_id);
    if (referrer) {
      const base = (referrer.plan === 'pro' || referrer.plan === 'business') && referrer.plan_expires && new Date(referrer.plan_expires) > new Date() ? new Date(referrer.plan_expires) : new Date();
      const rewardExp = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      db.prepare('UPDATE stores SET plan=?, plan_expires=? WHERE id=?').run('pro', rewardExp, referrer.id);
      appendLog(`**مكافأة إحالة** — متجر «${referrer.name}» كسب شهراً مجانياً (حتى ${rewardExp}) لأنه دعى متجر «${db.prepare('SELECT name FROM stores WHERE id=?').get(p.store_id).name}»`);
    }
  }
  const s = db.prepare('SELECT name FROM stores WHERE id=?').get(p.store_id);
  const u = db.prepare('SELECT username FROM users WHERE store_id=?').get(p.store_id);
  logActivity(req.user.id, req.user.username, 'تأكيد دفع', `فعّل الباقة الاحترافية لمتجر «${s.name}» حتى ${exp}`);
  appendLog(`**تم تأكيد دفع** — متجر «${s.name}» (المستخدم ${u ? u.username : '?'}) أصبح احترافياً حتى ${exp} — المبلغ ${money(p.amount)}`);
  res.redirect('/admin/payments?ok=' + encodeURIComponent('تم تفعيل الباقة الاحترافية حتى ' + exp));
});

router.post('/stores/:id/plan', (req, res) => {
  const store = getStore(req.params.id);
  if (!store) return res.redirect('/admin/stores');
  const plan = req.body.plan === 'business' ? 'business' : (req.body.plan === 'pro' ? 'pro' : 'free');
  const days = Math.max(1, Number(req.body.months) || 1) * 30;
  const exp = plan === 'free' ? '' : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  db.prepare('UPDATE stores SET plan=?, plan_expires=? WHERE id=?').run(plan, exp, store.id);
  const planAr = plan === 'business' ? 'الأعمال حتى ' + exp : (plan === 'pro' ? 'احترافية حتى ' + exp : 'مجانية');
  logActivity(req.user.id, req.user.username, 'تعديل باقة', `حدّد باقة «${plan}» لمتجر «${store.name}»`);
  appendLog(`المدير العام حدّد باقة «${planAr}» لمتجر «${store.name}»`);
  res.redirect('/admin/stores/' + store.id + '?ok=' + encodeURIComponent('تم تحديث الباقة'));
});

/* ====== فريق الإدارة (RBAC) ====== */
router.get('/team', (req, res) => {
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user, 'users.view')) return res.status(403).render('error', { msg: 'ليس لديك صلاحية إدارة الفريق', user: req.user });
  const team = db.prepare("SELECT id, username, display_name, role, is_active, created_at, last_login FROM users WHERE role IN ('superadmin','admin','billing','support','viewer') ORDER BY CASE role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 WHEN 'billing' THEN 2 WHEN 'support' THEN 3 ELSE 4 END, id").all();
  res.render('admin/team', { team, ok: req.query.ok || takeFlash(req,res), err: req.query.err || '', user: req.user });
});

router.post('/team', (req, res) => {
  const { hasPermission, ADMIN_ROLES } = require('../util');
  if (!hasPermission(req.user, 'users.manage')) return res.redirect('/admin/team?err=' + encodeURIComponent('ليس لديك صلاحية'));
  const { username, display_name, password, role, permissions } = req.body;
  const u = String(username||'').trim();
  const p = String(password||'');
  const r = String(role||'viewer');
  if (!u || u.length < 3) return res.redirect('/admin/team?err=' + encodeURIComponent('اسم المستخدم 3 أحرف على الأقل'));
  if (p.length < 6) return res.redirect('/admin/team?err=' + encodeURIComponent('كلمة المرور 6 أحرف على الأقل'));
  if (!ADMIN_ROLES.includes(r)) return res.redirect('/admin/team?err=' + encodeURIComponent('دور غير صحيح'));
  if (r === 'superadmin' && req.user.role !== 'superadmin') return res.redirect('/admin/team?err=' + encodeURIComponent('فقط السوبر أدمن ينشئ سوبر أدمن'));
  if (db.prepare('SELECT id FROM users WHERE username=?').get(u)) return res.redirect('/admin/team?err=' + encodeURIComponent('اسم المستخدم مستعمل'));
  let perms = '';
  if (permissions) {
    try { const arr = Array.isArray(permissions) ? permissions : [permissions]; perms = JSON.stringify(arr); } catch {}
  }
  db.prepare('INSERT INTO users (username, password_hash, role, display_name, permissions, is_active, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(u, hashPassword(p), r, String(display_name||'').trim(), perms, 1, req.user.id);
  logActivity(req.user.id, req.user.username, 'إضافة مشرف', `أضاف ${u} بدور ${r}`);
  appendLog(`المدير ${req.user.username} أضاف مشرف ${u} (${r})`);
  setFlash(res, `تم إنشاء حساب ${u} بدور ${r} — كلمة المرور: ${p} (مرة واحدة)`);
  res.redirect('/admin/team');
});

router.post('/team/:id/toggle', (req, res) => {
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user, 'users.manage')) return res.redirect('/admin/team?err=' + encodeURIComponent('ليس لديك صلاحية'));
  const t = db.prepare("SELECT * FROM users WHERE id=? AND role IN ('superadmin','admin','billing','support','viewer')").get(req.params.id);
  if (!t) return res.redirect('/admin/team?err=' + encodeURIComponent('المستخدم غير موجود'));
  if (t.id === req.user.id) return res.redirect('/admin/team?err=' + encodeURIComponent('لا يمكنك تعطيل نفسك'));
  if (t.role === 'superadmin' && req.user.role !== 'superadmin') return res.redirect('/admin/team?err=' + encodeURIComponent('لا يمكنك تعديل سوبر أدمن'));
  db.prepare('UPDATE users SET is_active=? WHERE id=?').run(t.is_active ? 0 : 1, t.id);
  res.redirect('/admin/team?ok=' + encodeURIComponent(t.is_active ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب'));
});

router.post('/team/:id/delete', (req, res) => {
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user, 'users.manage')) return res.redirect('/admin/team?err=' + encodeURIComponent('ليس لديك صلاحية'));
  const t = db.prepare("SELECT * FROM users WHERE id=? AND role IN ('superadmin','admin','billing','support','viewer')").get(req.params.id);
  if (!t) return res.redirect('/admin/team?err=' + encodeURIComponent('المستخدم غير موجود'));
  if (t.id === req.user.id) return res.redirect('/admin/team?err=' + encodeURIComponent('لا يمكنك حذف نفسك'));
  if (t.role === 'superadmin') return res.redirect('/admin/team?err=' + encodeURIComponent('لا يمكن حذف السوبر أدمن'));
  db.prepare('DELETE FROM users WHERE id=?').run(t.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id);
  appendLog(`المدير ${req.user.username} حذف مشرف ${t.username}`);
  res.redirect('/admin/team?ok=' + encodeURIComponent('تم حذف الحساب'));
});

router.post('/team/:id/resetpass', (req, res) => {
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user, 'users.manage')) return res.redirect('/admin/team?err=' + encodeURIComponent('ليس لديك صلاحية'));
  const t = db.prepare("SELECT * FROM users WHERE id=? AND role IN ('superadmin','admin','billing','support','viewer')").get(req.params.id);
  if (!t) return res.redirect('/admin/team?err=' + encodeURIComponent('المستخدم غير موجود'));
  const pass = genPassword();
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(pass), t.id);
  setFlash(res, `كلمة المرور الجديدة لـ ${t.username}: ${pass} (مرة واحدة)`);
  res.redirect('/admin/team');
});

/* ====== حظر المستخدمين (مكافحة التخريب والحسابات الوهمية) ====== */
router.post('/users/:id/ban', (req, res) => {
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user, 'users.manage')) return res.redirect('/admin/stores?err=' + encodeURIComponent('ليس لديك صلاحية'));
  const t = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!t) return res.redirect('/admin/stores?err=' + encodeURIComponent('المستخدم غير موجود'));
  if (t.id === req.user.id) return res.redirect('/admin/stores?err=' + encodeURIComponent('لا يمكنك حظر نفسك'));
  if (t.role === 'superadmin') return res.redirect('/admin/stores?err=' + encodeURIComponent('لا يمكن حظر السوبر أدمن'));
  const reason = String(req.body.reason || '').slice(0, 200);
  db.prepare('UPDATE users SET banned=1, banned_reason=? WHERE id=?').run(reason, t.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id); // طرد فوري من كل الجلسات
  logActivity(req.user.id, req.user.username, 'حظر مستخدم', `حظر «${t.username}» — السبب: ${reason || 'غير مذكور'}`);
  appendLog(`المدير ${req.user.username} حظر المستخدم «${t.username}» وطرده من كل الجلسات`);
  res.redirect('/admin/stores?ok=' + encodeURIComponent('تم حظر ' + t.username + ' وطرده فوراً'));
});

router.post('/users/:id/unban', (req, res) => {
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user, 'users.manage')) return res.redirect('/admin/stores?err=' + encodeURIComponent('ليس لديك صلاحية'));
  const t = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!t) return res.redirect('/admin/stores?err=' + encodeURIComponent('المستخدم غير موجود'));
  db.prepare("UPDATE users SET banned=0, banned_reason='' WHERE id=?").run(t.id);
  logActivity(req.user.id, req.user.username, 'فك حظر', `فك حظر «${t.username}»`);
  res.redirect('/admin/stores?ok=' + encodeURIComponent('تم فك حظر ' + t.username));
});

/* ====== سجل تسجيلات الدخول ====== */
router.get('/logins', (req, res) => {
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user, 'users.view')) return res.status(403).render('error', { msg: 'ليس لديك صلاحية', user: req.user });
  const q = String(req.query.q || '').trim();
  let rows;
  if (q) rows = db.prepare('SELECT * FROM login_logs WHERE username LIKE ? ORDER BY id DESC LIMIT 200').all('%' + q + '%');
  else rows = db.prepare('SELECT * FROM login_logs ORDER BY id DESC LIMIT 200').all();
  const fails = db.prepare('SELECT COUNT(*) c FROM login_logs WHERE success=0').get().c;
  res.render('admin/logins', { rows, fails, q, ok: req.query.ok || '', user: req.user });
});

/* ====== إدارة القوالب الديناميكية ====== */
const tplUpload = multer({
  storage: multer.diskStorage({
    destination: (req,file,cb) => {
      const dir = path.join(__dirname,'..','public','css');
      fs.mkdirSync(dir,{recursive:true});
      cb(null, dir);
    },
    filename: (req,file,cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safe = String(req.body.id||'tpl').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,20) || 'tpl';
      cb(null, safe + ext);
    }
  }),
  limits:{fileSize: 500*1024},
  fileFilter:(req,file,cb)=>{
    const ok = ['.css'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('فقط ملفات CSS'), ok);
  }
});

router.get('/templates', (req,res)=>{
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user,'templates.manage') && !hasPermission(req.user,'settings.view')) return res.status(403).render('error',{msg:'ليس لديك صلاحية إدارة القوالب', user:req.user});
  const list = db.prepare('SELECT * FROM templates ORDER BY position, id').all();
  res.render('admin/templates', { list, ok:req.query.ok||'', err:req.query.err||'', user:req.user });
});

router.post('/templates', tplUpload.single('css_file'), (req,res)=>{
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user,'templates.manage')) return res.redirect('/admin/templates?err=' + encodeURIComponent('ليس لديك صلاحية'));
  const { id, name, description, is_premium } = req.body;
  const tid = String(id||'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,20);
  if (!tid || !name) return res.redirect('/admin/templates?err=' + encodeURIComponent('المعرّف والاسم مطلوبان'));
  if (db.prepare('SELECT id FROM templates WHERE id=?').get(tid)) return res.redirect('/admin/templates?err=' + encodeURIComponent('المعرّف موجود سابقاً'));
  const cssPath = req.file ? '/css/' + req.file.filename : '';
  const maxPos = db.prepare('SELECT COALESCE(MAX(position),0) m FROM templates').get().m;
  db.prepare('INSERT INTO templates (id,name,description,css_file,is_premium,is_active,position) VALUES (?,?,?,?,?,?,?)')
    .run(tid, String(name).trim(), String(description||'').trim(), cssPath, is_premium==='on'?1:0, 1, maxPos+1);
  logActivity(req.user.id, req.user.username, 'إضافة قالب', `أضاف قالب ${tid}`);
  res.redirect('/admin/templates?ok=' + encodeURIComponent('تم إضافة القالب ' + tid));
}, (err,req,res,next)=> res.redirect('/admin/templates?err=' + encodeURIComponent(err.message||'فشل الرفع')));

router.post('/templates/:id/toggle', (req,res)=>{
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user,'templates.manage')) return res.redirect('/admin/templates?err=' + encodeURIComponent('ليس لديك صلاحية'));
  const t = db.prepare('SELECT * FROM templates WHERE id=?').get(req.params.id);
  if (!t) return res.redirect('/admin/templates?err=' + encodeURIComponent('القالب غير موجود'));
  db.prepare('UPDATE templates SET is_active=? WHERE id=?').run(t.is_active?0:1, t.id);
  res.redirect('/admin/templates?ok=' + encodeURIComponent(t.is_active ? 'تم تعطيل القالب' : 'تم تفعيل القالب'));
});

router.post('/templates/:id/premium', (req,res)=>{
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user,'templates.manage')) return res.redirect('/admin/templates?err=' + encodeURIComponent('ليس لديك صلاحية'));
  const t = db.prepare('SELECT * FROM templates WHERE id=?').get(req.params.id);
  if (!t) return res.redirect('/admin/templates?err=' + encodeURIComponent('القالب غير موجود'));
  db.prepare('UPDATE templates SET is_premium=? WHERE id=?').run(t.is_premium?0:1, t.id);
  res.redirect('/admin/templates?ok=' + encodeURIComponent(t.is_premium ? 'أصبح مجاني' : 'أصبح مميز'));
});

router.post('/templates/:id/delete', (req,res)=>{
  const { hasPermission } = require('../util');
  if (!hasPermission(req.user,'templates.manage')) return res.redirect('/admin/templates?err=' + encodeURIComponent('ليس لديك صلاحية'));
  const t = db.prepare('SELECT * FROM templates WHERE id=?').get(req.params.id);
  if (!t) return res.redirect('/admin/templates?err=' + encodeURIComponent('القالب غير موجود'));
  if (t.id==='classic') return res.redirect('/admin/templates?err=' + encodeURIComponent('لا يمكن حذف القالب الأساسي'));
  if (t.css_file) {
    const abs = path.join(__dirname,'..', t.css_file);
    if (fs.existsSync(abs)) try{ fs.unlinkSync(abs); }catch{}
  }
  db.prepare('DELETE FROM templates WHERE id=?').run(t.id);
  res.redirect('/admin/templates?ok=' + encodeURIComponent('تم حذف القالب'));
});

router.post('/password', (req, res) => {
  const { oldpass, newpass } = req.body;
  const { checkPassword } = require('../util');
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!checkPassword(String(oldpass || ''), u.password_hash))
    return res.redirect('/admin/password?err=كلمة المرور الحالية غير صحيحة');
  if (String(newpass || '').length < 6)
    return res.redirect('/admin/password?err=كلمة المرور الجديدة قصيرة (6 أحرف على الأقل)');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(String(newpass)), req.user.id);
  appendLog(`المدير العام غيّر كلمة مرور حسابه الخاص`);
  res.redirect('/admin/password?ok=تم تغيير كلمة المرور بنجاح');
});

/* ====== تذاكر الدعم — عرض الكل + رد + إغلاق ====== */
router.get('/support', (req, res) => {
  const filter = ['open', 'answered', 'closed', 'all'].includes(req.query.status) ? req.query.status : 'open';
  const where = filter === 'all' ? '' : 'WHERE t.status=?';
  const params = filter === 'all' ? [] : [filter];
  const rows = db.prepare(`SELECT t.*, s.name store_name, s.slug store_slug,
    (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id=t.id) replies
    FROM support_tickets t LEFT JOIN stores s ON s.id=t.store_id ${where} ORDER BY t.id DESC LIMIT 200`).all(...params);
  const openCount = db.prepare(`SELECT COUNT(*) c FROM support_tickets WHERE status='open'`).get().c;
  res.render('admin/support', { rows, filter, openCount, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});
router.get('/support/:id', (req, res) => {
  const t = db.prepare(`SELECT t.*, s.name store_name, s.slug store_slug FROM support_tickets t LEFT JOIN stores s ON s.id=t.store_id WHERE t.id=?`).get(Number(req.params.id) || 0);
  if (!t) return res.redirect('/admin/support?err=' + encodeURIComponent('التذكرة غير موجودة'));
  const msgs = db.prepare('SELECT * FROM support_messages WHERE ticket_id=? ORDER BY id').all(t.id);
  res.render('admin/support-view', { t, msgs, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});
router.post('/support/:id/reply', (req, res) => {
  const t = db.prepare('SELECT * FROM support_tickets WHERE id=?').get(Number(req.params.id) || 0);
  if (!t) return res.redirect('/admin/support?err=' + encodeURIComponent('التذكرة غير موجودة'));
  const message = String(req.body.message || '').replace(/<[^>]*>/g, '').trim().slice(0, 2000);
  if (message.length < 2) return res.redirect(`/admin/support/${t.id}?err=` + encodeURIComponent('اكتب الرد'));
  db.prepare(`INSERT INTO support_messages (ticket_id, sender_type, sender_id, message) VALUES (?,?,?,?)`).run(t.id, 'admin', req.user.id, message);
  db.prepare(`UPDATE support_tickets SET status='answered' WHERE id=?`).run(t.id);
  logActivity(req.user.id, req.user.username, 'رد دعم', `رد على تذكرة #${t.id}`);
  res.redirect(`/admin/support/${t.id}?ok=` + encodeURIComponent('تم إرسال الرد'));
});
router.post('/support/:id/status', (req, res) => {
  const t = db.prepare('SELECT * FROM support_tickets WHERE id=?').get(Number(req.params.id) || 0);
  if (!t) return res.redirect('/admin/support?err=' + encodeURIComponent('التذكرة غير موجودة'));
  const st = ['open', 'closed'].includes(req.body.status) ? req.body.status : 'open';
  db.prepare(`UPDATE support_tickets SET status=?, resolved_at=CASE WHEN ?='closed' THEN datetime('now','localtime') ELSE '' END WHERE id=?`).run(st, st, t.id);
  res.redirect(`/admin/support/${t.id}?ok=` + encodeURIComponent(st === 'closed' ? 'تم إغلاق التذكرة' : 'تم إعادة فتح التذكرة'));
});

module.exports = router;
module.exports.makeBackup = makeBackup;
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
  res.render('admin/review', { newStores, pendingReviews, user: req.user });
});

router.get('/stores', (req, res) => {
  const rows = db.prepare('SELECT s.*, u.username owner_username FROM stores s LEFT JOIN users u ON u.store_id = s.id ORDER BY s.id DESC').all();
  const list = rows.map(r => ({ ...r, ...storeStats(r.id) }));
  res.render('admin/stores', { list, money, ok: req.query.ok || takeFlash(req, res), err: req.query.err || '', user: req.user });
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

router.post('/review/:id/approve', (req, res) => {
  db.prepare('UPDATE reviews SET approved=1 WHERE id=?').run(req.params.id);
  res.redirect('/admin/review?ok=' + encodeURIComponent('تمت الموافقة على التقييم'));
});
router.post('/review/:id/delete', (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id=?').run(req.params.id);
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
  const owner = db.prepare('SELECT id, username FROM users WHERE store_id=?').get(store.id);
  const stats = storeStats(store.id);
  const referrals = db.prepare('SELECT COUNT(*) c FROM referrals WHERE referrer_store_id=?').get(store.id).c;
  const rewarded = db.prepare("SELECT COUNT(*) c FROM referrals WHERE referrer_store_id=? AND status='done'").get(store.id).c;
  res.render('admin/store-edit', { store, owner, stats, referrals, rewarded, TPL_PREMIUM: TPL.PREMIUM, money, ok: req.query.ok || takeFlash(req, res), user: req.user });
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
  if (TPL.isPremium(tpl) && store.plan !== 'pro') tpl = 'classic';
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
  const owner = db.prepare('SELECT id FROM users WHERE store_id=?').get(store.id);
  if (owner) db.prepare('DELETE FROM users WHERE id=?').run(owner.id);
  db.prepare('DELETE FROM stores WHERE id=?').run(store.id);
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
  zip.addLocalFile(DB_FILE, '', 'data/matajer.db');
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
  const { site_name, tagline, site_whatsapp, pay_account, free_products, pro_price, pro_price_3, pro_price_12, trial_days, telegram_bot_token, telegram_admin_chat_id } = req.body;
  setSetting('site_name', String(site_name || '').trim() || 'دُكّان Dukkan');
  setSetting('tagline', String(tagline || ''));
  setSetting('site_whatsapp', String(site_whatsapp || '').trim());
  setSetting('pay_account', String(pay_account || '').trim());
  setSetting('free_products', String(Math.max(1, Math.min(100, Number(free_products) || 10))));
  setSetting('pro_price', String(Math.max(1000, Number(pro_price) || 12000)));
  setSetting('pro_price_3', String(Math.max(1000, Number(pro_price_3) || 30000)));
  setSetting('pro_price_12', String(Math.max(1000, Number(pro_price_12) || 72000)));
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
  const abs = path.join(__dirname, '..', p.receipt_path);
  if (!require('fs').existsSync(abs)) return res.redirect('/admin/payments');
  res.sendFile(abs);
});

router.post('/payments/:id/confirm', (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
  if (!p) return res.redirect('/admin/payments');
  const days = Math.max(1, Number(req.body.months) || 1) * 30;
  const exp = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  db.prepare('UPDATE stores SET plan=?, plan_expires=? WHERE id=?').run('pro', exp, p.store_id);
  db.prepare("UPDATE payments SET status='done' WHERE id=?").run(p.id);
  const ref = db.prepare("SELECT * FROM referrals WHERE new_store_id=? AND status='pending'").get(p.store_id);
  if (ref) {
    db.prepare("UPDATE referrals SET status='done' WHERE id=?").run(ref.id);
    const referrer = db.prepare('SELECT * FROM stores WHERE id=?').get(ref.referrer_store_id);
    if (referrer) {
      const base = referrer.plan === 'pro' && referrer.plan_expires && new Date(referrer.plan_expires) > new Date() ? new Date(referrer.plan_expires) : new Date();
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
  const plan = req.body.plan === 'pro' ? 'pro' : 'free';
  const days = Math.max(1, Number(req.body.months) || 1) * 30;
  const exp = plan === 'pro' ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : '';
  db.prepare('UPDATE stores SET plan=?, plan_expires=? WHERE id=?').run(plan, exp, store.id);
  logActivity(req.user.id, req.user.username, 'تعديل باقة', `حدّد باقة «${plan}» لمتجر «${store.name}»`);
  appendLog(`المدير العام حدّد باقة «${plan === 'pro' ? 'احترافية حتى ' + exp : 'مجانية'}» لمتجر «${store.name}»`);
  res.redirect('/admin/stores/' + store.id + '?ok=' + encodeURIComponent('تم تحديث الباقة'));
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

module.exports = router;
module.exports.makeBackup = makeBackup;
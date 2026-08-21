const express = require('express');
const crypto = require('crypto');
const { db, logActivity, siteSettings, setSetting, isPro } = require('../db');
const { hashPassword, checkPassword, genSlug, createSession, destroySession, appendLog, checkLimit, captchaNew, captchaCheck } = require('../util');
const TPL = require('../templates');
const router = express.Router();

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'ip';
}

router.get('/', (req, res) => {
  const cfg = siteSettings();
  const stores = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.store_id=s.id AND p.active=1) products
    FROM stores s WHERE s.status='active' ORDER BY s.id DESC`).all();
  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    storesToday: db.prepare("SELECT COUNT(*) c FROM stores WHERE status='active' AND date(created_at)=?").get(today).c,
    ordersDone: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='completed'").get().c
  };
  res.render('landing', { cfg, stores, stats, money: (n) => (Number(n) || 0).toLocaleString('en-US') + ' د.ع' });
});

router.get('/faq', (req, res) => {
  const cfg = siteSettings();
  res.render('page', { cfg, title: 'الأسئلة الشائعة', heading: 'الأسئلة الشائعة', desc: 'إجابات عن أكثر الأسئلة تكراراً حول دُكّان: التسجيل، الدفع، الباقات، الدومينات، وما بعد انتهاء الباقة.', body: `
    <h2>كيف أنشئ متجري؟</h2>
    <p>اضغط «أنشئ متجرك مجاناً»، اكتب اسم المتجر واسم المستخدم وكلمة مرور (8 أحرف مع رقم وحرف) — وينطلق متجرك فوراً برابط خاص (مثل /s/my-store). لا نحتاج بطاقة دفع ولا أي مستندات.</p>
    <h2>كيف يدفع زبوني؟</h2>
    <p>دفع عند الاستلام. الزبون يطلب من متجرك، يصلك الطلب في لوحة التحكم مع تفاصيل كاملة، وتتواصل معه واتساب بضغطة واحدة. الدفع يتم عند وصول الطلب للزبون.</p>
    <h2>هل أحتاج دومين أو استضافة؟</h2>
    <p>لا — متجرك على رابط المنصة مجاناً. مع الباقة الاحترافية يمكنك ربط دومينك الخاص (مثل myshop.com) إن كان لديك.</p>
    <h2>كم عدد المنتجات المسموح؟</h2>
    <p>الباقة المجانية تسمح بـ ${cfg.free_products} منتج. الاحترافية: منتجات بلا حدود، مخزون، خيارات وإضافات، وأكواد خصم بلا حدود.</p>
    <h2>كيف أرقّي للباقة الاحترافية؟</h2>
    <p>من صفحة «الباقات» في لوحة تحكمك اختر 1 أو 3 أو 12 شهراً (12000 / 30000 / 72000 د.ع)، حوّل المبلغ لجهة الاستلام الموضحة هناك، وأرسل إثبات التحويل — نفعّل باقتك خلال دقائق.</p>
    <h2>ماذا يحدث بعد انتهاء الباقة؟</h2>
    <p>يعود متجرك للباقة المجانية فوراً مع بقاء كل بياناته (منتجات، صور، طلبات). يبقى التصميم الاحترافي معطلاً حتى تجدد الباقة، وأي تصاميم اعتمدتها لا تُحذف — تعود بمجرد التفعيل.</p>
    <h2>هل أستطيع إلغاء الباقة؟</h2>
    <p>نعم، في أي وقت — لا تجدد عند الانتهاء أو راسلنا واتساب لإيقافها فوراً. لا مصاريف خفية ولا التزامات.</p>
    <h2>كيف أتواصل مع الدعم؟</h2>
    <p>واتساب: <b dir="ltr">07831020026</b> — تيليغرام وإنستغرام: <b dir="ltr">@s018d</b> — تيك توك: <b dir="ltr">@s018a</b>. نرد خلال ساعات العمل.</p>
  ` });
});

router.get('/privacy', (req, res) => {
  const cfg = siteSettings();
  res.render('page', { cfg, title: 'سياسة الخصوصية', heading: 'سياسة الخصوصية', desc: 'كيف نتعامل مع بياناتك وبيانات زبائنك على منصة دُكّان Dukkan.', body: `
    <h2>ما البيانات التي نجمعها؟</h2>
    <p>عند التسجيل: اسم المتجر، اسم المستخدم، كلمة مرور مشفرة (لا تُخزن نصاً)، ورقم هاتف اختياري. عند الطلب: اسم الزبون وهاتفه وعنوانه وملاحظاته — وهذه بيانات يرسلها زبون متجرك إليك أنت، وتمر عبر خوادمنا لتفعيل الطلب فقط.</p>
    <h2>أين تُخزن البيانات؟</h2>
    <p>على خوادمنا داخل قاعدة بيانات محمية بكلمات مرور قوية. لا نبيع بياناتك ولا نشاركها مع أي طرف ثالث لأغراض تسويقية.</p>
    <h2>كلمة مرورك</h2>
    <p>تُخزن مشفرة بخوارزمية bcrypt — لا يمكن لأحد (بمن فيهم نحن) قراءتها. إذا نسيتها يمكن تصفيرها من لوحة المدير فقط.</p>
    <h2>ملفات تعريف الارتباط (كوكيز)</h2>
    <p>نستخدم كوكيز الجلسة لدخولك، وكوكيز حماية CSRF لمنع الهجمات. لا نستخدم كوكيز تتبع إعلاني.</p>
    <h2>حذف بياناتك</h2>
    <p>يمكنك طلب حذف متجرك وكل بياناته نهائياً في أي وقت عبر واتساب الدعم — يُنفذ خلال 48 ساعة.</p>
    <h2>ملاحظة</h2>
    <p>كل متجر مسؤول عن بيانات زبائنه: تجنّب طلب معلومات حساسة لا تحتاجها في طلباتك، والتزم بقوانين بلدك.</p>
  ` });
});

router.get('/terms', (req, res) => {
  const cfg = siteSettings();
  res.render('page', { cfg, title: 'الشروط والأحكام', heading: 'الشروط والأحكام', desc: 'شروط استخدام منصة دُكّان Dukkan للمتاجر الإلكترونية.', body: `
    <h2>قبول الشروط</h2>
    <p>بإنشاء متجرك على دُكّان فأنت توافق على هذه الشروط. نرحّل بتحديثها عند الحاجة وسنعلن عن التغييرات الجوهرية.</p>
    <h2>ما هو مسموح</h2>
    <p>بيع السلع والخدمات المشروعة قانوناً. يجب ألا تحتوي منتجاتك أو صورها على محتوى مخالف للقانون أو مسيء، وألا تستخدم المتجر لأغراض احتيالية.</p>
    <h2>الباقة المجانية</h2>
    <p>مجانية بلا مصاريف خفية: ${cfg.free_products} منتج، تصميم «الكلاسيكي النظيف»، حتى 5 أكواد خصم، مع ظهور عبارة «صُنع بواسطة ${cfg.site_name}» في متجرك.</p>
    <h2>الباقة الاحترافية</h2>
    <p>الأسعار: ${Number(cfg.pro_price).toLocaleString('en-US')} د.ع / شهر، ${Number(cfg.pro_price_3).toLocaleString('en-US')} د.ع / 3 شهور، ${Number(cfg.pro_price_12).toLocaleString('en-US')} د.ع / سنة. الدفع يدوياً عبر جهة الاستلام المعلنة. عند تأكيد الدفع تُفعّل الباقة فوراً للمدة المختارة.</p>
    <h2>إيقاف المتجر</h2>
    <p>نحتفظ بحق إيقاف أي متجر يخالف الشروط أو القوانين، مع إشعار مسبق عند الإمكان. المخالفات الجسيمة (احتيال، محتوى غير قانوني) قد تؤدي لإيقاف فوري.</p>
    <h2>المسؤولية</h2>
    <p>المنصة وسيط تقني: البيع يتم بين تاجر المتجر وزبونه مباشرة، والمنصة غير مسؤولة عن جودة البضائع أو أداء التاجر أو الزبون. نبذل جهداً للحفاظ على توفر الخدمة، ولا نضمن انقطاعاً صفرياً.</p>
    <h2>الدفع بين التاجر والزبون</h2>
    <p>المنصة لا تدخل في علاقة الدفع بينك وبين زبائنك — الطلبات «دفع عند الاستلام» وتُسلَّم وتسدد بين الطرفين مباشرة.</p>
    <h2>قانونية الاستخدام في العراق</h2>
    <p>التزاماً بقوانين جمهورية العراق، يجب على أصحاب المتاجر ممارسة نشاطهم المشروع وتحصيل أي تراخيص مطلوبة لنشاطهم.</p>
  ` });
});

router.get('/sitemap.xml', (req, res) => {
  const host = req.protocol + '://' + req.get('host');
  const stores = db.prepare("SELECT slug FROM stores WHERE status='active'").all();
  const urls = ['', '/faq', '/privacy', '/terms'].map(p => `<url><loc>${host}${p}</loc></url>`)
    .concat(stores.map(s => `<url><loc>${host}/s/${s.slug}</loc></url>`)).join('\n');
  res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>');
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /panel\nDisallow: /admin\nDisallow: /login\nDisallow: /signup\nAllow: /s/\n\nSitemap: ' + req.protocol + '://' + req.get('host') + '/sitemap.xml\n');
});

router.get('/signup', (req, res) => {
  const cap = captchaNew();
  res.cookie('cap', cap.id, { httpOnly: true, sameSite: 'lax' });
  let ref = '';
  let refName = '';
  const r = String(req.query.ref || '').trim();
  if (r) {
    const s = db.prepare("SELECT name FROM stores WHERE slug=? AND status='active'").get(r);
    if (s) { ref = r; refName = s.name; }
  }
  res.render('signup', { error: req.query.err || '', cap, ref, refName, trialDays: Number(siteSettings().trial_days || 0) });
});

router.post('/signup', (req, res) => {
  const ip = clientIp(req);
  const lim = checkLimit('signup:' + ip, 5, 60 * 60 * 1000);
  if (!lim.ok) return res.redirect('/signup?err=' + encodeURIComponent('طلبات التسجيل كثيرة من جهازك — انتظر ساعة ثم حاول'));
  const { username, password, name, phone, answer, website, ref } = req.body;
  if (website) return res.redirect('/signup?err=' + encodeURIComponent('رفض الطلب'));
  if (!captchaCheck(req.cookies.cap, answer))
    return res.redirect('/signup?err=' + encodeURIComponent('إجابة السؤال الحسابي غير صحيحة — حاول مجدداً'));
  const uname = String(username || '').trim();
  const pname = String(name || '').trim();
  if (uname.length < 3 || uname.length > 20 || !/^[a-zA-Z0-9_.-]+$/.test(uname))
    return res.redirect('/signup?err=' + encodeURIComponent('اسم المستخدم: 3-20 حرفاً إنجليزياً وأرقاماً فقط'));
  if (db.prepare('SELECT id FROM users WHERE username=?').get(uname))
    return res.redirect('/signup?err=' + encodeURIComponent('اسم المستخدم محجوز — اختر غيره'));
  if (String(password || '').length < 8 || !/^(?=.*[A-Za-z])(?=.*\d)/.test(String(password || '')))
    return res.redirect('/signup?err=' + encodeURIComponent('كلمة المرور: 8 أحرف على الأقل مع رقم وحرف'));
  if (pname.length < 2)
    return res.redirect('/signup?err=' + encodeURIComponent('اكتب اسم متجرك'));
  const tpl = 'classic';
  const cfg = siteSettings();
  const trialExp = new Date(Date.now() + Number(cfg.trial_days || 7) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const info = db.prepare('INSERT INTO stores (name, slug, description, owner_name, phone, template, color, plan, plan_expires) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(pname, genSlug(pname), 'متجري الجديد على ' + (cfg.site_name || 'دُكّان Dukkan'), String(uname), String(phone || ''), tpl, '#0ea5e9', 'pro', trialExp);
  const uinfo = db.prepare('INSERT INTO users (username, password_hash, role, store_id) VALUES (?,?,?,?)')
    .run(uname, hashPassword(String(password)), 'owner', info.lastInsertRowid);
  const token = createSession(uinfo.lastInsertRowid);
  res.cookie('sid', token, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  const slug = db.prepare('SELECT slug FROM stores WHERE id=?').get(info.lastInsertRowid).slug;
  const refSlug = String(ref || '').trim();
  if (refSlug) {
    const refStore = db.prepare("SELECT id, name FROM stores WHERE slug=? AND status='active'").get(refSlug);
    if (refStore && refStore.id !== info.lastInsertRowid) {
      db.prepare('INSERT INTO referrals (referrer_store_id, new_store_id) VALUES (?,?)').run(refStore.id, info.lastInsertRowid);
      appendLog(`**إحالة** — متجر «${pname}» (${slug}) سُجل عبر دعوة من متجر «${refStore.name}» — الداعي يكسب شهراً مجانياً عند أول ترقية للمدعو`);
    }
  }
  appendLog(`**تسجيل ذاتي جديد** — متجر «${pname}» — رابطه /s/${slug} — المستخدم «${uname}» — قالب مجاني (${tpl})${Number(cfg.trial_days || 0) > 0 ? ` — تجربة احترافية ${cfg.trial_days} أيام مجاناً حتى ${trialExp}` : ''}`);
  logActivity(null, uname, 'تسجيل متجر جديد', `«${pname}» بقالب ${tpl}` + (Number(cfg.trial_days || 0) > 0 ? ` — تجربة احترافية ${cfg.trial_days} أيام` : ''));
  res.redirect('/panel?welcome=1');
});

module.exports = router;
module.exports.clientIp = clientIp;
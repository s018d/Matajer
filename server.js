const express = require('express');
const path = require('path');
const crypto = require('crypto');
const compression = require('compression');
const { db } = require('./db');
const { genPassword, hashPassword, appendLog, now } = require('./util');

const app = express();
const PORT = process.env.PORT || 3000;
/* Trust proxy صريح فقط: يُفعَّل عبر TRUST_PROXY=1 خلف reverse proxy حقيقي (nginx). بدونه تُستخدم socket address ولا نثق بأي header من العميل. */
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(compression());
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, 'public'), { etag: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '1d', etag: true }));

app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const pair of header.split(';')) {
      const i = pair.indexOf('=');
      if (i > 0) req.cookies[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
    }
  }
  next();
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/* حماية CSRF: توكن في كوكي + حقل مخفي بكل نموذج (double-submit) — النماذج متعددة الأجزاء ترسل التوكن في الرابط أيضاً */
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    let t = req.cookies._csrf;
    if (!t) {
      t = crypto.randomBytes(18).toString('hex');
      res.setHeader('Set-Cookie', '_csrf=' + t + '; Path=/; HttpOnly; SameSite=Lax');
    }
    res.locals.csrf = t;
    return next();
  }
  const t = req.cookies._csrf;
  const sent = req.body._csrf || req.query._csrf || req.headers['x-csrf-token'];
  if (!t || String(sent || '') !== t) {
    return res.status(403).render('error', { msg: 'انتهت صلاحية النموذج — عُد للصفحة وحاول مجدداً', user: null });
  }
  res.locals.csrf = t;
  next();
});

app.use((req, res, next) => {
  const host = String(req.hostname || '').toLowerCase().replace(/^www\./, '');
  if (host && !/^(\d+\.){3}\d+$/.test(host) && !host.endsWith('.local') && host !== 'localhost' && !/^\d/.test(host)) {
    const s = db.prepare("SELECT slug FROM stores WHERE lower(custom_domain)=? AND status='active'").get(host);
    if (s && !req.url.startsWith('/s/')) {
      req.storeBase = '';
      req.url = '/s/' + s.slug + (req.url === '/' ? '' : req.url);
    }
  }
  next();
});

app.use(require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/panel', require('./routes/panel'));
app.use('/', require('./routes/site'));
app.use('/', require('./routes/store'));

app.use((req, res) => res.status(404).render('error', { msg: 'الصفحة غير موجودة', user: null }));

/* معالج أخطاء 500: يسجّل الخطأ ويردّ صفحة هادئة — بلا تسريب Stack Trace للمتصفح */
app.use((err, req, res, next) => {
  try {
    appendLog('**خطأ في الخادم:** ' + (err && (err.stack || err.message || String(err)) || String(err)));
  } catch (e) {}
  console.error('[' + new Date().toISOString() + ']', err && err.stack || err);
  if (res.headersSent) return next(err);
  const msg = process.env.NODE_ENV === 'production'
    ? 'حدث خطأ غير متوقع — حاول مجدداً لاحقاً'
    : 'حدث خطأ غير متوقع: ' + ((err && err.message) || String(err));
  res.status(500).render('error', { msg, user: null });
});

function seed() {
  const count = db.prepare("SELECT COUNT(*) c FROM users WHERE role='superadmin'").get().c;
  if (count === 0) {
    const pass = genPassword(12);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)')
      .run('admin', hashPassword(pass), 'superadmin');
    appendLog('**تم إنشاء حساب المدير العام الأول** — اسم المستخدم: admin — كلمة المرور في مخرجات الكونسول فقط (لا تُسجل نصاً في الملفات)');
    console.log('══════════════════════════════════════');
    console.log('  حساب المدير العام الأول:');
    console.log('  اسم المستخدم  : admin');
    console.log('  كلمة المرور   : ' + pass);
    console.log('  (تظهر في الكونسول فقط — لا تُحفظ في log.md)');
    console.log('══════════════════════════════════════');
  }
}

seed();
require('./seed').seedSamples();
appendLog(`تم تشغيل الخادم — المنصة جاهزة على http://localhost:${PORT} — الوقت: ${now()}`);

/* نسخة احتياطية تلقائية يومياً + WAL checkpoint — بدون إزعاج المستخدمين */
function scheduleMaintenance() {
  const runDaily = () => {
    const h = new Date().getHours();
    if (h === 3 && new Date().getMinutes() < 10) {
      try {
        const { makeBackup } = require('./routes/admin');
        const zipFile = makeBackup();
        appendLog(`**نسخة احتياطية تلقائية يومية** — ${path.basename(zipFile)}`);
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (e) {}
      } catch (e) { appendLog('فشلت النسخة الاحتياطية التلقائية: ' + (e.message || e)); }
    }
  };
  runDaily();
  setInterval(runDaily, 30 * 60 * 1000);
  appendLog('تم تفعيل النسخ الاحتياطي التلقائي اليومي (الساعة 3 فجراً) + صيانة قاعدة البيانات');
}
scheduleMaintenance();

app.listen(PORT, () => {
  console.log(`Matajer يعمل الآن على: http://localhost:${PORT}`);
});
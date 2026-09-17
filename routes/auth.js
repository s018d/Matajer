const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { hashPassword, checkPassword, createSession, destroySession, appendLog, logLogin, loginLocked, loginFail, loginOk, checkLimit, genSlug } = require('../util');
const router = express.Router();

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'ip';
}

/* شرائح الحسابات الأخيرة — كوكي عادي (أسماء فقط، بدون أسرار) */
function getRecent(req) {
  try {
    const arr = JSON.parse(req.cookies.recent || '[]');
    return Array.isArray(arr) ? arr.filter(x => x && x.u).slice(0, 3) : [];
  } catch { return []; }
}
function pushRecent(res, req, username) {
  const u = String(username || '').slice(0, 30);
  if (!u) return;
  const list = getRecent(req).filter(x => x.u !== u);
  list.unshift({ u });
  try {
    res.cookie('recent', JSON.stringify(list.slice(0, 3)), { maxAge: 180 * 24 * 60 * 60 * 1000, httpOnly: false, sameSite: 'lax' });
  } catch {}
}

function googleEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function finishLogin(req, res, user, method, remember) {
  // الحظر — يمنع حتى الجلسات القديمة عند أي دخول جديد
  if (user.banned === 1) {
    logLogin(user.id, user.username, clientIp(req), req.headers['user-agent'], false, method);
    return res.redirect('/login?err=' + encodeURIComponent('حسابك محظور' + (user.banned_reason ? ' — السبب: ' + user.banned_reason : '') + ' — تواصل مع الإدارة'));
  }
  if (user.is_active === 0) {
    logLogin(user.id, user.username, clientIp(req), req.headers['user-agent'], false, method);
    return res.redirect('/login?err=' + encodeURIComponent('حسابك موقوف — تواصل مع المدير العام'));
  }
  // تذكرني: 90 يوم — بدونها: يوم واحد فقط (حفظ الدخول اختياري)
  const days = remember ? 90 : 1;
  const { token } = createSession(user.id, days);
  try { db.prepare("UPDATE users SET last_login=datetime('now','localtime') WHERE id=?").run(user.id); } catch {}
  logLogin(user.id, user.username, clientIp(req), req.headers['user-agent'], true, method);
  pushRecent(res, req, user.username);
  res.cookie('sid', token, { maxAge: days * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  const ADMIN_ROLES = ['superadmin','admin','billing','support','viewer'];
  const isAdmin = ADMIN_ROLES.includes(user.role);
  appendLog(`دخول ناجح للمستخدم «${user.username}» عبر ${method === 'google' ? 'جيميل' : 'كلمة المرور'} بتصريح ${isAdmin ? 'إدارة ('+user.role+')' : 'صاحب متجر'}`);
  res.redirect(isAdmin ? '/admin' : '/panel');
}

router.get('/login', (req, res) => {
  // داخل أصلاً؟ روح للوحة مباشرة
  if (req.cookies && req.cookies.sid) {
    try {
      const { currentUser } = require('../util');
      const u = currentUser(req);
      if (u) {
        const ADMIN_ROLES = ['superadmin','admin','billing','support','viewer'];
        return res.redirect(ADMIN_ROLES.includes(u.role) ? '/admin' : '/panel');
      }
    } catch {}
  }
  res.render('login', { error: req.query.err || '', recent: getRecent(req), google: googleEnabled() });
});

router.post('/login', (req, res) => {
  const ip = clientIp(req);
  if (loginLocked(ip))
    return res.redirect('/login?err=' + encodeURIComponent('محاولات كثيرة — تم قفل الدخول 15 دقيقة'));
  const lim = checkLimit('login:' + ip, 20, 10 * 60 * 1000);
  if (!lim.ok) return res.redirect('/login?err=' + encodeURIComponent('محاولات كثيرة من جهازك — انتظر 10 دقائق'));
  const { username, password, remember } = req.body;
  const uname = String(username || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  if (!user || !user.password_hash || !checkPassword(String(password || ''), user.password_hash)) {
    logLogin(user ? user.id : null, uname, ip, req.headers['user-agent'], false, 'password');
    const locked = loginFail(ip);
    return res.redirect('/login?err=' + encodeURIComponent(locked ? 'محاولات كثيرة — تم قفل الدخول 15 دقيقة' : 'اسم المستخدم أو كلمة المرور غير صحيحة'));
  }
  loginOk(ip);
  finishLogin(req, res, user, 'password', remember === 'on' || remember === '1');
});

/* ====== الدخول بجيميل (Google OAuth2/OpenID) ====== */
const oauthStates = new Map(); // state -> وقت الإنشاء (10 دقائق)
function googleClient(callbackUrl) {
  const { Issuer } = require('openid-client');
  return Issuer.discover('https://accounts.google.com').then(googleIssuer => {
    const { Client } = require('openid-client');
    return new googleIssuer.Client({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uris: [callbackUrl],
      response_types: ['code']
    });
  });
}
function baseUrl(req) {
  return req.protocol + '://' + req.get('host');
}

router.get('/login/google', async (req, res) => {
  if (!googleEnabled()) return res.redirect('/login?err=' + encodeURIComponent('الدخول بجيميل غير مفعّل بعد — استخدم اسم المستخدم'));
  try {
    const cb = baseUrl(req) + '/oauth2/callback/google';
    const client = await googleClient(cb);
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, Date.now());
    if (oauthStates.size > 200) for (const [k, v] of oauthStates) if (Date.now() - v > 10 * 60 * 1000) oauthStates.delete(k);
    res.redirect(client.authorizationUrl({ scope: 'openid email profile', state }));
  } catch (e) {
    res.redirect('/login?err=' + encodeURIComponent('تعذر الاتصال بجوجل — حاول لاحقاً'));
  }
});

router.get('/oauth2/callback/google', async (req, res) => {
  if (!googleEnabled()) return res.redirect('/login');
  try {
    const cb = baseUrl(req) + '/oauth2/callback/google';
    const state = String(req.query.state || '');
    const at = oauthStates.get(state);
    oauthStates.delete(state);
    if (!at || Date.now() - at > 10 * 60 * 1000)
      return res.redirect('/login?err=' + encodeURIComponent('انتهت صلاحية طلب جوجل — حاول مجدداً'));
    const client = await googleClient(cb);
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(cb, params, { state });
    const claims = tokenSet.claims();
    const sub = String(claims.sub || '');
    const email = String(claims.email || '').toLowerCase().trim();
    const name = String(claims.name || email.split('@')[0] || 'تاجر').slice(0, 60);
    if (!sub || !email) return res.redirect('/login?err=' + encodeURIComponent('جوجل لم يرسل البريد — حاول مجدداً'));
    // 1) مربوط من قبل؟
    let user = null;
    try { user = db.prepare('SELECT * FROM users WHERE google_sub=?').get(sub); } catch {}
    // 2) نفس الإيميل مسجل؟ اربطه
    if (!user) {
      try { user = db.prepare('SELECT * FROM users WHERE lower(email)=?').get(email); } catch {}
      if (user) { try { db.prepare('UPDATE users SET google_sub=? WHERE id=?').run(sub, user.id); } catch {} }
    }
    // 3) جديد تماماً؟ أنشئ حساب + متجر (نفس امتيازات التسجيل: تجربة احترافية)
    if (!user) {
      const { siteSettings } = require('../db');
      const cfg = siteSettings();
      let uname = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 18) || 'user';
      if (uname.length < 3) uname += '123';
      let n = uname, i = 2;
      while (db.prepare('SELECT id FROM users WHERE username=?').get(n)) { n = uname.slice(0, 14) + i; i++; }
      const trialExp = new Date(Date.now() + Number(cfg.trial_days || 14) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const info = db.prepare('INSERT INTO stores (name, slug, description, owner_name, phone, template, color, plan, plan_expires) VALUES (?,?,?,?,?,?,?,?,?)')
        .run('متجر ' + name, genSlug(name), 'متجري الجديد على ' + (cfg.site_name || 'دُكّان Dukkan'), name, '', 'classic', '#0ea5e9', 'pro', trialExp);
      const fakePass = crypto.randomBytes(24).toString('hex'); // دخوله عبر جوجل فقط
      const uinfo = db.prepare('INSERT INTO users (username, password_hash, role, store_id, email, google_sub) VALUES (?,?,?,?,?,?)')
        .run(n, hashPassword(fakePass), 'owner', info.lastInsertRowid, email, sub);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(uinfo.lastInsertRowid);
      appendLog(`**تسجيل جيميل جديد** — «${email}» — متجر «متجر ${name}» — تجربة احترافية ${cfg.trial_days || 14} أيام`);
    }
    loginOk(clientIp(req));
    finishLogin(req, res, user, 'google', true); // جوجل = تذكرني دائماً (90 يوم)
  } catch (e) {
    res.redirect('/login?err=' + encodeURIComponent('فشل الدخول بجيميل — حاول مجدداً'));
  }
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies && req.cookies.sid);
  res.clearCookie('sid');
  // كوكي الحسابات الأخيرة يبقى عمداً — لعرض الشرائح عند العودة
  res.redirect('/login');
});

module.exports = router;

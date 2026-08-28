const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { db, logActivity, siteSettings } = require('./db');

const LOG_FILE = path.join(__dirname, 'log.md');

function now() {
  const d = new Date();
  return d.toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' });
}

function appendLog(line) {
  try {
    fs.appendFileSync(LOG_FILE, `\n- **[${now()}]** ${line}`);
  } catch (e) { /* لا شيء */ }
}

function hashPassword(plain) {
  const bcrypt = require('bcryptjs');
  return bcrypt.hashSync(plain, 10);
}

function checkPassword(plain, hash) {
  const bcrypt = require('bcryptjs');
  return bcrypt.compareSync(plain, hash);
}

function genPassword(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

function genSlug(base) {
  const safe = String(base || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const base2 = safe || 'store';
  let slug = base2;
  let i = 2;
  while (db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug)) {
    slug = `${base2}-${i}`;
    i++;
  }
  return slug;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)').run(hashed, userId, expires);
  return token;
}

function destroySession(token) {
  if (!token) return;
  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashed);
}

function currentUser(req) {
  const token = req.cookies && req.cookies.sid;
  if (!token) return null;
  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?')
    .get(hashed, new Date().toISOString());
  if (!s) return null;
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.redirect('/login');
  req.user = user;
  next();
}

const ADMIN_ROLES = ['superadmin','admin','billing','support','viewer'];
const ROLE_PERMISSIONS = {
  superadmin: ['*'],
  admin: ['stores.view','stores.edit','stores.delete','products.view','products.edit','orders.view','orders.edit','payments.view','payments.manage','templates.manage','settings.view','settings.manage','users.view','users.manage','activity.view','backup.create','reviews.manage'],
  billing: ['stores.view','orders.view','payments.view','payments.manage','activity.view'],
  support: ['stores.view','stores.edit','products.view','orders.view','orders.edit','reviews.manage','activity.view'],
  viewer: ['stores.view','products.view','orders.view','payments.view','activity.view']
};
function hasPermission(user, perm) {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  // custom permissions JSON overrides role defaults
  let perms = [];
  try { perms = user.permissions ? JSON.parse(user.permissions) : []; } catch {}
  if (perms.length) return perms.includes(perm) || perms.includes('*');
  const rolePerms = ROLE_PERMISSIONS[user.role] || [];
  return rolePerms.includes(perm) || rolePerms.includes('*');
}
function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.redirect('/login');
  if (!ADMIN_ROLES.includes(user.role)) return res.status(403).render('error', { msg: 'هذه الصفحة للإدارة فقط', user });
  if (user.is_active === 0) return res.status(403).render('error', { msg: 'حسابك موقوف — تواصل مع المدير العام', user });
  req.user = user;
  next();
}
function requirePermission(perm) {
  return (req, res, next) => {
    const user = req.user || currentUser(req);
    if (!user) return res.redirect('/login');
    if (!hasPermission(user, perm)) return res.status(403).render('error', { msg: 'ليس لديك صلاحية: ' + perm, user });
    next();
  };
}

function requireOwner(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.redirect('/login');
  if (user.role === 'superadmin') return res.redirect('/admin?err=' + encodeURIComponent('أنت مدير عام — لوحة المتجر للتجار فقط. استخدم لوحة الإدارة.'));
  if (user.role !== 'owner' || !user.store_id) return res.status(403).render('error', { msg: 'ليس لديك متجر مرتبط بحسابك — سجل متجراً جديداً من الصفحة الرئيسية', user });
  req.user = user;
  next();
}

function money(n) {
  return (Number(n) || 0).toLocaleString('en-US') + ' د.ع';
}

/* مصغرة الصورة للبطاقات (تُرجع المسار الأصلي إن لم توجد) */
function thumb(p) {
  if (!p) return p;
  const t = String(p).replace(/(\.[^.]+)$/, '_t$1');
  try { if (fs.existsSync(path.join(__dirname, t))) return t; } catch (e) {}
  return p;
}

/* ====== حماية المعاينة العامة ====== */

const ipLimits = new Map();
function checkLimit(key, max, windowMs) {
  const t = Date.now();
  const rec = ipLimits.get(key);
  if (!rec || rec.resetAt < t) {
    ipLimits.set(key, { count: 1, resetAt: t + windowMs });
    return { ok: true, left: max - 1 };
  }
  rec.count++;
  ipLimits.set(key, rec);
  return { ok: rec.count <= max, left: Math.max(0, max - rec.count) };
}

const loginLocks = new Map();
function loginLocked(ip) {
  const rec = loginLocks.get(ip);
  if (!rec) return false; // لا يوجد سجل

  // إذا كان القفل لا يزال سارياً
  if (rec.lockUntil > Date.now()) return true;

  // إذا انتهى القفل (وتأكد أن lockUntil كان قيماً، أي أكبر من 0) عندها نحذف السجل
  if (rec.lockUntil > 0) {
    loginLocks.delete(ip);
  }
  return false;
}
function loginFail(ip) {
  const nowMs = Date.now();
  const rec = loginLocks.get(ip) || { fails: 0, lockUntil: 0 };
  rec.fails++;
  if (rec.fails >= 5) { rec.fails = 0; rec.lockUntil = nowMs + 15 * 60 * 1000; }
  loginLocks.set(ip, rec);
  return rec.lockUntil > nowMs;
}
function loginOk(ip) { loginLocks.delete(ip); }

/* كابتشا حسابية بسيطة (بدون مكتبات) */
const captchas = new Map();
function captchaNew() {
  const id = crypto.randomBytes(6).toString('hex');
  const a = crypto.randomInt(5, 14), b = crypto.randomInt(2, 9);
  captchas.set(id, { a, b, at: Date.now() });
  if (captchas.size > 500) {
    for (const [k, v] of captchas) if (Date.now() - v.at > 30 * 60 * 1000) captchas.delete(k);
  }
  return { id, a, b };
}
function captchaCheck(id, answer) {
  const c = captchas.get(id || '');
  if (!c) return false;
  captchas.delete(id);
  return Number(answer) === c.a + c.b;
}

/* ====== إشعارات تيليجرام ====== */
function sendTelegram(chatId, text) {
  const s = siteSettings();
  const token = s.telegram_bot_token;
  if (!token || !chatId) return false;
  const data = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const u = new URL(url);
  const req = https.request({
    hostname: u.hostname,
    path: u.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  });
  req.on('error', () => {});
  req.write(data);
  req.end();
  return true;
}

function notifyNewOrder(store, order, items) {
  const s = siteSettings();
  const adminChat = s.telegram_admin_chat_id;
  if (!adminChat) return;
  const itemLines = items.map(i => `• ${i.product_name} × ${i.qty} = ${money(i.product_price * i.qty)}`).join('\n');
  const text = `🛍 <b>طلب جديد!</b>\n` +
    `🏪 المتجر: ${store.name} (<code>${store.slug}</code>)\n` +
    `👤 الزبون: ${order.customer_name}\n` +
    `📞 الهاتف: ${order.customer_phone}\n` +
    `📍 العنوان: ${order.customer_address || '—'}\n` +
    `💬 ملاحظة: ${order.note || '—'}\n` +
    `🧾 العناصر:\n${itemLines}\n` +
    `💰 المجموع: ${money(order.total)}\n` +
    `🆔 الطلب: #${order.id} — ${new Date(order.created_at).toLocaleString('ar-IQ')}`;
  sendTelegram(adminChat, text);
}

/* ====== نقاط الولاء ====== */
function getLoyaltyPoints(storeId, phone) {
  const row = db.prepare('SELECT * FROM loyalty_points WHERE store_id=? AND customer_phone=?').get(storeId, phone);
  return row || { points: 0, total_earned: 0, total_redeemed: 0 };
}

function addLoyaltyPoints(storeId, phone, points, type, referenceId, description) {
  if (points <= 0) return;
  const existing = db.prepare('SELECT * FROM loyalty_points WHERE store_id=? AND customer_phone=?').get(storeId, phone);
  if (existing) {
    db.prepare('UPDATE loyalty_points SET points=points+?, total_earned=total_earned+?, last_activity=datetime(\'now\',\'localtime\') WHERE store_id=? AND customer_phone=?')
      .run(points, points, storeId, phone);
  } else {
    db.prepare('INSERT INTO loyalty_points (store_id, customer_phone, points, total_earned, total_redeemed) VALUES (?,?,?,?,?)')
      .run(storeId, phone, points, points, 0);
  }
  db.prepare('INSERT INTO loyalty_transactions (store_id, customer_phone, type, points, reference_type, reference_id, description) VALUES (?,?,?,?,?,?,?)')
    .run(storeId, phone, 'earned', points, type, referenceId, description);
}

function redeemLoyaltyPoints(storeId, phone, points, referenceId, description) {
  if (points <= 0) return false;
  const existing = db.prepare('SELECT * FROM loyalty_points WHERE store_id=? AND customer_phone=?').get(storeId, phone);
  if (!existing || existing.points < points) return false;
  db.prepare('UPDATE loyalty_points SET points=points-?, total_redeemed=total_redeemed+?, last_activity=datetime(\'now\',\'localtime\') WHERE store_id=? AND customer_phone=?')
    .run(points, points, storeId, phone);
  db.prepare('INSERT INTO loyalty_transactions (store_id, customer_phone, type, points, reference_type, reference_id, description) VALUES (?,?,?,?,?,?,?)')
    .run(storeId, phone, 'redeemed', points, 'order', referenceId, description);
  return true;
}

function getLoyaltyConfig() {
  const s = siteSettings();
  return {
    points_per_1000: Number(s.loyalty_points_per_1000 || 10),
    points_per_review: Number(s.loyalty_points_per_review || 50),
    points_per_referral: Number(s.loyalty_points_per_referral || 500),
    redeem_value: Number(s.loyalty_redeem_value || 100),
    min_redeem: Number(s.loyalty_min_redeem || 100)
  };
}

/* ====== حماية المحتوى — كلمات ممنوعة ====== */
const FORBIDDEN_WORDS = [
  // مخدرات
  'مخدر','مخدرات','حشيش','كبتاجون','ترامادول','كريستال','هيروين','كوكايين','افيون','أفيون','حبوب مخدرة',
  // سلاح
  'سلاح','مسدس','بندقية','كلاشنكوف','رشاش','قنبلة','متفجرات',
  // خمور/قمار
  'خمور','خمر','كحول','ويسكي','فودكا','بيرة','قمار','مراهنات','كازينو',
  // إباحي
  'اباحي','إباحي','جنس','عري','بورنو','اباحية','إباحية',
  // إنجليزي
  'drugs','drug','cannabis','cocaine','heroin','opium','weapon','gun','rifle','porn','xxx','casino','gambling','viagra','tramadol'
];
function containsForbidden(text){
  if(!text) return false;
  const lower = String(text).toLowerCase();
  // إزالة المسافات والشرطات لتجاوز محاولات التمويه
  const compact = lower.replace(/[\s\-_\.،,]+/g,'');
  for(const w of FORBIDDEN_WORDS){
    const lw = w.toLowerCase();
    if(lower.includes(lw) || compact.includes(lw.replace(/[\s\-_\.]+/g,''))) return true;
  }
  return false;
}
function getForbiddenWord(text){
  if(!text) return null;
  const lower = String(text).toLowerCase();
  const compact = lower.replace(/[\s\-_\.،,]+/g,'');
  for(const w of FORBIDDEN_WORDS){
    const lw = w.toLowerCase();
    if(lower.includes(lw) || compact.includes(lw.replace(/[\s\-_\.]+/g,''))) return w;
  }
  return null;
}

/* تسجيل قيد في الكاش فلو */
function addCashFlowEntry(storeId, type, category, amount, referenceType, referenceId, description) {
  db.prepare('INSERT INTO cash_flow_entries (store_id, type, category, amount, reference_type, reference_id, description) VALUES (?,?,?,?,?,?,?)')
    .run(storeId, type, category, Math.round(Number(amount) || 0), referenceType || '', referenceId || '', String(description || '').slice(0, 500));
  return true;
}

module.exports = {
  now, appendLog, hashPassword, checkPassword, genPassword, genSlug,
  createSession, destroySession, currentUser,
  requireAuth, requireAdmin, requirePermission, hasPermission, ADMIN_ROLES, ROLE_PERMISSIONS, requireOwner, money, logActivity, thumb,
  checkLimit, loginLocked, loginFail, loginOk, captchaNew, captchaCheck,
  sendTelegram, notifyNewOrder,
  getLoyaltyPoints, addLoyaltyPoints, redeemLoyaltyPoints, getLoyaltyConfig,
  addCashFlowEntry, containsForbidden, getForbiddenWord,
  asyncHandler
};

/* لفّ async handlers: يمرّر أي رفض (rejection) إلى معالج الأخطاء 500 بدل تعليق الطلب */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
const express = require('express');
const { db } = require('../db');
const { hashPassword, checkPassword, createSession, destroySession, appendLog, loginLocked, loginFail, loginOk, checkLimit } = require('../util');
const router = express.Router();

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'ip';
}

router.get('/login', (req, res) => {
  res.render('login', { error: req.query.err || '' });
});

router.post('/login', (req, res) => {
  const ip = clientIp(req);
  if (loginLocked(ip))
    return res.redirect('/login?err=' + encodeURIComponent('محاولات كثيرة — تم قفل الدخول 15 دقيقة'));
  const lim = checkLimit('login:' + ip, 20, 10 * 60 * 1000);
  if (!lim.ok) return res.redirect('/login?err=' + encodeURIComponent('محاولات كثيرة من جهازك — انتظر 10 دقائق'));
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!user || !checkPassword(String(password || ''), user.password_hash)) {
    const locked = loginFail(ip);
    return res.redirect('/login?err=' + encodeURIComponent(locked ? 'محاولات كثيرة — تم قفل الدخول 15 دقيقة' : 'اسم المستخدم أو كلمة المرور غير صحيحة'));
  }
  loginOk(ip);
  const token = createSession(user.id);
  res.cookie('sid', token, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  appendLog(`دخول ناجح للمستخدم «${user.username}» بتصريح ${user.role === 'superadmin' ? 'مدير عام' : 'صاحب متجر'}`);
  res.redirect(user.role === 'superadmin' ? '/admin' : '/panel');
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies && req.cookies.sid);
  res.clearCookie('sid');
  res.redirect('/login');
});

module.exports = router;
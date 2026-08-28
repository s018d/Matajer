const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, logActivity, UPLOADS_DIR, siteSettings, setSetting, isPro } = require('../db');
const { requireOwner, hashPassword, checkPassword, appendLog, money, thumb, asyncHandler, containsForbidden, getForbiddenWord } = require('../util');
const TPL = require('../templates');
const { tplFor } = require('./store');
const router = express.Router();

function getStore(id) {
  const s = db.prepare('SELECT * FROM stores WHERE id=?').get(id);
  if (s) s.ispro = isPro(s) ? 1 : 0;
  return s;
}

function uploader(folderName) {
  const disk = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_DIR, `store_${req.user.store_id}`, folderName(req));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
    }
  });
  return multer({
    storage: disk,
    limits: { fileSize: 12 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : new Error('Ù†ÙˆØ¹ Ø§Ù„Ù…Ù„Ù ØºÙŠØ± Ù…Ù‚Ø¨ÙˆÙ„'), ok);
    }
  });
}

/* Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† Ø§Ù„Ù‡ÙŠÙƒÙ„ÙŠØ© Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠØ© Ù„Ù„Ù…Ù„Ù Ø¹Ø¨Ø± Magic Bytes Ø¨Ø¯Ù„Ø§Ù‹ Ù…Ù† Ø§Ù„Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¹Ù„Ù‰ Ø§Ù„Ø§Ù…ØªØ¯Ø§Ø¯ ÙÙ‚Ø· */
function isRealImage(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    // JPEG
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
    // GIF
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
    // WEBP
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
    return false;
  } catch (e) {
    return false;
  }
}

/* Ø¶ØºØ· Ø§Ù„ØµÙˆØ± ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹: ØªØµØºÙŠØ± Ù„Ù„Ø¹Ø±Ø¶ Ø§Ù„Ø£Ù‚ØµÙ‰ + Ù…ØµØºØ±Ø© Ù„Ù„Ù…Ø¹Ø§ÙŠÙ†Ø© Ø§Ù„Ø³Ø±ÙŠØ¹Ø© */
async function processImage(filePath) {
  if (!isRealImage(filePath)) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
    throw new Error('Ø§Ù„Ù…Ù„Ù Ø§Ù„Ù…Ø±ÙÙˆØ¹ Ù„ÙŠØ³ ØµÙˆØ±Ø© ØµØ§Ù„Ø­Ø©');
  }
  try {
    const sharp = require('sharp');
    const ext = path.extname(filePath).toLowerCase();
    const thumbPath = filePath.replace(/(\.[^.]+)$/, '_t$1');
    const fmt = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : ext === '.gif' ? 'gif' : 'jpeg';
    const opts = fmt === 'jpeg' ? { quality: 82 } : fmt === 'webp' ? { quality: 82 } : {};
    const img = sharp(filePath, { failOn: 'none', animated: fmt === 'gif' });
    const meta = await img.metadata();
    if (!meta.width) return;
    if (meta.width > 1200) await img.clone().resize({ width: 1200, withoutEnlargement: true }).toFormat(fmt, opts).toFile(filePath);
    await sharp(filePath, { failOn: 'none' }).resize({ width: 400, withoutEnlargement: true }).toFormat(fmt, opts).toFile(thumbPath);
  } catch (e) { /* Ù†ÙØ¨Ù‚ÙŠ Ø§Ù„ØµÙˆØ±Ø© Ø§Ù„Ø£ØµÙ„ÙŠØ© Ø¹Ù†Ø¯ Ø£ÙŠ Ø®Ø·Ø£ */ }
}
// Ù…ÙˆÙ„ØªØ± Ù„Ù„Ù…Ù†ØªØ¬Ø§Øª: Ù…Ø¬Ù„Ø¯ Ù…Ø¤Ù‚Øª Ù„Ù„Ø¥Ù†Ø´Ø§Ø¡ + Ù…Ø¬Ù„Ø¯ Ø§Ù„Ù…Ù†ØªØ¬ Ù„Ù„ØªØ¹Ø¯ÙŠÙ„
const upPics = () => uploader(req => `product_${req.params.id}`);
const upNewPics = () => uploader(() => `tmp_new`);

router.use(requireOwner);

router.get('/', (req, res) => {
  const store = getStore(req.user.store_id);
  const stats = {
    products: db.prepare('SELECT COUNT(*) c FROM products WHERE store_id=?').get(store.id).c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders WHERE store_id=?').get(store.id).c,
    newOrders: db.prepare("SELECT COUNT(*) c FROM orders WHERE store_id=? AND status='new'").get(store.id).c,
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE store_id=? AND status != 'cancelled'").get(store.id).s,
    views: db.prepare('SELECT COALESCE(SUM(views),0) s FROM products WHERE store_id=?').get(store.id).s
  };
  // Smart stats
  const avgOrder = stats.orders > 0 ? Math.round(stats.revenue / stats.orders) : 0;
  const conversionRate = stats.views > 0 ? Math.round((stats.orders / stats.views) * 10000) / 100 : 0;
  
  // Top 5 selling products
  const topProducts = db.prepare(`
    SELECT COALESCE(p.name, oi.product_name) as name, SUM(oi.qty) as total_qty, SUM(oi.qty * oi.product_price) as total_revenue
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id AND p.store_id = ?
    JOIN orders o ON o.id = oi.order_id AND o.store_id = ? AND o.status != 'cancelled'
    GROUP BY COALESCE(p.name, oi.product_name)
    ORDER BY total_qty DESC
    LIMIT 5
  `).all(store.id, store.id);
  
  // Peak hours (last 30 days)
  const peakHours = db.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as cnt
    FROM orders WHERE store_id=? AND status != 'cancelled' AND date(created_at) >= date('now', '-30 days')
    GROUP BY hour ORDER BY cnt DESC LIMIT 6
  `).all(store.id);
  
  // Peak days (last 30 days)
  const peakDays = db.prepare(`
    SELECT strftime('%w', created_at) as dow, COUNT(*) as cnt
    FROM orders WHERE store_id=? AND status != 'cancelled' AND date(created_at) >= date('now', '-30 days')
    GROUP BY dow ORDER BY cnt DESC LIMIT 7
  `).all(store.id);
  
  const dowNames = ['Ø§Ù„Ø£Ø­Ø¯','Ø§Ù„Ø¥Ø«Ù†ÙŠÙ†','Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡','Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡','Ø§Ù„Ø®Ù…ÙŠØ³','Ø§Ù„Ø¬Ù…Ø¹Ø©','Ø§Ù„Ø³Ø¨Øª'];
  
  const recent = db.prepare('SELECT * FROM orders WHERE store_id=? ORDER BY id DESC LIMIT 6').all(store.id);
  const chart = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const d = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const r = db.prepare("SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM orders WHERE store_id=? AND status != 'cancelled' AND date(created_at)=?").get(store.id, d);
    chart.push({ d: d.slice(5), s: Number(r.s), c: Number(r.c) });
  }
  const chartMax = Math.max(1, ...chart.map(x => x.s));
  res.render('panel/dashboard', { store, stats, recent, chart, chartMax, money, user: req.user, 
    avgOrder, conversionRate, topProducts, peakHours, peakDays, dowNames });
});

router.get('/products', (req, res) => {
  const store = getStore(req.user.store_id);
  const q = String(req.query.q || '').trim();
  let where = 'p.store_id=?';
  const params = [store.id];
  if (q) {
    where += ' AND (p.name LIKE ? OR p.description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  const rows = db.prepare(`
    SELECT p.*, c.name cat, (SELECT path FROM product_images i WHERE i.product_id=p.id ORDER BY position, id LIMIT 1) img,
      (SELECT COUNT(*) FROM product_images i WHERE i.product_id=p.id) img_count
    FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${where} ORDER BY p.id DESC`).all(...params);
  rows.forEach(r => { r.img = thumb(r.img); });
  res.render('panel/products', { store, rows, money, ok: req.query.ok || '', err: req.query.err || '', user: req.user, searchQ: q });
});

function productForm(store, pid) {
  const cats = db.prepare('SELECT * FROM categories WHERE store_id=? ORDER BY position, id').all(store.id);
  if (!pid) return { product: null, cats, images: [] };
  const product = db.prepare('SELECT * FROM products WHERE id=? AND store_id=?').get(pid, store.id);
  if (!product) return null;
  const images = db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY position, id').all(pid);
  return { product, cats, images };
}

function sanitizeOptions(options) {
  try {
    const o = JSON.parse(options || '{}');
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      const label = String(k).trim().slice(0, 30);
      const vals = String(v).split(',').map(x => x.trim()).filter(Boolean).slice(0, 20);
      if (label && vals.length) out[label] = vals.join(',');
    }
    return Object.keys(out).length ? JSON.stringify(out) : '';
  } catch (e) { return ''; }
}

function sanitizeAddons(addons) {
  try {
    const a = JSON.parse(addons || '[]');
    if (!Array.isArray(a)) return '';
    const out = [];
    for (const x of a) {
      const nm = String(x.name || '').trim().slice(0, 40);
      const pr = Number(x.price);
      if (nm && !isNaN(pr) && pr >= 0) out.push({ name: nm, price: pr });
    }
    return out.length ? JSON.stringify(out.slice(0, 20)) : '';
  } catch (e) { return ''; }
}

router.get('/products/new', (req, res) => {
  const store = getStore(req.user.store_id);
  const f = productForm(store, null);
  res.render('panel/product-form', { store, ...f, err: req.query.err || '', user: req.user });
});

router.post('/products', upNewPics().array('images', 20), asyncHandler(async (req, res) => {
  const store = getStore(req.user.store_id);
  const { name, category_id, price, old_price, description, active, stock, options, addons } = req.body;
  if (!name || isNaN(Number(price))) return res.redirect('/panel/products/new?err=' + encodeURIComponent('Ø§Ø³Ù… Ø§Ù„Ù…Ù†ØªØ¬ ÙˆØ³Ø¹Ø±Ù‡ Ù…Ø·Ù„ÙˆØ¨Ø§Ù†'));
  if (containsForbidden(name) || containsForbidden(description)) {
    const w = getForbiddenWord(name + ' ' + (description||'')) || 'Ù…Ù…Ù†ÙˆØ¹Ø©';
    return res.redirect('/panel/products/new?err=' + encodeURIComponent(`Ø§Ù„Ù…Ù†ØªØ¬ ÙŠØ­ØªÙˆÙŠ Ø¹Ù„Ù‰ ÙƒÙ„Ù…Ø© ØºÙŠØ± Ù…Ø³Ù…ÙˆØ­Ø©: "${w}" â€” ÙŠØ±Ø¬Ù‰ ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ø§Ø³Ù…/Ø§Ù„ÙˆØµÙ`));
  }
  if (!isPro(store)) {
    const maxP = Number(siteSettings().free_products || 10);
    const cnt = db.prepare('SELECT COUNT(*) c FROM products WHERE store_id=?').get(store.id).c;
    if (cnt >= maxP)
      return res.redirect('/panel/products/new?err=' + encodeURIComponent(`Ø¨Ø§Ù‚ØªÙƒ Ø§Ù„Ù…Ø¬Ø§Ù†ÙŠØ© ØªØ³Ù…Ø­ Ø¨Ù€ ${maxP} Ù…Ù†ØªØ¬ ÙÙ‚Ø· â€” Ø±Ù‚ÙÙ‘ Ø¨Ø§Ù‚ØªÙƒ Ù…Ù† ØµÙØ­Ø© Â«Ø§Ù„Ø¨Ø§Ù‚Ø§ØªÂ» Ù„Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ù…Ø²ÙŠØ¯`));
  }
  const stockVal = stock === '' || stock == null ? null : Math.max(0, Math.floor(Number(stock) || 0));
  const optsJson = sanitizeOptions(options);
  const addonsJson = sanitizeAddons(addons);
  const info = db.prepare('INSERT INTO products (store_id, category_id, name, description, price, old_price, active, stock, options, addons) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(store.id, category_id ? Number(category_id) : null, String(name), String(description || ''), Number(price), old_price && !isNaN(Number(old_price)) ? Number(old_price) : null, active === 'on' ? 1 : 0, stockVal, optsJson, addonsJson);
  // Ø­ÙØ¸ Ø§Ù„ØµÙˆØ± Ù…Ø¨Ø§Ø´Ø±Ø© Ø¥Ù† Ø±ÙÙØ¹Øª Ù…Ø¹ Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ (Ø®Ø·ÙˆØ© ÙˆØ§Ø­Ø¯Ø©) â€” Ù†Ù‚Ù„ Ù…Ù† tmp_new Ø¥Ù„Ù‰ Ù…Ø¬Ù„Ø¯ Ø§Ù„Ù…Ù†ØªØ¬ Ø§Ù„ØµØ­ÙŠØ­
  if (req.files && req.files.length) {
    let pos = 0;
    const destDir = path.join(UPLOADS_DIR, `store_${store.id}`, `product_${info.lastInsertRowid}`);
    fs.mkdirSync(destDir, { recursive: true });
    for (const f of req.files) {
      await processImage(f.path);
      const thumbSrc = f.path.replace(/(\.[^.]+)$/, '_t$1');
      const destPath = path.join(destDir, f.filename);
      const thumbDest = destPath.replace(/(\.[^.]+)$/, '_t$1');
      try { if (fs.existsSync(f.path)) fs.renameSync(f.path, destPath); } catch(e){}
      try { if (fs.existsSync(thumbSrc)) fs.renameSync(thumbSrc, thumbDest); } catch(e){}
      db.prepare('INSERT INTO product_images (product_id, path, position) VALUES (?,?,?)').run(info.lastInsertRowid, '/uploads/store_' + store.id + `/product_${info.lastInsertRowid}/` + f.filename, pos++);
    }
  }
  logActivity(req.user.id, req.user.username, 'Ø¥Ø¶Ø§ÙØ© Ù…Ù†ØªØ¬', `Ø£Ø¶Ø§Ù Ù…Ù†ØªØ¬ Â«${name}Â»`);
  appendLog(`Ù…Ø³ØªØ®Ø¯Ù… Â«${req.user.username}Â» Ø£Ø¶Ø§Ù Ù…Ù†ØªØ¬ Â«${name}Â» ÙÙŠ Ù…ØªØ¬Ø± Â«${store.name}Â»`);
  const msg = req.files && req.files.length ? `ØªÙ… Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ù…Ù†ØªØ¬ Ù…Ø¹ ${req.files.length} ØµÙˆØ±Ø©` : 'ØªÙ… Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ù…Ù†ØªØ¬ â€” ÙŠÙ…ÙƒÙ†Ùƒ Ø¥Ø¶Ø§ÙØ© ØµÙˆØ±Ù‡ Ø§Ù„Ø¢Ù†';
  res.redirect('/panel/products/' + info.lastInsertRowid + '/edit?ok=' + encodeURIComponent(msg));
}));

router.get('/products/:id/edit', (req, res) => {
  const store = getStore(req.user.store_id);
  const f = productForm(store, req.params.id);
  if (!f) return res.redirect('/panel/products');
  res.render('panel/product-form', { store, ...f, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

router.post('/products/:id', (req, res) => {
  const store = getStore(req.user.store_id);
  const { name, category_id, price, old_price, description, active, stock, options, addons } = req.body;
  const p = db.prepare('SELECT * FROM products WHERE id=? AND store_id=?').get(req.params.id, store.id);
  if (!p) return res.redirect('/panel/products');
  if (containsForbidden(name) || containsForbidden(description)) {
    const w = getForbiddenWord(name + ' ' + (description||'')) || 'Ù…Ù…Ù†ÙˆØ¹Ø©';
    return res.redirect('/panel/products/' + p.id + '/edit?err=' + encodeURIComponent(`Ø§Ù„Ù…Ù†ØªØ¬ ÙŠØ­ØªÙˆÙŠ Ø¹Ù„Ù‰ ÙƒÙ„Ù…Ø© ØºÙŠØ± Ù…Ø³Ù…ÙˆØ­Ø©: "${w}"`));
  }
  const stockVal = stock === '' || stock == null ? null : Math.max(0, Math.floor(Number(stock) || 0));
  db.prepare('UPDATE products SET name=?, category_id=?, description=?, price=?, old_price=?, active=?, stock=?, options=?, addons=? WHERE id=?')
    .run(String(name || p.name), category_id ? Number(category_id) : null, String(description ?? ''), Number(price), old_price && !isNaN(Number(old_price)) ? Number(old_price) : null, active === 'on' ? 1 : 0, stockVal, sanitizeOptions(options), sanitizeAddons(addons), p.id);
  logActivity(req.user.id, req.user.username, 'ØªØ¹Ø¯ÙŠÙ„ Ù…Ù†ØªØ¬', `Ø¹Ø¯Ù‘Ù„ Ù…Ù†ØªØ¬ Â«${name}Â»`);
  res.redirect('/panel/products/' + p.id + '/edit?ok=' + encodeURIComponent('ØªÙ… Ø­ÙØ¸ Ø§Ù„ØªØ¹Ø¯ÙŠÙ„Ø§Øª'));
});

router.post('/products/:id/images', upPics().array('images', 20), asyncHandler(async (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=? AND store_id=?').get(req.params.id, req.user.store_id);
  if (!p) return res.redirect('/panel/products');
  if (req.files && req.files.length) {
    const variant = String(req.body.variant || '').trim().slice(0,30);
    const maxPos = db.prepare('SELECT COALESCE(MAX(position),-1) m FROM product_images WHERE product_id=?').get(p.id).m;
    let pos = maxPos + 1;
    for (const f of req.files) {
      await processImage(f.path);
      db.prepare('INSERT INTO product_images (product_id, path, position, variant) VALUES (?,?,?,?)').run(p.id, '/uploads/store_' + req.user.store_id + `/product_${p.id}/` + f.filename, pos++, variant);
    }
    logActivity(req.user.id, req.user.username, 'Ø±ÙØ¹ ØµÙˆØ±', `Ø±ÙØ¹ ${req.files.length} ØµÙˆØ±Ø© Ù„Ù…Ù†ØªØ¬ Â«${p.name}Â»`);
    appendLog(`Ù…Ø³ØªØ®Ø¯Ù… Â«${req.user.username}Â» Ø±ÙØ¹ ${req.files.length} ØµÙˆØ±Ø© Ù„Ù…Ù†ØªØ¬ Â«${p.name}Â»`);
    return res.redirect('/panel/products/' + p.id + '/edit?ok=' + encodeURIComponent(`ØªÙ… Ø±ÙØ¹ ${req.files.length} ØµÙˆØ±Ø©`));
  }
  res.redirect('/panel/products/' + p.id + '/edit?err=' + encodeURIComponent('Ù„Ù… ÙŠØªÙ… Ø§Ø®ØªÙŠØ§Ø± Ø£ÙŠ ØµÙˆØ±Ø©'));
}), (err, req, res, next) => {
  res.redirect('/panel/products/' + req.params.id + '/edit?err=' + encodeURIComponent(err.message || 'ÙØ´Ù„ Ø±ÙØ¹ Ø§Ù„ØµÙˆØ±'));
});

router.post('/products/:id/images/:imgid/setmain', (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id=?').get(req.params.imgid);
  const p = img && db.prepare('SELECT * FROM products WHERE id=? AND store_id=?').get(img.product_id, req.user.store_id);
  if (!img || !p) return res.redirect('/panel/products');
  db.prepare('UPDATE product_images SET position = 999999 WHERE product_id=?').run(p.id);
  db.prepare('UPDATE product_images SET position = 0 WHERE id=?').run(img.id);
  res.redirect('/panel/products/' + p.id + '/edit?ok=ØªÙ… ØªØ¹ÙŠÙŠÙ† Ø§Ù„ØµÙˆØ±Ø© Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ©');
});

router.post('/products/:id/images/:imgid/delete', (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id=?').get(req.params.imgid);
  const p = img && db.prepare('SELECT * FROM products WHERE id=? AND store_id=?').get(img.product_id, req.user.store_id);
  if (!img || !p) return res.redirect('/panel/products');
  const abs = path.join(__dirname, '..', img.path);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  const thumbAbs = abs.replace(/(\.[^.]+)$/, '_t$1');
  if (fs.existsSync(thumbAbs)) fs.unlinkSync(thumbAbs);
  db.prepare('DELETE FROM product_images WHERE id=?').run(img.id);
  res.redirect('/panel/products/' + p.id + '/edit?ok=ØªÙ… Ø­Ø°Ù Ø§Ù„ØµÙˆØ±Ø©');
});

router.post('/products/:id/images/:imgid/variant', (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id=?').get(req.params.imgid);
  const p = img && db.prepare('SELECT * FROM products WHERE id=? AND store_id=?').get(img.product_id, req.user.store_id);
  if (!img || !p) return res.redirect('/panel/products');
  const variant = String(req.body.variant || '').trim().slice(0,30);
  db.prepare('UPDATE product_images SET variant=? WHERE id=?').run(variant, img.id);
  res.redirect('/panel/products/' + p.id + '/edit?ok=' + encodeURIComponent(variant ? `ØªÙ… Ø±Ø¨Ø· Ø§Ù„ØµÙˆØ±Ø© Ø¨Ø§Ù„Ù„ÙˆÙ† Â«${variant}Â»` : 'ØªÙ… Ø¥Ø²Ø§Ù„Ø© Ø±Ø¨Ø· Ø§Ù„Ù„ÙˆÙ†'));
});

router.post('/products/:id/toggle', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=? AND store_id=?').get(req.params.id, req.user.store_id);
  if (!p) return res.redirect('/panel/products');
  db.prepare('UPDATE products SET active = ? WHERE id=?').run(p.active ? 0 : 1, p.id);
  res.redirect('/panel/products?ok=' + encodeURIComponent(p.active ? 'ØªÙ… Ø¥Ø®ÙØ§Ø¡ Ø§Ù„Ù…Ù†ØªØ¬' : 'ØªÙ… Ø¥Ø¸Ù‡Ø§Ø± Ø§Ù„Ù…Ù†ØªØ¬'));
});

router.post('/products/:id/delete', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=? AND store_id=?').get(req.params.id, req.user.store_id);
  if (!p) return res.redirect('/panel/products');
  const imgs = db.prepare('SELECT * FROM product_images WHERE product_id=?').all(p.id);
  for (const im of imgs) {
    const abs = path.join(__dirname, '..', im.path);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    const thumbAbs = abs.replace(/(\.[^.]+)$/, '_t$1');
    if (fs.existsSync(thumbAbs)) fs.unlinkSync(thumbAbs);
  }
  db.prepare('DELETE FROM product_images WHERE product_id=?').run(p.id);
  db.prepare('DELETE FROM products WHERE id=?').run(p.id);
  const dir = path.join(UPLOADS_DIR, `store_${req.user.store_id}`, `product_${p.id}`);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  logActivity(req.user.id, req.user.username, 'Ø­Ø°Ù Ù…Ù†ØªØ¬', `Ø­Ø°Ù Ù…Ù†ØªØ¬ Â«${p.name}Â»`);
  res.redirect('/panel/products?ok=' + encodeURIComponent('ØªÙ… Ø­Ø°Ù Ø§Ù„Ù…Ù†ØªØ¬'));
});

router.get('/categories', (req, res) => {
  const store = getStore(req.user.store_id);
  const cats = db.prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id) cnt FROM categories c WHERE c.store_id=? ORDER BY c.position, c.id').all(store.id);
  res.render('panel/categories', { store, cats, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

router.post('/categories', (req, res) => {
  const store = getStore(req.user.store_id);
  const { name } = req.body;
  if (!String(name || '').trim()) return res.redirect('/panel/categories?err=' + encodeURIComponent('Ø§ÙƒØªØ¨ Ø§Ø³Ù… Ø§Ù„Ù‚Ø³Ù…'));
  if (containsForbidden(name)) {
    const w = getForbiddenWord(name) || 'Ù…Ù…Ù†ÙˆØ¹Ø©';
    return res.redirect('/panel/categories?err=' + encodeURIComponent(`Ø§Ù„Ù‚Ø³Ù… ÙŠØ­ØªÙˆÙŠ Ø¹Ù„Ù‰ ÙƒÙ„Ù…Ø© ØºÙŠØ± Ù…Ø³Ù…ÙˆØ­Ø©: "${w}"`));
  }
  const maxPos = db.prepare('SELECT COALESCE(MAX(position),0) m FROM categories WHERE store_id=?').get(store.id).m;
  db.prepare('INSERT INTO categories (store_id, name, position) VALUES (?,?,?)').run(store.id, String(name).trim(), maxPos + 1);
  res.redirect('/panel/categories?ok=' + encodeURIComponent('ØªÙ…Øª Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ù‚Ø³Ù…'));
});

router.post('/categories/:id/delete', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id=? AND store_id=?').run(req.params.id, req.user.store_id);
  res.redirect('/panel/categories?ok=' + encodeURIComponent('ØªÙ… Ø­Ø°Ù Ø§Ù„Ù‚Ø³Ù…'));
});

router.get('/orders', (req, res) => {
  const store = getStore(req.user.store_id);
  const filter = req.query.status || 'all';
  const q = String(req.query.q || '').trim();
  const perPage = 50;
  const page = Math.max(1, Number(req.query.page) || 1);
  let where = filter === 'all' ? 'store_id=?' : 'store_id=? AND status=?';
  const params = filter === 'all' ? [store.id] : [store.id, filter];
  if (q) {
    where += ' AND (customer_name LIKE ? OR customer_phone LIKE ? OR id LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) c FROM orders WHERE ${where}`).get(...params).c;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const rows = db.prepare(`
    SELECT o.*, (SELECT GROUP_CONCAT(oi.product_name || ' Ã—' || oi.qty || ' â€” ' || oi.product_price || ' Ø¯.Ø¹', ' âº ') FROM order_items oi WHERE oi.order_id=o.id) items_txt
    FROM orders o WHERE ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...params, perPage, (page - 1) * perPage);
  const withItems = rows.map(o => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
    return Object.assign({}, o, { items });
  });
  res.render('panel/orders', { store, rows: withItems, filter, page, totalPages, total, money, user: req.user, searchQ: q });
});

router.post('/orders/:id/status', (req, res) => {
  const statuses = ['new', 'confirmed', 'completed', 'cancelled'];
  const status = statuses.includes(req.body.status) ? req.body.status : 'new';
  db.prepare('UPDATE orders SET status=? WHERE id=? AND store_id=?').run(status, req.params.id, req.user.store_id);
  res.redirect('/panel/orders?status=' + (req.query.back || 'all'));
});

router.get('/orders/export', (req, res) => {
  const store = getStore(req.user.store_id);
  const filter = req.query.status || 'all';
  const q = String(req.query.q || '').trim();
  let where = filter === 'all' ? 'store_id=?' : 'store_id=? AND status=?';
  const params = filter === 'all' ? [store.id] : [store.id, filter];
  if (q) {
    where += ' AND (customer_name LIKE ? OR customer_phone LIKE ? OR id LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const orders = db.prepare(`
    SELECT o.*, (SELECT GROUP_CONCAT(oi.product_name || ' x' || oi.qty || ' - ' || oi.product_price || ' IQD', ' | ') FROM order_items oi WHERE oi.order_id=o.id) items_txt
    FROM orders o WHERE ${where} ORDER BY o.id DESC`).all(...params);

  const csvHeader = 'Ø±Ù‚Ù… Ø§Ù„Ø·Ù„Ø¨,Ø§Ù„Ø­Ø§Ù„Ø©,Ø§Ù„Ø¹Ù…ÙŠÙ„,Ø§Ù„Ù‡Ø§ØªÙ,Ø§Ù„Ø¹Ù†ÙˆØ§Ù†,Ù…Ù„Ø§Ø­Ø¸Ø©,Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª,Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„ÙØ±Ø¹ÙŠ,Ø§Ù„Ø®ØµÙ…,ÙƒÙˆØ¯ Ø§Ù„ÙƒÙˆØ¨ÙˆÙ†,Ø§Ù„ØªÙˆØµÙŠÙ„,Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ,Ø§Ù„ØªØ§Ø±ÙŠØ®\n';
  const csvRows = orders.map(o => {
    const escape = (val) => '"' + String(val || '').replace(/"/g, '""') + '"';
    const items = escape(o.items_txt || '');
    const statusMap = { new: 'Ø¬Ø¯ÙŠØ¯', confirmed: 'Ù…Ø¤ÙƒØ¯', completed: 'Ù…ÙƒØªÙ…Ù„', cancelled: 'Ù…Ù„ØºÙŠ' };
    return [
      escape(o.id),
      escape(statusMap[o.status] || o.status),
      escape(o.customer_name),
      escape(o.customer_phone),
      escape(o.customer_address),
      escape(o.note),
      items,
      escape(o.subtotal),
      escape(o.discount),
      escape(o.coupon_code),
      escape(o.delivery_fee),
      escape(o.total),
      escape(o.created_at)
    ].join(',');
  }).join('\n');

  const csv = csvHeader + csvRows;
  const filename = `orders_${store.slug}_${new Date().toISOString().slice(0,10)}.csv`;
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
});

router.get('/abandoned-carts', (req, res) => {
  const store = getStore(req.user.store_id);
  const carts = db.prepare('SELECT * FROM abandoned_carts WHERE store_id=? ORDER BY created_at DESC').all(store.id);
  res.render('panel/abandoned-carts', { store, carts, money, user: req.user });
});

router.post('/abandoned-carts/:id/remind', (req, res) => {
  const store = getStore(req.user.store_id);
  const cart = db.prepare('SELECT * FROM abandoned_carts WHERE id=? AND store_id=?').get(req.params.id, store.id);
  if (!cart) return res.redirect('/panel/abandoned-carts?err=' + encodeURIComponent('Ø§Ù„Ø³Ù„Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©'));
  if (!cart.customer_phone) return res.redirect('/panel/abandoned-carts?err=' + encodeURIComponent('Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ø±Ù‚Ù… Ù‡Ø§ØªÙ Ù„Ù„Ø²Ø¨ÙˆÙ†'));
  
  const cartData = JSON.parse(cart.cart_data);
  const items = cartData.map(item => `${item.name} x${item.qty}`).join('ØŒ ');
  const waPhone = cart.customer_phone.replace(/^0/, '964');
  const msg = `Ù…Ø±Ø­Ø¨Ø§Ù‹ ${cart.customer_name || 'Ø²Ø¨ÙˆÙ†Ù†Ø§ Ø§Ù„ÙƒØ±ÙŠÙ…'}ØŒ Ù„Ø§Ø­Ø¸Ù†Ø§ Ø£Ù† Ù„Ø¯ÙŠÙƒ Ø³Ù„Ø© Ù…Ø¹Ù„Ù‚Ù‡ ÙÙŠ ${store.name}:\n${items}\nØ§Ù„Ù…Ø¬Ù…ÙˆØ¹: ${money(cart.subtotal)}\n\nØ£ÙƒÙ…Ù„ Ø·Ù„Ø¨Ùƒ Ø§Ù„Ø¢Ù†: ${cart.store_base || '/s/' + store.slug}/checkout`;
  const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
  
  db.prepare("UPDATE abandoned_carts SET reminded_at=datetime(\'now\',\'localtime\') WHERE id=?").run(cart.id);
  res.redirect(`/panel/abandoned-carts?ok=` + encodeURIComponent('ØªÙ… Ø¥Ø±Ø³Ø§Ù„ ØªØ°ÙƒÙŠØ± ÙˆØ§ØªØ³Ø§Ø¨'));
});

router.get('/domain/buy', (req, res) => {
  const store = getStore(req.user.store_id);
  const requests = db.prepare(`SELECT * FROM domain_requests WHERE store_id=? ORDER BY id DESC`).all(store.id);
  const domainPrice = Number(siteSettings().domain_price || 20000);
  res.render('panel/domain-buy', { store, requests, cfg: siteSettings(), domainPrice, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

router.post('/domain/buy', (req, res) => {
  const store = getStore(req.user.store_id);
  const domain = String(req.body.domain || '').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'');
  const type = req.body.type === 'premium' ? 'premium' : 'normal';
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain))
    return res.redirect('/panel/domain/buy?err=' + encodeURIComponent('ØµÙŠØºØ© Ø§Ù„Ø¯ÙˆÙ…ÙŠÙ† ØºÙŠØ± ØµØ­ÙŠØ­Ø© â€” Ù…Ø«Ø§Ù„: my-shop.com'));
  const price = type === 'normal' ? Number(siteSettings().domain_price || 20000) : null;
  db.prepare(`INSERT INTO domain_requests (store_id, domain, type, price, note) VALUES (?,?,?,?,?)`)
    .run(store.id, domain, type, price, String(req.body.note || '').slice(0,200));
  appendLog(`Ù…ØªØ¬Ø± Â«${store.name}Â» Ø·Ù„Ø¨ Ø´Ø±Ø§Ø¡ Ø¯ÙˆÙ…ÙŠÙ† ${domain} (${type === 'normal' ? 'Ø¹Ø§Ø¯ÙŠ ' + price + ' Ø¯.Ø¹' : 'Ù…Ù…ÙŠØ² â€” Ø³Ø¹Ø± Ø®Ø§Øµ'})`);
  logActivity(req.user.id, req.user.username, 'Ø·Ù„Ø¨ Ø¯ÙˆÙ…ÙŠÙ†', `${domain} (${type})`);
  res.redirect('/panel/domain/buy?ok=' + encodeURIComponent('ÙˆØµÙ„ Ø·Ù„Ø¨Ùƒ! Ø±Ø§Ø­ Ù†ØªÙˆØ§ØµÙ„ ÙˆÙŠØ§Ùƒ Ù„ØªØ£ÙƒÙŠØ¯ Ø§Ù„Ø¯ÙØ¹ ÙˆØ§Ù„Ø±Ø¨Ø· Ø®Ù„Ø§Ù„ 24 Ø³Ø§Ø¹Ø©'));
});

router.get('/domain', (req, res) => {
  const store = getStore(req.user.store_id);
  if (!isPro(store)) return res.redirect('/panel/settings?err=' + encodeURIComponent('Ø§Ù„Ø¯ÙˆÙ…ÙŠÙ† Ø§Ù„Ù…Ø®ØµØµ Ù…ØªØ§Ø­ Ù„Ù„Ø¨Ø§Ù‚Ø© Ø§Ù„Ø§Ø­ØªØ±Ø§ÙÙŠØ© ÙÙ‚Ø·'));
  res.render('panel/domain', { store, host: req.headers.host, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

router.post('/domain', (req, res) => {
  // Ø§Ù„ØªØ§Ø¬Ø± Ù„Ø§ ÙŠØ¹Ø¯Ù„ Ø§Ù„Ø¯ÙˆÙ…ÙŠÙ† ÙŠØ¯ÙˆÙŠØ§Ù‹ â€” Ø§Ù„Ø·Ù„Ø¨ Ø¹Ø¨Ø± /panel/domain/buy ÙˆØ§Ù„Ø±Ø¨Ø· Ù…Ù† Ù„ÙˆØ­Ø© Ø§Ù„Ø£Ø¯Ù…Ù†
  return res.redirect('/panel/domain');
});

router.get('/settings', (req, res) => {
  const store = getStore(req.user.store_id);
  res.render('panel/settings', { store, premiumTpls: TPL.PREMIUM, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

router.get('/billing', (req, res) => {
  const store = getStore(req.user.store_id);
  const cfg = siteSettings();
  const payments = db.prepare('SELECT * FROM payments WHERE store_id=? ORDER BY id DESC').all(store.id);
  const referrals = db.prepare('SELECT COUNT(*) c FROM referrals WHERE referrer_store_id=?').get(store.id).c;
  const rewarded = db.prepare("SELECT COUNT(*) c FROM referrals WHERE referrer_store_id=? AND status='done'").get(store.id).c;
  res.render('panel/billing', { store, cfg, payments, referrals, rewarded, pro: isPro(store), money, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

router.get('/api/neworders', (req, res) => {
  const store = getStore(req.user.store_id);
  const since = req.query.since ? String(req.query.since) : '';
  let count = 0;
  if (since && /^\d{4}-\d{2}-\d{2}/.test(since)) {
    count = db.prepare('SELECT COUNT(*) c FROM orders WHERE store_id=? AND status=? AND created_at>?' ).get(store.id, 'new', since).c;
  } else {
    count = db.prepare("SELECT COUNT(*) c FROM orders WHERE store_id=? AND status='new'").get(store.id).c;
  }
  res.json({ count });
});

/* Ø¥Ø«Ø¨Ø§ØªØ§Øª Ø§Ù„Ø¯ÙØ¹ ØªÙØ­ÙØ¸ Ø®Ø§Ø±Ø¬ uploads Ø§Ù„Ø¹Ø§Ù… ÙÙŠ Ù…Ø¬Ù„Ø¯ Ø®Ø§Øµ â€” Ù„Ø§ ØªÙØ®Ø¯ÙŽÙ‘Ù… Ø¥Ù„Ø§ Ø¹Ø¨Ø± route Ù…Ø­Ù…ÙŠ */
const upReceipt = () => {
  const disk = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'private-receipts', 'store_' + req.user.store_id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
    }
  });
  return multer({
    storage: disk,
    limits: { fileSize: 12 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : new Error('Ù†ÙˆØ¹ Ø§Ù„Ù…Ù„Ù ØºÙŠØ± Ù…Ù‚Ø¨ÙˆÙ„'), ok);
    }
  });
};
 
// ===== Ø±ÙØ¹ Ø®Ù„ÙÙŠØ© Ø§Ù„Ù…ØªØ¬Ø± =====
const upStoreBg = () => {
  const disk = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'uploads', 'store_' + req.user.store_id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `bg_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
    }
  });
  return multer({
    storage: disk,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB Ù„Ù„ÙÙŠØ¯ÙŠÙˆ
    fileFilter: (req, file, cb) => {
      const ok = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm'].includes(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : new Error('Ù†ÙˆØ¹ Ø§Ù„Ù…Ù„Ù ØºÙŠØ± Ù…Ù‚Ø¨ÙˆÙ„ - ØµÙˆØ±/ÙÙŠØ¯ÙŠÙˆ ÙÙ‚Ø·'), ok);
    }
  });
};
 
router.post('/templates/store-bg', upStoreBg().fields([{name:'store_bg_image', maxCount:1}, {name:'store_bg_video', maxCount:1}]), (req, res) => {
  const store = getStore(req.user.store_id);
  const files = req.files || {};
  const updates = [];
  const params = [];
  if (req.files.store_bg_image) {
    updates.push('store_bg_image = ?');
    params.push('/uploads/store_' + store.id + '/' + req.files.store_bg_image[0].filename);
  }
  if (req.files.store_bg_video) {
    updates.push('store_bg_video = ?');
    params.push('/uploads/store_' + store.id + '/' + req.files.store_bg_video[0].filename);
  }
  if (req.body.bg_overlay) {
    updates.push('bg_overlay = ?');
    params.push(Number(req.body.bg_overlay) || 0);
  }
  if (updates.length) {
    params.push(store.id);
    db.prepare(`UPDATE stores SET ${updates.join(', ')} WHERE id=?`).run(...params);
  }
  res.redirect('/panel/templates/customize?ok=' + encodeURIComponent('ØªÙ… Ø­ÙØ¸ Ø®Ù„ÙÙŠØ© Ø§Ù„Ù…ØªØ¬Ø±'));
});
 
router.post('/billing/request', upReceipt().single('receipt'), (req, res) => {
  const store = getStore(req.user.store_id);
  const cfg = siteSettings();
  if (isPro(store)) return res.redirect('/panel/billing?err=' + encodeURIComponent('Ù…ØªØ¬Ø±Ùƒ Ø§Ø­ØªØ±Ø§ÙÙŠ Ø¨Ø§Ù„ÙØ¹Ù„'));
  const months = [1, 3, 12].includes(Number(req.body.months)) ? Number(req.body.months) : 1;
  const priceMap = { 1: Number(cfg.pro_price || 12000), 3: Number(cfg.pro_price_3 || 30000), 12: Number(cfg.pro_price_12 || 72000) };
  const amount = priceMap[months];
  const ref = 'DKR-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const receiptPath = req.file ? '/private-receipts/store_' + store.id + '/' + req.file.filename : '';
  const transferRef = String(req.body.transfer_ref || '').trim().slice(0, 80);
  db.prepare('INSERT INTO payments (store_id, plan, amount, status, months, ref, receipt_path, note) VALUES (?,?,?,?,?,?,?,?)')
    .run(store.id, 'pro', amount, receiptPath ? 'reported' : 'pending', months, ref, receiptPath, transferRef);
  logActivity(req.user.id, req.user.username, 'Ø·Ù„Ø¨ ØªØ±Ù‚ÙŠØ©', `Ø·Ù„Ø¨ Ø¨Ø§Ù‚Ø© Ø§Ø­ØªØ±Ø§ÙÙŠØ© (${months} Ø´Ù‡Ø±Ø§Ù‹) â€” Ù…Ø±Ø¬Ø¹ ${ref}`);
  appendLog(`**Ø·Ù„Ø¨ ØªØ±Ù‚ÙŠØ© Ø¬Ø¯ÙŠØ¯** â€” Ù…Ø³ØªØ®Ø¯Ù… Â«${req.user.username}Â» Ø·Ù„Ø¨ Ø§Ù„Ø¨Ø§Ù‚Ø© Ø§Ù„Ø§Ø­ØªØ±Ø§ÙÙŠØ© Ù„Ù…ØªØ¬Ø± Â«${store.name}Â» (${months} Ø´Ù‡Ø±Ø§Ù‹ â€” Ø§Ù„Ù…Ø¨Ù„Øº ${money(amount)})${receiptPath ? ' â€” Ù…Ø±ÙÙ‚ Ø¥Ø«Ø¨Ø§Øª Ø§Ù„Ø¯ÙØ¹' : ''} â€” Ø§Ù„Ù…Ø±Ø¬Ø¹ ${ref}`);
  res.redirect('/panel/billing?ok=' + encodeURIComponent('ØªÙ… Ø¥Ø±Ø³Ø§Ù„ Ø·Ù„Ø¨ Ø§Ù„ØªØ±Ù‚ÙŠØ©' + (receiptPath ? ' Ù…Ø¹ Ø¥Ø«Ø¨Ø§Øª Ø§Ù„Ø¯ÙØ¹' : '') + ' â€” Ù…Ø±Ø¬Ø¹Ùƒ: ' + ref + ' â€” Ø³Ù†ÙØ¹Ù‘Ù„ Ø¨Ø§Ù‚ØªÙƒ ÙÙˆØ± ØªØ£ÙƒÙŠØ¯Ù†Ø§'));
}, (err, req, res, next) => {
  res.redirect('/panel/billing?err=' + encodeURIComponent(err.message || 'ÙØ´Ù„ Ø±ÙØ¹ Ø§Ù„Ø¥Ø«Ø¨Ø§Øª'));
});

/* Ø¹Ø±Ø¶ Ø¥Ø«Ø¨Ø§Øª Ø§Ù„Ø¯ÙØ¹ â€” Ù„ØµØ§Ø­Ø¨ Ø§Ù„Ù…ØªØ¬Ø± ÙÙ‚Ø·ØŒ ÙˆÙ…Ù† Ù…ØªØ¬Ø±Ù‡ ÙÙ‚Ø· */
router.get('/billing/receipt/:paymentId', (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=? AND store_id=?').get(req.params.paymentId, req.user.store_id);
  if (!p || !p.receipt_path) return res.redirect('/panel/billing?err=' + encodeURIComponent('Ø§Ù„Ø¥Ø«Ø¨Ø§Øª ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯'));
  const abs = path.join(__dirname, '..', p.receipt_path);
  if (!fs.existsSync(abs)) return res.redirect('/panel/billing?err=' + encodeURIComponent('Ù…Ù„Ù Ø§Ù„Ø¥Ø«Ø¨Ø§Øª ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯'));
  res.sendFile(abs);
});

router.get('/templates', (req, res) => {
  const store = getStore(req.user.store_id);
  const list = [
    ...TPL.LIST.map(t => ({ id: t.id, name: t.name, desc: TPL.describe(t), classes: t.classes, palette: t.palette })),
    ...TPL.PREMIUM.map(t => ({ id: t.id, name: t.name, desc: t.desc, classes: t.id, palette: t.palette, premium: true })),
    ...TPL.LEGACY.map(id => ({ id, name: 'Ø§Ù„Ù…Ø§Ø±ÙƒØª', desc: 'Ù†Ù…Ø· Ø§Ù„Ù…ØªØ§Ø¬Ø± Ø§Ù„Ø³ÙˆÙ‚ÙŠØ©: Ø´Ø±ÙŠØ· Ø¹Ø±ÙˆØ¶ Ù…ØªØ­Ø±Ùƒ ÙˆÙ‡ÙŠØ±Ùˆ Ø¶Ø®Ù… ÙˆØ¨Ø·Ø§Ù‚Ø§Øª Ø¹Ø±Ø¶ ÙƒØ¨ÙŠØ±Ø© â€” Ù…Ø«Ø§Ù„ÙŠ Ù„Ù„Ù…Ù†ØªØ¬Ø§Øª ÙƒØ«ÙŠØ±Ø© Ø§Ù„Ø¹Ø±Ø¶', classes: 'tpl-c', palette: { primary: '#e11d48', accent: '#f59e0b', bg: '#fff7ed', ink: '#3f2d16', soft: '#ffe4e6' }, legacy: true }))
  ];
  res.render('panel/templates', { store, list, count: list.length, current: store.template, pro: isPro(store), ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

router.get('/preview/:id', (req, res) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const t = TPL.get(req.params.id);
  if (!t) return res.status(404).render('store/notfound', {});
  const store = {
    id: 0, name: 'Ù…ØªØ¬Ø± ØªØ¬Ø±ÙŠØ¨ÙŠ', slug: 'preview', base: '/s/preview', description: 'Ù‡ÙƒØ°Ø§ Ø³ÙŠØ¸Ù‡Ø± Ù…ØªØ¬Ø±Ùƒ Ø¹Ù†Ø¯ Ø§Ù„Ø²Ø§Ø¦Ø± â€” Ù…Ø¹Ø§ÙŠÙ†Ø© Ø­ÙŠØ© Ù„Ù„Ù‚Ø§Ù„Ø¨',
    logo_path: '', template: t.id, color: '#0ea5e9', whatsapp: '', plan: 'pro', plan_expires: '2099-12-31'
  };
  const cats = [];
  const sample = [
    { id: 101, name: 'Ø³Ø§Ø¹Ø© Ø°ÙƒÙŠØ© Ø¨Ø±Ùˆ', description: 'Ø´Ø§Ø´Ø© Ø£Ù…ÙˆÙ„ÙŠØ¯ â€” Ø¬ÙˆØ¯Ø© Ø¹Ø§Ù„ÙŠØ©', price: 55000, old_price: 75000, img: '/img/placeholder.svg' },
    { id: 102, name: 'Ø³Ù…Ø§Ø¹Ø© Ù„Ø§Ø³Ù„ÙƒÙŠØ©', description: 'ØµÙˆØª Ù†Ù‚ÙŠ Ù…Ø¹ Ø¹Ù„Ø¨Ø© Ø´Ø­Ù†', price: 28000, old_price: 35000, img: '/img/placeholder.svg' },
    { id: 103, name: 'Ø­Ù‚ÙŠØ¨Ø© Ø¬Ù„Ø¯ÙŠØ© ÙØ§Ø®Ø±Ø©', description: 'Ø®Ø§Ù…Ø© Ø·Ø¨ÙŠØ¹ÙŠØ© Ù…ØªÙŠÙ†Ø©', price: 42000, old_price: 0, img: '/img/placeholder.svg' },
    { id: 104, name: 'Ù†Ø¸Ø§Ø±Ø© Ø´Ù…Ø³ÙŠØ© Ø±ÙŠØ§Ø¶ÙŠØ©', description: 'Ø­Ù…Ø§ÙŠØ© UV400 ÙƒØ§Ù…Ù„Ø©', price: 15000, old_price: 0, img: '/img/placeholder.svg' },
    { id: 105, name: 'Ø´Ø§Ø­Ù† Ø³Ø±ÙŠØ¹ 65 ÙˆØ§Ø·', description: 'Ø´Ø­Ù† Ø³Ø±ÙŠØ¹ Ù„Ø£Ø¬Ù‡Ø²ØªÙƒ ÙƒÙ„Ù‡Ø§', price: 19000, old_price: 24000, img: '/img/placeholder.svg' },
    { id: 106, name: 'Ù…ØµØ¨Ø§Ø­ Ù…ÙƒØªØ¨ÙŠ LED', description: 'Ø¥Ø¶Ø§Ø¡Ø© Ù…Ø±ÙŠØ­Ø© Ù„Ù„Ø¹ÙŠÙ†', price: 12500, old_price: 0, img: '/img/placeholder.svg' }
  ];
  res.render('store/home', { store, cats, cat: 0, q: '', rows: sample, tpl: tplFor(store) });
});

router.post('/templates/apply', (req, res) => {
  const store = getStore(req.user.store_id);
  const tpl = TPL.valid(req.body.template) ? req.body.template : store.template;
  if (TPL.isPremium(tpl) && !isPro(store)) {
    return res.redirect('/panel/templates?err=' + encodeURIComponent('Ù‡Ø°Ø§ Ø§Ù„ØªØµÙ…ÙŠÙ… Ø§Ø­ØªØ±Ø§ÙÙŠ â€” ÙØ¹Ù‘Ù„ Ø¨Ø§Ù‚ØªÙƒ Ø£ÙˆÙ„Ø§Ù‹ Ù…Ù† ØµÙØ­Ø© Ø§Ù„Ø¨Ø§Ù‚Ø§Øª'));
  }
  db.prepare('UPDATE stores SET template=? WHERE id=?').run(tpl, store.id);
  logActivity(req.user.id, req.user.username, 'ØªØºÙŠÙŠØ± Ø§Ù„Ù‚Ø§Ù„Ø¨', `Ø§Ø¹ØªÙ…Ø¯ Ø§Ù„Ù‚Ø§Ù„Ø¨ Â«${tpl}Â»`);
  appendLog(`Ù…Ø³ØªØ®Ø¯Ù… Â«${req.user.username}Â» Ø§Ø¹ØªÙ…Ø¯ Ù‚Ø§Ù„Ø¨ Ø§Ù„Ù…ØªØ¬Ø± Â«${tpl}Â» Ù„Ù…ØªØ¬Ø± Â«${store.name}Â»`);
  res.redirect('/panel/templates?ok=' + encodeURIComponent('ØªÙ… Ø§Ø¹ØªÙ…Ø§Ø¯ Ø§Ù„Ù‚Ø§Ù„Ø¨ â€” Ø§Ø³Ù…Ù‡: ' + tpl));
});

router.get('/templates/customize', (req, res) => {
  const store = getStore(req.user.store_id);
  let cfg = {};
  try { cfg = JSON.parse(store.template_config || '{}'); } catch {}
  let layout = {};
  try { layout = JSON.parse(store.layout_json || '{}'); } catch {}
  
  // Ø§Ù„Ø£Ù‚Ø³Ø§Ù… Ø­Ø³Ø¨ ØªØ±ØªÙŠØ¨ Ø§Ù„ØªØ®Ø²ÙŠÙ† Ø£Ùˆ Ø§Ù„Ø§ÙØªØ±Ø§Ø¶ÙŠ
  const defs = [
    { key:'hero',    icon:'ðŸ–¼ï¸', name:'Ø§Ù„Ù‡ÙŠØ±Ùˆ (Ø§Ù„ÙˆØ§Ø¬Ù‡Ø©)', desc:'Ø§Ù„Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠ + ØµÙˆØ±Ø©/ÙÙŠØ¯ÙŠÙˆ Ø®Ù„ÙÙŠØ©' },
    { key:'search',  icon:'ðŸ”', name:'Ø§Ù„Ø¨Ø­Ø«', desc:'Ø´Ø±ÙŠØ· Ø§Ù„Ø¨Ø­Ø« Ø¹Ù† Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª' },
    { key:'cats',    icon:'ðŸ—‚ï¸', name:'Ø§Ù„Ø£Ù‚Ø³Ø§Ù…', desc:'Ø£Ø²Ø±Ø§Ø± ØªØµÙ†ÙŠÙØ§Øª Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª' },
    { key:'announce',icon:'ðŸ“¢', name:'Ø´Ø±ÙŠØ· Ø§Ù„Ø¥Ø¹Ù„Ø§Ù†Ø§Øª', desc:'Ø´Ø±ÙŠØ· Ø¥Ø¹Ù„Ø§Ù†Ø§Øª Ø¹Ù„ÙˆÙŠ Ù‚Ø§Ø¨Ù„ Ù„Ù„ØªØ®ØµÙŠØµ' },
    { key:'grid',    icon:'ðŸ›ï¸', name:'Ø´Ø¨ÙƒØ© Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª', desc:'Ø¨Ø·Ø§Ù‚Ø§Øª Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª' },
    { key:'brand',   icon:'ðŸ·ï¸', name:'ØªÙˆÙ‚ÙŠØ¹ Ø§Ù„Ù…Ù†ØµØ©', desc:'Â«ØµÙÙ†Ø¹ Ø¨ÙˆØ§Ø³Ø·Ø© Ø¯ÙÙƒÙ‘Ø§Ù†Â» (Ù…Ø¬Ø§Ù†ÙŠ ÙÙ‚Ø·)' }
  ];
  const order = Array.isArray(layout.order) && layout.order.length ? layout.order : ['hero','search','cats','announce','grid','brand'];
  // Ø¯Ù…Ø¬ Ø§Ù„Ø£Ù‚Ø³Ø§Ù… Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø© ØºÙŠØ± Ø§Ù„Ù…ÙˆØ¬ÙˆØ¯Ø© ÙÙŠ Ø§Ù„ØªØ±ØªÙŠØ¨ Ø§Ù„Ù…Ø­ÙÙˆØ¸ (Ù…Ø«Ù„ announce Ù„Ù„Ù…ØªØ§Ø¬Ø± Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø©)
  const DEFAULT_ORDER = ['hero','search','cats','announce','grid','brand'];
  const merged = [...order];
  for (const k of DEFAULT_ORDER) if (!merged.includes(k)) merged.splice(merged.indexOf('grid') >= 0 ? Math.max(merged.indexOf('grid'), 0) : merged.length, 0, k);
  const vis = layout.visibility || {};
  const sections = merged.filter(k=>defs.find(d=>d.key===k)).map(k=>({
    ...defs.find(d=>d.key===k),
    visible: vis[k] !== false
  }));
  
  res.render('panel/template-customize', { store, cfg, layout, sections, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

// Ø­ÙØ¸ Ø§Ù„ØªØ®Ø·ÙŠØ· Ù…Ù† Ø§Ù„Ù…Ø­Ø±Ø± Ø§Ù„Ù…Ø±Ø¦ÙŠ (multipart) â€” Ø§Ø³ØªØ®Ø±Ø§Ø¬ layout_json Ù…Ù† req.body
router.post('/templates/layout', (req, res) => {
  try {
    const store = getStore(req.user.store_id);
    const raw = req.body.layout_json;
    if (!raw) return res.status(400).json({ error: 'layout_json missing' });
    JSON.parse(raw); // validate
    db.prepare(`UPDATE stores SET layout_json=? WHERE id=?`).run(raw, store.id);
    logActivity(req.user.id, req.user.username, 'ØªØ­Ø¯ÙŠØ« ØªØµÙ…ÙŠÙ… Ø§Ù„Ù…ØªØ¬Ø±', 'ØªØ±ØªÙŠØ¨ ÙˆØªØ®ØµÙŠØµ Ø§Ù„Ø£Ù‚Ø³Ø§Ù…');
    res.json({ ok: true });
  } catch(e){ res.status(400).json({error:e.message}); }
});

router.post('/templates/customize', (req, res) => {
  const store = getStore(req.user.store_id);
  // Ø¯Ø¹Ù… Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ Ø§Ù„Ù…Ø¨Ø³Ø· (heroTitle/heroSub/heroImage...) + Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ Ø§Ù„Ù‚Ø¯ÙŠÙ…
  let layout = {};
  try { layout = JSON.parse(store.layout_json || '{}'); } catch {}
  // Ø¥Ø°Ø§ Ø¬Ø§Ø¡Øª Ø­Ù‚ÙˆÙ„ Ù…Ø¨Ø³Ø·Ø© Ù…Ù† Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ Ø§Ù„Ø¬Ø¯ÙŠØ¯ØŒ Ø­Ø¯Ø« Ø§Ù„Ù€ layout
  if (req.body.heroTitle !== undefined || req.body.heroSub !== undefined || req.body.heroImage !== undefined) {
    layout.hero = {
      title: String(req.body.heroTitle || store.name),
      sub: String(req.body.heroSub || ''),
      image: String(req.body.heroImage || (layout.hero||{}).image || ''),
      video: String(req.body.heroVideo || (layout.hero||{}).video || ''),
      textColor: String(req.body.heroText || (layout.hero||{}).textColor || '#ffffff'),
      overlay: Number(req.body.heroOverlay != null ? req.body.heroOverlay : ((layout.hero||{}).overlay ?? 40))
    };
  }
  if (req.body.announce !== undefined && !req.body.layout_json) {
    layout.announce = String(req.body.announce || '').slice(0,120);
  }
  // Ø­ÙØ¸ Ø§Ù„Ù€ layout Ø¥Ø°Ø§ ØªØºÙŠØ± Ø¹Ø¨Ø± Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ Ø§Ù„Ù…Ø¨Ø³Ø·
  if (req.body.heroTitle !== undefined || (req.body.announce !== undefined && !req.body.layout_json)) {
    db.prepare(`UPDATE stores SET layout_json=? WHERE id=?`).run(JSON.stringify(layout), store.id);
  }
  const { primary, accent, bg, ink, soft, btnColor, radius, font, fontSize, shadow, cardStyle, btnStyle, hover, anim, hero, grid, sections, announce } = req.body;
  const cfg = {
    primary: /^#[0-9a-fA-F]{6}$/.test(primary) ? primary : store.color,
    accent: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#ec4899',
    bg: /^#[0-9a-fA-F]{6}$/.test(bg) ? bg : '#ffffff',
    ink: /^#[0-9a-fA-F]{6}$/.test(ink) ? ink : '#111111',
    soft: /^#[0-9a-fA-F]{6}$/.test(soft) ? soft : '#f1f3f5',
    btnColor: /^#[0-9a-fA-F]{6}$/.test(btnColor) ? btnColor : (primary || store.color),
    radius: String(radius || '14'),
    font: String(font || 'Cairo'),
    fontSize: String(fontSize || '15'),
    shadow: String(shadow || 'soft'),
    cardStyle: String(cardStyle || 'default'),
    btnStyle: String(btnStyle || 'pill'),
    hover: String(hover || 'lift'),
    anim: String(anim || 'on'),
    hero: String(hero || 'default'),
    grid: String(grid || 'auto'),
    sections: String(sections || 'hero,search,cats,grid'),
    announce: String(announce || layout.announce || '').slice(0,120)
  };
  const shadowVal = cfg.shadow==='none' ? 'none' : cfg.shadow==='medium' ? '0 10px 28px rgba(15,23,42,.09)' : cfg.shadow==='strong' ? '0 22px 54px rgba(15,23,42,.15)' : '0 2px 8px rgba(15,23,42,.05)';
  const customCss = `:root{--primary:${cfg.primary};--accent:${cfg.accent};--bg:${cfg.bg};--ink:${cfg.ink};--soft:${cfg.soft};--radius:${cfg.radius}px;--btn:${cfg.btnColor};--shadow:${shadowVal}} body{font-family:'${cfg.font}', sans-serif; font-size:${cfg.fontSize}px} .st-card{${cfg.cardStyle==='sharp'?'border-radius:2px':cfg.cardStyle==='rounded'?'border-radius:18px':cfg.cardStyle==='soft'?'border-radius:24px':''}} .st-btn{${cfg.btnStyle==='square'?'border-radius:2px':cfg.btnStyle==='rounded'?'border-radius:10px':cfg.btnStyle==='soft'?'border-radius:14px':'border-radius:99px'};background:${cfg.btnColor}} ${cfg.anim==='off'?'*{animation:none !important;transition:none !important}':''} ${cfg.announce ? `.announce-bar{display:block}` : ''}`;
  db.prepare(`UPDATE stores SET template_config=?, custom_css=?, color=? WHERE id=?`).run(JSON.stringify(cfg), customCss, cfg.primary, store.id);
  logActivity(req.user.id, req.user.username, 'ØªØ®ØµÙŠØµ Ø§Ù„Ù‚Ø§Ù„Ø¨', `Ø£Ù„ÙˆØ§Ù† ÙˆØªØµÙ…ÙŠÙ…`);
  res.redirect('/panel/templates/customize?ok=' + encodeURIComponent('ØªÙ… Ø­ÙØ¸ Ø§Ù„ØªØ®ØµÙŠØµ â€” Ø´ÙˆÙ Ù…ØªØ¬Ø±Ùƒ Ø§Ù„Ø¢Ù†'));
});

router.post('/settings', (req, res) => {
  const store = getStore(req.user.store_id);
  const { name, description, owner_name, phone, whatsapp, template, color, custom_domain, delivery_fee, free_delivery_min, meta_desc } = req.body;
  let domain = String(store.custom_domain || '').toLowerCase();
  if (isPro(store)) {
    const d = String(custom_domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (d) {
      if (/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d) && !d.endsWith('.local') && !/^(\d+\.){3}\d+$/.test(d) && d !== 'localhost') {
        const clash = db.prepare('SELECT id FROM stores WHERE lower(custom_domain)=? AND id!=?').get(d, store.id);
        if (clash) return res.redirect('/panel/settings?err=' + encodeURIComponent('Ù‡Ø°Ø§ Ø§Ù„Ø¯ÙˆÙ…ÙŠÙ† Ù…Ø±Ø¨ÙˆØ· Ø¨Ù…ØªØ¬Ø± Ø¢Ø®Ø±'));
        domain = d;
      } else return res.redirect('/panel/settings?err=' + encodeURIComponent('ØµÙŠØºØ© Ø§Ù„Ø¯ÙˆÙ…ÙŠÙ† ØºÙŠØ± ØµØ­ÙŠØ­Ø© â€” Ù…Ø«Ø§Ù„: my-shop.example.com'));
    } else domain = '';
  }
  if (containsForbidden(name) || containsForbidden(description)) {
    const w = getForbiddenWord(name + ' ' + (description||'')) || 'Ù…Ù…Ù†ÙˆØ¹Ø©';
    return res.redirect('/panel/settings?err=' + encodeURIComponent(`Ø§Ù„Ø§Ø³Ù…/Ø§Ù„ÙˆØµÙ ÙŠØ­ØªÙˆÙŠ Ø¹Ù„Ù‰ ÙƒÙ„Ù…Ø© ØºÙŠØ± Ù…Ø³Ù…ÙˆØ­Ø©: "${w}"`));
  }
  let tpl = TPL.valid(template) ? template : store.template;
  if (TPL.isPremium(tpl) && !isPro(store)) tpl = store.template;
  db.prepare('UPDATE stores SET name=?, description=?, owner_name=?, phone=?, whatsapp=?, template=?, color=?, custom_domain=?, delivery_fee=?, free_delivery_min=?, meta_desc=? WHERE id=?')
    .run(String(name || store.name), String(description || ''), String(owner_name || ''), String(phone || ''), String(whatsapp || ''), tpl, /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : store.color, domain,
      Math.max(0, Number(delivery_fee) || 0), Math.max(0, Number(free_delivery_min) || 0), String(meta_desc || '').slice(0, 200), store.id);
  logActivity(req.user.id, req.user.username, 'Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ù…ØªØ¬Ø±', 'Ø¹Ø¯Ù‘Ù„ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ù…ØªØ¬Ø±Ù‡' + (domain ? ' â€” Ø§Ù„Ø¯ÙˆÙ…ÙŠÙ†: ' + domain : ''));
  res.redirect('/panel/settings?ok=' + encodeURIComponent('ØªÙ… Ø­ÙØ¸ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª'));
});

const upLogo = () => uploader(() => '.');

router.post('/settings/logo', upLogo().single('logo'), asyncHandler(async (req, res) => {
  const store = getStore(req.user.store_id);
  if (!req.file) return res.redirect('/panel/settings?err=' + encodeURIComponent('Ù„Ù… ÙŠØªÙ… Ø§Ø®ØªÙŠØ§Ø± ØµÙˆØ±Ø©'));
  if (store.logo_path) {
    const oldAbs = path.join(__dirname, '..', store.logo_path);
    if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
    const oldThumb = oldAbs.replace(/(\.[^.]+)$/, '_t$1');
    if (fs.existsSync(oldThumb)) fs.unlinkSync(oldThumb);
  }
  const newPath = `/uploads/store_${store.id}/logo${path.extname(req.file.filename)}`;
  await processImage(req.file.path);
  fs.renameSync(req.file.path, path.join(__dirname, '..', newPath));
  db.prepare('UPDATE stores SET logo_path=? WHERE id=?').run(newPath, store.id);
  appendLog(`Ù…Ø³ØªØ®Ø¯Ù… Â«${req.user.username}Â» ØºÙŠÙ‘Ø± Ø´Ø¹Ø§Ø± Ù…ØªØ¬Ø± Â«${store.name}Â»`);
  res.redirect('/panel/settings?ok=' + encodeURIComponent('ØªÙ… ØªØ­Ø¯ÙŠØ« Ø§Ù„Ø´Ø¹Ø§Ø±'));
}), (err, req, res, next) => {
  res.redirect('/panel/settings?err=' + encodeURIComponent(err.message || 'ÙØ´Ù„ Ø±ÙØ¹ Ø§Ù„Ø´Ø¹Ø§Ø±'));
});

/* ====== Ø§Ù„Ø¹Ø±ÙˆØ¶ Ø§Ù„Ù…Ø¬Ù…Ø¹Ø© (Bundles) - Ù…Ø­Ø°ÙˆÙØ© Ø¨Ø·Ù„Ø¨ Ø³Ø¬Ø§Ø¯ ====== */

/* ====== Ø£ÙƒÙˆØ§Ø¯ Ø§Ù„Ø®ØµÙ… ====== */
router.get('/coupons', (req, res) => {
  const store = getStore(req.user.store_id);
  const rows = db.prepare('SELECT * FROM coupons WHERE store_id=? ORDER BY id DESC').all(store.id);
  res.render('panel/coupons', { store, rows, pro: isPro(store), money, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

router.post('/coupons', (req, res) => {
  const store = getStore(req.user.store_id);
  const { code, type, value, min_total, max_uses, expires } = req.body;
  const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
  if (c.length < 3) return res.redirect('/panel/coupons?err=' + encodeURIComponent('Ø§Ù„ÙƒÙˆØ¯: 3 Ø£Ø­Ø±Ù/Ø£Ø±Ù‚Ø§Ù… Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„ (Ù„Ø§ØªÙŠÙ†ÙŠ ÙˆØ£Ø±Ù‚Ø§Ù… ÙÙ‚Ø·)'));
  const t = type === 'amount' ? 'amount' : 'percent';
  const v = Number(value);
  if (isNaN(v) || v <= 0 || (t === 'percent' && v > 100)) return res.redirect('/panel/coupons?err=' + encodeURIComponent('Ù‚ÙŠÙ…Ø© Ø§Ù„Ø®ØµÙ… ØºÙŠØ± ØµØ­ÙŠØ­Ø©'));
  if (!isPro(store)) {
    const cnt = db.prepare('SELECT COUNT(*) c FROM coupons WHERE store_id=?').get(store.id).c;
    if (cnt >= 5) return res.redirect('/panel/coupons?err=' + encodeURIComponent('Ø§Ù„Ø¨Ø§Ù‚Ø© Ø§Ù„Ù…Ø¬Ø§Ù†ÙŠØ© ØªØ³Ù…Ø­ Ø¨Ù€ 5 Ø£ÙƒÙˆØ§Ø¯ ÙÙ‚Ø· â€” Ø±Ù‚ÙÙ‘ Ø¨Ø§Ù‚ØªÙƒ Ù…Ù† ØµÙØ­Ø© Â«Ø§Ù„Ø¨Ø§Ù‚Ø§ØªÂ» Ù„Ø¨Ù„Ø§ Ø­Ø¯ÙˆØ¯'));
  }
  const clash = db.prepare('SELECT id FROM coupons WHERE store_id=? AND code=?').get(store.id, c);
  if (clash) return res.redirect('/panel/coupons?err=' + encodeURIComponent('ÙŠÙˆØ¬Ø¯ ÙƒÙˆØ¯ Ø¨Ù†ÙØ³ Ø§Ù„Ø§Ø³Ù… Ø¨Ø§Ù„ÙØ¹Ù„'));
  db.prepare('INSERT INTO coupons (store_id, code, type, value, min_total, max_uses, expires) VALUES (?,?,?,?,?,?,?)')
    .run(store.id, c, t, v, Math.max(0, Number(min_total) || 0), Math.max(0, Math.floor(Number(max_uses) || 0)),
      /^\d{4}-\d{2}-\d{2}$/.test(String(expires || '')) ? String(expires) : '');
  logActivity(req.user.id, req.user.username, 'ÙƒÙˆØ¯ Ø®ØµÙ…', `Ø£Ù†Ø´Ø£ ÙƒÙˆØ¯ Â«${c}Â»`);
  appendLog(`Ù…Ø³ØªØ®Ø¯Ù… Â«${req.user.username}Â» Ø£Ù†Ø´Ø£ ÙƒÙˆØ¯ Ø®ØµÙ… Â«${c}Â» (${t === 'percent' ? v + '%' : money(v)}) ÙÙŠ Ù…ØªØ¬Ø± Â«${store.name}Â»`);
  res.redirect('/panel/coupons?ok=' + encodeURIComponent('ØªÙ… Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„ÙƒÙˆØ¯ â€” Ø´Ø§Ø±ÙƒÙ‡ Ù…Ø¹ Ø²Ø¨Ø§Ø¦Ù†Ùƒ'));
});

router.post('/coupons/:id/toggle', (req, res) => {
  const store = getStore(req.user.store_id);
  const c = db.prepare('SELECT * FROM coupons WHERE id=? AND store_id=?').get(req.params.id, store.id);
  if (c) db.prepare('UPDATE coupons SET active=? WHERE id=?').run(c.active ? 0 : 1, c.id);
  res.redirect('/panel/coupons?ok=' + encodeURIComponent('ØªÙ… Ø§Ù„ØªØ­Ø¯ÙŠØ«'));
});

router.post('/coupons/:id/delete', (req, res) => {
  const store = getStore(req.user.store_id);
  db.prepare('DELETE FROM coupons WHERE id=? AND store_id=?').run(req.params.id, store.id);
  res.redirect('/panel/coupons?ok=' + encodeURIComponent('ØªÙ… Ø­Ø°Ù Ø§Ù„ÙƒÙˆØ¯'));
});

router.get('/password', (req, res) => {
  res.render('panel/password', { ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});

router.post('/password', (req, res) => {
  const { oldpass, newpass } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!checkPassword(String(oldpass || ''), u.password_hash))
    return res.redirect('/panel/password?err=' + encodeURIComponent('ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± Ø§Ù„Ø­Ø§Ù„ÙŠØ© ØºÙŠØ± ØµØ­ÙŠØ­Ø©'));
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(newpass || '')))
    return res.redirect('/panel/password?err=' + encodeURIComponent('ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø©: 8 Ø£Ø­Ø±Ù Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„ Ù…Ø¹ Ø±Ù‚Ù… ÙˆØ­Ø±Ù'));
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(String(newpass)), req.user.id);
  res.redirect('/panel/password?ok=' + encodeURIComponent('ØªÙ… ØªØºÙŠÙŠØ± ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±'));
});

/* ====== Ø§Ù„ØªÙ‚ÙŠÙŠÙ…Ø§Øª â€” Ø¥Ø¯Ø§Ø±Ø© ØªÙ‚ÙŠÙŠÙ…Ø§Øª Ø§Ù„Ø²Ø¨Ø§Ø¦Ù† ====== */
router.get('/reviews', (req, res) => {
  const store = getStore(req.user.store_id);
  const reviews = db.prepare(`
    SELECT r.*, p.name product_name
    FROM reviews r JOIN products p ON p.id=r.product_id
    WHERE p.store_id=? ORDER BY r.approved ASC, r.id DESC
  `).all(store.id);
  res.render('panel/reviews', { store, reviews, ok: req.query.ok || '', err: req.query.err || '', user: req.user });
});
router.post('/reviews/:id/approve', (req, res) => {
  const store = getStore(req.user.store_id);
  const r = db.prepare('SELECT r.* FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.id=? AND p.store_id=?').get(req.params.id, store.id);
  if (!r) return res.redirect('/panel/reviews?err=' + encodeURIComponent('Ø§Ù„ØªÙ‚ÙŠÙŠÙ… ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯'));
  db.prepare('UPDATE reviews SET approved=1 WHERE id=?').run(r.id);
  // Ù†Ù‚Ø§Ø· ÙˆÙ„Ø§Ø¡ Ù„Ù„Ù…Ø±Ø§Ø¬Ø¹
  try{ const cfg=require('../util').getLoyaltyConfig(); require('../util').addLoyaltyPoints(store.id, r.customer_phone||'review-'+r.id, cfg.points_per_review, 'review', r.id, 'ØªÙ‚ÙŠÙŠÙ… Ù…Ù†ØªØ¬'); }catch(e){}
  res.redirect('/panel/reviews?ok=' + encodeURIComponent('ØªÙ…Øª Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© â€” ÙŠØ¸Ù‡Ø± Ø§Ù„Ø¢Ù† Ù„Ù„Ø²ÙˆØ§Ø±'));
});
router.post('/reviews/:id/delete', (req, res) => {
  const store = getStore(req.user.store_id);
  const r = db.prepare('SELECT r.* FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.id=? AND p.store_id=?').get(req.params.id, store.id);
  if (!r) return res.redirect('/panel/reviews?err=' + encodeURIComponent('Ø§Ù„ØªÙ‚ÙŠÙŠÙ… ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯'));
  db.prepare('DELETE FROM reviews WHERE id=?').run(r.id);
  res.redirect('/panel/reviews?ok=' + encodeURIComponent('ØªÙ… Ø­Ø°Ù Ø§Ù„ØªÙ‚ÙŠÙŠÙ…'));
});

module.exports = router;

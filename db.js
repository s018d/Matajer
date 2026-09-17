const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let db;
let DB_FILE;
let isPg = false;
let pool;

// ==================== PostgreSQL Mode (when DATABASE_URL is set) ====================
if (process.env.DATABASE_URL) {
  isPg = true;
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  console.log('🐘 PostgreSQL mode —', process.env.DATABASE_URL.split('@').pop()?.split('?')[0] || 'PG');

  function toPg(sql) {
    let idx = 1;
    return sql.replace(/\?/g, () => `$${idx++}`);
  }

  // Wrap to mimic DatabaseSync API but async
  db = {
    isPg: true,
    pool,
    prepare(sql) {
      const pgSql = toPg(sql);
      return {
        get: async (...params) => {
          const res = await pool.query(pgSql, params);
          return res.rows[0] || null;
        },
        all: async (...params) => {
          const res = await pool.query(pgSql, params);
          return res.rows;
        },
        run: async (...params) => {
          let finalSql = pgSql;
          if (/^\s*INSERT/i.test(sql) && !/RETURNING/i.test(sql)) finalSql += ' RETURNING id';
          const res = await pool.query(finalSql, params);
          const id = res.rows[0]?.id;
          return { lastInsertRowid: id, lastInsertId: id, changes: res.rowCount, rowCount: res.rowCount };
        }
      };
    },
    exec: async (sql) => {
      let pgSql = sql
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
        .replace(/datetime\('now','localtime'\)/g, 'NOW()')
        .replace(/PRAGMA journal_mode = WAL;/g, '')
        .replace(/PRAGMA foreign_keys = ON;/g, '');
      const stmts = pgSql.split(';').map(s => s.trim()).filter(Boolean);
      for (const stmt of stmts) {
        if (!stmt) continue;
        try { await pool.query(stmt); } catch (e) {
          if (e.message.includes('already exists') || e.code === '42P07') continue;
          // Ignore already exists for tables/indexes
          if (stmt.includes('CREATE TABLE') || stmt.includes('CREATE INDEX') || stmt.includes('CREATE UNIQUE INDEX')) continue;
          console.error('PG exec:', e.message.slice(0,80));
        }
      }
    }
  };

  // Init tables async (fire and forget, but ensure before first query)
  (async () => {
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'owner',
          store_id INTEGER,
          created_at TEXT DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS stores (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT UNIQUE NOT NULL,
          description TEXT DEFAULT '',
          owner_name TEXT DEFAULT '',
          phone TEXT DEFAULT '',
          logo_path TEXT DEFAULT '',
          template TEXT DEFAULT 'classic',
          color TEXT DEFAULT '#0ea5e9',
          status TEXT DEFAULT 'active',
          plan TEXT DEFAULT 'free',
          plan_expires TEXT DEFAULT '',
          created_at TEXT DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_custom_domain ON stores(lower(custom_domain)) WHERE custom_domain<>'' AND custom_domain IS NOT NULL;
        CREATE TABLE IF NOT EXISTS categories (
          id SERIAL PRIMARY KEY,
          store_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          position INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          store_id INTEGER NOT NULL,
          category_id INTEGER,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          price DOUBLE PRECISION NOT NULL DEFAULT 0,
          old_price DOUBLE PRECISION,
          views INTEGER DEFAULT 0,
          active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS product_images (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL,
          path TEXT NOT NULL,
          position INTEGER DEFAULT 0,
          variant TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          store_id INTEGER NOT NULL,
          customer_name TEXT NOT NULL,
          customer_phone TEXT NOT NULL,
          customer_address TEXT DEFAULT '',
          note TEXT DEFAULT '',
          total DOUBLE PRECISION NOT NULL DEFAULT 0,
          status TEXT DEFAULT 'new',
          created_at TEXT DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS order_items (
          id SERIAL PRIMARY KEY,
          order_id INTEGER NOT NULL,
          product_name TEXT NOT NULL,
          product_price DOUBLE PRECISION NOT NULL,
          qty INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          created_at TEXT DEFAULT NOW(),
          expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS activity (
          id SERIAL PRIMARY KEY,
          user_id INTEGER,
          username TEXT,
          action TEXT NOT NULL,
          details TEXT DEFAULT '',
          created_at TEXT DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS payments (
          id SERIAL PRIMARY KEY,
          store_id INTEGER NOT NULL,
          plan TEXT NOT NULL DEFAULT 'pro',
          amount DOUBLE PRECISION NOT NULL DEFAULT 0,
          status TEXT DEFAULT 'pending',
          note TEXT DEFAULT '',
          created_at TEXT DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS referrals (
          id SERIAL PRIMARY KEY,
          referrer_store_id INTEGER NOT NULL,
          new_store_id INTEGER NOT NULL,
          status TEXT DEFAULT 'pending',
          created_at TEXT DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS coupons (
          id SERIAL PRIMARY KEY,
          store_id INTEGER NOT NULL,
          code TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'percent',
          value DOUBLE PRECISION NOT NULL DEFAULT 10,
          min_total DOUBLE PRECISION NOT NULL DEFAULT 0,
          max_uses INTEGER NOT NULL DEFAULT 0,
          used INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          expires TEXT DEFAULT '',
          created_at TEXT DEFAULT NOW()
        );
      `);
      // Add columns (PostgreSQL: ADD COLUMN IF NOT EXISTS)
      const alters = [
        "ALTER TABLE stores ADD COLUMN IF NOT EXISTS whatsapp TEXT DEFAULT ''",
        "ALTER TABLE stores ADD COLUMN IF NOT EXISTS custom_domain TEXT DEFAULT ''",
        "ALTER TABLE stores ADD COLUMN IF NOT EXISTS delivery_fee DOUBLE PRECISION DEFAULT 0",
        "ALTER TABLE stores ADD COLUMN IF NOT EXISTS free_delivery_min DOUBLE PRECISION DEFAULT 0",
        "ALTER TABLE stores ADD COLUMN IF NOT EXISTS meta_desc TEXT DEFAULT ''",
        "ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_bg_video TEXT DEFAULT ''",
        "ALTER TABLE stores ADD COLUMN IF NOT EXISTS bg_overlay INTEGER DEFAULT 0",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS options TEXT DEFAULT ''",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS addons TEXT DEFAULT ''",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal DOUBLE PRECISION DEFAULT 0",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee DOUBLE PRECISION DEFAULT 0",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount DOUBLE PRECISION DEFAULT 0",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT DEFAULT ''",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS done_token TEXT DEFAULT ''",
        "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS options TEXT DEFAULT ''",
        "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS addons_price DOUBLE PRECISION DEFAULT 0",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS months INTEGER DEFAULT 1",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS ref TEXT DEFAULT ''",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_path TEXT DEFAULT ''",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_store_code ON coupons(store_id, code)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT DEFAULT ''",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS banned INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT DEFAULT ''",
        "CREATE TABLE IF NOT EXISTS login_logs (id SERIAL PRIMARY KEY, user_id INTEGER, username TEXT DEFAULT '', ip TEXT DEFAULT '', user_agent TEXT DEFAULT '', success INTEGER DEFAULT 0, method TEXT DEFAULT 'password', created_at TEXT DEFAULT NOW())",
        "CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT ''",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT ''",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TEXT DEFAULT ''",
        "CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', css_file TEXT DEFAULT '', preview_image TEXT DEFAULT '', is_premium INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, position INTEGER DEFAULT 0, created_at TEXT DEFAULT NOW())"
      ];
      for (const q of alters) { try { await pool.query(q); } catch(e) {} }

      // Additional tables (same as SQLite, PG will convert)
      const extraTables = [
        `CREATE TABLE IF NOT EXISTS abandoned_carts (id SERIAL PRIMARY KEY, store_id INTEGER NOT NULL, session_id TEXT NOT NULL, cart_data TEXT NOT NULL, customer_phone TEXT, customer_name TEXT, subtotal DOUBLE PRECISION DEFAULT 0, created_at TEXT DEFAULT NOW(), reminded_at TEXT DEFAULT '', converted_at TEXT DEFAULT '')`,
        `CREATE TABLE IF NOT EXISTS reviews (id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT, rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5), comment TEXT DEFAULT '', approved INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS loyalty_points (id SERIAL PRIMARY KEY, store_id INTEGER NOT NULL, customer_phone TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, total_earned INTEGER NOT NULL DEFAULT 0, total_redeemed INTEGER NOT NULL DEFAULT 0, last_activity TEXT DEFAULT NOW(), UNIQUE(store_id, customer_phone))`,
        `CREATE TABLE IF NOT EXISTS loyalty_transactions (id SERIAL PRIMARY KEY, store_id INTEGER NOT NULL, customer_phone TEXT NOT NULL, type TEXT NOT NULL, points INTEGER NOT NULL, reference_type TEXT, reference_id INTEGER, description TEXT, created_at TEXT DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', css_file TEXT DEFAULT '', preview_image TEXT DEFAULT '', is_premium INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, position INTEGER DEFAULT 0, created_at TEXT DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS support_tickets (id SERIAL PRIMARY KEY, store_id INTEGER, customer_name TEXT, customer_phone TEXT, customer_email TEXT, subject TEXT NOT NULL, category TEXT NOT NULL, priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'open', assigned_to INTEGER, created_at TEXT DEFAULT NOW(), updated_at TEXT DEFAULT NOW(), resolved_at TEXT)`,
        `CREATE TABLE IF NOT EXISTS support_messages (id SERIAL PRIMARY KEY, ticket_id INTEGER NOT NULL, sender_type TEXT NOT NULL, sender_id INTEGER, message TEXT NOT NULL, attachments TEXT, is_internal INTEGER DEFAULT 0, created_at TEXT DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS sms_logs (id SERIAL PRIMARY KEY, store_id INTEGER, phone TEXT NOT NULL, message TEXT NOT NULL, type TEXT NOT NULL, status TEXT DEFAULT 'pending', provider TEXT, provider_message_id TEXT, error_message TEXT, cost INTEGER DEFAULT 0, sent_at TEXT, delivered_at TEXT, created_at TEXT DEFAULT NOW())`
      ];
      // cash_flow_entries + domain_requests + indexes
      for (const q of [
        `CREATE TABLE IF NOT EXISTS cash_flow_entries (id SERIAL PRIMARY KEY, store_id INTEGER NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL, amount INTEGER NOT NULL, reference_type TEXT DEFAULT '', reference_id INTEGER DEFAULT 0, description TEXT DEFAULT '', created_at TEXT DEFAULT NOW()); CREATE INDEX IF NOT EXISTS idx_cfe_store ON cash_flow_entries(store_id);`,
        `CREATE INDEX IF NOT EXISTS idx_orders_store_status_created ON orders(store_id, status, created_at); CREATE INDEX IF NOT EXISTS idx_products_store_active ON products(store_id, active);`
      ]) { try { await pool.query(q); } catch(e) {} }
      for (const q of extraTables) { try { await pool.query(q); } catch(e) {} }
      console.log('🐘 PostgreSQL tables ready (39)');
    } catch(e) {
      console.error('PG init error', e.message);
    }
  })();

// ==================== SQLite Mode (local, no DATABASE_URL) ====================
} else {
  const { DatabaseSync } = require('node:sqlite');
  const DATA_DIR = path.join(__dirname, 'data');
  DB_FILE = path.join(DATA_DIR, 'matajer.db');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqliteDb = new DatabaseSync(DB_FILE);
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
  db = sqliteDb;
  db.isPg = false;
  console.log('💾 SQLite mode —', DB_FILE);

  // Wrap SQLite to be await-compatible (so same code works with await)
  const origPrepare = db.prepare.bind(db);
  const origExec = db.exec.bind(db);
  db.prepare = (sql) => {
    const stmt = origPrepare(sql);
    return {
      get: (...args) => stmt.get(...args),
      all: (...args) => stmt.all(...args),
      run: (...args) => stmt.run(...args)
    };
  };
  // Keep exec sync for init, but allow async usage too
  db.exec = origExec;

  // Create tables synchronously (original SQLite code)
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  store_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  owner_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  logo_path TEXT DEFAULT '',
  template TEXT DEFAULT 'classic',
  color TEXT DEFAULT '#0ea5e9',
  status TEXT DEFAULT 'active',
  plan TEXT DEFAULT 'free',
  plan_expires TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  category_id INTEGER,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  old_price REAL,
  views INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  variant TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT DEFAULT '',
  note TEXT DEFAULT '',
  total REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  product_price REAL NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  details TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT 'pro',
  amount REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_store_id INTEGER NOT NULL,
  new_store_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'percent',
  value REAL NOT NULL DEFAULT 10,
  min_total REAL NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  expires TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);
  try { db.exec("ALTER TABLE stores ADD COLUMN whatsapp TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE stores ADD COLUMN updated_at TEXT DEFAULT (datetime('now','localtime'))"); } catch (e) {}
  try { db.exec("ALTER TABLE stores ADD COLUMN custom_domain TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE stores ADD COLUMN delivery_fee REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE stores ADD COLUMN free_delivery_min REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE stores ADD COLUMN meta_desc TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE stores ADD COLUMN store_bg_video TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE stores ADD COLUMN bg_overlay INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN stock INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN options TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN addons TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE orders ADD COLUMN subtotal REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE orders ADD COLUMN delivery_fee REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE orders ADD COLUMN discount REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE orders ADD COLUMN coupon_code TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE orders ADD COLUMN done_token TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE order_items ADD COLUMN options TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE order_items ADD COLUMN addons_price REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE payments ADD COLUMN months INTEGER DEFAULT 1"); } catch (e) {}
  try { db.exec("ALTER TABLE payments ADD COLUMN ref TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE payments ADD COLUMN receipt_path TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE product_images ADD COLUMN variant TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_store_code ON coupons(store_id, code)"); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS abandoned_carts (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, session_id TEXT NOT NULL, cart_data TEXT NOT NULL, customer_phone TEXT, customer_name TEXT, subtotal REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')), reminded_at TEXT DEFAULT '', converted_at TEXT DEFAULT '')`); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT, rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5), comment TEXT DEFAULT '', approved INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')))`); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS loyalty_points (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, customer_phone TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, total_earned INTEGER NOT NULL DEFAULT 0, total_redeemed INTEGER NOT NULL DEFAULT 0, last_activity TEXT DEFAULT (datetime('now','localtime')), UNIQUE(store_id, customer_phone))`); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS loyalty_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, customer_phone TEXT NOT NULL, type TEXT NOT NULL, points INTEGER NOT NULL, reference_type TEXT, reference_id INTEGER, description TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))`); } catch (e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id); CREATE INDEX IF NOT EXISTS idx_products_store_active ON products(store_id, active); CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id); CREATE INDEX IF NOT EXISTS idx_orders_store_status_created ON orders(store_id, status, created_at); CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id); CREATE INDEX IF NOT EXISTS idx_cats_store ON categories(store_id); CREATE INDEX IF NOT EXISTS idx_payments_store ON payments(store_id);`); } catch (e) {}
  // P0-3: فهرس فريد يمنع استيلاء دومين متزامن
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_custom_domain ON stores(lower(custom_domain)) WHERE custom_domain<>'' AND custom_domain IS NOT NULL`); } catch (e) {}
  // RBAC — أعمدة جديدة للمشرفين
  try { db.exec("ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN created_by INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN last_login TEXT DEFAULT ''"); } catch (e) {}
  // جدول القوالب الديناميكي
  try { db.exec(`CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', css_file TEXT DEFAULT '', preview_image TEXT DEFAULT '', is_premium INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, position INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')))`); } catch (e) {}
  // cash_flow_entries — كان ناقصاً (يستدعيه addCashFlowEntry)
  try { db.exec(`CREATE TABLE IF NOT EXISTS cash_flow_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL, amount INTEGER NOT NULL, reference_type TEXT DEFAULT '', reference_id INTEGER DEFAULT 0, description TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime'))); CREATE INDEX IF NOT EXISTS idx_cfe_store ON cash_flow_entries(store_id);`); } catch (e) {}
  // نظام الدخول المزدوج — جوجل + حظر + سجل دخول
  try { db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN banned_reason TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS login_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT DEFAULT '', ip TEXT DEFAULT '', user_agent TEXT DEFAULT '', success INTEGER DEFAULT 0, method TEXT DEFAULT 'password', created_at TEXT DEFAULT (datetime('now','localtime'))); CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id);`); } catch (e) {}
  // تذاكر الدعم — التاجر يفتح، الأدمن يرد (موجودة بـ PG مسبقاً)
  try { db.exec(`CREATE TABLE IF NOT EXISTS support_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER, customer_name TEXT DEFAULT '', customer_phone TEXT DEFAULT '', customer_email TEXT DEFAULT '', subject TEXT NOT NULL, category TEXT NOT NULL, priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'open', assigned_to INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')), resolved_at TEXT DEFAULT '')`); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS support_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, sender_type TEXT NOT NULL, sender_id INTEGER, message TEXT NOT NULL, attachments TEXT DEFAULT '', is_internal INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime'))); CREATE INDEX IF NOT EXISTS idx_support_msg_ticket ON support_messages(ticket_id); CREATE INDEX IF NOT EXISTS idx_support_tickets_store ON support_tickets(store_id);`); } catch (e) {}
}

function logActivity(userId, username, action, details = '') {
  // Note: for PG this is async, caller should await if needed
  return db.prepare('INSERT INTO activity (user_id, username, action, details) VALUES (?,?,?,?)').run(userId, username, action, details);
}
function siteSettings() {
  if (isPg) {
    throw new Error('Use await siteSettingsAsync() in PostgreSQL mode');
  }
  const map = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) map[row.key] = row.value;
  return {
    site_name: map.site_name || 'دُكّان Dukkan',
    site_whatsapp: map.site_whatsapp || '9647831020026',
    pay_account: map.pay_account || '',
    free_products: Number(map.free_products || 25),
    pro_price: Number(map.pro_price || 10000),
    pro_price_3: Number(map.pro_price_3 || 25000),
    pro_price_12: Number(map.pro_price_12 || 100000),
    business_price: Number(map.business_price || 25000),
    tagline: map.tagline || 'أنشئ متجرك الإلكتروني خلال دقائق وابدأ البيع فوراً',
    site_telegram: map.site_telegram || '@s018d',
    site_instagram: map.site_instagram || '@s018d',
    site_tiktok: map.site_tiktok || '@s018a',
    trial_days: Number(map.trial_days || 14),
    telegram_bot_token: map.telegram_bot_token || '',
    telegram_admin_chat_id: map.telegram_admin_chat_id || '',
    ...map
  };
}
async function siteSettingsAsync() {
  const map = {};
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  for (const row of rows) map[row.key] = row.value;
  return {
    site_name: map.site_name || 'دُكّان Dukkan',
    site_whatsapp: map.site_whatsapp || '9647831020026',
    pay_account: map.pay_account || '',
    free_products: Number(map.free_products || 25),
    pro_price: Number(map.pro_price || 10000),
    pro_price_3: Number(map.pro_price_3 || 25000),
    pro_price_12: Number(map.pro_price_12 || 100000),
    business_price: Number(map.business_price || 25000),
    tagline: map.tagline || 'أنشئ متجرك الإلكتروني خلال دقائق وابدأ البيع فوراً',
    site_telegram: map.site_telegram || '@s018d',
    site_instagram: map.site_instagram || '@s018d',
    site_tiktok: map.site_tiktok || '@s018a',
    trial_days: Number(map.trial_days || 14),
    telegram_bot_token: map.telegram_bot_token || '',
    telegram_admin_chat_id: map.telegram_admin_chat_id || '',
    ...map
  };
}
function setSetting(key, value) {
  return db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(String(key), String(value));
}
function isPro(store) {
  if (!store || (store.plan !== 'pro' && store.plan !== 'business')) return false;
  if (!store.plan_expires) return false;
  return new Date(store.plan_expires) > new Date();
}
function isBusiness(store) {
  if (!store || store.plan !== 'business') return false;
  if (!store.plan_expires) return false;
  return new Date(store.plan_expires) > new Date();
}

module.exports = { db, isPg, pool, logActivity, siteSettings, siteSettingsAsync, setSetting, isPro, isBusiness, UPLOADS_DIR, DB_FILE };

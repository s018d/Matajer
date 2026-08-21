const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'matajer.db');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

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
  position INTEGER DEFAULT 0
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
try { db.exec("ALTER TABLE stores ADD COLUMN custom_domain TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE stores ADD COLUMN delivery_fee REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE stores ADD COLUMN free_delivery_min REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE stores ADD COLUMN meta_desc TEXT DEFAULT ''"); } catch (e) {}
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
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_store_code ON coupons(store_id, code)"); } catch (e) {}
try { db.exec(`
CREATE TABLE IF NOT EXISTS bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  discount_type TEXT NOT NULL DEFAULT 'percent', -- 'percent' or 'amount'
  discount_value REAL NOT NULL DEFAULT 0,
  min_products INTEGER NOT NULL DEFAULT 2,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}
try { db.exec(`
CREATE TABLE IF NOT EXISTS bundle_products (
  bundle_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  PRIMARY KEY (bundle_id, product_id)
)`); } catch (e) {}
try { db.exec(`
CREATE TABLE IF NOT EXISTS abandoned_carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  cart_data TEXT NOT NULL,
  customer_phone TEXT,
  customer_name TEXT,
  subtotal REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  reminded_at TEXT DEFAULT '',
  converted_at TEXT DEFAULT ''
)`); } catch (e) {}
try { db.exec(`
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT DEFAULT '',
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}
try { db.exec(`
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_cats_store ON categories(store_id);
CREATE INDEX IF NOT EXISTS idx_bundles_store ON bundles(store_id);
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_store ON abandoned_carts(store_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS loyalty_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  customer_phone TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_redeemed INTEGER NOT NULL DEFAULT 0,
  last_activity TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(store_id, customer_phone)
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  customer_phone TEXT NOT NULL,
  type TEXT NOT NULL, -- 'earned', 'redeemed', 'expired'
  points INTEGER NOT NULL,
  reference_type TEXT, -- 'order', 'review', 'referral', 'signup', 'manual'
  reference_id INTEGER,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS shipping_companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE, -- 'barq', 'saqr', 'dhl', 'aramex', 'iraq_post'
  api_base_url TEXT,
  api_key TEXT,
  api_secret TEXT,
  merchant_id TEXT,
  callback_url TEXT,
  supports_cod INTEGER DEFAULT 1,
  supports_prepaid INTEGER DEFAULT 1,
  supports_tracking INTEGER DEFAULT 1,
  supports_pickup INTEGER DEFAULT 1,
  api_docs_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS store_shipping_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  shipping_company_id INTEGER NOT NULL,
  is_enabled INTEGER DEFAULT 1,
  cod_fee INTEGER DEFAULT 0,
  free_shipping_min INTEGER DEFAULT 0,
  default_weight REAL DEFAULT 0.5,
  default_dimensions TEXT, -- JSON: {length, width, height}
  api_credentials TEXT, -- JSON encrypted
  settings TEXT, -- JSON for company-specific settings
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(store_id, shipping_company_id)
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  shipping_company_id INTEGER NOT NULL,
  tracking_number TEXT,
  shipping_company_order_id TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'pickup_scheduled', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled'
  cod_amount INTEGER DEFAULT 0,
  shipping_fee INTEGER DEFAULT 0,
  weight REAL,
  dimensions TEXT, -- JSON
  pickup_address TEXT,
  delivery_address TEXT,
  customer_phone TEXT,
  customer_name TEXT,
  notes TEXT,
  pickup_scheduled_at TEXT,
  picked_up_at TEXT,
  delivered_at TEXT,
  returned_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS shipment_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  location TEXT,
  description TEXT,
  timestamp TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  vehicle_type TEXT, -- 'motorcycle', 'car', 'van'
  vehicle_plate TEXT,
  license_number TEXT,
  is_active INTEGER DEFAULT 1,
  commission_type TEXT DEFAULT 'per_order', -- 'per_order', 'percentage', 'fixed_monthly'
  commission_value REAL DEFAULT 0,
  current_lat REAL,
  current_lng REAL,
  last_location_update TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS driver_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  assigned_at TEXT DEFAULT (datetime('now','localtime')),
  accepted_at TEXT,
  picked_up_at TEXT,
  delivered_at TEXT,
  status TEXT DEFAULT 'assigned', -- 'assigned', 'accepted', 'picked_up', 'delivered', 'returned', 'cancelled'
  notes TEXT
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS driver_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  total_orders INTEGER DEFAULT 0,
  total_commission REAL DEFAULT 0,
  total_cod_collected INTEGER DEFAULT 0,
  advances_paid INTEGER DEFAULT 0,
  net_payable REAL DEFAULT 0,
  status TEXT DEFAULT 'pending', -- 'pending', 'paid', 'disputed'
  paid_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS returns_exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'return', 'exchange'
  reason TEXT NOT NULL, -- 'damaged', 'wrong_item', 'size_issue', 'changed_mind', 'defective', 'other'
  reason_details TEXT,
  status TEXT DEFAULT 'requested', -- 'requested', 'approved', 'rejected', 'pickup_scheduled', 'picked_up', 'received', 'inspected', 'refunded', 'exchanged', 'rejected_by_customer', 'completed', 'cancelled'
  refund_amount INTEGER DEFAULT 0,
  exchange_product_id INTEGER,
  exchange_quantity INTEGER DEFAULT 1,
  pickup_address TEXT,
  pickup_scheduled_at TEXT,
  picked_up_at TEXT,
  received_at TEXT,
  inspected_at TEXT,
  inspected_by INTEGER,
  inspection_notes TEXT,
  refund_method TEXT, -- 'original', 'wallet', 'bank_transfer', 'points'
  refunded_at TEXT,
  exchange_shipment_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL, -- 'BAG', 'BSR', 'main'
  address TEXT,
  city TEXT,
  manager_name TEXT,
  manager_phone TEXT,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS product_warehouse_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved_quantity INTEGER DEFAULT 0,
  min_threshold INTEGER DEFAULT 5,
  max_threshold INTEGER DEFAULT 1000,
  last_restocked_at TEXT,
  UNIQUE(product_id, warehouse_id)
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS cash_flow_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'income', 'expense'
  category TEXT NOT NULL, -- 'order_revenue', 'cod_collected', 'shipping_paid', 'driver_paid', 'platform_fee', 'marketing', 'refund', 'driver_advance', 'driver_settlement', 'shipping_settlement', 'other'
  amount INTEGER NOT NULL,
  reference_type TEXT, -- 'order', 'shipment', 'driver', 'driver_settlement', 'shipping_settlement', 'manual'
  reference_id INTEGER,
  description TEXT,
  status TEXT DEFAULT 'completed', -- 'pending', 'completed', 'cancelled'
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS shipping_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  shipping_company_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  total_orders INTEGER DEFAULT 0,
  total_cod_amount INTEGER DEFAULT 0,
  total_shipping_fees INTEGER DEFAULT 0,
  platform_commission INTEGER DEFAULT 0,
  net_receivable INTEGER DEFAULT 0, -- ما تستحقه المنصة من شركة التوصيل
  received_amount INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', -- 'pending', 'partial', 'received', 'disputed'
  received_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  subject TEXT NOT NULL,
  category TEXT NOT NULL, -- 'order', 'payment', 'shipping', 'return', 'technical', 'billing', 'other'
  priority TEXT DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
  status TEXT DEFAULT 'open', -- 'open', 'in_progress', 'waiting_customer', 'resolved', 'closed'
  assigned_to INTEGER, -- admin user id
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  resolved_at TEXT
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  sender_type TEXT NOT NULL, -- 'customer', 'admin', 'system'
  sender_id INTEGER, -- user id or admin id
  message TEXT NOT NULL,
  attachments TEXT, -- JSON array of file paths
  is_internal INTEGER DEFAULT 0, -- internal note vs customer visible
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS instagram_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  instagram_username TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  total_posts INTEGER DEFAULT 0,
  imported_products INTEGER DEFAULT 0,
  failed_products INTEGER DEFAULT 0,
  error_log TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  completed_at TEXT
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS whatsapp_catalogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'draft', -- 'draft', 'generated', 'sent'
  product_count INTEGER DEFAULT 0,
  file_path TEXT, -- PDF/WhatsApp catalog file
  sent_to TEXT, -- phone numbers JSON
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS sms_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL, -- 'order_confirmation', 'shipping_update', 'delivery_otp', 'payment_reminder', 'promotional', 'abandoned_cart', 'review_request', 'custom'
  status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'delivered'
  provider TEXT, -- 'iraq_tel', 'asiacell', 'korek', 'zain', 'twilio', 'custom'
  provider_message_id TEXT,
  error_message TEXT,
  cost INTEGER DEFAULT 0,
  sent_at TEXT,
  delivered_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS kurdish_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE, -- 'home.welcome', 'product.add_to_cart'
  arabic TEXT NOT NULL,
  kurdish_sorani TEXT,
  kurdish_kurmanji TEXT,
  context TEXT,
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

try { db.exec(`
CREATE INDEX IF NOT EXISTS idx_shipments_store ON shipments(store_id);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_driver ON shipments(driver_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipment_tracking(shipment_id);
CREATE INDEX IF NOT EXISTS idx_drivers_store ON drivers(store_id);
CREATE INDEX IF NOT EXISTS idx_driver_assignments_driver ON driver_assignments(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_assignments_shipment ON driver_assignments(shipment_id);
CREATE INDEX IF NOT EXISTS idx_returns_store ON returns_exchanges(store_id);
CREATE INDEX IF NOT EXISTS idx_returns_order ON returns_exchanges(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns_exchanges(status);
CREATE INDEX IF NOT EXISTS idx_warehouses_store ON warehouses(store_id);
CREATE INDEX IF NOT EXISTS idx_product_warehouse ON product_warehouse_stock(product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_store ON cash_flow_entries(store_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_type ON cash_flow_entries(type);
CREATE INDEX IF NOT EXISTS idx_cash_flow_category ON cash_flow_entries(category);
CREATE INDEX IF NOT EXISTS idx_shipping_settlements_store ON shipping_settlements(store_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_store ON support_tickets(store_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_store ON sms_logs(store_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone ON sms_logs(phone);
`); } catch (e) {}

try { db.exec(`
CREATE TABLE IF NOT EXISTS zaincash_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  transaction_id TEXT,
  amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'paid', 'failed', 'cancelled', 'refunded'
  zaincash_transaction_id TEXT,
  zaincash_order_id TEXT,
  response_code TEXT,
  response_message TEXT,
  paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`); } catch (e) {}

function logActivity(userId, username, action, details = '') {
  db.prepare('INSERT INTO activity (user_id, username, action, details) VALUES (?,?,?,?)')
    .run(userId, username, action, details);
}

function siteSettings() {
  const map = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) map[row.key] = row.value;
  return {
    site_name: map.site_name || 'دُكّان Dukkan',
    site_whatsapp: map.site_whatsapp || '9647831020026',
    pay_account: map.pay_account || '',
    free_products: Number(map.free_products || 10),
    pro_price: Number(map.pro_price || 12000),
    pro_price_3: Number(map.pro_price_3 || 30000),
    pro_price_12: Number(map.pro_price_12 || 72000),
    tagline: map.tagline || 'أنشئ متجرك الإلكتروني خلال دقائق وابدأ البيع فوراً',
    site_telegram: map.site_telegram || '@s018d',
    site_instagram: map.site_instagram || '@s018d',
    site_tiktok: map.site_tiktok || '@s018a',
    trial_days: Number(map.trial_days || 7),
    telegram_bot_token: map.telegram_bot_token || '',
    telegram_admin_chat_id: map.telegram_admin_chat_id || '',
    zaincash_merchant_id: map.zaincash_merchant_id || '',
    zaincash_service_type: map.zaincash_service_type || '',
    zaincash_password: map.zaincash_password || '',
    zaincash_callback_url: map.zaincash_callback_url || '',
    zaincash_mode: map.zaincash_mode || 'sandbox',
    ...map
  };
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(String(key), String(value));
}

function isPro(store) {
  if (!store || store.plan !== 'pro') return false;
  if (!store.plan_expires) return false;
  return new Date(store.plan_expires) > new Date();
}

module.exports = { db, logActivity, siteSettings, setSetting, isPro, UPLOADS_DIR, DB_FILE };
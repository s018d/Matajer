/* متجر الديمو — يعرض المنصة بعين التاجر والزبون. آمن: يتخطى إذا موجود. التشغيل: node seed_demo.js */
const { db } = require('./db');
const { hashPassword } = require('./util');

const SLUG = 'demo';
if (db.prepare('SELECT id FROM stores WHERE slug=?').get(SLUG)) {
  console.log('Demo store already exists — /s/demo');
  process.exit(0);
}

const info = db.prepare(`INSERT INTO stores (name, slug, description, owner_name, phone, template, color, plan, plan_expires, whatsapp)
  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
  'سوق الديمو 🛍️', SLUG, 'متجر عرض حي — جرّب السلة والكوبون والتقييم بنفسك! الدفع عند الاستلام.',
  'فريق دُكّان', '07700000000', 'black-gold', '#C9A96E', 'pro', '2028-01-01', '9647831020026'
);
const sid = info.lastInsertRowid;
db.prepare(`INSERT INTO users (username, password_hash, role, store_id) VALUES (?,?,?,?)`)
  .run('demo_owner', hashPassword('Demo1234'), 'owner', sid);
const cat = db.prepare('INSERT INTO categories (store_id, name, position) VALUES (?,?,?)').run(sid, 'الأكثر مبيعاً', 1).lastInsertRowid;

const products = [
  ['عطر فاخر — عود ملكي', 'عطر شرقي فاخر بثبات عالٍ يدوم طوال اليوم', 45000, 60000, '/img/sample/perfume.svg', 12],
  ['سماعات بلوتوث برو', 'صوت نقي + عزل ضوضاء + بطارية 30 ساعة', 65000, 85000, '/img/sample/headphones.svg', 8],
  ['ساعة يد كلاسيك', 'تصميم أنيق ضد الماء — هدية مثالية', 55000, 0, '/img/sample/watch.svg', 5],
  ['حذاء رياضي إير', 'خفيف ومريح للمشي اليومي والرياضة', 75000, 95000, '/img/sample/shoes.svg', 3],
  ['حقيبة جلد طبيعي', 'جلد فاخر بخياطة يدوية — تتسع للابتوب', 85000, 0, '/img/sample/bag.svg', 6],
  ['مصباح مكتب ذكي', 'إضاءة دافئة قابلة للتعديل + شحن لاسلكي', 35000, 45000, '/img/sample/lamp.svg', 15],
  ['موبايل — أحدث إصدار', 'شاشة كبيرة + كاميرا احترافية + بطارية عملاقة', 450000, 0, '/img/sample/phone.svg', 4],
  ['بكج مكياج متكامل', 'كل أساسيات المكياج اليومي بعلبة واحدة', 28000, 35000, '/img/sample/makeup.svg', 20],
];
for (const [name, desc, price, old, img, stock] of products) {
  const p = db.prepare(`INSERT INTO products (store_id, category_id, name, description, price, old_price, stock, active)
    VALUES (?,?,?,?,?,?,?,1)`).run(sid, cat, name, desc, price, old || null, stock).lastInsertRowid;
  db.prepare('INSERT INTO product_images (product_id, path, position) VALUES (?,?,0)').run(p, img);
}
db.prepare(`INSERT INTO coupons (store_id, code, type, value, min_total, max_uses, used, active) VALUES (?,?,?,?,?,?,?,1)`)
  .run(sid, 'WELCOME10', 'percent', 10, 20000, 100, 0);
console.log('Demo ready: /s/demo — owner demo_owner / Demo1234 — coupon WELCOME10');

const { db, logActivity } = require('./db');
const { hashPassword, genSlug, appendLog } = require('./util');

const S = '/img/sample';

const SAMPLES = [
  {
    name: 'عود وعطور بغداد',
    slug: 'baghdadscents',
    desc: 'أفخر العطور الشرقية والغربية — توصيل سريع لجميع المحافظات',
    owner: 'baghdadscents', password: 'Scents2026!',
    cat: ['عود', 'عطور نسائية', 'عطور رجالية'],
    imgs: ['perfume.svg', 'perfume.svg', 'perfume.svg', 'perfume.svg', 'perfume.svg', 'perfume.svg', 'perfume.svg', 'perfume.svg'],
    items: [
      ['عود ملكي فاخر 12 مل', 45000, 60000, 0],
      ['مسك أبيض خالص 25 مل', 32000, 40000, 0],
      ['عطر ورد بغداد 100 مل', 55000, 0, 1],
      ['عطر رجالي عودي 100 مل', 60000, 75000, 2],
      ['دهن عود كمبودي 6 مل', 180000, 220000, 0],
      ['معطر جسم ورد 250 مل', 18000, 24000, 1],
      ['عطر فرنسي أو دو بارفان', 72000, 90000, 1],
      ['بخور عود فاخر 40 غرام', 28000, 0, 0]
    ]
  },
  {
    name: 'تك هب للأجهزة',
    slug: 'techhub',
    desc: 'جوالات وسمااعات وإكسسوارات أصلية بضمان — أثمان منافسة',
    owner: 'techhub', password: 'TechHub#2026',
    cat: ['جوالات', 'سماعات', 'شواحن'],
    imgs: ['phone.svg', 'headphones.svg', 'lamp.svg', 'phone.svg', 'headphones.svg', 'phone.svg', 'lamp.svg', 'phone.svg', 'watch.svg'],
    items: [
      ['جوال برو 5G 256GB', 750000, 850000, 0],
      ['سماعة لاسلكية ANC', 65000, 85000, 1],
      ['شاحن سريع 65 واط', 35000, 45000, 2],
      ['باور بانك 20000mAh', 40000, 0, 2],
      ['سماعة أذن رياضية', 45000, 60000, 1],
      ['كيبورد مضيء ميكانيكي', 55000, 0, 2],
      ['ماوس لاسلكي على شكل عروة', 22000, 30000, 2],
      ['جوال أساسي 128GB', 320000, 0, 0],
      ['ساعة آبل البديلة الذكية', 95000, 130000, 0]
    ]
  },
  {
    name: 'ساعة وستايل',
    slug: 'watchstyle',
    desc: 'ساعات يد أنيقة رجالية ونسائية بأسعار مميزة',
    owner: 'watchstyle', password: 'Style#2026x',
    cat: ['رجالية', 'نسائية'],
    imgs: ['watch.svg', 'watch.svg', 'watch.svg', 'watch.svg', 'watch.svg', 'watch.svg'],
    items: [
      ['ساعة رياضية سوار معدني', 75000, 95000, 0],
      ['ساعة كلاسيكية جلدية', 55000, 0, 0],
      ['ساعة نسائية مرصعة', 85000, 110000, 1],
      ['ساعة محيط فاخرة', 120000, 0, 0],
      ['ساعة عصرية رفيعة', 65000, 80000, 1],
      ['ساعة مزدوجة الأوجه', 90000, 0, 0]
    ]
  },
  {
    name: 'شنط وحقائب',
    slug: 'luxbags',
    desc: 'حقائب جلدية فاخرة — صناعة يدوية متينة',
    owner: 'luxbags', password: 'BagsLux#26',
    cat: ['نسائية', 'رجالية', 'سفر'],
    imgs: ['bag.svg', 'bag.svg', 'bag.svg', 'bag.svg', 'bag.svg', 'bag.svg'],
    items: [
      ['حقيبة سهرة ذهبية', 60000, 80000, 0],
      ['حقيبة يد جلدية كبيرة', 85000, 0, 0],
      ['محفظة رجالية جلد طبيعي', 35000, 45000, 1],
      ['حقيبة ظهر محمولة', 50000, 0, 2],
      ['حقيبة سفر صغيرة 2 عجلات', 140000, 180000, 2],
      ['شنطة أدوات تجميل', 30000, 0, 0]
    ]
  },
  {
    name: 'جولدن كير',
    slug: 'goldencare',
    desc: 'مستحضرات عناية وتجميل أصلية — شحن لجميع المحافظات',
    owner: 'goldencare', password: 'Golden#2026',
    cat: ['مكياج', 'عناية'],
    imgs: ['makeup.svg', 'makeup.svg', 'makeup.svg', 'makeup.svg', 'makeup.svg', 'makeup.svg', 'makeup.svg'],
    items: [
      ['باليت أحمر شفاه 12 لون', 45000, 55000, 0],
      ['ماسكرا مقاومة للماء', 25000, 32000, 0],
      ['كريم تفتيح آمن 50 مل', 35000, 0, 1],
      ['زيت أرغان 100 مل', 30000, 40000, 1],
      ['فرش مكياج 10 قطع', 20000, 0, 0],
      ['سيروم فيتامين سي', 42000, 52000, 1],
      ['مجموعة عناية كاملة', 95000, 125000, 1]
    ]
  }
];

function seedSamples() {
  if (process.env.DISABLE_SAMPLES === '1') return;
  if (db.prepare('SELECT COUNT(*) c FROM stores').get().c > 0) return;
  let orderNo = 1;
  for (const s of SAMPLES) {
    const info = db.prepare('INSERT INTO stores (name, slug, description, owner_name, phone, template, color, plan) VALUES (?,?,?,?,?,?,?,?)')
      .run(s.name, s.slug || genSlug(s.name), s.desc, s.owner, '', 'classic', '#0ea5e9', 'free');
    db.prepare('INSERT INTO users (username, password_hash, role, store_id) VALUES (?,?,?,?)')
      .run(s.owner, hashPassword(s.password), 'owner', info.lastInsertRowid);
    const catIds = s.cat.map(name => {
      const r = db.prepare('INSERT INTO categories (store_id, name, position) VALUES (?,?,?)').run(info.lastInsertRowid, name, 0);
      return r.lastInsertRowid;
    });
    s.items.forEach((it, i) => {
      const [name, price, old, cidx] = it;
      const p = db.prepare('INSERT INTO products (store_id, category_id, name, description, price, old_price, active) VALUES (?,?,?,?,?,?,1)')
        .run(info.lastInsertRowid, catIds[cidx], name, 'منتج مميز — اطلبه الآن والتوصيل سريع', price, old || null);
      db.prepare('INSERT INTO product_images (product_id, path, position) VALUES (?,?,?)')
        .run(p.lastInsertRowid, S + '/' + s.imgs[i % s.imgs.length], 0);
    });
    if (s.name === 'جولدن كير') {
      const o1 = db.prepare('INSERT INTO orders (store_id, customer_name, customer_phone, customer_address, note, subtotal, total, status) VALUES (?,?,?,?,?,?,?,?)')
        .run(info.lastInsertRowid, 'زينب علي', '07712345678', 'بغداد - الكرادة', 'الدفع عند الاستلام', 70000, 70000, 'completed');
      db.prepare('INSERT INTO order_items (order_id, product_name, product_price, qty) VALUES (?,?,?,?)').run(o1.lastInsertRowid, 'باليت أحمر شفاه 12 لون', 45000, 1);
      db.prepare('INSERT INTO order_items (order_id, product_name, product_price, qty) VALUES (?,?,?,?)').run(o1.lastInsertRowid, 'ماسكرا مقاومة للماء', 25000, 1);
      const o2 = db.prepare('INSERT INTO orders (store_id, customer_name, customer_phone, customer_address, note, subtotal, total, status) VALUES (?,?,?,?,?,?,?,?)')
        .run(info.lastInsertRowid, 'حسن محمد', '07801234567', 'البصرة', '', 95000, 95000, 'completed');
      db.prepare('INSERT INTO order_items (order_id, product_name, product_price, qty) VALUES (?,?,?,?)').run(o2.lastInsertRowid, 'مجموعة عناية كاملة', 95000, 1);
      orderNo += 2;
    }
    console.log('SEEDED', s.name);
  }
  appendLog('**تم إنشاء متاجر العينات الحية (5 متاجر بمنتجات حقيقية)** — «عود وعطور بغداد» / «تك هب للأجهزة» / «ساعة وستايل» / «شنط وحقائب» / «جولدن كير» (لأخير فيه طلبان مكتملان تجريبيان أحدهما 70 ألف والآخر 95 ألف لإظهار أثر اللوحة) — حسابات التجربة كلها على الباقة المجانية وموثقة بملفات الإعداد.');
  console.log('══════════════════════════════════════');
  console.log('  متاجر العينات جاهزة — 5 متاجر × 6-9 منتجات');
  console.log('  سجلات الدخول التجريبية مسجلة في log.md');
  console.log('══════════════════════════════════════');
}

const SAMPLE_IMG = ['perfume.svg', 'phone.svg', 'headphones.svg', 'watch.svg', 'bag.svg', 'shoes.svg', 'lamp.svg', 'makeup.svg'];
const SAMPLE_DEMO_CREDENTIALS = SAMPLES.map(s => `${s.name} → ${s.owner} / ${s.password}`);

module.exports = { seedSamples };
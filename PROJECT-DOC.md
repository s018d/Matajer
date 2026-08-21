# دُكّان Dukkan — الوثيقة الكاملة للمشروع

> وثيقة مرجعية شاملة تُعطى لأي AI (أو مطوّر) ليحلّل المشروع ويقترح تحسينات.
> آخر تحديث: 2026-08-15 (بعد جولة التحسينات العاشرة — راجع §12.1)

---

## 1. نظرة عامة

**دُكّان** منصة عراقية 100% بالعربي لإنشاء متاجر إلكترونية جاهزة (SaaS متعدد المستأجرين):
- أي شخص يسجل → ينطلق متجره فوراً برابط خاص `/s/slug` بلا خبرة تقنية وبلا دومين.
- الباقة المجانية: 10 منتجات، تصميم واحد، حتى 5 أكواد خصم، علامة «صُنع بواسطة دُكّان».
- الباقة الاحترافية: منتجات وأكواد بلا حدود، 8 أنماط عالمية، مخزون وخيارات وإضافات، دومين خاص، بلا علامة.
- الدفع بين التاجر والزبون: **دفع عند الاستلام** (لا بوابات دفع).
- ترقية المتاجر للاحترافية: يدوي عبر طلب + تأكيد المدير العام (زين كاش/على اليد).
- نظام إحالات: الداعي يكسب شهراً مجانياً عند أول ترقية للمدعو.

**الهوية:** موقع تسويقي (landing) + لوحة صاحب متجر + لوحة مدير عام + متاجر عامة للزبائن.

---

## 2. البنية التقنية

| | |
|---|---|
| اللغة | Node.js (JavaScript) |
| الإطار | Express 4 |
| قاعدة البيانات | SQLite عبر `node:sqlite` (DatabaseSync) + WAL |
| القوالب | EJS |
| التشفير | bcryptjs |
| رفع الملفات | multer (صور فقط، حد 12MB) |
| ضغط الصور | sharp (تصغير + مصغّرات `_t` بعرض 400) |
| النسخ الاحتياطي | adm-zip (DB + uploads) + **جدولة تلقائية يومية** |
| لا يوجد | أي إطار أمامي — JS نقي (vanilla) + localStorage للسلة |
| التشغيل | `node server.js` على port 3000 (start.bat) |

### الملفات الرئيسية
```
server.js      — إعداد Express، وسائط أمان (CSRF/دومين)، التوجيه
db.js          — قاعدة البيانات، كل الجداول، siteSettings/isPro/logActivity
util.js        — جلسات، كلمات مرور، قفل دخول، كابتشا، حدود IP، money(), log.md
seed.js        — 5 متاجر عينات عند أول تشغيل + طلبان تجريبيان
templates.js   — تعريف الأنماط (1 مجاني + 8 احترافية)
routes/auth.js — /login /logout
routes/site.js — الصفحة الرئيسية، تسجيل، FAQ/شروط/خصوصية، sitemap/robots
routes/panel.js— لوحة صاحب المتجر (كلها)
routes/admin.js— لوحة المدير العام (كلها)
routes/store.js— متاجر الزبائن: /s/:slug، صفحة منتج، إتمام الطلب، فحص كوبون
views/...      — قوالب EJS (landing, panel/*, admin/*, store/*, partials/*)
public/        — CSS (site/app/store/prem-*) + JS (cart.js, notify.js) + صور
data/matajer.db — قاعدة البيانات
uploads/store_N/ — صور المتاجر المرفوعة
log.md         — سجل تفصيلي لكل الأحداث (بديل المونيتور)
backups/       — نسخ احتياطية ZIP
```

### ترتيب الوسائط في server.js
1. urlencoded + json + static.
2. **CSRF double-submit**: كوكي `_csrf` HttpOnly + حقل `_csrf` في كل نموذج؛ يُرفض أي POST بلا تطابق (403).
3. توجيه الدومين المخصص: `custom_domain` → `/s/slug`.
4. Auth → Admin → Panel → Site → Store → 404.

---

## 3. قاعدة البيانات (data/matajer.db)

| الجدول | الحقول المهمة |
|---|---|
| users | username, password_hash (bcrypt), role (`superadmin`/`owner`), store_id |
| stores | name, slug (فريد), description, owner_name, phone, logo_path, template, color, status (active/suspended), plan (free/pro), plan_expires, **whatsapp, custom_domain, delivery_fee, free_delivery_min, meta_desc** (أُضيفت بـ ALTER) |
| categories | store_id, name, position |
| products | store_id, category_id, name, description, price, old_price, views, active, **stock, options (JSON كائن), addons (JSON مصفوفة)** |
| product_images | product_id, path, position (0 = الرئيسية) |
| orders | store_id, customer_name, customer_phone, customer_address, note, subtotal, discount, coupon_code, delivery_fee, total, status (new/confirmed/completed/cancelled), created_at |
| order_items | order_id, product_name, product_price, qty, options, addons_price |
| sessions | token (sha256), user_id, expires_at |
| activity | سجل أفعال (بديل للمراجعة) |
| settings | key/value — إعدادات المنصة (أسعار، واتساب، شعار، **trial_days**) |
| payments | store_id, plan, amount, months, status (pending/done/reported), **ref (مثل DKR-XXXXXX), note (رقم التحويل), receipt_path (صورة الإثبات)** |
| referrals | referrer_store_id, new_store_id, status (pending/done) |
| coupons | store_id, code (فريد لكل متجر), type (percent/amount), value, min_total, max_uses, used, active, expires |

**هوامش فنية:**
- الأسعار REAL، التواريخ نصية ISO.
- `isPro(store)`: plan=pro وغير منتهية الصلاحية.
- WAL mode + `foreign_keys = ON`.
- `ALTER TABLE ... ADD COLUMN` ملفوفة بـ try/catch للترقيات الآمنة.

---

## 4. المسارات (Routes)

### عام (site.js)
| المسار | الوصف |
|---|---|
| `/` | Landing: مميزات، 9 تصاميم، متاجر حية، باقات، FAQ، فوتر بدعم |
| `/signup` GET/POST | تسجيل ذاتي: اسم متجر + مستخدم + كلمة مرور (8+ حرف مع رقم وحرف) + **كابتشا حسابية** + **حقل honeybot** + حد 5/IP/ساعة + دعم `?ref=slug` للإحالات + **تجربة برو 7 أيام تلقائياً** (المدة من trial_days) |
| `/faq` `/privacy` `/terms` | صفحات ثابتة نصية (أسعار وأرقام حقيقية من settings) |
| `/sitemap.xml` `/robots.txt` | SEO |
| `/login` `/logout` (auth.js) | دخول مع **قفل بعد 5 محاولات خاطئة (15 دقيقة)** + حد 20/IP/10د |

### لوحة صاحب المتجر (panel.js — يتطلب `requireOwner`)
| المسار | الوصف |
|---|---|
| `/panel` | إحصائيات (منتجات/طلبات/جدد/إيرادات/مشاهدات) + رسم بياني 7 أيام + آخر الطلبات |
| `/panel/products` + `/new` + `/:id/edit` | قائمة/إضافة/تعديل (سعر، خصم، قسم، مفعل، **مخزون، خيارات JSON، إضافات JSON**) |
| `/panel/products/:id/images` | رفع حتى 20 صورة، **ضغط تلقائي (sharp: تصغير + مصغرة)**، تعيين رئيسية، حذف |
| `/panel/products/:id/toggle` `/delete` | إظهار/إخفاء، حذف مع الصور والملفات (بما فيها المصغرات) |
| `/panel/categories` | إضافة/حذف أقسام |
| `/panel/orders` + `/:id/status` | طلبات مع فلاتر (new/confirmed/completed/cancelled)، تفاصيل منتجات/خيارات، إجماليات، **زر واتساب الزبون**، تغيير الحالة — **ترقيم صفحات (50/صفحة)** |
| `/panel/api/neworders` | فحص دوري للطلبات الجديدة (يشغل notify.js + صوت) |
| `/panel/coupons` + POST + toggle + delete | أكواد خصم (حد 5 للمجاني، نسبة/مبلغ، حد أدنى، استخدامات، انتهاء) |
| `/panel/templates` + `/preview/:id` + `/templates/apply` | معرض 9 أنماط + **معاينة حية** بمنتجات تجريبية + اعتماد (الاحترافي يتطلب برو) |
| `/panel/settings` + POST | الاسم/الوصف/الواتساب/القالب/اللون/الدومين/رسوم التوصيل/توصيل مجاني/ميتا وصف |
| `/panel/settings/logo` | رفع شعار (يستبدل القديم + ضغط بمصغرة) |
| `/panel/password` | تغيير كلمة المرور (8+ مع رقم وحرف) |
| `/panel/billing` + `/billing/request` | باقات: 1/3/12 شهر (12000/30000/72000)، طلب ترقية مع **رقم التحويل + رفع صورة الإثبات** → payments reported |

### لوحة المدير العام (admin.js — يتطلب `requireAdmin`)
| المسار | الوصف |
|---|---|
| `/admin` | 9 بطاقات إحصائيات + أفضل المتاجر + آخر الطلبات + آخر النشاطات |
| `/admin/stores` + POST | قائمة بكل المتاجر وإحصائياتها + إنشاء متجر يدوي |
| `/admin/stores/:id` + POST | تعديل شامل (قالب/باقة/حالة/دومين/توصيل/ميتا) |
| `/admin/stores/:id/resetpass` | تصفير كلمة مرور صاحب المتجر |
| `/admin/stores/:id/delete` | حذف نهائي مع الصور |
| `/admin/activity` | سجل الأفعال |
| `/admin/backup` | نسخة ZIP كاملة (DB + uploads) تُنزَّل وتُحفظ في backups/ — + **نسخ تلقائي يومي 3 فجراً** |
| `/admin/payments` + `/payments/:id/confirm` | تأكيد دفعات الترقية (يُفعّل 30 يوم × months) + **مكافأة الإحالة شهر مجاني للداعي** + عرض **المرجع وصورة الإثبات** |
| `/admin/stores/:id/plan` | تحويل يدوي free/pro |
| `/admin/site` + POST | إعدادات المنصة: الاسم، الواتساب، جهة الدفع، عدد منتجات المجاني، 3 أسعار، **أيام التجربة (trial_days)** |
| `/admin/password` | تغيير كلمة مرور المدير |

### متاجر الزبائن (store.js)
| المسار | الوصف |
|---|---|
| `/s/:slug` | واجهة المتجر: أقسام، بحث، منتجات (active فقط) — القالب حسب الباقة |
| `/s/:slug/p/:id` | صفحة منتج: معرض صور، خيارات، إضافات، كمية، مخزون/نفد، منتجات مشابهة، **يزيد views** |
| `/s/:slug/checkout` GET | صفحة إتمام الطلب (سلة من localStorage) |
| `/s/:slug/checkout` POST | تحقق من السلة والأسعار من DB (لا يثق بالعميل)، تطبيق كوبون، حساب التوصيل، إنقاص المخزون، حفظ الطلب |
| `/s/:slug/coupon-check` | فحص كوبون لحظي (JSON) — **محدود 30/دقيقة/IP** |
| `/s/:slug/manifest.json` | PWA manifest لكل متجر (اسم، لون، أيقونة) |

**الأمان في إتمام الطلب:** تُعاد قراءة الأسعار من قاعدة البيانات، كمية 1-99، تحقق مخزون، كوبون يُتحقق منه (استنفاد/انتهاء/حد أدنى)، ويُرفض أي طلب بلا منتجات صالحة.

---

## 5. نظام الأنماط (التصاميم)

- **مجاني:** `classic` (الكلاسيكي النظيف) — CSS variables عبر `cssVars(tpl, store.color)`.
- **احترافي ×8:** prem-minimal (أبل مينيمال)، prem-luxe (الذهب الأسود)، prem-glass (الزجاجي)، prem-brut (النيو بروتالي)، prem-boutique (البوتيك)، prem-tech (التقني)، prem-retro (الرجعي)، prem-festive (الاحتفالي) — كل واحد ملف CSS مستقل `/css/prem-*.css`.
- **PWA:** كل متجر قابل للتثبيت (manifest + service worker `/sw.js` للكاش) — يُفعّل تلقائياً على صفحات المتجر.
- المتجر غير البرو مع قالب احترافي → يُعرض بالقوالب القديمة (legacy: modern/dark/market/neo تُعامل كـ classic).
- المعاينة الحية `/panel/preview/:id` بمنتجات تجريبية.
- متاجر الزبائن تشترك كلها في `store.css` + `store-gen.css` + ملفات CSS الخاصة بكل نمط تُحمّل حسب القالب.

---

## 6. سلة الشراء (cart.js)

- localStorage بمفتاح لكل متجر (`mc_<slug>`).
- عنصر سلة: id + اسم + سعر + صورة + كمية + خيارات (نص) + إضافات (مصفوفة باسم/سعر) + addonsTotal.
- دمج نفس المنتج إذا تطابقت الخيارات (optsKey).
- صفحة Checkout: تعرض المجموع، الخصم، التوصيل، وتقدم شريط «أضف X للتوصيل المجاني».
- الكوبون يُطبَّق عميلياً بعد فحص الخادم، ويُرسل الرمز مع الطلب لتأكيد الخادم وحساب الخصم الفعلي.

---

## 7. الباقات والإحالات

- **مجاني:** 10 منتجات (قابل للتغيير من /admin/site)، 5 أكواد خصم، قالب classic، علامة «صُنع بواسطة دُكّان».
- **برو:** كلشي + 8 أنماط + دومين خاص + بلا علامة. يُفعَّل فقط عبر:
  - طلب `/panel/billing/request` (مع رقم تحويل + صورة إثبات) → `payments.reported` → تأكيد المدير (يدوي) → 30 يوم × months.
  - أو تحويل يدوي من `/admin/stores/:id/plan`.
- **التجربة:** أي متجر جديد يحصل **برو 7 أيام تلقائياً** (المدة قابلة للتغيير من /admin/site → trial_days)، وتظهر الباقي وحالة الانتهاء في أعلى اللوحة.
- **الإحالة:** رابط `/signup?ref=slug` → `referrals.pending` → عند أول ترقية للمدعو، الداعي يكسب +30 يوماً (يُضاف لنهاية باقته الحالية إن كان برو).
- انتهاء الباقة: يبقى المتجر وبياناته، القالب الاحترافي يُعطل تلقائياً (tplFor يُعيد null).

---

## 8. الأمان المطبق

- CSRF double-submit على كل POST (403) — **نماذج رفع الملفات (multipart) ترسل التوكن في الرابط `?_csrf=`** لأن req.body لا يُحلّ قبل الوسيط.
- bcrypt لكلمات المرور + جلسات بمواصفات قوية (sha256) + هاش للجلسات.
- قفل دخول (5 أخطاء → 15 دقيقة/IP) + حد تسجيل (5/ساعة/IP) + كابتشا حسابية + honeybot + **حد فحص الكوبونات (30/دقيقة/IP)**.
- تحقق من أنواع الملفات (صور فقط) + حد حجم 12MB + أسماء ملفات عشوائية.
- معالجة الدومين المخصص (منع localhost/IP/تعارض).
- Headers: nosniff, X-Frame-Options DENY, Referrer-Policy.
- قيود خطط (منتجات/كوبونات) وتطبيقها في الخادم لا الواجهة.
- إخفاء بيانات الطلب: الأسعار تُحسب من DB، كمية محدودة، مخزون.
- sanitize للخيارات والإضافات (حدود أطوال وعدد).

---

## 9. الحالة الحالية (Live Data)

**المتاجر (5 عينات):**
| المتجر | slug | القالب | الباقة |
|---|---|---|---|
| عود وعطور بغداد | baghdadscents | classic | free |
| تك هب للأجهزة | techhub | classic | free |
| ساعة وستايل | watchstyle | classic | free |
| شنط وحقائب | luxbags | classic | free |
| جولدن كير | goldencare | **prem-minimal** | **pro حتى 2027-08-15** |

**حسابات تجريبية:** baghdadscents/Scents2026! — techhub/TechHub#2026 — watchstyle/Style#2026x — luxbags/BagsLux#26 — goldencare/Golden#2026 (جرّب: كلمة مرور goldencare أُعيد توليدها أثناء اختبارات سابقة — آخر قيمة في C:\Users\s20\AppData\Local\Temp\opencode\gcpass.txt). حساب المدير: admin (كلمة المرور في log.md).

**إعدادات المنصة:** site_name=دُكّان Dukkan — واتساب 9647831020026 — تيليغرام/إنستغرام @s018d — تيك توك @s018a — مجاني=10 منتجات — أسعار 12000/30000/72000 — trial_days=7 — pay_account فارغ (لم يُحدد بعد!).

**البيانات:** 36 منتجاً، طلبان مكتملان تجريبيان (70k و 95k — subtotal مصحح مؤخراً)، كوبون اختبار TEST10 (10%، حد أدنى 10000) في goldencare، 40 سجلاً في activity.

---

## 10. ملاحظات ونقاط ضعف معروفة (واقعية)

1. **pay_account فارغ** — صفحة الباقات ستعرض جهة استلام فارغة حتى يُحدد في /admin/site.
2. لا توجد **بوابة دفع إلكترونية** (كل الدفع يدوي/عند الاستلام).
3. **لا يوجد إشعار تلقائي** للتاجر عند الطلب إلا صوت/فحص داخل اللوحة المفتوحة (لا واتساب/بوش خارجي).
4. ~~لا ضغط للصور~~ — **أُضيف ضغط sharp + مصغرات** ✅
5. ~~لا pagination~~ — **أُضيف ترقيم الطلبات (50/صفحة)** ✅
6. ~~نسخ يدوي فقط~~ — **أُضيف نسخ تلقائي يومي + WAL checkpoint** ✅
7. ~~لا إثبات تحويل~~ — **أُضيف رفع صورة الإثبات + رقم المرجع** ✅
8. لا اختبارات آلية مكتوبة (فقط سكربتات ad-hoc في Temp).
9. لا HTTPS (للتشغيل الفعلي على دومين يجب طبقة TLS — nginx/reverse proxy أو خدمة استضافة).
10. ~~WAL يكبر~~ — **checkpoint تلقائي مع النسخ اليومي** ✅
11. الـ landing تقول «9 تصاميم» — صحيح (classic + 8)؛ قوالب legacy لم تعد معروضة في القائمة.
12. لا إمكانية لصاحب المتجر بحذف متجره بنفسه (يُطلب واتساب) — مقصود لكنه فجوة.
13. لا systemd/خدمة Windows — تشغيل يدوي بـ start.bat.
14. صفحة المنتج تعرض «المتبقي: N» فقط عند stock محدد — لا تنبيه «كمية قليلة».
15. لا بحث في لوحة التحكم (المنتجات/الطلبات) — القوائم فقط.
16. حد فحص الكوبون 30/دقيقة/IP قد يزعج الزبائن على شبكات مشتركة (NAT).
17. PWA يعمل على localhost/HTTPS فقط (قيد المتصفحات).
18. مصغرات الصور تُنشأ عند الرفع — الصور القديمة (قبل التحديث) بلا مصغرة (thumb() تسقط لها للملف الأصلي).

---

## 11. أسئلة مفتوحة للنقاش (هنا دور الـ AI المقترح)

أعطِ الـ AI هذه الأسئلة ليحللها ويردّ بمقترحات مرتّبة بالأولوية، كل مقترح مع: ماذا ولماذا وكيف (ملفات/جداول) وتقدير الجهد:

1. ما أهم 5 ميزات نضيفها لرفع المبيعات الحقيقية للمتاجر (وليس الشكل فقط)؟
2. الدفع الإلكتروني العراقي (زين كاش API / FIB / أيون / كي كارد): أيها الأنسب لنطاقنا؟ أين تُدمج في التدفق الحالي؟
3. إشعار واتساب تلقائي للتاجر عند كل طلب (WhatsApp Business API vs wa.me فقط)؟
4. تحسينات للتاجر في اللوحة: ماذا ينقصها ليركّز على البيع؟
5. نظام مراجعات/تقييمات/أسئلة على المنتجات — هل يستحق الآن أم لاحقاً؟
6. التسريع والأداء: lazy-load صور، caching، compress — قائمة تطبيقية مرتبة.
7. ماذا نصحح أولاً من نقاط الضعف في القسم 10؟ (تُرتب من الأكثر ضرراً)
8. تحويل المتجر نفسه لـ PWA (تثبيت على الجوال + إشعارات)؟
9. التسويق والنمو: كيف نزيد التسجيلات؟ (إحالات محسنة، قسائم، محتوى، SEO...)
10. البنية: هل ننتقل لـ PostgreSQL/MySQL لاحقاً؟ متى يصبح ضرورياً؟ ما حدود SQLite الحالية؟
11. متجر تجريبي أوتوماتيكي عند التسجيل (بمنتجات جاهزة للاستكشاف) — تفصيل؟
12. أمان إضافي: rate limit على coupon-check، حماية uploads، سجلات، أي ثغرات محتملة في الكود الحالي؟
    > ✅ نُفّذت معظمها في جولة التحسينات (راجع §12.1) — تبقّى المراجعة الأمنية العميقة للكود.

---

## 12.1 سجل جولة التحسينات (2026-08-15)

| # | التحسين | الملفات |
|---|---|---|
| 1 | إثبات الدفع: رقم تحويل + رفع صورة + مرجع `DKR-XXXXXX` | db.js, routes/panel.js, views/panel/billing.ejs, views/admin/payments.ejs |
| 2 | تجربة برو 7 أيام عند التسجيل (قابلة للتعديل) | routes/site.js, routes/admin.js, views/admin/site.ejs, views/signup.ejs, db.js |
| 3 | شريط حالة الباقة في أعلى اللوحة (منتهية/نشطة + تاريخ) | views/partials/topbar.ejs |
| 4 | Rate limit فحص الكوبونات 30/دقيقة/IP | routes/store.js |
| 5 | نسخ احتياطي تلقائي يومي 3 فجراً + WAL checkpoint | routes/admin.js, server.js |
| 6 | عدادات حية (متاجر اليوم/طلبات) في landing | routes/site.js, views/landing.ejs |
| 7 | إزالة القوالب القديمة (legacy) من قائمة الإعدادات | views/panel/settings.ejs |
| 8 | PWA: manifest + service worker لكل متجر | routes/store.js, public/sw.js, views/partials/head.ejs, views/store/* |
| 9 | ضغط الصور بـ sharp + مصغرات `_t` | routes/panel.js, util.js, routes/store.js |
| 10 | ترقيم صفحات الطلبات (50/صفحة) | routes/panel.js, views/panel/orders.ejs |
| 11 | **إصلاح CSRF + multipart**: كل نماذج رفع الملفات كانت ترفض 403 دائماً — حلّها: التوكن في الرابط | server.js + 3 قوالب |

**ملاحظة التثبيت:** بعد هذه الجولة أُضيفت مكتبة `sharp` (npm) — لا تنسَ `npm install` عند النسخ لجهاز جديد.

---

## 12. كيف تشغّل وتختبر

```bash
cd C:\Users\s20\Desktop\Matajer
node server.js        # أو start.bat — يعمل على http://localhost:3000
```

- صفحة التسويق: `/` — تسجيل: `/signup` — دخول تاجر: `/login` (goldencare) — لوحة المدير: `/admin` (admin).
- متجر تجريبي: `/s/goldencare` — صفحة منتج: `/s/goldencare/p/:id` — معاينة قالب: داخل اللوحة `/panel/templates`.
- النسخة الاحتياطية: `/admin/backup`.
- السجل التفصيلي: `log.md` في جذر المشروع.

**ملاحظة:** لا تنسَ إدخال «جهة استلام الدفع» (pay_account) من `/admin/site` قبل فتح المنصة للجمهور.
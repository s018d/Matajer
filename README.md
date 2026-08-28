# دُكّان Dukkan — منصة متاجر عراقية
> أنشئ متجرك خلال دقيقة — بدون مبرمج، بدون دومين

**حالة:** v5.1 — جاهز للإطلاق التجريبي
**التشغيل:** `node server.js` → http://localhost:3000
**التقنية:** Node.js + Express 4 + SQLite (WAL) + EJS + sharp

## التشغيل السريع
```bash
npm install
node server.js
# أو start.bat (Windows)
```
- هبوط: `/` — تسجيل: `/signup` — دخول: `/login`
- تاجر: `/panel` — أدمن: `/admin` (admin / كلمة مرور في log.md أول تشغيل)
- متجر: `/s/slug`

## المميزات
- 4 قوالب (1 مجاني + 3 بريميوم ديناميكية — رفع CSS من /admin/templates)
- سلة + دفع عند الاستلام + كوبونات + مخزون + توصيل
- RBAC هرمي: superadmin/admin/billing/support/viewer في /admin/team
- إشعار تيليجرام، نسخ احتياطي يومي 3 فجراً، PWA

## الإعدادات
انسخ `.env.example` → `.env` وعدّل:
- `PORT`, `TRUST_PROXY`, `DISABLE_SAMPLES`, `DATABASE_URL` (للانتقال لـ PostgreSQL)

## الإدارة
- `/admin` — نظرة عامة + متاجر + مدفوعات + قوالب + فريق + إعدادات + سجل
- `/admin/site` — كل إعدادات المنصة مبوبة
- `/admin/stores/:id` — تحكم كامل بكل متجر (7 تبويبات)
- `/admin/templates` — رفع/تفعيل/حذف قوالب بدون كود

## التاجر
- `/panel` — إحصائيات + مشاركة + QR
- `/panel/products` — مخزون ملون + بحث
- `/panel/orders` — تصدير CSV + واتساب
- `/panel/settings` — مبوب (عام/تصميم/توصيل/دومين/شعار)

## النشر
- PM2: `ecosystem.config.js` — `pm2 start ecosystem.config.js`
- دومين: اربط CNAME → السيرفر، فعّل من /admin/stores/:id
- نسخ: `/admin/backup` → `backups/`

## الأمان
- CSRF double-submit، bcrypt، قفل دخول 5/15د، كلمات ممنوعة، No HTTPS يتطلب reverse proxy

---
صنع في العراق 🇮🇶 — 2026

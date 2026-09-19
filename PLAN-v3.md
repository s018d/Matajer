# PLAN-v3.md — العراقة الحديثة — Mesopotamian Modern

> لا كود قبل ضوء أخضر من سجاد

## الفلسفة
70% حداثة عالمية (Linear/Stripe) + 30% روح عراقية (قوس باب بغداد، نجمة سامراء، زليج الموصل). واثق، دافئ، عريق، حديث.

## الألوان v3 — نلتزم حرفيا
- دومي: #7A0C10 / #4A0608 / #A51C22 / #FBEEEF
- ذهبي: #C9A96E / #E8C99A / #F4E4C1 / #FBF6EC (10% كحد أقصى)
- كحلي: #0B1F3A / #143A5E / #1E4976
- كريمي: #FBF8F3 (خلفية رئيسية) / #F5EFE4 + أبيض للبطاقات + خط #EBE3D5
- وظيفي: #1E7A4C / #B8860B / #A51C22 / #1E4976
- تدرجات: grad-dome, grad-gold, grad-navy, grad-hero — لا برتقالي #EA580C

## الخطوط
Noto Kufi Arabic 400/500/600/700/800/900 — preload as="font" type="font/woff2" crossorigin — لا @import — display 4.5rem / 3rem / 2rem / 1.5rem ... body 15px — line-height 1.9 — tabular-nums

## الهوية المميزة
- قوس عراقي: border-radius 50% 50% 14px 14px / 30% — قوس واحد على الأقل بكل صفحة
- نقش نجمة 8 سامراء: SVG pattern.svg شفافية 3-5% كل 60px — hero/CTA/sidebar فقط
- فاصل ذهبي: linear-gradient transparent→#C9A96E→transparent
- أيقونات: Lucide/Feather SVG inline 1.5px — 20/24/32px — ممنوع إيموجي

## الشبكة والحركة
- حاوية 1200px — مسافات 4/8/16/24/32/48/64/96/128 — بطاقة 32px داخل، 24px بين، 96px بين أقسام
- حواف 8/14/20/28/999 — ظلال 5 أنواع (sm/md/lg/dome/gold) — انتقالات 180/320/480ms — transform+opacity فقط — prefers-reduced-motion

## تأكد backup/pre-redesign
- `backup/pre-redesign` فيه 5 commits كاملة (4831e3a, 7e5ca13, 9a25a8e, b43348e, d8e86a2) — كامل ومؤمن. عدت إليه وتأكدت ثم رجعت لـ `redesign/v2`.

## مصير site.css و app.css
- `site.css` (48KB أزرق/بنفسجي) → يتحول تدريجيا لـ `components.css` جديد (كتابة من الصفر) — لا نحذفه بالدفعة 1
- `app.css` (72KB) → يبقى للـ overrides البسيطة فقط
- لا حذف بالدفعة 1 — حذف تدريجي بالدفعات 5-6 بعد التأكد

## إزالة البرتقالي #EA580C
- في `tokens.css v3`: أعيد تعريف `--brand`, `--brand2`, `--dome` كلها تشير لـ #7A0C10 — بدون حذف متغير موجود، فقط إعادة توجيه
- كل استخدام قديم لـ #EA580C يتحول تلقائيا للدومي

## إصلاح CTA المثبت
- في `landing.ejs:131` — `.dk-mobile-cta` حاليا ثابت دائما ويغطي المحتوى
- الحل: يختفي عند scroll down، يظهر عند scroll up (JS: lastScrollY)، أو ينشال كليا من الديسكتوب (يبقى موبايل فقط) — أطبقه بالدفعة 2

## إصلاح إحصائيات Hero
- في `landing.ejs:160` — الأرقام مقطوعة/بدون فواصل
- الحل: 3 أرقام واضحة "12,000+ متجر • 250,000 طلب • 4.9/5" مع `font-variant-numeric: tabular-nums` و `gap` مضبوط و `overflow:visible`

## خطة 6 دفعات (محدثة — market-nav.ejs أضيف للدفعة 1)

**الدفعة 1 — الأساس (5 ملفات):**
1. tokens.css v3 كامل (ألوان، مسافات، ظلال، خطوط — يحدث v2 الحالي — يعيد توجيه البرتقالي للدومي)
2. partials/head.ejs (preload as="font" type="font/woff2" crossorigin — لا @import)
3. partials/pattern-bg.svg (نقش النجمة 3-5%)
4. partials/icons.ejs (مكتبة SVG Lucide)
5. partials/market-nav.ejs (يبان بكل صفحة — أساسي)

**الدفعة 2 — الرئيسية (الأولوية المطلقة):**
5. landing.ejs — Hero (تدرج دومي + نقش 4% + عنوان 4.5rem + موكاب HTML) + كيف تبدأ + Bento مزايا + متاجر (6 بطاقات بقوس) + باقات (toggle) + أسئلة + CTA كحلي + فوتر 4 أعمدة
6. market-footer.ejs

**الدفعة 3 — المصادقة:**
7. login.ejs (مقسوم: يمين دومي + نقش، يسار فورم)
8. signup.ejs

**الدفعة 4 — لوحة التاجر:**
9. sidebar-panel.ejs + topbar.ejs (كحلي + دومي نشط + شريط ذهبي 4px)
10. panel/dashboard.ejs (4 إحصائيات 48px + رسم SVG + جدول)
11. panel/products.ejs (Grid/List + فلتر + Modal)

**الدفعة 5 — الطلبات والمتجر:**
12. panel/orders.ejs + settings.ejs (Tabs)
13. store/store.ejs + product.ejs + cart_drawer.ejs (drawer جانبي)

**الدفعة 6 — الأدمن والمراجعة:**
14. admin/*.ejs
15. مراجعة 360/768/1160/1440 — لا scroll أفقي
16. Lighthouse Performance ≥90 / Accessibility ≥95

## قواعد إلزامية
- commit = ملف واحد فقط على redesign/v2 — لا master
- قبل كل commit: npm start + 360/768/1160/1440 + لا console.error + لا scroll أفقي + Lighthouse
- Screenshot في وصف كل commit — وصف بالإنجليزية
- لا نلمس routes/, server.js, db.js, sw.js — لا نحذف متغير — لا Tailwind/Bootstrap — Vanilla JS فقط
- لا نكمل دفعة قبل ضوء أخضر

## انتظار ضوء أخضر من سجاد

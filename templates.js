/* أنماط دُكّان — 1 مجاني نضيف + 3 بريميوم مميزة كلياً (كل واحد شخصية) */

const FREE = {
  id: 'classic', name: 'الواضح',
  desc: 'مجاني وصاروخي: أبيض نضيف، خط واضح، سريع على الجوال، يدعم كل المنتجات والخصومات. تفتح متجرك وتبيع فوراً بدون دفع.',
  classes: 'tpl-c',
  palette: { primary: '#0ea5e9', accent: '#0284c7', bg: '#ffffff', ink: '#0f172a', soft: '#f1f5f9' },
  premium: false
};

const PREMIUM = [
  { id: 'royal-ivory', name: 'الذهب العاجي (Royal Ivory)', palette: { primary: '#C9A96E', accent: '#B8944E', bg: '#F8F5EF', ink: '#4A3F3A', soft: '#EFE9E0' }, desc: 'فاخر هادئ: أبيض عاجي وذهبي، هيدر زجاجي + شبكة 2-أعمدة. يبيع بالفخامة.', layout: 'editorial', hero: 'royal', grid: '2col', feature: 'lookbook' },
  { id: 'black-gold', name: 'الإمبراطورية السوداء (Black Gold)', palette: { primary: '#C9A96E', accent: '#A8894E', bg: '#0A0A0A', ink: '#E0D5C8', soft: '#161616' }, desc: 'فاخر جداً: أسود مع ذهبي معدني، توهج دوراني + كروت معتمة. يبيع بالهيبة.', layout: 'dense', hero: 'gold', grid: '4col', feature: 'specs' },
  { id: 'modern-green', name: 'السوق العصري (Modern Green)', palette: { primary: '#2E7D5E', accent: '#1F5E45', bg: '#F5F7F6', ink: '#1A2E2A', soft: '#E8F0EC' }, desc: 'عصري ونظيف: أخضر زمردي وأبيض، شريط أخضر + عداد عروض. يبيع بالثقة اليومية.', layout: 'market', hero: 'green', grid: '4col', feature: 'story' }
];

const PREMIUM_MAP = new Map(PREMIUM.map(p => [p.id, p]));

const LEGACY = ['prem-fashion','prem-classic','prem-natural','prem-outdoor'];

const LIST = [FREE];

const BY_ID = new Map(LIST.map(t => [t.id, t]));

// ديناميكي من DB إن وجد — بدون كسر إذا لم تكن الجداول جاهزة بعد
function dbTemplates() {
  try {
    const { db } = require('./db');
    if (db.isPg) return []; // PG async — يُستخدم الهاردكود كـ fallback مبدئياً
    const rows = db.prepare('SELECT * FROM templates WHERE is_active=1 ORDER BY position, id').all();
    return rows;
  } catch { return []; }
}

function valid(id) {
  if (!id) return false;
  if (BY_ID.has(id) || LEGACY.includes(id)) return true;
  if (PREMIUM_MAP.has(id)) return true;
  try {
    const rows = dbTemplates();
    if (rows.find(r => r.id === id)) return true;
  } catch {}
  return false;
}

function isPremium(id) {
  if (PREMIUM_MAP.has(id)) return true;
  try {
    const rows = dbTemplates();
    const r = rows.find(x => x.id === id);
    if (r) return !!r.is_premium;
  } catch {}
  return false;
}

function get(id) {
  const prem = PREMIUM_MAP.get(id);
  if (prem) return { ...prem, premium: true, classes: prem.id, style: '' };
  const free = BY_ID.get(id);
  if (free) return { ...free };
  if (LEGACY.includes(id)) return { ...FREE, id };
  try {
    const rows = dbTemplates();
    const r = rows.find(x => x.id === id);
    if (r) return { id: r.id, name: r.name, desc: r.description, classes: r.id, style: '', palette: { primary:'#0ea5e9', accent:'#0284c7', bg:'#ffffff', ink:'#0f172a', soft:'#f1f5f9' }, premium: !!r.is_premium, css: r.css_file };
  } catch {}
  return null;
}

function allActive() {
  const base = [...LIST, ...PREMIUM.filter(p => valid(p.id))];
  try {
    const rows = dbTemplates();
    for (const r of rows) {
      if (!base.find(b => b.id === r.id)) base.push({ id: r.id, name: r.name, desc: r.description, classes: r.id, palette: { primary:'#0ea5e9', accent:'#0284c7', bg:'#ffffff', ink:'#0f172a', soft:'#f1f5f9' }, premium: !!r.is_premium, css: r.css_file });
    }
  } catch {}
  return base;
}

function cssVars(tpl, customColor) {
  const p = tpl.palette;
  const primary = (customColor && customColor !== '#0ea5e9') ? customColor : p.primary;
  return `:root{--primary:${primary};--accent:${p.accent};--bg:${p.bg};--ink:${p.ink};--soft:${p.soft}}`;
}

function describe(tpl) {
  return tpl.desc || tpl.name;
}

module.exports = { LIST, PREMIUM, LEGACY, valid, isPremium, get, cssVars, describe, allActive };
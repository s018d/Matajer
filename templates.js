/* أنماط دُكّان — 1 مجاني نضيف + 3 بريميوم مميزة كلياً (كل واحد شخصية) */

const FREE = {
  id: 'classic', name: 'الواضح',
  desc: 'مجاني وصاروخي: أبيض نضيف، خط واضح، سريع على الجوال، يدعم كل المنتجات والخصومات. تفتح متجرك وتبيع فوراً بدون دفع.',
  classes: 'tpl-c',
  palette: { primary: '#0ea5e9', accent: '#0284c7', bg: '#ffffff', ink: '#0f172a', soft: '#f1f5f9' },
  premium: false
};

const PREMIUM = [
  { id: 'prem-fashion', name: 'الأتيلييه', palette: { primary: '#191a1b', accent: '#d4a574', bg: '#f2f3f5', ink: '#191a1b', soft: '#e9eaeb' }, desc: 'للأزياء والعطور والجمال — Editorial فاخر: هيرو 3/4 + عمودين + لقطة ثانية عند المرور. يبيع بالصور.', layout: 'editorial', hero: 'fashion', grid: '2col', feature: 'lookbook' },
  { id: 'prem-classic', name: 'التقني', palette: { primary: '#0f172a', accent: '#06b6d4', bg: '#f8fafc', ink: '#0f172a', soft: '#e2e8f0' }, desc: 'للإلكترونيات والموبايلات — Dark Tech: هيدر داكن + شبكة كثيفة + شارة مواصفات. يبيع بالثقة.', layout: 'dense', hero: 'tech', grid: '4col', feature: 'specs' },
  { id: 'prem-natural', name: 'الدافئ', palette: { primary: '#92400e', accent: '#f59e0b', bg: '#fffbeb', ink: '#451a03', soft: '#fef3c7' }, desc: 'للحلويات والأكل والعطارة — دافئ مستدير: ألوان ترابية + مسافات حنينة + قصة المنتج. يبيع بالدفء.', layout: 'masonry', hero: 'warm', grid: 'masonry', feature: 'story' }
];

const PREMIUM_MAP = new Map(PREMIUM.map(p => [p.id, p]));

const LEGACY = [];

const LIST = [FREE];

const BY_ID = new Map(LIST.map(t => [t.id, t]));

function valid(id) {
  if (!id) return false;
  if (BY_ID.has(id) || LEGACY.includes(id)) return true;
  if (PREMIUM_MAP.has(id)) return true;
  return false;
}

function isPremium(id) {
  return PREMIUM_MAP.has(id);
}

function get(id) {
  const prem = PREMIUM_MAP.get(id);
  if (prem) return { ...prem, premium: true, classes: 'prem-' + id.slice(5), style: '' };
  const free = BY_ID.get(id);
  if (free) return { ...free };
  if (LEGACY.includes(id)) return { ...FREE, id };
  return null;
}

function cssVars(tpl, customColor) {
  const p = tpl.palette;
  const primary = (customColor && customColor !== '#0ea5e9') ? customColor : p.primary;
  return `:root{--primary:${primary};--accent:${p.accent};--bg:${p.bg};--ink:${p.ink};--soft:${p.soft}}`;
}

function describe(tpl) {
  return tpl.desc || tpl.name;
}

module.exports = { LIST, PREMIUM, LEGACY, valid, isPremium, get, cssVars, describe };
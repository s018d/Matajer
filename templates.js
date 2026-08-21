/* أنماط دُكّان — تصميم مجاني واحد + 4 أنماط عالمية احترافية (كود أصلي خاص بالمنصة) */

const FREE = {
  id: 'classic', name: 'متجر احترافي',
  desc: 'تصميم مجاني احترافي سريع، متوافق مع الجوال، يدعم جميع المنتجات وأكواد الخصم. يمكنك الترقية لاحترافية للحصول على 4 أنماط عالمية وحل مخصص.',
  classes: 'tpl-c',
  palette: { primary: '#0d9488', accent: '#ec4899', bg: '#ffffff', ink: '#111111', soft: '#f1f3f5' },
  premium: false
};

const PREMIUM = [
  { id: 'prem-fashion', name: 'الأتيلييه', palette: { primary: '#191a1b', accent: '#cacbcc', bg: '#f2f3f5', ink: '#191a1b', soft: '#e9eaeb' }, desc: 'فخامة دور الأزياء العالمية (Moda Operandi): أحادي اللون، خط تحريري أنيق، زوايا شبه حادة — لعلامات الأزياء الفاخرة' },
  { id: 'prem-classic', name: 'الجراند', palette: { primary: '#008827', accent: '#00a1e0', bg: '#ffffff', ink: '#212529', soft: '#f8f9fa' }, desc: 'متاجر الأقسام العالمية (Saks Fifth Avenue): أبيض مرتب وأخضر علامة بارز وزوايا شبه مربعة — كلاسيكي يبعث الثقة' },
  { id: 'prem-natural', name: 'الطبيعي', palette: { primary: '#3e6f5e', accent: '#b85c38', bg: '#faf9f6', ink: '#2d2a26', soft: '#f0ece3' }, desc: 'الاستدامة العصرية (Allbirds): ألوان أرضية دافئة وخط هندسي نظيف ومساحات واسعة — للمنتجات الطبيعية والعضوية' },
  { id: 'prem-outdoor', name: 'المغامر', palette: { primary: '#fa4616', accent: '#003da5', bg: '#f5f5f5', ink: '#1a1a1a', soft: '#e8e8e8' }, desc: 'أسلوب علامات الرحلات العالمية (Patagonia): برتقالي جريء وحواف حادة وبنية صلبة — للمعدات والملابس الرياضية' }
];

const PREMIUM_MAP = new Map(PREMIUM.map(p => [p.id, p]));

const LEGACY = ['market'];

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
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('data/matajer.db');
// صور حقيقية للمتاجر الأربعة من Unsplash (نحملها ونخزنها بـ uploads)
const mapping = [
  { slug:'baghdadscents', imgs:['https://images.unsplash.com/photo-1594035910387-fea47794261f?w=600&q=80','https://images.unsplash.com/photo-1541643600914-78b084683601?w=600&q=80','https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=600&q=80'] },
  { slug:'techhub', imgs:['https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80','https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=600&q=80','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80'] },
  { slug:'watchstyle', imgs:['https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600&q=80','https://images.unsplash.com/photo-1547996160-81dfa63595aa?w=600&q=80','https://images.unsplash.com/photo-1434493789847-2f02dc6ca35d?w=600&q=80'] },
  { slug:'luxbags', imgs:['https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600&q=80','https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=600&q=80','https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&q=80'] },
];
console.log(JSON.stringify(mapping, null, 1));
db.close();

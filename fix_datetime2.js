const fs = require('fs');
const files = ['shipping.js', 'util.js', 'routes/panel.js'];
let count = 0;
for (const f of files) {
  let c = fs.readFileSync(f, 'utf8');
  const before = c;
  // Broken pattern: datetime('now','localtime') inside single-quoted JS strings
  // Fix: escape the inner quotes as \'
  c = c.split("datetime('now','localtime')").join("datetime(\\'now\\',\\'localtime\\')");
  fs.writeFileSync(f, c);
  if (before !== c) count++;
  console.log(f, 'changed:', before !== c);
}
console.log('total changed:', count);

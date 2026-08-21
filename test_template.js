const {db} = require('./db');
const ejs = require('ejs');
const fs = require('fs');
const template = fs.readFileSync('views/panel/warehouse-stock.ejs', 'utf8');
const warehouse = {id: 1, name: 'المستودع الرئيسي', code: 'MAIN', manager_name: 'أحمد', manager_phone: '07701234567'};
const stocks = [];
const store = {id: 5, slug: 'goldencare'};
const q = '';
const money = (n) => (Number(n)||0).toLocaleString('en-US') + ' د.ع';
try {
  const result = ejs.render(template, { store: {id: 5, slug: 'goldencare'}, warehouse, stocks: [], money: (n) => (Number(n)||0).toLocaleString('en-US') + ' د.ع', q: '', csrf: 'test' });
  console.log('Success:', result.substring(0, 200));
} catch (e) {
  console.log('Error:', e.message);
  console.log('Stack:', e.stack);
}
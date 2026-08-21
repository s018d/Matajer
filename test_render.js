const path = require('path');
const ejs = require('ejs');
const {db} = require('C:/Users/s20/Desktop/Matajer/db');

const viewsDir = 'C:/Users/s20/Desktop/Matajer/views';
const warehouse = db.prepare('SELECT * FROM warehouses WHERE id=? AND store_id=?').get(1, 5);
console.log('warehouse:', JSON.stringify(warehouse));

const stocks = db.prepare(`
  SELECT pws.*, p.name, p.price, p.sku,
    CASE WHEN pws.quantity <= pws.min_threshold THEN 'low'
         WHEN pws.quantity = 0 THEN 'out'
         ELSE 'ok' END as stock_status
  FROM product_warehouse_stock pws
  JOIN products p ON p.id = pws.product_id
  WHERE pws.warehouse_id = ? AND p.store_id = ? AND p.active = 1
  ORDER BY p.name
`).all(1, 5);
console.log('stocks:', stocks.length);

const data = {
  store: db.prepare('SELECT * FROM stores WHERE id=5').get(),
  warehouse,
  stocks,
  money: (n) => (Number(n)||0).toLocaleString('en-US') + ' د.ع',
  q: '',
  ok: '', err: '',
  user: {store_id: 5, role: 'owner'},
  csrf: 'test123',
  messages: { error: '', success: '' }
};

ejs.renderFile(path.join(viewsDir, 'panel/warehouse-stock.ejs'), data, (err, html) => {
  if (err) {
    console.log('RENDER_ERROR:');
    console.log(err.message);
    console.log(err.stack.split('\n').slice(0, 15).join('\n'));
  } else {
    console.log('RENDER_OK length:', html.length);
    console.log('has-title:', html.includes('مخزون المستودع'));
  }
});

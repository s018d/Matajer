const {db} = require('C:/Users/s20/Desktop/Matajer/db');

const drivers = db.prepare('SELECT * FROM drivers WHERE store_id=5').all();
const shipments = db.prepare('SELECT * FROM shipments WHERE store_id=5').all();
const returns = db.prepare('SELECT * FROM returns_exchanges WHERE store_id=5').all();
const bundles = db.prepare('SELECT * FROM bundles WHERE store_id=5').all();
const orders = db.prepare('SELECT * FROM orders WHERE store_id=5').all();
console.log('drivers:', drivers.length, 'shipments:', shipments.length, 'returns:', returns.length, 'bundles:', bundles.length, 'orders:', orders.length);

if (drivers.length === 0) {
  db.prepare('INSERT INTO drivers (store_id, name, phone, vehicle_type, vehicle_plate, commission_type, commission_value, is_active) VALUES (5, ?, ?, ?, ?, ?, ?, 1)')
    .run('علي الحسني', '07712345678', 'motorcycle', 'B-123', 'per_order', 3000);
  console.log('driver created');
}
if (bundles.length === 0) {
  db.prepare('INSERT INTO bundles (store_id, name, description, discount_type, discount_value, min_products, active) VALUES (5, ?, ?, ?, ?, ?, 1)')
    .run('عرض الذهب', 'منتجين معاً بخصم', 'percent', 10, 2);
  console.log('bundle created');
}
let o1 = orders[0];
if (orders.length === 0) {
  db.prepare('INSERT INTO orders (store_id, session_id, customer_name, customer_phone, customer_address, total, status) VALUES (5, ?, ?, ?, ?, ?, ?)')
    .run('test-session-1', 'اختبار مشتري', '07701234567', 'بغداد - الكرادة', 5000, 'new');
  o1 = db.prepare('SELECT * FROM orders WHERE store_id=5').get();
  console.log('order created');
}
const d1 = db.prepare('SELECT * FROM drivers WHERE store_id=5').get();
const b1 = db.prepare('SELECT * FROM bundles WHERE store_id=5').get();

if (shipments.length === 0) {
  db.prepare('INSERT INTO shipments (store_id, order_id, shipping_company_id, tracking_number, status, cod_amount, shipping_fee, customer_name, customer_phone, delivery_address) VALUES (5, ?, 1, ?, ?, ?, ?, ?, ?, ?)')
    .run(o1.id, 'BRQ-' + Date.now(), 'pending', o1.total, 4000, o1.customer_name, o1.customer_phone, o1.customer_address);
  console.log('shipment created');
}
if (returns.length === 0) {
  db.prepare('INSERT INTO returns_exchanges (store_id, order_id, order_item_id, type, reason, status) VALUES (5, ?, ?, ?, ?, ?)')
    .run(o1.id, 1, 'return', 'منتج تالف', 'pending');
  console.log('return created');
}

const s1 = db.prepare('SELECT * FROM shipments WHERE store_id=5').get();
const r1 = db.prepare('SELECT * FROM returns_exchanges WHERE store_id=5').get();
console.log('IDs:', {shipment: s1.id, ret: r1.id, bundle: b1.id, driver: d1.id, order: o1.id});

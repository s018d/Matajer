/* Zain Cash Payment Gateway Integration */
const crypto = require('crypto');
const https = require('https');
const { db, siteSettings } = require('./db');

/* Zain Cash Configuration */
const ZAINCASH_BASE_URL = {
  sandbox: 'https://sandbox.zaincash.iq/transaction/api/v1',
  production: 'https://api.zaincash.iq/transaction/api/v1'
};

function getZainCashConfig() {
  const s = siteSettings();
  const mode = s.zaincash_mode || 'sandbox';
  return {
    baseUrl: ZAINCASH_BASE_URL[mode],
    merchantId: s.zaincash_merchant_id,
    serviceType: s.zaincash_service_type,
    password: s.zaincash_password,
    callbackUrl: s.zaincash_callback_url,
    mode
  };
}

/* Generate signature for Zain Cash request */
function generateSignature(data, password) {
  // Zain Cash uses HMAC-SHA256 with password as key
  const sortedKeys = Object.keys(data).sort();
  const concatenated = sortedKeys.map(k => data[k]).join('');
  return crypto.createHmac('sha256', password).update(concatenated).digest('hex');
}

/* Create payment request */
function createPaymentRequest(orderId, amount, customerPhone, customerName, callbackUrl, description) {
  const config = getZainCashConfig();
  
  if (!config.merchantId || !config.password) {
    throw new Error('Zain Cash غير مكوّن — يرجى إعداد بيانات التاجر في إعدادات المنصة');
  }
  
  const orderIdStr = String(orderId);
  const amountStr = String(amount);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  
  const payload = {
    merchantId: config.merchantId,
    serviceType: config.serviceType || 'WalletPayment',
    amount: amountStr,
    orderId: orderIdStr,
    currency: 'IQD',
    customerPhone: customerPhone.replace(/^0/, '964'),
    customerName: customerName,
    description: description || `طلب رقم ${orderId}`,
    callbackUrl: callbackUrl,
    timestamp: timestamp,
    language: 'ar'
  };
  
  // Generate signature
  payload.signature = generateSignature(payload, config.password);
  
  return { payload, config };
}

/* Send payment request to Zain Cash */
async function initiatePayment(orderId, amount, customerPhone, customerName, callbackUrl, description) {
  const { payload, config } = createPaymentRequest(orderId, amount, customerPhone, customerName, callbackUrl, description);
  
  const url = `${config.baseUrl}/create`;
  
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: new URL(config.baseUrl).hostname,
      path: '/create',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve(response);
        } catch (e) {
          reject(new Error('استجابة غير صالحة من زين كاش'));
        }
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/* Verify payment callback */
function verifyCallback(query, password) {
  const { signature, ...data } = query;
  const expectedSignature = generateSignature(data, password);
  return signature === expectedSignature;
}

/* Check payment status */
async function checkPaymentStatus(orderId) {
  const config = getZainCashConfig();
  
  const payload = {
    merchantId: config.merchantId,
    orderId: String(orderId),
    timestamp: Math.floor(Date.now() / 1000).toString()
  };
  
  payload.signature = generateSignature(payload, config.password);
  
  const url = `${config.baseUrl}/status`;
  
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: new URL(config.baseUrl).hostname,
      path: '/status',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve(response);
        } catch (e) {
          reject(new Error('استجابة غير صالحة من زين كاش'));
        }
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/* Process callback */
function processCallback(query) {
  const config = getZainCashConfig();
  
  if (!verifyCallback(query, config.password)) {
    return { valid: false, error: 'توقيع غير صالح' };
  }
  
  const { orderId, status, transactionId, amount } = query;
  
  // Update payment record
  const payment = db.prepare('SELECT * FROM zaincash_payments WHERE order_id=?').get(query.orderId);
  if (!payment) {
    return { valid: false, error: 'دفعة غير موجودة' };
  }
  
  const statusMap = {
    'success': 'paid',
    'failed': 'failed',
    'cancelled': 'cancelled'
  };
  
  const newStatus = statusMap[status] || 'failed';
  
  db.prepare('UPDATE zaincash_payments SET status=?, zaincash_transaction_id=?, zaincash_order_id=?, response_code=?, response_message=?, paid_at=? WHERE id=?')
    .run(newStatus, query.transactionId, query.orderId, query.responseCode, query.responseMessage, new Date().toISOString(), payment.id);
  
  // If paid, update order status
  if (newStatus === 'paid') {
    db.prepare('UPDATE orders SET status=? WHERE id=?').run('confirmed', query.orderId);
  }
  
  return { valid: true, status: newStatus, orderId: query.orderId };
}

module.exports = {
  initiatePayment,
  checkPaymentStatus,
  processCallback,
  getZainCashConfig
};
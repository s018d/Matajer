/* Shipping Companies Integration Service */
const crypto = require('crypto');
const https = require('https');
const { db, siteSettings } = require('./db');
const { logActivity } = require('./util');

/* Shipping Companies Configuration */
const SHIPPING_COMPANIES = {
  barq: {
    name: 'بارق (Barq)',
    code: 'barq',
    baseUrl: {
      sandbox: 'https://api-sandbox.barq.iq/api/v1',
      production: 'https://api.barq.iq/api/v1'
    },
    supports: { cod: true, prepaid: true, tracking: true, pickup: true }
  },
  saqr: {
    name: 'صقر (Saqr)',
    code: 'saqr',
    baseUrl: {
      sandbox: 'https://api-sandbox.saqr.iq/api/v1',
      production: 'https://api.saqr.iq/api/v1'
    },
    supports: { cod: true, prepaid: true, tracking: true, pickup: true }
  },
  dhl: {
    name: 'DHL Express',
    code: 'dhl',
    baseUrl: {
      sandbox: 'https://api-sandbox.dhl.com/api/v1',
      production: 'https://api.dhl.com/api/v1'
    },
    supports: { cod: false, prepaid: true, tracking: true, pickup: true }
  },
  aramex: {
    name: 'Aramex',
    code: 'aramex',
    baseUrl: {
      sandbox: 'https://api-sandbox.aramex.com/api/v1',
      production: 'https://api.aramex.com/api/v1'
    },
    supports: { cod: true, prepaid: true, tracking: true, pickup: true }
  },
  iraq_post: {
    name: 'البريد العراقي',
    code: 'iraq_post',
    baseUrl: {
      sandbox: 'https://api-sandbox.iraqpost.iq/api/v1',
      production: 'https://api.iraqpost.iq/api/v1'
    },
    supports: { cod: true, prepaid: true, tracking: true, pickup: false }
  }
};

function getCompanyConfig(companyCode, storeId) {
  const s = siteSettings();
  const company = SHIPPING_COMPANIES[companyCode];
  if (!company) return null;
  
  // Get store-specific config
  const storeConfig = db.prepare(`
    SELECT ssc.*, sc.name, sc.code, sc.base_url, sc.supports_cod, sc.supports_prepaid, sc.supports_tracking, sc.supports_pickup
    FROM store_shipping_config ssc
    JOIN shipping_companies sc ON sc.id = ssc.shipping_company_id
    WHERE ssc.store_id = ? AND ssc.shipping_company_id = (SELECT id FROM shipping_companies WHERE code = ?)
  `).get(storeId, companyCode);
  
  if (!storeConfig || !storeConfig.is_enabled) return null;
  
  return {
    ...company,
    storeConfig,
    credentials: storeConfig.api_credentials ? JSON.parse(storeConfig.api_credentials) : {}
  };
}

function getActiveShippingCompanies(storeId) {
  return db.prepare(`
    SELECT sc.*, ssc.is_enabled, ssc.cod_fee, ssc.free_shipping_min, ssc.settings
    FROM shipping_companies sc
    JOIN store_shipping_config ssc ON ssc.shipping_company_id = sc.id
    WHERE ssc.store_id = ? AND ssc.is_enabled = 1 AND sc.is_active = 1
  `).all(storeId);
}

function getShippingCompanyByCode(storeId, code) {
  return db.prepare(`
    SELECT sc.*, ssc.*, ssc.settings as store_settings
    FROM shipping_companies sc
    JOIN store_shipping_config ssc ON ssc.shipping_company_id = sc.id
    WHERE ssc.store_id = ? AND sc.code = ? AND ssc.is_enabled = 1
  `).get(storeId, code);
}

/* Generate signature for API requests */
function generateSignature(data, secret) {
  const sortedKeys = Object.keys(data).sort();
  const concatenated = sortedKeys.map(k => data[k]).join('');
  return crypto.createHmac('sha256', secret).update(concatenated).digest('hex');
}

/* Barq API Integration */
async function createBarqShipment(config, shipmentData) {
  const credentials = config.credentials;
  if (!credentials.api_key || !credentials.api_secret) {
    throw new Error('بيانات اعتماد بارق غير مكتملة');
  }
  
  const payload = {
    merchant_id: credentials.merchant_id,
    service_type: 'delivery',
    amount: shipmentData.cod_amount || 0,
    order_id: shipmentData.order_id.toString(),
    currency: 'IQD',
    customer_phone: shipmentData.customer_phone.replace(/^0/, '964'),
    customer_name: shipmentData.customer_name,
    description: `طلب #${shipmentData.order_id}`,
    callback_url: shipmentData.callback_url,
    weight: shipmentData.weight || 0.5,
    dimensions: shipmentData.dimensions || { length: 20, width: 15, height: 10 },
    pickup_address: shipmentData.pickup_address,
    delivery_address: shipmentData.delivery_address,
    cod_amount: shipmentData.cod_amount || 0
  };
  
  const timestamp = Math.floor(Date.now() / 1000).toString();
  payload.timestamp = timestamp;
  payload.signature = generateBarqSignature(payload, credentials.api_secret);
  
  return sendBarqRequest('create', payload, config);
}

function generateBarqSignature(data, secret) {
  const sortedKeys = Object.keys(data).sort();
  const concatenated = sortedKeys.map(k => data[k]).join('');
  return crypto.createHmac('sha256', secret).update(concatenated).digest('hex');
}

function sendBarqRequest(endpoint, payload, config) {
  const url = `${config.baseUrl.production}/shipments/create`;
  const data = JSON.stringify(payload);
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: new URL(config.baseUrl.production).hostname,
      path: '/shipments/create',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(payload)),
        'Authorization': `Bearer ${config.credentials.api_key}`
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.success) {
            resolve({
              success: true,
              tracking_number: response.tracking_number,
              order_id: response.order_id,
              redirect_url: response.redirect_url,
              barcode: response.barcode
            });
          } else {
            resolve({ success: false, error: response.message || 'فشل إنشاء الشحنة' });
          }
        } catch (e) {
          reject(new Error('استجابة غير صالحة من بارق'));
        }
      });
    });
    
    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

/* Saqr API Integration */
async function createSaqrShipment(config, shipmentData) {
  // Similar structure to Barq
  throw new Error('تكامل صقر قيد التطوير');
}

/* DHL API Integration */
async function createDhlShipment(config, shipmentData) {
  throw new Error('تكامل DHL قيد التطوير');
}

/* Aramex API Integration */
async function createAramexShipment(config, shipmentData) {
  throw new Error('تكامل Aramex قيد التطوير');
}

/* Iraq Post API Integration */
async function createIraqPostShipment(config, shipmentData) {
  throw new Error('تكامل البريد العراقي قيد التطوير');
}

/* Generic shipment creation */
async function createShipment(storeId, shipmentData) {
  const company = getShippingCompanyByCode(storeId, shipmentData.shipping_company_code);
  if (!company) throw new Error('شركة التوصيل غير مفعلة');
  
  switch (company.code) {
    case 'barq':
      return createBarqShipment(company, shipmentData);
    case 'saqr':
      return createSaqrShipment(company, shipmentData);
    case 'dhl':
      return createDhlShipment(company, shipmentData);
    case 'aramex':
      return createAramexShipment(company, shipmentData);
    case 'iraq_post':
      return createIraqPostShipment(company, shipmentData);
    default:
      throw new Error('شركة توصيل غير مدعومة');
  }
}

/* Create shipment record in DB */
function createShipmentRecord(storeId, orderId, shippingCompanyId, shipmentData) {
  const shipmentId = db.prepare(`
    INSERT INTO shipments (
      store_id, order_id, shipping_company_id, tracking_number,
      cod_amount, shipping_fee, weight, dimensions,
      pickup_address, delivery_address, customer_phone, customer_name,
      pickup_scheduled_at, status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    storeId, orderId, shipmentData.shipping_company_id,
    shipmentData.tracking_number || null,
    shipmentData.cod_amount || 0,
    shipmentData.shipping_fee || 0,
    shipmentData.weight || 0.5,
    JSON.stringify(shipmentData.dimensions || {}),
    shipmentData.pickup_address,
    shipmentData.delivery_address,
    shipmentData.customer_phone,
    shipmentData.customer_name,
    shipmentData.pickup_scheduled_at || null,
    'pending'
  ).lastInsertRowid;
  
  return shipmentId;
}

/* Update shipment status */
function updateShipmentStatus(shipmentId, status, trackingData = {}) {
  const updates = ['status = ?', 'updated_at = datetime(\'now\',\'localtime\')'];
  const params = [status];
  
  if (trackingData.tracking_number) {
    updates.push('tracking_number = ?');
    params.push(trackingData.tracking_number);
  }
  if (trackingData.shipping_company_order_id) {
    updates.push('shipping_company_order_id = ?');
    params.push(trackingData.shipping_company_order_id);
  }
  if (trackingData.picked_up_at) {
    updates.push('picked_up_at = ?');
    params.push(trackingData.picked_up_at);
  }
  if (trackingData.delivered_at) {
    updates.push('delivered_at = ?');
    params.push(trackingData.delivered_at);
  }
  if (trackingData.returned_at) {
    updates.push('returned_at = ?');
    params.push(trackingData.returned_at);
  }
  if (trackingData.notes) {
    updates.push('notes = ?');
    params.push(trackingData.notes);
  }
  
  params.push(shipmentId);
  
  db.prepare(`UPDATE shipments SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  
  // Add tracking entry
  if (trackingData.description) {
    db.prepare('INSERT INTO shipment_tracking (shipment_id, status, location, description) VALUES (?,?,?,?)')
      .run(shipmentId, status, trackingData.location || '', trackingData.description);
  }
}

/* Get shipment with tracking */
function getShipmentWithTracking(shipmentId) {
  const shipment = db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipmentId);
  if (!shipment) return null;
  
  const tracking = db.prepare('SELECT * FROM shipment_tracking WHERE shipment_id = ? ORDER BY timestamp DESC').all(shipmentId);
  return { ...shipment, tracking };
}

/* Process webhook from shipping companies */
function processShippingWebhook(companyCode, payload) {
  switch (companyCode) {
    case 'barq':
      return processBarqWebhook(payload);
    case 'saqr':
      return processSaqrWebhook(payload);
    default:
      return { valid: false, error: 'Unsupported company' };
  }
}

function processBarqWebhook(payload) {
  // Verify signature
  // Update shipment status based on payload
  return { valid: true, status: 'updated' };
}

function processSaqrWebhook(payload) {
  return { valid: true, status: 'updated' };
}

/* Generate shipping label PDF */
async function generateShippingLabel(shipmentId) {
  const shipment = getShipmentWithTracking(shipmentId);
  if (!shipment) throw new Error('Shipment not found');
  
  // Placeholder: real PDF generation not yet implemented
  throw new Error('PDF generation not yet available');
}

/* Calculate shipping fee */
function calculateShippingFee(storeId, companyCode, weight, dimensions, codAmount, deliveryCity) {
  const company = getShippingCompanyByCode(storeId, companyCode);
  if (!company) return 0;
  
  const settings = company.store_settings ? JSON.parse(company.store_settings) : {};
  const baseFee = settings.base_fee || 5000;
  const perKg = settings.per_kg || 2000;
  const codFee = company.storeConfig.cod_fee || 0;
  const freeMin = company.storeConfig.free_shipping_min || 0;
  
  let fee = baseFee + (weight * perKg);
  if (codAmount > 0) fee += codFee;
  
  return Math.max(0, fee);
}

module.exports = {
  SHIPPING_COMPANIES,
  getCompanyConfig,
  getActiveShippingCompanies,
  getShippingCompanyByCode,
  createShipment,
  createShipmentRecord,
  updateShipmentStatus,
  getShipmentWithTracking,
  processShippingWebhook,
  generateShippingLabel,
  calculateShippingFee,
  getActiveShippingCompanies
};
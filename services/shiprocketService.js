const axios = require('axios');

const SHIPROCKET_API_URL = 'https://apiv2.shiprocket.in/v1/external';

// ---------------------------------------------------------------------------
// Mock mode — set SHIPROCKET_MOCK=true in .env to bypass real API calls.
// Useful for local development / testing the full Pack-and-Ship UI flow
// without a real Shiprocket account.
// ---------------------------------------------------------------------------
const isMock = () => process.env.SHIPROCKET_MOCK === 'true';

const mockAWB = () => `MOCK${Date.now()}`;
const mockShipmentId = () => Math.floor(Math.random() * 9000000) + 1000000;


class ShiprocketTokenManager {
  constructor() {
    this._token = null;
    this._expiry = null;
    this._refreshing = null; // promise lock
  }

  async getToken() {
    // Return cached token if still valid (with 5-min safety margin)
    if (this._token && this._expiry && new Date() < new Date(this._expiry - 5 * 60 * 1000)) {
      return this._token;
    }

    // If a refresh is already in-flight, wait for it instead of issuing a
    // second login request (prevents race conditions under concurrent load).
    if (this._refreshing) {
      return this._refreshing;
    }

    this._refreshing = this._refresh().finally(() => {
      this._refreshing = null;
    });

    return this._refreshing;
  }

  async _refresh() {
    try {
      const response = await axios.post(`${SHIPROCKET_API_URL}/auth/login`, {
        email: process.env.SHIPROCKET_EMAIL,
        password: process.env.SHIPROCKET_PASSWORD
      });

      this._token = response.data.token;
      // Shiprocket tokens are valid for 10 days; cache for 9 to be safe.
      this._expiry = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
      return this._token;
    } catch (error) {
      console.error('Shiprocket Login Error:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with Shiprocket');
    }
  }
}

// Module-level singleton — single instance per Node.js process.
const tokenManager = new ShiprocketTokenManager();

const getToken = () => tokenManager.getToken();

// Get authenticated axios instance
const getAuthenticatedClient = async () => {
  const token = await getToken();
  return axios.create({
    baseURL: SHIPROCKET_API_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000 // 15s timeout for all Shiprocket calls
  });
};

// Create order/shipment
exports.createOrder = async (orderData) => {
  if (isMock()) {
    const id = mockShipmentId();
    console.log('[Shiprocket MOCK] createOrder called — returning fake shipment', id);
    return { success: true, shipmentId: id, orderId: orderData.orderNumber, status: 'NEW' };
  }
  try {
    const client = await getAuthenticatedClient();

    const payload = {
      order_id: orderData.orderNumber,
      order_date: new Date().toISOString().split('T')[0],
      pickup_location: orderData.pickupLocation || 'Primary',
      billing_customer_name: orderData.billingAddress.name,
      billing_last_name: '',
      billing_address: orderData.billingAddress.addressLine1,
      billing_address_2: orderData.billingAddress.addressLine2 || '',
      billing_city: orderData.billingAddress.city,
      billing_pincode: orderData.billingAddress.pincode,
      billing_state: orderData.billingAddress.state,
      billing_country: orderData.billingAddress.country || 'India',
      billing_email: orderData.customerEmail,
      billing_phone: orderData.billingAddress.phone,
      shipping_is_billing: true,
      order_items: orderData.items.map(item => ({
        name: item.name,
        sku: item.sku || '',
        units: item.quantity,
        selling_price: item.sellingPrice,
        discount: Math.max(0, (item.originalPrice || item.sellingPrice) - item.sellingPrice),
        tax: 0
      })),
      payment_method: orderData.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
      shipping_charges: orderData.shippingCost || 0,
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: orderData.discount || 0,
      sub_total: orderData.subtotal,
      // Dimensions pulled from product.specifications (length/breadth/height in cm, weight in kg)
      length: orderData.dimensions?.length || 25,
      breadth: orderData.dimensions?.breadth || 20,
      height: orderData.dimensions?.height || 5,
      weight: orderData.weight || 0.5
    };

    const response = await client.post('/orders/create/adhoc', payload);

    return {
      success: true,
      shipmentId: response.data.shipment_id,
      orderId: response.data.order_id,
      status: response.data.status
    };
  } catch (error) {
    console.error('Shiprocket Create Order Error:', error.response?.data || error.message);
    throw new Error(`Failed to create shipment: ${error.response?.data?.message || error.message}`);
  }
};

// Generate AWB (Air Waybill)
exports.generateAWB = async (shipmentId, courierId = null) => {
  if (isMock()) {
    const awb = mockAWB();
    console.log('[Shiprocket MOCK] generateAWB called — returning fake AWB', awb);
    return {
      success: true,
      awbCode: awb,
      courierId: courierId || 999,
      courierName: 'BlueDart (Mock)',
      shipmentId,
      trackingUrl: `https://shiprocket.co/tracking/${awb}`
    };
  }
  try {
    const client = await getAuthenticatedClient();

    const payload = {
      shipment_id: shipmentId
    };

    if (courierId) {
      payload.courier_id = courierId;
    }

    const response = await client.post('/courier/assign/awb', payload);

    const awbData = response.data.response?.data;
    if (!awbData?.awb_code) {
      throw new Error('AWB assignment failed: no AWB code returned');
    }
    return {
      success: true,
      awbCode: awbData.awb_code,
      courierId: awbData.courier_id,
      courierName: awbData.courier_name,
      shipmentId: awbData.shipment_id,
      trackingUrl: `https://shiprocket.co/tracking/${awbData.awb_code}`
    };
  } catch (error) {
    console.error('Shiprocket AWB Error:', error.response?.data || error.message);
    throw new Error(`Failed to generate AWB: ${error.response?.data?.message || error.message}`);
  }
};

// Get tracking details
exports.getTracking = async (awbCode) => {
  if (isMock()) {
    console.log('[Shiprocket MOCK] getTracking called for', awbCode);
    return {
      success: true,
      tracking: {
        awb_code: awbCode,
        current_status: 'In Transit',
        shipment_track: [
          { date: new Date().toISOString(), activity: 'Shipment picked up from seller', location: 'Hyderabad' },
          { date: new Date(Date.now() - 3600000).toISOString(), activity: 'In transit to hub', location: 'Hyderabad Hub' }
        ]
      }
    };
  }
  try {
    const client = await getAuthenticatedClient();

    const response = await client.get(`/courier/track/awb/${awbCode}`);

    return {
      success: true,
      tracking: response.data
    };
  } catch (error) {
    console.error('Shiprocket Tracking Error:', error.response?.data || error.message);
    throw new Error(`Failed to get tracking: ${error.response?.data?.message || error.message}`);
  }
};

// Cancel shipment
exports.cancelShipment = async (shipmentId) => {
  if (isMock()) {
    console.log('[Shiprocket MOCK] cancelShipment called for', shipmentId);
    return { success: true, message: 'Shipment cancelled successfully (mock)', data: {} };
  }
  try {
    const client = await getAuthenticatedClient();

    const response = await client.post('/orders/cancel', {
      ids: [shipmentId]
    });

    return {
      success: true,
      message: 'Shipment cancelled successfully',
      data: response.data
    };
  } catch (error) {
    console.error('Shiprocket Cancel Error:', error.response?.data || error.message);
    throw new Error(`Failed to cancel shipment: ${error.response?.data?.message || error.message}`);
  }
};

// Get all couriers
exports.getCouriers = async () => {
  if (isMock()) {
    return { success: true, couriers: [{ courier_id: 999, courier_name: 'BlueDart (Mock)', rate: 100, estimated_delivery_days: '3-5' }] };
  }
  try {
    const client = await getAuthenticatedClient();

    const response = await client.get('/courier/all');

    return {
      success: true,
      couriers: response.data.data
    };
  } catch (error) {
    console.error('Shiprocket Couriers Error:', error.response?.data || error.message);
    throw new Error(`Failed to get couriers: ${error.response?.data?.message || error.message}`);
  }
};

// Check courier serviceability
exports.checkServiceability = async (pickupPincode, deliveryPincode, weight = 0.5, cod = false) => {
  if (isMock()) {
    return { success: true, availableCouriers: [{ courier_name: 'BlueDart (Mock)', rate: 100, estimated_delivery_days: '3-5' }] };
  }
  try {
    const client = await getAuthenticatedClient();

    const response = await client.get('/courier/serviceability', {
      params: {
        pickup_postcode: pickupPincode,
        delivery_postcode: deliveryPincode,
        weight,
        cod
      }
    });

    return {
      success: true,
      availableCouriers: response.data.data.available_courier_companies || []
    };
  } catch (error) {
    console.error('Shiprocket Serviceability Error:', error.response?.data || error.message);
    throw new Error(`Failed to check serviceability: ${error.response?.data?.message || error.message}`);
  }
};

// Get order details
exports.getOrderDetails = async (orderId) => {
  try {
    const client = await getAuthenticatedClient();

    const response = await client.get(`/orders/show/${orderId}`);

    return {
      success: true,
      order: response.data.data
    };
  } catch (error) {
    console.error('Shiprocket Order Details Error:', error.response?.data || error.message);
    throw new Error(`Failed to get order details: ${error.response?.data?.message || error.message}`);
  }
};

// Generate return order
exports.createReturnOrder = async (returnData) => {
  try {
    const client = await getAuthenticatedClient();

    const payload = {
      order_id: returnData.originalOrderId,
      order_date: new Date().toISOString().split('T')[0],
      pickup_customer_name: returnData.pickupAddress.name,
      pickup_last_name: '',
      pickup_address: returnData.pickupAddress.addressLine1,
      pickup_address_2: returnData.pickupAddress.addressLine2 || '',
      pickup_city: returnData.pickupAddress.city,
      pickup_pincode: returnData.pickupAddress.pincode,
      pickup_state: returnData.pickupAddress.state,
      pickup_country: returnData.pickupAddress.country || 'India',
      pickup_email: returnData.customerEmail,
      pickup_phone: returnData.pickupAddress.phone,
      shipping_customer_name: returnData.returnAddress.name,
      shipping_last_name: '',
      shipping_address: returnData.returnAddress.addressLine1,
      shipping_address_2: returnData.returnAddress.addressLine2 || '',
      shipping_city: returnData.returnAddress.city,
      shipping_pincode: returnData.returnAddress.pincode,
      shipping_state: returnData.returnAddress.state,
      shipping_country: returnData.returnAddress.country || 'India',
      shipping_email: returnData.returnEmail,
      shipping_phone: returnData.returnAddress.phone,
      order_items: returnData.items.map(item => ({
        name: item.name,
        sku: item.sku || '',
        units: item.quantity,
        selling_price: item.sellingPrice
      })),
      payment_method: 'Prepaid',
      sub_total: returnData.subtotal
    };

    const response = await client.post('/orders/create/return', payload);

    return {
      success: true,
      returnShipmentId: response.data.shipment_id,
      status: response.data.status
    };
  } catch (error) {
    console.error('Shiprocket Return Error:', error.response?.data || error.message);
    throw new Error(`Failed to create return: ${error.response?.data?.message || error.message}`);
  }
};

// Check Shiprocket configuration
exports.isConfigured = () => {
  return !!(
    process.env.SHIPROCKET_EMAIL &&
    process.env.SHIPROCKET_PASSWORD
  );
};

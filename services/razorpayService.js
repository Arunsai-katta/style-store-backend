const Razorpay = require('razorpay');
const crypto = require('crypto');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Create order
exports.createOrder = async (amount, receipt, notes = {}) => {
  try {
    const options = {
      amount: Math.round(amount * 100), // Convert to paise
      currency: 'INR',
      receipt,
      notes,
      payment_capture: 1 // Auto capture
    };
    
    const order = await razorpay.orders.create(options);
    
    return {
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status
    };
  } catch (error) {
    console.error('Razorpay Create Order Error:', error);
    throw new Error(`Failed to create order: ${error.message}`);
  }
};

// Verify payment signature
exports.verifyPayment = (orderId, paymentId, signature) => {
  try {
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');
    
    const isAuthentic = expectedSignature === signature;
    
    return {
      success: isAuthentic,
      message: isAuthentic ? 'Payment verified successfully' : 'Invalid payment signature'
    };
  } catch (error) {
    console.error('Razorpay Verify Error:', error);
    return {
      success: false,
      message: 'Payment verification failed'
    };
  }
};

// Capture payment
exports.capturePayment = async (paymentId, amount) => {
  try {
    const payment = await razorpay.payments.capture(
      paymentId,
      Math.round(amount * 100),
      'INR'
    );
    
    return {
      success: true,
      payment
    };
  } catch (error) {
    console.error('Razorpay Capture Error:', error);
    throw new Error(`Failed to capture payment: ${error.message}`);
  }
};

// Get payment details
exports.getPaymentDetails = async (paymentId) => {
  try {
    const payment = await razorpay.payments.fetch(paymentId);
    
    return {
      success: true,
      payment
    };
  } catch (error) {
    console.error('Razorpay Fetch Error:', error);
    throw new Error(`Failed to fetch payment: ${error.message}`);
  }
};

// Refund payment
exports.refundPayment = async (paymentId, amount = null, notes = {}) => {
  try {
    const options = {
      notes
    };
    
    // If amount is provided, do partial refund
    if (amount) {
      options.amount = Math.round(amount * 100);
    }
    
    const refund = await razorpay.payments.refund(paymentId, options);
    
    return {
      success: true,
      refundId: refund.id,
      amount: refund.amount / 100,
      status: refund.status,
      refund
    };
  } catch (error) {
    console.error('Razorpay Refund Error:', error);
    throw new Error(`Failed to refund payment: ${error.message}`);
  }
};

// Get refund details
exports.getRefundDetails = async (refundId) => {
  try {
    const refund = await razorpay.refunds.fetch(refundId);
    
    return {
      success: true,
      refund
    };
  } catch (error) {
    console.error('Razorpay Refund Fetch Error:', error);
    throw new Error(`Failed to fetch refund: ${error.message}`);
  }
};

// Get all refunds for a payment
exports.getPaymentRefunds = async (paymentId) => {
  try {
    const refunds = await razorpay.refunds.all({
      payment_id: paymentId
    });
    
    return {
      success: true,
      refunds: refunds.items
    };
  } catch (error) {
    console.error('Razorpay Refunds Fetch Error:', error);
    throw new Error(`Failed to fetch refunds: ${error.message}`);
  }
};

// Check Razorpay configuration
exports.isConfigured = () => {
  return !!(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET
  );
};

// Get Razorpay key (public)
exports.getKey = () => {
  return process.env.RAZORPAY_KEY_ID;
};

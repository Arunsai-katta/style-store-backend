const { razorpayService } = require('../services');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const crypto = require('crypto');
const { Order, Product, Cart } = require('../models');

// @desc    Get Razorpay key
// @route   GET /api/payments/razorpay-key
// @access  Public
exports.getRazorpayKey = asyncHandler(async (req, res) => {
  const key = razorpayService.getKey();

  if (!key) {
    throw new AppError('Razorpay not configured', 500);
  }

  res.status(200).json({
    success: true,
    key
  });
});

// @desc    Create Razorpay order
// @route   POST /api/payments/create-order
// @access  Private
exports.createOrder = asyncHandler(async (req, res) => {
  const { amount, receipt, notes } = req.body;

  if (!amount || !receipt) {
    throw new AppError('Please provide amount and receipt', 400);
  }

  const order = await razorpayService.createOrder(amount, receipt, notes);

  res.status(200).json({
    success: true,
    order
  });
});

// @desc    Verify payment
// @route   POST /api/payments/verify
// @access  Private
exports.verifyPayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new AppError('Please provide all payment details', 400);
  }

  const verification = razorpayService.verifyPayment(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );

  res.status(200).json({
    success: verification.success,
    message: verification.message
  });
});

// @desc    Get payment details
// @route   GET /api/payments/:paymentId
// @access  Private/Admin
exports.getPaymentDetails = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;

  const payment = await razorpayService.getPaymentDetails(paymentId);

  res.status(200).json({
    success: true,
    payment: payment.payment
  });
});

// @desc    Process refund
// @route   POST /api/payments/refund
// @access  Private/Admin
exports.processRefund = asyncHandler(async (req, res) => {
  const { paymentId, amount, notes } = req.body;

  if (!paymentId) {
    throw new AppError('Please provide payment ID', 400);
  }

  const refund = await razorpayService.refundPayment(paymentId, amount, notes);

  res.status(200).json({
    success: true,
    refund
  });
});

// @desc    Get refund details
// @route   GET /api/payments/refund/:refundId
// @access  Private/Admin
exports.getRefundDetails = asyncHandler(async (req, res) => {
  const { refundId } = req.params;

  const refund = await razorpayService.getRefundDetails(refundId);

  res.status(200).json({
    success: true,
    refund: refund.refund
  });
});

// @desc    Get payment configuration
// @route   GET /api/payments/config
// @access  Public
exports.getPaymentConfig = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    config: {
      razorpayKey: razorpayService.getKey(),
      currency: 'INR',
      cod: {
        enabled: true,
        maxOrderAmount: parseInt(process.env.COD_MAX_ORDER_AMOUNT) || 5000,
        minPrepaidAmount: parseInt(process.env.COD_MIN_PREPAID_AMOUNT) || 500
      }
    }
  });
});

// ---------------------------------------------------------------------------
// @desc    Handle Razorpay webhook
// @route   POST /api/payments/webhook
// @access  Public (verified by signature)
// IMPORTANT: This route must receive the raw request body. In server.js the
// webhook path is registered BEFORE express.json() so the body arrives as a
// Buffer. Do NOT add protect middleware here.
// ---------------------------------------------------------------------------
exports.handleWebhook = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];

  if (!signature) {
    return res.status(400).json({ success: false, message: 'Missing webhook signature' });
  }

  // Verify HMAC-SHA256 signature against the raw body
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const body = req.body; // raw Buffer when express.raw() is used

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );

  if (!isValid) {
    console.warn('Razorpay webhook: invalid signature');
    return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
  }

  // Parse the verified payload
  let event;
  try {
    event = JSON.parse(body.toString());
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
  }

  // Acknowledge immediately — Razorpay retries if it doesn't get a 2xx quickly
  res.status(200).json({ success: true });

  // Process event asynchronously after responding
  try {
    if (event.event === 'payment.captured') {
      const paymentEntity = event.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;
      const razorpayPaymentId = paymentEntity.id;

      // Find the order by Razorpay order ID
      const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
      if (!order) {
        console.error(`Webhook: no order found for Razorpay order ${razorpayOrderId}`);
        return;
      }

      // Idempotency guard — skip if already confirmed
      if (order.payment.status === 'completed') return;

      // Mark payment complete
      order.payment.status = 'completed';
      order.payment.razorpayPaymentId = razorpayPaymentId;
      order.payment.paidAt = new Date();
      order.status = 'confirmed';
      order.addTimelineEvent('confirmed', 'Payment confirmed via Razorpay webhook');
      await order.save();

      // Atomically decrement stock
      for (const item of order.items) {
        const updateResult = await Product.updateOne(
          {
            _id: item.product,
            'colorVariants.colorName': item.colorVariant.colorName,
            'colorVariants.sizes': {
              $elemMatch: { size: item.size, quantity: { $gte: item.quantity } }
            }
          },
          {
            $inc: { 'colorVariants.$[cv].sizes.$[sz].quantity': -item.quantity }
          },
          {
            arrayFilters: [
              { 'cv.colorName': item.colorVariant.colorName },
              { 'sz.size': item.size }
            ]
          }
        );
        if (updateResult.modifiedCount === 0) {
          console.error(
            `Webhook stock underflow: product ${item.product} ${item.colorVariant.colorName} ${item.size}`
          );
        }
      }

      console.log(`Webhook: order ${order.orderNumber} confirmed for payment ${razorpayPaymentId}`);
    } else if (event.event === 'payment.failed') {
      const paymentEntity = event.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;

      const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
      if (order && order.payment.status === 'pending') {
        order.payment.status = 'failed';
        order.addTimelineEvent('payment_failed', 'Payment failed (webhook)');
        await order.save();
      }
    }
  } catch (err) {
    // Do NOT re-throw — we already sent 200 to Razorpay
    console.error('Webhook processing error:', err);
  }
};

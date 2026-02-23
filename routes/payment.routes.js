const express = require('express');
const router = express.Router();
const { paymentController } = require('../controllers');
const { protect, adminOnly } = require('../middleware/auth');

// ---------------------------------------------------------------------------
// Webhook — MUST use express.raw() so we receive the raw body Buffer for
// signature verification. Do NOT add protect middleware here.
// This route is registered BEFORE express.json() in server.js.
// ---------------------------------------------------------------------------
router.post(
    '/webhook',
    express.raw({ type: 'application/json' }),
    paymentController.handleWebhook
);

// Public routes
router.get('/config', paymentController.getPaymentConfig);
router.get('/razorpay-key', paymentController.getRazorpayKey);

// Protected routes
router.post('/create-order', protect, paymentController.createOrder);
router.post('/verify', protect, paymentController.verifyPayment);

// Admin routes
router.get('/:paymentId', protect, adminOnly, paymentController.getPaymentDetails);
router.post('/refund', protect, adminOnly, paymentController.processRefund);
router.get('/refund/:refundId', protect, adminOnly, paymentController.getRefundDetails);

module.exports = router;

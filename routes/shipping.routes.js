const express = require('express');
const router = express.Router();
const { shippingController } = require('../controllers');
const { protect, adminOnly } = require('../middleware/auth');

// Public routes
router.get('/config', shippingController.getShippingConfig);
router.get('/serviceability', shippingController.checkServiceability);
router.post('/estimate', shippingController.estimateShipping);

// Protected routes
router.get('/track/:awbCode', protect, shippingController.getTracking);

// Admin routes
router.get('/couriers', protect, adminOnly, shippingController.getCouriers);

module.exports = router;

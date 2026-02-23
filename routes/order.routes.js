const express = require('express');
const router = express.Router();
const { orderController } = require('../controllers');
const { protect, adminOnly } = require('../middleware/auth');

// Protected user routes
router.use(protect);

router.post('/', orderController.createOrder);
router.post('/verify-payment', orderController.verifyPayment);
router.get('/', orderController.getOrders);
router.get('/number/:orderNumber', orderController.getOrderByNumber);
router.get('/:id/tracking', orderController.getTracking);
router.get('/:id', orderController.getOrder);
router.put('/:id/cancel', orderController.cancelOrder);

// Admin routes
router.get('/admin/all', adminOnly, orderController.getAllOrders);
router.put('/:id/status', adminOnly, orderController.updateStatus);
router.post('/:id/shipment', adminOnly, orderController.createShipment);

module.exports = router;

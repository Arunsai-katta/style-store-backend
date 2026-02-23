const express = require('express');
const router = express.Router();
const { cartController } = require('../controllers');
const { protect } = require('../middleware/auth');

// All cart routes are protected
router.use(protect);

router.get('/', cartController.getCart);
router.post('/items', cartController.addItem);
router.put('/items/:itemId', cartController.updateQuantity);
router.delete('/items/:itemId', cartController.removeItem);
router.delete('/', cartController.clearCart);
router.post('/coupon', cartController.applyCoupon);
router.delete('/coupon', cartController.removeCoupon);
router.post('/sync', cartController.syncCart);

module.exports = router;

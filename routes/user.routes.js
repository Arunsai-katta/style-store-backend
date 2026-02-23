const express = require('express');
const router = express.Router();
const { userController } = require('../controllers');
const { protect } = require('../middleware/auth');

// All user routes are protected
router.use(protect);

router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);

// Addresses
router.get('/addresses', userController.getProfile);
router.post('/addresses', userController.addAddress);
router.put('/addresses/:addressId', userController.updateAddress);
router.delete('/addresses/:addressId', userController.deleteAddress);
router.put('/addresses/:addressId/default', userController.setDefaultAddress);

// Wishlist
router.get('/wishlist', userController.getWishlist);
router.post('/wishlist', userController.addToWishlist);
router.delete('/wishlist/:productId', userController.removeFromWishlist);

module.exports = router;

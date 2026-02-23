const express = require('express');
const router = express.Router();
const { reviewController } = require('../controllers');
const { protect, adminOnly } = require('../middleware/auth');

// Public routes
router.get('/product/:productId', reviewController.getProductReviews);

// Protected user routes
router.post('/', protect, reviewController.createReview);
router.get('/my-reviews', protect, reviewController.getMyReviews);
router.put('/:id', protect, reviewController.updateReview);
router.delete('/:id', protect, reviewController.deleteReview);
router.post('/:id/helpful', protect, reviewController.markHelpful);

// Admin routes
router.get('/admin/all', protect, adminOnly, reviewController.getAllReviews);
router.put('/:id/respond', protect, adminOnly, reviewController.respondToReview);
router.put('/:id/toggle', protect, adminOnly, reviewController.toggleReview);

module.exports = router;

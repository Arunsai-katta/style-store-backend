const express = require('express');
const router = express.Router();
const { productController } = require('../controllers');
const { protect, adminOnly } = require('../middleware/auth');

// Public routes
router.get('/', productController.getProducts);
router.get('/new-arrivals', productController.getNewArrivals);
router.get('/featured', productController.getFeaturedProducts);
router.get('/category/:category', productController.getProductsByCategory);
router.get('/filters/:category', productController.getProductFilters);
router.get('/slug/:slug', productController.getProductBySlug);
router.get('/:id/related', productController.getRelatedProducts);
router.get('/:id', productController.getProduct);

// Protected admin routes
router.post('/', protect, adminOnly, productController.createProduct);
router.put('/:id', protect, adminOnly, productController.updateProduct);
router.delete('/:id', protect, adminOnly, productController.deleteProduct);
router.put('/:id/stock', protect, adminOnly, productController.updateStock);
router.put('/:id/featured', protect, adminOnly, productController.toggleFeatured);
router.get('/admin/all', protect, adminOnly, productController.getAllProductsAdmin);

module.exports = router;

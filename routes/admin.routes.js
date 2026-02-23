const express = require('express');
const router = express.Router();
const { adminController } = require('../controllers');
const { protect, adminOnly } = require('../middleware/auth');

// All admin routes are protected and require admin role
router.use(protect, adminOnly);

// User management
router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUser);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);

// Customer management (with order stats)
router.get('/customers', adminController.getCustomers);
router.get('/customers/:id/orders', adminController.getCustomerOrders);

// Overview & settings
router.get('/overview', adminController.getOverview);
router.get('/settings', adminController.getSettings);
router.put('/settings', adminController.updateSettings);

module.exports = router;

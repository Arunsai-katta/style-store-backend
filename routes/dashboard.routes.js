const express = require('express');
const router = express.Router();
const { dashboardController } = require('../controllers');
const { protect, adminOnly } = require('../middleware/auth');

// All dashboard routes are protected and require admin role
router.use(protect, adminOnly);

router.get('/stats', dashboardController.getDashboardStats);

module.exports = router;

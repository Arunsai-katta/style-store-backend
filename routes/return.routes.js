const express = require('express');
const router = express.Router();
const { returnController } = require('../controllers');
const { protect, adminOnly } = require('../middleware/auth');

// Protected user routes
router.use(protect);

router.post('/', returnController.createReturn);
router.get('/', returnController.getReturns);
router.get('/:id', returnController.getReturn);
router.get('/:id/refund-status', returnController.getRefundStatus);
router.put('/:id/cancel', returnController.cancelReturn);

// Admin routes
router.get('/admin/all', adminOnly, returnController.getAllReturns);
router.get('/admin/statistics', adminOnly, returnController.getReturnStatistics);
router.put('/:id/approve', adminOnly, returnController.approveReturn);
router.put('/:id/reject', adminOnly, returnController.rejectReturn);
router.put('/:id/inspect', adminOnly, returnController.inspectReturn);
router.put('/:id/refund', adminOnly, returnController.processRefund);
router.put('/:id/mark-refunded', adminOnly, returnController.markRefunded);

module.exports = router;

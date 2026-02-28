const express = require('express');
const router = express.Router();
const { authController } = require('../controllers');
const { protect } = require('../middleware/auth');

// Public routes
router.post('/send-otp', authController.sendOtp);
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/admin/login', authController.adminLogin);
router.post('/forgotpassword', authController.forgotPassword);
router.put('/resetpassword/:resettoken', authController.resetPassword);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/create-admin', authController.createAdmin);

// Protected routes
router.post('/logout', protect, authController.logout);
router.get('/me', protect, authController.getMe);
router.put('/updatedetails', protect, authController.updateDetails);
router.put('/updatepassword', protect, authController.updatePassword);

module.exports = router;

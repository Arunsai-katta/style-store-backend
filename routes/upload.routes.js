const express = require('express');
const router = express.Router();
const { uploadController } = require('../controllers');
const { protect, adminOnly } = require('../middleware/auth');
const { uploadSingle, uploadMultiple } = require('../middleware/upload');

// All upload routes are protected and require admin role
router.use(protect, adminOnly);

router.post('/single', uploadSingle('image'), uploadController.uploadSingle);
router.post('/multiple', uploadMultiple('images', 10), uploadController.uploadMultiple);
router.delete('/', uploadController.deleteImage);
router.delete('/multiple', uploadController.deleteMultipleImages);
router.delete('/by-url', uploadController.deleteByUrl);
router.post('/signed-url', uploadController.getSignedUrl);

module.exports = router;

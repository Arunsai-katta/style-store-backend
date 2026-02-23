const { s3Service } = require('../services');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// @desc    Upload single image
// @route   POST /api/upload/single
// @access  Private/Admin
exports.uploadSingle = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('Please upload an image', 400);
  }
  
  const { folder = 'products' } = req.body;
  
  const result = await s3Service.uploadImage(req.file, folder);
  
  res.status(200).json({
    success: true,
    message: 'Image uploaded successfully',
    url: result.url,
    key: result.key
  });
});

// @desc    Upload multiple images
// @route   POST /api/upload/multiple
// @access  Private/Admin
exports.uploadMultiple = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('Please upload at least one image', 400);
  }
  
  const { folder = 'products' } = req.body;
  
  const result = await s3Service.uploadMultipleImages(req.files, folder);
  
  res.status(200).json({
    success: true,
    message: `${req.files.length} images uploaded successfully`,
    urls: result.urls,
    keys: result.keys
  });
});

// @desc    Delete image from S3
// @route   DELETE /api/upload
// @access  Private/Admin
exports.deleteImage = asyncHandler(async (req, res) => {
  const { key } = req.body;
  
  if (!key) {
    throw new AppError('Please provide image key', 400);
  }
  
  await s3Service.deleteImage(key);
  
  res.status(200).json({
    success: true,
    message: 'Image deleted successfully'
  });
});

// @desc    Delete multiple images from S3
// @route   DELETE /api/upload/multiple
// @access  Private/Admin
exports.deleteMultipleImages = asyncHandler(async (req, res) => {
  const { keys } = req.body;
  
  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    throw new AppError('Please provide image keys', 400);
  }
  
  await s3Service.deleteMultipleImages(keys);
  
  res.status(200).json({
    success: true,
    message: `${keys.length} images deleted successfully`
  });
});

// @desc    Get signed URL for temporary access
// @route   POST /api/upload/signed-url
// @access  Private
exports.getSignedUrl = asyncHandler(async (req, res) => {
  const { key, expiresIn = 3600 } = req.body;
  
  if (!key) {
    throw new AppError('Please provide image key', 400);
  }
  
  const result = await s3Service.getSignedUrl(key, expiresIn);
  
  res.status(200).json({
    success: true,
    url: result.url
  });
});

// @desc    Extract key from URL and delete
// @route   DELETE /api/upload/by-url
// @access  Private/Admin
exports.deleteByUrl = asyncHandler(async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    throw new AppError('Please provide image URL', 400);
  }
  
  const key = s3Service.extractKeyFromUrl(url);
  if (!key) {
    throw new AppError('Invalid image URL', 400);
  }
  
  await s3Service.deleteImage(key);
  
  res.status(200).json({
    success: true,
    message: 'Image deleted successfully'
  });
});

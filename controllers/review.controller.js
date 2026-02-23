const { Review, Order, Product } = require('../models');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// @desc    Create review
// @route   POST /api/reviews
// @access  Private
exports.createReview = asyncHandler(async (req, res) => {
  const { productId, orderId, rating, title, comment, images } = req.body;
  
  // Validate input
  if (!productId || !orderId || !rating || !comment) {
    throw new AppError('Please provide all required fields', 400);
  }
  
  // Check if order exists and belongs to user
  const order = await Order.findOne({
    _id: orderId,
    user: req.userId,
    status: 'delivered'
  });
  
  if (!order) {
    throw new AppError('Order not found or not delivered yet', 404);
  }
  
  // Check if product exists in order
  const orderItem = order.items.find(item => 
    item.product.toString() === productId
  );
  
  if (!orderItem) {
    throw new AppError('Product not found in this order', 400);
  }
  
  // Check if review already exists
  const existingReview = await Review.findOne({
    product: productId,
    user: req.userId,
    order: orderId
  });
  
  if (existingReview) {
    throw new AppError('You have already reviewed this product', 400);
  }
  
  // Create review
  const review = await Review.create({
    product: productId,
    user: req.userId,
    order: orderId,
    rating,
    title: title || '',
    comment,
    images: images || [],
    isVerifiedPurchase: true
  });
  
  // Populate and return
  const populatedReview = await Review.findById(review._id)
    .populate('user', 'name avatar');
  
  res.status(201).json({
    success: true,
    message: 'Review submitted successfully',
    review: populatedReview
  });
});

// @desc    Get product reviews
// @route   GET /api/reviews/product/:productId
// @access  Public
exports.getProductReviews = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { page = 1, limit = 10, sort = '-createdAt' } = req.query;
  
  const skip = (Number(page) - 1) * Number(limit);
  
  const reviews = await Review.find({
    product: productId,
    isActive: true
  })
    .sort(sort)
    .skip(skip)
    .limit(Number(limit))
    .populate('user', 'name avatar');
  
  const total = await Review.countDocuments({
    product: productId,
    isActive: true
  });
  
  // Get rating statistics
  const ratingStats = await Review.aggregate([
    { $match: { product: productId, isActive: true } },
    {
      $group: {
        _id: '$rating',
        count: { $sum: 1 }
      }
    }
  ]);
  
  const ratingDistribution = {
    5: 0, 4: 0, 3: 0, 2: 0, 1: 0
  };
  
  ratingStats.forEach(stat => {
    ratingDistribution[stat._id] = stat.count;
  });
  
  // Get average rating
  const avgRatingData = await Review.getAverageRating(productId);
  const averageRating = parseFloat(avgRatingData.averageRating) || 0;
  
  res.status(200).json({
    success: true,
    count: reviews.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    },
    averageRating,
    ratingDistribution,
    reviews
  });
});

// @desc    Get user's reviews
// @route   GET /api/reviews/my-reviews
// @access  Private
exports.getMyReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  
  const skip = (Number(page) - 1) * Number(limit);
  
  const reviews = await Review.find({ user: req.userId })
    .sort('-createdAt')
    .skip(skip)
    .limit(Number(limit))
    .populate('product', 'name colorVariants');
  
  const total = await Review.countDocuments({ user: req.userId });
  
  res.status(200).json({
    success: true,
    count: reviews.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    },
    reviews
  });
});

// @desc    Update review
// @route   PUT /api/reviews/:id
// @access  Private
exports.updateReview = asyncHandler(async (req, res) => {
  const { rating, title, comment, images } = req.body;
  
  const review = await Review.findOne({
    _id: req.params.id,
    user: req.userId
  });
  
  if (!review) {
    throw new AppError('Review not found', 404);
  }
  
  // Update fields
  if (rating) review.rating = rating;
  if (title !== undefined) review.title = title;
  if (comment) review.comment = comment;
  if (images) review.images = images;
  
  await review.save();
  
  const updatedReview = await Review.findById(review._id)
    .populate('user', 'name avatar')
    .populate('product', 'name');
  
  res.status(200).json({
    success: true,
    message: 'Review updated successfully',
    review: updatedReview
  });
});

// @desc    Delete review
// @route   DELETE /api/reviews/:id
// @access  Private
exports.deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findOne({
    _id: req.params.id,
    user: req.userId
  });
  
  if (!review) {
    throw new AppError('Review not found', 404);
  }
  
  // Soft delete
  review.isActive = false;
  await review.save();
  
  res.status(200).json({
    success: true,
    message: 'Review deleted successfully'
  });
});

// @desc    Mark review as helpful
// @route   POST /api/reviews/:id/helpful
// @access  Private
exports.markHelpful = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  
  if (!review) {
    throw new AppError('Review not found', 404);
  }
  
  await review.markHelpful(req.userId);
  
  res.status(200).json({
    success: true,
    message: 'Review marked as helpful',
    helpfulCount: review.helpful.count
  });
});

// ==================== ADMIN CONTROLLERS ====================

// @desc    Get all reviews (Admin)
// @route   GET /api/reviews/admin/all
// @access  Private/Admin
exports.getAllReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, productId, rating, search } = req.query;
  
  const query = {};
  
  if (productId) query.product = productId;
  if (rating) query.rating = Number(rating);
  
  const skip = (Number(page) - 1) * Number(limit);
  
  const reviews = await Review.find(query)
    .sort('-createdAt')
    .skip(skip)
    .limit(Number(limit))
    .populate('user', 'name email')
    .populate('product', 'name');
  
  const total = await Review.countDocuments(query);
  
  res.status(200).json({
    success: true,
    count: reviews.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    },
    reviews
  });
});

// @desc    Respond to review (Admin)
// @route   PUT /api/reviews/:id/respond
// @access  Private/Admin
exports.respondToReview = asyncHandler(async (req, res) => {
  const { comment } = req.body;
  
  const review = await Review.findById(req.params.id);
  if (!review) {
    throw new AppError('Review not found', 404);
  }
  
  review.adminResponse = {
    comment,
    respondedAt: new Date(),
    respondedBy: req.userId
  };
  
  await review.save();
  
  res.status(200).json({
    success: true,
    message: 'Response added successfully',
    review
  });
});

// @desc    Toggle review visibility (Admin)
// @route   PUT /api/reviews/:id/toggle
// @access  Private/Admin
exports.toggleReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    throw new AppError('Review not found', 404);
  }
  
  review.isActive = !review.isActive;
  await review.save();
  
  res.status(200).json({
    success: true,
    message: `Review ${review.isActive ? 'activated' : 'deactivated'}`,
    review
  });
});

const { Product } = require('../models');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// @desc    Get all products
// @route   GET /api/products
// @access  Public
exports.getProducts = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 12,
    sort = '-createdAt',
    category,
    minPrice,
    maxPrice,
    color,
    size,
    search,
    isNew,
    isFeatured
  } = req.query;

  // Build query
  const query = { isActive: true };

  // Category filter
  if (category) {
    query.category = category;
  }

  // Price filter
  if (minPrice || maxPrice) {
    query.sellingPrice = {};
    if (minPrice) query.sellingPrice.$gte = Number(minPrice);
    if (maxPrice) query.sellingPrice.$lte = Number(maxPrice);
  }

  // Color filter
  if (color) {
    query['colorVariants.colorName'] = { $regex: color, $options: 'i' };
  }

  // Size filter
  if (size) {
    query['colorVariants.sizes.size'] = size.toUpperCase();
  }

  // New arrivals
  if (isNew === 'true') {
    query.isNewArrival = true;
  }

  // Featured
  if (isFeatured === 'true') {
    query.isFeatured = true;
  }

  // Search — regex across name, category and description
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  // Pagination
  const skip = (Number(page) - 1) * Number(limit);

  // Execute query
  const products = await Product.find(query)
    .sort(sort)
    .skip(skip)
    .limit(Number(limit))
    .populate('reviews', 'rating');

  // Get total count
  const total = await Product.countDocuments(query);

  res.status(200).json({
    success: true,
    count: products.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    },
    products
  });
});

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
exports.getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate({
      path: 'reviews',
      populate: {
        path: 'user',
        select: 'name avatar'
      }
    });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  res.status(200).json({
    success: true,
    product
  });
});

// @desc    Get product by slug (for SEO-friendly URLs)
// @route   GET /api/products/slug/:slug
// @access  Public
exports.getProductBySlug = asyncHandler(async (req, res) => {
  // For now, using ID as slug - can be enhanced later
  const product = await Product.findById(req.params.slug)
    .populate({
      path: 'reviews',
      populate: {
        path: 'user',
        select: 'name avatar'
      }
    });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  res.status(200).json({
    success: true,
    product
  });
});

// @desc    Get related products
// @route   GET /api/products/:id/related
// @access  Public
exports.getRelatedProducts = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  const relatedProducts = await Product.find({
    category: product.category,
    _id: { $ne: product._id },
    isActive: true
  })
    .limit(4)
    .select('name sellingPrice originalPrice colorVariants');

  res.status(200).json({
    success: true,
    count: relatedProducts.length,
    products: relatedProducts
  });
});

// @desc    Get new arrivals
// @route   GET /api/products/new-arrivals
// @access  Public
exports.getNewArrivals = asyncHandler(async (req, res) => {
  const { limit = 6 } = req.query;

  const products = await Product.find({ isActive: true, isNewArrival: true })
    .sort('-createdAt')
    .limit(Number(limit))
    .select('name sellingPrice originalPrice colorVariants category');

  res.status(200).json({
    success: true,
    count: products.length,
    products
  });
});

// @desc    Get featured products
// @route   GET /api/products/featured
// @access  Public
exports.getFeaturedProducts = asyncHandler(async (req, res) => {
  const { limit = 8 } = req.query;

  const products = await Product.find({ isActive: true, isFeatured: true })
    .sort('-createdAt')
    .limit(Number(limit))
    .select('name sellingPrice originalPrice colorVariants category');

  res.status(200).json({
    success: true,
    count: products.length,
    products
  });
});

// @desc    Get products by category
// @route   GET /api/products/category/:category
// @access  Public
exports.getProductsByCategory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 12, sort = '-createdAt' } = req.query;
  const { category } = req.params;

  const validCategories = ['t-shirts', 'hoodies', 'sweatshirts'];
  if (!validCategories.includes(category)) {
    throw new AppError('Invalid category', 400);
  }

  const skip = (Number(page) - 1) * Number(limit);

  const products = await Product.find({
    category,
    isActive: true
  })
    .sort(sort)
    .skip(skip)
    .limit(Number(limit));

  const total = await Product.countDocuments({ category, isActive: true });

  res.status(200).json({
    success: true,
    count: products.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    },
    products
  });
});

// @desc    Get product filters (min/max prices, available colors, sizes)
// @route   GET /api/products/filters/:category
// @access  Public
exports.getProductFilters = asyncHandler(async (req, res) => {
  const { category } = req.params;

  const matchStage = { isActive: true };
  if (category && category !== 'all') {
    matchStage.category = category;
  }

  const [priceRange, colors, sizes] = await Promise.all([
    // Get price range
    Product.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          minPrice: { $min: '$sellingPrice' },
          maxPrice: { $max: '$sellingPrice' }
        }
      }
    ]),
    // Get available colors
    Product.aggregate([
      { $match: matchStage },
      { $unwind: '$colorVariants' },
      {
        $group: {
          _id: '$colorVariants.colorName',
          colorCode: { $first: '$colorVariants.colorCode' }
        }
      }
    ]),
    // Get available sizes
    Product.aggregate([
      { $match: matchStage },
      { $unwind: '$colorVariants' },
      { $unwind: '$colorVariants.sizes' },
      {
        $group: {
          _id: '$colorVariants.sizes.size'
        }
      }
    ])
  ]);

  res.status(200).json({
    success: true,
    filters: {
      priceRange: priceRange[0] || { minPrice: 0, maxPrice: 0 },
      colors: colors.map(c => ({ name: c._id, code: c.colorCode })),
      sizes: sizes.map(s => s._id).sort()
    }
  });
});

// ==================== ADMIN CONTROLLERS ====================

// @desc    Create product (Admin)
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = asyncHandler(async (req, res) => {
  const product = await Product.create(req.body);

  res.status(201).json({
    success: true,
    product
  });
});

// @desc    Update product (Admin)
// @route   PUT /api/products/:id
// @access  Private/Admin
exports.updateProduct = asyncHandler(async (req, res) => {
  let product = await Product.findById(req.params.id);

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  product = await Product.findByIdAndUpdate(
    req.params.id,
    req.body,
    {
      new: true,
      runValidators: true
    }
  );

  res.status(200).json({
    success: true,
    product
  });
});

// @desc    Delete product (Admin)
// @route   DELETE /api/products/:id
// @access  Private/Admin
exports.deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  // Soft delete
  product.isActive = false;
  await product.save();

  res.status(200).json({
    success: true,
    message: 'Product deleted successfully'
  });
});

// @desc    Update product stock (Admin)
// @route   PUT /api/products/:id/stock
// @access  Private/Admin
exports.updateStock = asyncHandler(async (req, res) => {
  const { colorVariantId, size, quantity } = req.body;

  const product = await Product.findById(req.params.id);

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  const colorVariant = product.colorVariants.id(colorVariantId);
  if (!colorVariant) {
    throw new AppError('Color variant not found', 404);
  }

  const sizeVariant = colorVariant.sizes.find(s => s.size === size);
  if (!sizeVariant) {
    throw new AppError('Size variant not found', 404);
  }

  sizeVariant.quantity = quantity;
  await product.save();

  res.status(200).json({
    success: true,
    message: 'Stock updated successfully',
    product
  });
});

// @desc    Toggle featured status (Admin)
// @route   PUT /api/products/:id/featured
// @access  Private/Admin
exports.toggleFeatured = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  product.isFeatured = !product.isFeatured;
  await product.save();

  res.status(200).json({
    success: true,
    message: `Product ${product.isFeatured ? 'marked as featured' : 'removed from featured'}`,
    product
  });
});

// @desc    Get all products for admin (including inactive)
// @route   GET /api/products/admin/all
// @access  Private/Admin
exports.getAllProductsAdmin = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search, stockAlert } = req.query;

  const query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { sku: { $regex: search, $options: 'i' } }
    ];
  }

  // Get products with low stock
  if (stockAlert === 'true') {
    query.$expr = {
      $lt: [
        { $sum: { $map: { input: '$colorVariants', as: 'cv', in: { $sum: '$$cv.sizes.quantity' } } } },
        10
      ]
    };
  }

  const skip = (Number(page) - 1) * Number(limit);

  const products = await Product.find(query)
    .sort('-createdAt')
    .skip(skip)
    .limit(Number(limit));

  const total = await Product.countDocuments(query);

  res.status(200).json({
    success: true,
    count: products.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    },
    products
  });
});

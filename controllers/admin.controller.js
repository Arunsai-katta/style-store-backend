const { User, Order, Product } = require('../models');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search, role } = req.query;

  const query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }

  if (role) query.role = role;

  const skip = (Number(page) - 1) * Number(limit);

  const users = await User.find(query)
    .sort('-createdAt')
    .skip(skip)
    .limit(Number(limit))
    .select('-password');

  const total = await User.countDocuments(query);

  res.status(200).json({
    success: true,
    count: users.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    },
    users
  });
});

// @desc    Get single user
// @route   GET /api/admin/users/:id
// @access  Private/Admin
exports.getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .select('-password')
    .populate('orders', 'orderNumber status pricing total createdAt');

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.status(200).json({
    success: true,
    user
  });
});

// @desc    Update user
// @route   PUT /api/admin/users/:id
// @access  Private/Admin
exports.updateUser = asyncHandler(async (req, res) => {
  const { name, email, phone, role, isActive } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Update fields
  if (name) user.name = name;
  if (email) user.email = email;
  if (phone) user.phone = phone;
  if (role) user.role = role;
  if (isActive !== undefined) user.isActive = isActive;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'User updated successfully',
    user: user.getPublicProfile()
  });
});

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Soft delete
  user.isActive = false;
  await user.save();

  res.status(200).json({
    success: true,
    message: 'User deactivated successfully'
  });
});

// @desc    Get admin dashboard overview
// @route   GET /api/admin/overview
// @access  Private/Admin
exports.getOverview = asyncHandler(async (req, res) => {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    todayStats,
    monthStats,
    totalStats,
    pendingOrders,
    lowStockProducts,
    recentUsers
  ] = await Promise.all([
    // Today's stats
    Order.aggregate([
      { $match: { createdAt: { $gte: startOfDay } } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: { $cond: [{ $eq: ['$payment.status', 'completed'] }, '$pricing.total', 0] } }
        }
      }
    ]),

    // Month stats
    Order.aggregate([
      { $match: { createdAt: { $gte: startOfMonth } } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: { $cond: [{ $eq: ['$payment.status', 'completed'] }, '$pricing.total', 0] } }
        }
      }
    ]),

    // Total stats
    Order.aggregate([
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: { $cond: [{ $eq: ['$payment.status', 'completed'] }, '$pricing.total', 0] } }
        }
      }
    ]),

    // Pending orders
    Order.countDocuments({ status: { $in: ['pending', 'confirmed', 'processing'] } }),

    // Low stock products
    Product.find({
      isActive: true,
      $expr: {
        $lt: [
          { $sum: { $map: { input: '$colorVariants', as: 'cv', in: { $sum: '$$cv.sizes.quantity' } } } },
          10
        ]
      }
    }).limit(5).select('name sku colorVariants'),

    // Recent users
    User.find({ role: 'user' })
      .sort('-createdAt')
      .limit(5)
      .select('name email createdAt')
  ]);

  res.status(200).json({
    success: true,
    overview: {
      today: {
        orders: todayStats[0]?.orders || 0,
        revenue: todayStats[0]?.revenue || 0
      },
      month: {
        orders: monthStats[0]?.orders || 0,
        revenue: monthStats[0]?.revenue || 0
      },
      total: {
        orders: totalStats[0]?.orders || 0,
        revenue: totalStats[0]?.revenue || 0
      },
      pendingOrders,
      lowStockProducts,
      recentUsers
    }
  });
});

// @desc    Get application settings
// @route   GET /api/admin/settings
// @access  Private/Admin
exports.getSettings = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    settings: {
      returnExchangeDays: parseInt(process.env.RETURN_EXCHANGE_DAYS) || 7,
      codMaxOrderAmount: parseInt(process.env.COD_MAX_ORDER_AMOUNT) || 5000,
      codMinPrepaidAmount: parseInt(process.env.COD_MIN_PREPAID_AMOUNT) || 500,
      staticShippingCost: parseInt(process.env.STATIC_SHIPPING_COST) || 100,
      razorpayConfigured: !!process.env.RAZORPAY_KEY_ID,
      shiprocketConfigured: !!process.env.SHIPROCKET_EMAIL,
      s3Configured: !!process.env.AWS_S3_BUCKET_NAME
    }
  });
});

// @desc    Update application settings
// @route   PUT /api/admin/settings
// @access  Private/Admin
exports.updateSettings = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Settings updated successfully. Please restart the server for changes to take effect.',
    note: 'Settings are stored in environment variables. Update the .env file and restart the server.'
  });
});

// @desc    Get all customers (users with role='user') with order stats
// @route   GET /api/admin/customers
// @access  Private/Admin
exports.getCustomers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const matchStage = { role: 'user' };
  if (search) {
    matchStage.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }

  const [customers, total] = await Promise.all([
    User.aggregate([
      { $match: matchStage },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: Number(limit) },
      {
        // Join with orders to compute per-customer stats
        $lookup: {
          from: 'orders',
          localField: '_id',
          foreignField: 'user',
          as: 'orders'
        }
      },
      {
        $addFields: {
          orderCount: { $size: '$orders' },
          totalSpent: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: '$orders',
                    as: 'o',
                    cond: { $eq: ['$$o.payment.status', 'completed'] }
                  }
                },
                as: 'paid',
                in: '$$paid.pricing.total'
              }
            }
          }
        }
      },
      {
        // Never expose password
        $project: {
          password: 0,
          orders: 0,
          resetPasswordToken: 0,
          resetPasswordExpire: 0,
          emailVerifyToken: 0,
          emailVerifyExpire: 0
        }
      }
    ]),
    User.countDocuments(matchStage)
  ]);

  res.status(200).json({
    success: true,
    count: customers.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit))
    },
    customers
  });
});

// @desc    Get orders for a specific customer
// @route   GET /api/admin/customers/:id/orders
// @access  Private/Admin
exports.getCustomerOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.params.id })
    .sort('-createdAt')
    .select('orderNumber status pricing payment createdAt items');

  res.status(200).json({
    success: true,
    count: orders.length,
    orders
  });
});


const { Order, Product, User, Return } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');

// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
// @access  Private/Admin
exports.getDashboardStats = asyncHandler(async (req, res) => {
  let { startDate, endDate, dateRange } = req.query;

  // Handle predefined date ranges
  if (dateRange && !startDate && !endDate) {
    const now = new Date();
    endDate = new Date(); // Current time as endDate
    if (dateRange === 'today') {
      startDate = new Date(now.setHours(0, 0, 0, 0));
    } else if (dateRange === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      startDate = new Date(now.setDate(diff));
      startDate.setHours(0, 0, 0, 0);
    } else if (dateRange === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (dateRange === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }
  }

  // Build date filter
  const dateFilter = {};
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
    if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
  }

  // Get counts and totals
  const [
    totalOrders,
    totalRevenue,
    pendingOrders,
    totalCustomers,
    lowStockProducts,
    recentOrders,
    salesByStatus,
    dailySales
  ] = await Promise.all([
    // Total orders
    Order.countDocuments(dateFilter),

    // Total revenue
    Order.aggregate([
      { $match: { ...dateFilter, 'payment.status': 'completed' } },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } }
    ]),

    // Pending orders
    Order.countDocuments({ ...dateFilter, status: { $in: ['pending', 'confirmed', 'processing'] } }),

    // Total customers
    User.countDocuments({ role: 'user' }),

    // Low stock products
    Product.find({
      isActive: true,
      $expr: {
        $lt: [
          { $sum: { $map: { input: '$colorVariants', as: 'cv', in: { $sum: '$$cv.sizes.quantity' } } } },
          10
        ]
      }
    }).select('name sku colorVariants').limit(10),

    // Recent orders
    Order.find(dateFilter)
      .sort('-createdAt')
      .limit(5)
      .populate('user', 'name email')
      .select('orderNumber status pricing total createdAt'),

    // Sales by status
    Order.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),

    // Daily sales (dynamic based on dateFilter, defaulting to last 7 days)
    Order.aggregate([
      {
        $match: {
          ...(dateFilter.createdAt ? { createdAt: dateFilter.createdAt } : { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
          'payment.status': 'completed'
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          sales: { $sum: '$pricing.total' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);

  // Calculate return requests
  const returnRequests = await Return.countDocuments({ status: 'pending' });

  res.status(200).json({
    success: true,
    stats: {
      totalOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
      pendingOrders,
      totalCustomers,
      returnRequests,
      lowStockCount: lowStockProducts.length
    },
    lowStockProducts,
    recentOrders,
    salesByStatus: salesByStatus.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {}),
    dailySales
  });
});

// Removed unused statistics API controllers since the statistics page is consolidated.

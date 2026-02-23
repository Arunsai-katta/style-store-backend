const { Order, Product, User, Return } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');

// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
// @access  Private/Admin
exports.getDashboardStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
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
    
    // Daily sales (last 7 days)
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
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

// @desc    Get sales statistics
// @route   GET /api/dashboard/sales
// @access  Private/Admin
exports.getSalesStats = asyncHandler(async (req, res) => {
  const { startDate, endDate, groupBy = 'day' } = req.query;
  
  // Build date filter
  const dateFilter = {
    'payment.status': 'completed'
  };
  
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
    if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
  }
  
  // Determine grouping format
  let groupFormat;
  switch (groupBy) {
    case 'month':
      groupFormat = '%Y-%m';
      break;
    case 'week':
      groupFormat = '%Y-W%U';
      break;
    case 'year':
      groupFormat = '%Y';
      break;
    default:
      groupFormat = '%Y-%m-%d';
  }
  
  const salesStats = await Order.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: { $dateToString: { format: groupFormat, date: '$createdAt' } },
        revenue: { $sum: '$pricing.total' },
        subtotal: { $sum: '$pricing.subtotal' },
        shipping: { $sum: '$pricing.shippingCost' },
        discount: { $sum: '$pricing.discount' },
        orders: { $sum: 1 },
        items: { $sum: { $size: '$items' } }
      }
    },
    { $sort: { _id: 1 } }
  ]);
  
  // Get product-wise sales
  const productSales = await Order.aggregate([
    { $match: dateFilter },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        productName: { $first: '$items.name' },
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.totalPrice' }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: 20 }
  ]);
  
  // Get category-wise sales
  const categorySales = await Order.aggregate([
    { $match: dateFilter },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'productDetails'
      }
    },
    { $unwind: '$productDetails' },
    {
      $group: {
        _id: '$productDetails.category',
        revenue: { $sum: '$items.totalPrice' },
        quantity: { $sum: '$items.quantity' },
        orders: { $addToSet: '$_id' }
      }
    },
    {
      $project: {
        category: '$_id',
        revenue: 1,
        quantity: 1,
        orderCount: { $size: '$orders' }
      }
    }
  ]);
  
  res.status(200).json({
    success: true,
    salesStats,
    productSales,
    categorySales
  });
});

// @desc    Get product statistics
// @route   GET /api/dashboard/products
// @access  Private/Admin
exports.getProductStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  const dateFilter = {};
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
    if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
  }
  
  const [
    totalProducts,
    activeProducts,
    newProducts,
    outOfStockProducts,
    categoryCounts
  ] = await Promise.all([
    Product.countDocuments(),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ ...dateFilter, isNewArrival: true }),
    Product.countDocuments({
      isActive: true,
      $expr: {
        $eq: [
          { $sum: { $map: { input: '$colorVariants', as: 'cv', in: { $sum: '$$cv.sizes.quantity' } } } },
          0
        ]
      }
    }),
    Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ])
  ]);
  
  res.status(200).json({
    success: true,
    stats: {
      totalProducts,
      activeProducts,
      newProducts,
      outOfStockProducts
    },
    categoryCounts: categoryCounts.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {})
  });
});

// @desc    Get customer statistics
// @route   GET /api/dashboard/customers
// @access  Private/Admin
exports.getCustomerStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  const dateFilter = { role: 'user' };
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
    if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
  }
  
  const [
    totalCustomers,
    newCustomers,
    activeCustomers,
    topCustomers
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments(dateFilter),
    User.countDocuments({ role: 'user', lastLogin: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
    Order.aggregate([
      { $match: { 'payment.status': 'completed' } },
      {
        $group: {
          _id: '$user',
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$pricing.total' }
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails'
        }
      },
      { $unwind: '$userDetails' },
      {
        $project: {
          name: '$userDetails.name',
          email: '$userDetails.email',
          totalOrders: 1,
          totalSpent: 1
        }
      }
    ])
  ]);
  
  res.status(200).json({
    success: true,
    stats: {
      totalCustomers,
      newCustomers,
      activeCustomers
    },
    topCustomers
  });
});

// @desc    Get order statistics
// @route   GET /api/dashboard/orders
// @access  Private/Admin
exports.getOrderStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  const dateFilter = {};
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
    if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
  }
  
  const [
    statusCounts,
    paymentMethodCounts,
    averageOrderValue,
    ordersByHour
  ] = await Promise.all([
    Order.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    Order.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$payment.method', count: { $sum: 1 } } }
    ]),
    Order.aggregate([
      { $match: { ...dateFilter, 'payment.status': 'completed' } },
      { $group: { _id: null, average: { $avg: '$pricing.total' } } }
    ]),
    Order.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);
  
  res.status(200).json({
    success: true,
    statusCounts: statusCounts.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {}),
    paymentMethodCounts: paymentMethodCounts.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {}),
    averageOrderValue: averageOrderValue[0]?.average || 0,
    ordersByHour
  });
});

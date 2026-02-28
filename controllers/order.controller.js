const { Order, Cart, Product } = require('../models');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { razorpayService, shiprocketService } = require('../services');

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
exports.createOrder = asyncHandler(async (req, res) => {
  const {
    shippingAddress,
    billingAddress,
    paymentMethod,
    items: directItems
  } = req.body;

  // Get items from cart or direct items
  let orderItems = [];
  let cart = null;

  if (directItems && directItems.length > 0) {
    // Buy now flow
    for (const item of directItems) {
      const product = await Product.findById(item.productId);
      if (!product || !product.isActive) {
        throw new AppError('Product not found', 404);
      }

      const colorVariant = product.colorVariants.id(item.colorVariantId);
      if (!colorVariant) {
        throw new AppError('Color variant not found', 404);
      }

      const sizeVariant = colorVariant.sizes.find(s => s.size === item.size);
      if (!sizeVariant || sizeVariant.quantity < item.quantity) {
        throw new AppError(`Insufficient stock for ${product.name} - ${item.size}`, 400);
      }

      orderItems.push({
        product: item.productId,
        name: product.name,
        colorVariant: {
          colorName: colorVariant.colorName,
          colorCode: colorVariant.colorCode,
          image: colorVariant.images[0]
        },
        size: item.size,
        quantity: item.quantity,
        originalPrice: product.originalPrice,
        sellingPrice: product.sellingPrice,
        totalPrice: product.sellingPrice * item.quantity
      });
    }
  } else {
    // Cart flow
    cart = await Cart.findOne({ user: req.userId });
    if (!cart || cart.items.length === 0) {
      throw new AppError('Your cart is empty', 400);
    }

    // Validate stock for all items
    for (const item of cart.items) {
      const product = await Product.findById(item.product);
      if (!product || !product.isActive) {
        throw new AppError(`Product ${item.name} is no longer available`, 400);
      }

      const colorVariant = product.colorVariants.id(item.colorVariantId);
      if (!colorVariant) {
        throw new AppError(`Color variant for ${item.name} is not available`, 400);
      }

      const sizeVariant = colorVariant.sizes.find(s => s.size === item.size);
      if (!sizeVariant || sizeVariant.quantity < item.quantity) {
        throw new AppError(`Insufficient stock for ${item.name} - ${item.size}`, 400);
      }

      orderItems.push({
        product: item.product,
        name: product.name,
        colorVariant: {
          colorName: item.colorName,
          colorCode: item.colorCode,
          image: item.image
        },
        size: item.size,
        quantity: item.quantity,
        originalPrice: item.originalPrice,
        sellingPrice: item.sellingPrice,
        totalPrice: item.sellingPrice * item.quantity
      });
    }
  }

  // Calculate pricing
  const subtotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const shippingCost = subtotal >= 5000 ? 0 : parseInt(process.env.STATIC_SHIPPING_COST) || 100;
  const total = subtotal + shippingCost;

  // Check COD eligibility
  if (paymentMethod === 'cod') {
    const codMaxAmount = parseInt(process.env.COD_MAX_ORDER_AMOUNT) || 5000;
    if (total > codMaxAmount) {
      throw new AppError(`COD is only available for orders up to ₹${codMaxAmount}`, 400);
    }
  }

  // Create order
  const order = await Order.create({
    user: req.userId,
    items: orderItems,
    shippingAddress,
    billingAddress: billingAddress || shippingAddress,
    payment: {
      method: paymentMethod,
      status: 'pending',
      // For COD: store the advance Razorpay payment ID so we can refund it later
      ...(paymentMethod === 'cod' && req.body.codAdvancePaymentId ? {
        razorpayPaymentId: req.body.codAdvancePaymentId,
        codAdvanceAmount: parseFloat(req.body.codAdvanceAmount) || 0,
        status: 'partially_paid'  // only advance amount paid, rest is COD
      } : {})
    },
    pricing: {
      subtotal,
      shippingCost,
      total
    },
    // COD orders with advance payment are immediately confirmed
    ...(paymentMethod === 'cod' && req.body.codAdvancePaymentId ? {
      status: 'confirmed'
    } : {})
  });

  // Add timeline event for COD orders
  if (paymentMethod === 'cod' && req.body.codAdvancePaymentId) {
    order.addTimelineEvent('confirmed', 'Order confirmed with COD advance payment');
    await order.save();
  }

  // Handle payment based on method
  let paymentData = null;
  if (paymentMethod === 'razorpay') {
    // Create Razorpay order
    paymentData = await razorpayService.createOrder(
      total,
      order.orderNumber,
      { orderId: order._id.toString() }
    );

    order.payment.razorpayOrderId = paymentData.orderId;
    await order.save();
  }

  // For COD orders: cart is cleared immediately since no payment step follows.
  // For Razorpay: cart is cleared only after payment is verified (inside verifyPayment)
  // to avoid losing the cart if the user's payment fails.
  if (cart && paymentMethod === 'cod') {
    await Cart.findByIdAndDelete(cart._id);
  } else if (cart) {
    // Store cartId on the order so verifyPayment can clean it up later
    order._cartId = cart._id;
    // We re-save the order with the razorpayOrderId already set above
    // the cartId is transient and not persisted — verifyPayment receives it from the client
  }

  res.status(201).json({
    success: true,
    order,
    paymentData,
    // Surface cartId to the frontend so it can pass it back during payment verification
    cartId: cart ? cart._id : undefined
  });
});

// @desc    Verify Razorpay payment
// @route   POST /api/orders/verify-payment
// @access  Private
exports.verifyPayment = asyncHandler(async (req, res) => {
  const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  // Verify signature
  const verification = razorpayService.verifyPayment(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );

  if (!verification.success) {
    order.payment.status = 'failed';
    await order.save();
    throw new AppError('Payment verification failed', 400);
  }

  // Update order
  order.payment.status = 'completed';
  order.payment.razorpayPaymentId = razorpayPaymentId;
  order.payment.razorpaySignature = razorpaySignature;
  order.payment.paidAt = new Date();
  order.status = 'confirmed';
  order.addTimelineEvent('confirmed', 'Order confirmed and payment received');
  await order.save();

  // Atomically decrement stock — uses $inc with a $gte guard so two concurrent
  // orders cannot both succeed when only one unit remains.
  for (const item of order.items) {
    const updateResult = await Product.updateOne(
      {
        _id: item.product,
        'colorVariants.colorName': item.colorVariant.colorName,
        'colorVariants.sizes': {
          $elemMatch: { size: item.size, quantity: { $gte: item.quantity } }
        }
      },
      {
        $inc: {
          'colorVariants.$[cv].sizes.$[sz].quantity': -item.quantity
        }
      },
      {
        arrayFilters: [
          { 'cv.colorName': item.colorVariant.colorName },
          { 'sz.size': item.size }
        ]
      }
    );

    if (updateResult.modifiedCount === 0) {
      // This means the $gte guard failed — another concurrent order grabbed the last stock.
      // Log and continue; the admin will need to handle the oversell manually.
      console.error(
        `Stock underflow for product ${item.product} / ${item.colorVariant.colorName} / ${item.size}`
      );
    }
  }

  // Clear cart now that payment is confirmed (cartId supplied by frontend)
  if (req.body.cartId) {
    await Cart.findByIdAndDelete(req.body.cartId);
  }

  res.status(200).json({
    success: true,
    message: 'Payment verified successfully',
    order
  });
});

// @desc    Retry payment for a pending Razorpay order
// @route   POST /api/orders/:id/retry-payment
// @access  Private
exports.retryPayment = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.userId
  });

  if (!order) {
    throw new AppError('Order not found', 404);
  }

  if (order.status !== 'pending' || order.payment.method !== 'razorpay' || order.payment.status !== 'pending') {
    throw new AppError('This order cannot be retried for payment', 400);
  }

  // Check if previous Razorpay order is still valid, or create a new one
  let paymentData;
  try {
    // Create a fresh Razorpay order for the same amount
    paymentData = await razorpayService.createOrder(
      order.pricing.total,
      order.orderNumber,
      { orderId: order._id.toString() }
    );

    // Update the order with the new Razorpay order ID
    order.payment.razorpayOrderId = paymentData.orderId;
    await order.save();
  } catch (error) {
    throw new AppError('Failed to initiate payment. Please try again.', 500);
  }

  res.status(200).json({
    success: true,
    order,
    paymentData
  });
});

// @desc    Get user's orders
// @route   GET /api/orders
// @access  Private
exports.getOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;

  const query = { user: req.userId };
  if (status) query.status = status;

  const skip = (Number(page) - 1) * Number(limit);

  const orders = await Order.find(query)
    .sort('-createdAt')
    .skip(skip)
    .limit(Number(limit))
    .select('orderNumber status pricing total payment shipping createdAt items.name items.quantity items.colorVariant items.size items.product items.sellingPrice items.totalPrice');

  const total = await Order.countDocuments(query);

  res.status(200).json({
    success: true,
    count: orders.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    },
    orders
  });
});

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
exports.getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.userId
  }).populate('items.product', 'name colorVariants');

  if (!order) {
    throw new AppError('Order not found', 404);
  }

  res.status(200).json({
    success: true,
    order
  });
});

// @desc    Get order by order number
// @route   GET /api/orders/number/:orderNumber
// @access  Private
exports.getOrderByNumber = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    orderNumber: req.params.orderNumber,
    user: req.userId
  }).populate('items.product', 'name colorVariants');

  if (!order) {
    throw new AppError('Order not found', 404);
  }

  res.status(200).json({
    success: true,
    order
  });
});

// @desc    Cancel order
// @route   PUT /api/orders/:id/cancel
// @access  Private
exports.cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.userId
  });

  if (!order) {
    throw new AppError('Order not found', 404);
  }

  // Check if order can be cancelled
  const cancellableStatuses = ['pending', 'confirmed', 'processing'];
  if (!cancellableStatuses.includes(order.status)) {
    throw new AppError('Order cannot be cancelled at this stage', 400);
  }

  // Atomically restore stock
  for (const item of order.items) {
    await Product.updateOne(
      {
        _id: item.product,
        'colorVariants.colorName': item.colorVariant.colorName
      },
      {
        $inc: {
          'colorVariants.$[cv].sizes.$[sz].quantity': item.quantity
        }
      },
      {
        arrayFilters: [
          { 'cv.colorName': item.colorVariant.colorName },
          { 'sz.size': item.size }
        ]
      }
    );
  }

  // Process refund if payment was made
  if (order.payment.status === 'completed' && order.payment.razorpayPaymentId) {
    try {
      const refund = await razorpayService.refundPayment(
        order.payment.razorpayPaymentId,
        order.pricing.total,
        { reason: 'Order cancelled by customer' }
      );
      order.payment.status = 'refunded';
      order.payment.refundedAt = new Date();
      order.payment.refundAmount = order.pricing.total;
    } catch (error) {
      console.error('Refund error:', error);
    }
  }

  order.status = 'cancelled';
  order.addTimelineEvent('cancelled', 'Order cancelled by customer');
  await order.save();

  res.status(200).json({
    success: true,
    message: 'Order cancelled successfully',
    order
  });
});

// @desc    Get order tracking
// @route   GET /api/orders/:id/tracking
// @access  Private
exports.getTracking = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.userId
  });

  if (!order) {
    throw new AppError('Order not found', 404);
  }

  if (!order.shipping.awbCode) {
    return res.status(200).json({
      success: true,
      tracking: null,
      timeline: order.timeline.filter(t => t.isPublic)
    });
  }

  // Get tracking from Shiprocket
  let trackingData = null;
  try {
    trackingData = await shiprocketService.getTracking(order.shipping.awbCode);
  } catch (error) {
    console.error('Tracking error:', error);
  }

  res.status(200).json({
    success: true,
    tracking: trackingData?.tracking || null,
    awbCode: order.shipping.awbCode,
    courierName: order.shipping.courierName,
    trackingUrl: order.shipping.trackingUrl,
    timeline: order.timeline.filter(t => t.isPublic)
  });
});

// ==================== ADMIN CONTROLLERS ====================

// @desc    Get all orders (Admin)
// @route   GET /api/orders/admin/all
// @access  Private/Admin
exports.getAllOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, search, startDate, endDate } = req.query;

  const query = {};

  if (status) query.status = status;

  if (search) {
    query.$or = [
      { orderNumber: { $regex: search, $options: 'i' } }
    ];
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const skip = (Number(page) - 1) * Number(limit);

  const orders = await Order.find(query)
    .sort('-createdAt')
    .skip(skip)
    .limit(Number(limit))
    .populate('user', 'name email phone');

  const total = await Order.countDocuments(query);

  res.status(200).json({
    success: true,
    count: orders.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    },
    orders
  });
});

// @desc    Update order status (Admin)
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
exports.updateStatus = asyncHandler(async (req, res) => {
  const { status, description } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  order.status = status;
  order.addTimelineEvent(status, description || `Order status updated to ${status}`);

  // Handle specific status changes
  if (status === 'shipped') {
    order.shipping.shippedAt = new Date();
  } else if (status === 'delivered') {
    order.shipping.deliveredAt = new Date();
  }

  await order.save();

  res.status(200).json({
    success: true,
    message: 'Order status updated',
    order
  });
});

// @desc    Create shipment (Admin) — pack and dispatch via Shiprocket
// @route   POST /api/orders/:id/shipment
// @access  Private/Admin
exports.createShipment = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('user', 'email');
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  if (!['confirmed', 'processing'].includes(order.status)) {
    throw new AppError('Order must be in confirmed or processing status to ship', 400);
  }

  // Admin provides actual packed-box dimensions & weight from the request body.
  // Falls back to reasonable defaults so the call still works if fields are omitted.
  const weight = parseFloat(req.body.weight) || 0.5;     // kg
  const length = parseFloat(req.body.length) || 25;      // cm
  const breadth = parseFloat(req.body.breadth) || 20;    // cm
  const height = parseFloat(req.body.height) || 5;     // cm

  const shipmentData = {
    orderNumber: order.orderNumber,
    pickupLocation: 'Primary',
    billingAddress: order.shippingAddress,
    customerEmail: order.user.email,
    items: order.items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      sellingPrice: item.sellingPrice,
      originalPrice: item.originalPrice
    })),
    paymentMethod: order.payment.method,
    shippingCost: order.pricing.shippingCost,
    discount: order.pricing.discount || 0,
    subtotal: order.pricing.subtotal,
    weight,
    dimensions: { length, breadth, height }
  };

  // Step 1: Create Shiprocket order
  const shipment = await shiprocketService.createOrder(shipmentData);

  // Step 2: Assign AWB (auto-selects best courier)
  const awb = await shiprocketService.generateAWB(shipment.shipmentId);

  // Step 3: Persist shipping details & advance status to shipped
  // Guard: initialise the sub-doc if it doesn't exist yet (older orders).
  if (!order.shipping) order.shipping = {};
  order.shipping.shipmentId = shipment.shipmentId;
  order.shipping.awbCode = awb.awbCode;
  order.shipping.courierId = awb.courierId;
  order.shipping.courierName = awb.courierName;
  order.shipping.trackingUrl = awb.trackingUrl;
  order.shipping.status = 'label_generated';
  order.shipping.shippedAt = new Date();
  order.status = 'shipped';
  order.addTimelineEvent('shipped', `Shipped via ${awb.courierName}. AWB: ${awb.awbCode}`);
  await order.save();

  res.status(200).json({
    success: true,
    message: 'Shipment created successfully',
    shipment: {
      shipmentId: shipment.shipmentId,
      awbCode: awb.awbCode,
      courierName: awb.courierName,
      trackingUrl: awb.trackingUrl
    }
  });
});

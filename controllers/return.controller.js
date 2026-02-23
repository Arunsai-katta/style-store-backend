const { Return, Order, Product } = require('../models');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { razorpayService, razorpayPayoutService, shiprocketService } = require('../services');

// @desc    Create return request
// @route   POST /api/returns
// @access  Private
exports.createReturn = asyncHandler(async (req, res) => {
  const { orderId, items, upiId, bankDetails } = req.body;

  // Get order
  const order = await Order.findOne({
    _id: orderId,
    user: req.userId
  });

  if (!order) {
    throw new AppError('Order not found', 404);
  }

  // Check if order is eligible for return
  if (!order.canReturn()) {
    throw new AppError('Order is no longer eligible for return', 400);
  }

  // Check if return already exists
  const existingReturn = await Return.findOne({ order: orderId });
  if (existingReturn) {
    throw new AppError('Return request already exists for this order', 400);
  }

  const isCod = order.payment.method === 'cod';

  // COD orders MUST provide UPI or bank — we can't refund to a card.
  if (isCod && !upiId && (!bankDetails || !bankDetails.accountNumber)) {
    throw new AppError(
      'Please provide your UPI ID or bank account details to receive the refund for COD orders',
      400
    );
  }

  // Auto-detect refund method
  let refundMethod = 'original_payment'; // Razorpay orders → back to card
  if (isCod) {
    refundMethod = upiId ? 'upi' : 'bank_transfer';
  }

  // Validate items
  const returnItems = [];
  let totalRefundAmount = 0;

  for (const item of items) {
    const orderItem = order.items.id(item.orderItemId);
    if (!orderItem) {
      throw new AppError('Order item not found', 404);
    }

    if (item.quantity > orderItem.quantity) {
      throw new AppError('Return quantity cannot exceed ordered quantity', 400);
    }

    const refundAmount = orderItem.sellingPrice * item.quantity;
    totalRefundAmount += refundAmount;

    returnItems.push({
      orderItem: item.orderItemId,
      product: orderItem.product,
      name: orderItem.name,
      colorName: orderItem.colorVariant.colorName,
      size: orderItem.size,
      quantity: item.quantity,
      reason: item.reason,
      reasonDescription: item.reasonDescription || '',
      images: item.images || [],
      refundAmount
    });
  }

  // Create return
  const returnRequest = await Return.create({
    order: orderId,
    user: req.userId,
    items: returnItems,
    refundDetails: {
      totalAmount: totalRefundAmount,
      method: refundMethod,
      upiId: upiId || undefined,
      bankDetails: bankDetails || undefined,
    },
    status: 'pending'
  });

  // Update order status
  order.status = 'return_requested';
  order.addTimelineEvent('return_requested', 'Return request submitted by customer');
  await order.save();

  res.status(201).json({
    success: true,
    message: 'Return request created successfully',
    returnRequest
  });
});

// @desc    Get user's returns
// @route   GET /api/returns
// @access  Private
exports.getReturns = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const skip = (Number(page) - 1) * Number(limit);

  const returns = await Return.find({ user: req.userId })
    .sort('-requestedAt')
    .skip(skip)
    .limit(Number(limit))
    .populate('order', 'orderNumber');

  const total = await Return.countDocuments({ user: req.userId });

  res.status(200).json({
    success: true,
    count: returns.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    },
    returns
  });
});

// @desc    Get single return
// @route   GET /api/returns/:id
// @access  Private
exports.getReturn = asyncHandler(async (req, res) => {
  const returnRequest = await Return.findOne({
    _id: req.params.id,
    user: req.userId
  }).populate('order', 'orderNumber shippingAddress');

  if (!returnRequest) {
    throw new AppError('Return request not found', 404);
  }

  res.status(200).json({
    success: true,
    returnRequest
  });
});

// @desc    Cancel return request
// @route   PUT /api/returns/:id/cancel
// @access  Private
exports.cancelReturn = asyncHandler(async (req, res) => {
  const returnRequest = await Return.findOne({
    _id: req.params.id,
    user: req.userId
  });

  if (!returnRequest) {
    throw new AppError('Return request not found', 404);
  }

  // Check if return can be cancelled
  const cancellableStatuses = ['pending', 'approved'];
  if (!cancellableStatuses.includes(returnRequest.status)) {
    throw new AppError('Return request cannot be cancelled at this stage', 400);
  }

  returnRequest.status = 'cancelled';
  await returnRequest.save();

  // Update order status back to delivered
  const order = await Order.findById(returnRequest.order);
  if (order) {
    order.status = 'delivered';
    order.addTimelineEvent('return_cancelled', 'Return request cancelled by customer');
    await order.save();
  }

  res.status(200).json({
    success: true,
    message: 'Return request cancelled',
    returnRequest
  });
});

// ==================== ADMIN CONTROLLERS ====================

// @desc    Get all returns (Admin)
// @route   GET /api/returns/admin/all
// @access  Private/Admin
exports.getAllReturns = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;

  const query = {};

  if (status) query.status = status;

  if (search) {
    query.$or = [
      { returnNumber: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);

  const returns = await Return.find(query)
    .sort('-requestedAt')
    .skip(skip)
    .limit(Number(limit))
    .populate('user', 'name email phone')
    .populate('order', 'orderNumber');

  const total = await Return.countDocuments(query);

  res.status(200).json({
    success: true,
    count: returns.length,
    total,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    },
    returns
  });
});

// @desc    Approve return (Admin)
// @route   PUT /api/returns/:id/approve
// @access  Private/Admin
exports.approveReturn = asyncHandler(async (req, res) => {
  const { adminNotes } = req.body;

  const returnRequest = await Return.findById(req.params.id);
  if (!returnRequest) {
    throw new AppError('Return request not found', 404);
  }

  if (returnRequest.status !== 'pending') {
    throw new AppError('Return request is not pending', 400);
  }

  returnRequest.status = 'approved';
  returnRequest.adminNotes = adminNotes || '';
  await returnRequest.save();

  // Schedule pickup via Shiprocket
  try {
    const order = await Order.findById(returnRequest.order);
    if (order) {
      const returnData = {
        originalOrderId: order.orderNumber,
        pickupAddress: order.shippingAddress,
        customerEmail: order.user.email,
        returnAddress: {
          name: 'Store Name',
          addressLine1: '123 Return Street',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
          phone: '9876543210'
        },
        returnEmail: 'returns@store.com',
        items: returnRequest.items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          sellingPrice: item.refundAmount / item.quantity
        })),
        subtotal: returnRequest.refundDetails.totalAmount
      };

      const returnShipment = await shiprocketService.createReturnOrder(returnData);
      returnRequest.pickupDetails.shipmentId = returnShipment.returnShipmentId;
    }
  } catch (error) {
    console.error('Return shipment creation error:', error);
  }

  res.status(200).json({
    success: true,
    message: 'Return request approved',
    returnRequest
  });
});

// @desc    Reject return (Admin)
// @route   PUT /api/returns/:id/reject
// @access  Private/Admin
exports.rejectReturn = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const returnRequest = await Return.findById(req.params.id);
  if (!returnRequest) {
    throw new AppError('Return request not found', 404);
  }

  if (returnRequest.status !== 'pending') {
    throw new AppError('Return request is not pending', 400);
  }

  returnRequest.status = 'rejected';
  returnRequest.rejectionReason = reason || '';
  await returnRequest.save();

  // Update order status back to delivered
  const order = await Order.findById(returnRequest.order);
  if (order) {
    order.status = 'delivered';
    order.addTimelineEvent('return_rejected', `Return request rejected: ${reason}`);
    await order.save();
  }

  res.status(200).json({
    success: true,
    message: 'Return request rejected',
    returnRequest
  });
});

// @desc    Update inspection details (Admin)
// @route   PUT /api/returns/:id/inspect
// @access  Private/Admin
exports.inspectReturn = asyncHandler(async (req, res) => {
  const { condition, notes, images } = req.body;

  const returnRequest = await Return.findById(req.params.id);
  if (!returnRequest) {
    throw new AppError('Return request not found', 404);
  }

  if (returnRequest.status !== 'received') {
    throw new AppError('Return item not yet received', 400);
  }

  returnRequest.inspectionDetails = {
    inspectedBy: req.userId,
    inspectedAt: new Date(),
    condition,
    notes,
    images: images || []
  };

  returnRequest.status = 'inspected';
  await returnRequest.save();

  res.status(200).json({
    success: true,
    message: 'Inspection completed',
    returnRequest
  });
});

// @desc    Process refund (Admin)
// @route   PUT /api/returns/:id/refund
// @access  Private/Admin
exports.processRefund = asyncHandler(async (req, res) => {
  const returnRequest = await Return.findById(req.params.id);
  if (!returnRequest) throw new AppError('Return request not found', 404);

  if (!['approved', 'inspected'].includes(returnRequest.status)) {
    throw new AppError('Return not ready for refund', 400);
  }

  const order = await Order.findById(returnRequest.order).populate('user', 'name email phone');
  if (!order) throw new AppError('Order not found', 404);

  const totalRefund = returnRequest.refundDetails.totalAmount;
  const isCod = order.payment.method === 'cod';

  let refundTransactionId = null;
  let payoutId = null;
  let payoutStatus = 'not_required';
  let isManual = false;

  if (isCod) {
    // ── COD refund ───────────────────────────────────────────────────────────
    const upiId = returnRequest.refundDetails.upiId;
    const bankDetails = returnRequest.refundDetails.bankDetails;

    if (!upiId && (!bankDetails || !bankDetails.accountNumber)) {
      throw new AppError('No UPI or bank details found on this return request', 400);
    }

    const hasRazorpayX = !!process.env.RAZORPAY_X_ACCOUNT_NUMBER;

    if (hasRazorpayX) {
      // ── AUTO: Razorpay X payout ────────────────────────────────────────────
      try {
        const contact = await razorpayPayoutService.createContact({
          name: order.user?.name || 'Customer',
          email: order.user?.email,
          phone: order.user?.phone || order.shippingAddress?.phone,
          reference: returnRequest.returnNumber,
        });
        const fundAccount = await razorpayPayoutService.createFundAccount({
          contactId: contact.id,
          upiId: upiId || undefined,
          bankDetails: bankDetails || undefined,
        });
        const payout = await razorpayPayoutService.createPayout({
          fundAccountId: fundAccount.id,
          amount: totalRefund,
          reference: returnRequest.returnNumber,
          narration: `Refund for order ${order.orderNumber}`,
        });
        payoutId = payout.id;
        payoutStatus = payout.status || 'processing';
      } catch (error) {
        console.error('Payout error:', error?.response?.data || error.message);
        throw new AppError(
          'Failed to initiate payout: ' + (error?.response?.data?.error?.description || error.message),
          500
        );
      }
      returnRequest.refundDetails.payoutId = payoutId;
      returnRequest.refundDetails.payoutStatus = payoutStatus;

    } else {
      // ── MANUAL: No Razorpay X configured — admin will transfer manually ────
      isManual = true;
      payoutStatus = 'not_required';
      returnRequest.refundDetails.payoutStatus = 'not_required';
    }

  } else {
    // ── Razorpay: 100% refund back to original card ───────────────────────────
    if (!order.payment.razorpayPaymentId) {
      throw new AppError('No Razorpay payment ID found on this order', 400);
    }
    try {
      const refund = await razorpayService.refundPayment(
        order.payment.razorpayPaymentId,
        totalRefund,
        { reason: `Return refund for ${returnRequest.returnNumber}` }
      );
      refundTransactionId = refund.refundId;
    } catch (error) {
      console.error('Refund error:', error);
      throw new AppError('Failed to process Razorpay refund', 500);
    }
  }

  // Update return status
  // For manual COD: move to 'refund_initiated' so admin can Mark Refunded after manual transfer
  // For auto payout / Razorpay card: directly 'refunded'
  returnRequest.status = isManual ? 'refund_initiated' : 'refunded';
  returnRequest.refundDetails.processedAt = new Date();
  returnRequest.refundDetails.transactionId = refundTransactionId;
  await returnRequest.save();

  // Update order
  order.payment.status = isManual ? 'partially_refunded' : 'refunded';
  order.payment.refundAmount = (order.payment.refundAmount || 0) + totalRefund;
  const timelineMsg = isManual
    ? `₹${totalRefund} refund initiated. Admin will manually transfer to ${returnRequest.refundDetails.upiId ? `UPI: ${returnRequest.refundDetails.upiId}` : 'bank account'}.`
    : isCod
      ? `₹${totalRefund} payout initiated via ${returnRequest.refundDetails.upiId ? 'UPI' : 'bank transfer'}`
      : `₹${totalRefund} refunded to original card`;
  order.addTimelineEvent(isManual ? 'refund_initiated' : 'refunded', timelineMsg);
  await order.save();

  res.status(200).json({
    success: true,
    message: isManual
      ? `Manual transfer required. Please send ₹${totalRefund} to the customer's ${returnRequest.refundDetails.upiId ? 'UPI' : 'bank account'} and click "Mark Refunded".`
      : 'Refund processed successfully',
    isManual,
    refund: {
      total: totalRefund,
      method: isCod ? (isManual ? 'manual' : 'payout') : 'razorpay',
      upiId: returnRequest.refundDetails.upiId,
      bankDetails: returnRequest.refundDetails.bankDetails,
      transactionId: refundTransactionId,
      payoutId,
      payoutStatus,
    },
    returnRequest,
  });
});

// @desc    Mark refund as completed (Admin — manual transfer confirmation)
// @route   PUT /api/returns/:id/mark-refunded
// @access  Private/Admin
exports.markRefunded = asyncHandler(async (req, res) => {
  const returnRequest = await Return.findById(req.params.id);
  if (!returnRequest) throw new AppError('Return request not found', 404);

  if (returnRequest.status !== 'refund_initiated') {
    throw new AppError('This return is not waiting for manual refund confirmation', 400);
  }

  const order = await Order.findById(returnRequest.order);
  if (!order) throw new AppError('Order not found', 404);

  const { transactionReference } = req.body; // optional: admin can note UTR / UPI ref

  returnRequest.status = 'refunded';
  returnRequest.refundDetails.payoutStatus = 'processed';
  if (transactionReference) {
    returnRequest.refundDetails.transactionId = transactionReference;
  }
  await returnRequest.save();

  order.payment.status = 'refunded';
  order.addTimelineEvent('refunded', `₹${returnRequest.refundDetails.totalAmount} manually transferred to customer${transactionReference ? ` (Ref: ${transactionReference})` : ''}`);
  await order.save();

  res.status(200).json({
    success: true,
    message: 'Refund marked as completed',
    returnRequest,
  });
});



// @desc    Get live refund / payout status
// @route   GET /api/returns/:id/refund-status
// @access  Private
exports.getRefundStatus = asyncHandler(async (req, res) => {
  const returnRequest = await Return.findOne({
    _id: req.params.id,
    ...(req.isAdmin ? {} : { user: req.userId }) // admin can see all; user sees own
  });
  if (!returnRequest) throw new AppError('Return request not found', 404);

  const details = returnRequest.refundDetails;
  let livePayoutStatus = details.payoutStatus;

  // Poll live payout status from Razorpay if still in-flight
  if (details.payoutId && !['processed', 'failed', 'cancelled', 'not_required'].includes(details.payoutStatus)) {
    try {
      const live = await razorpayPayoutService.getPayoutStatus(details.payoutId);
      livePayoutStatus = live.status;
      // Persist updated status
      if (live.status !== details.payoutStatus) {
        returnRequest.refundDetails.payoutStatus = live.status;
        await returnRequest.save();
      }
    } catch (e) {
      console.error('Could not fetch payout status:', e.message);
    }
  }

  res.status(200).json({
    success: true,
    returnStatus: returnRequest.status,
    refund: {
      total: details.totalAmount,
      method: details.method,
      upiId: details.upiId,
      transactionId: details.transactionId,
      payoutId: details.payoutId,
      payoutStatus: livePayoutStatus,
      processedAt: details.processedAt,
    },
  });
});



// @desc    Get return statistics (Admin)
// @route   GET /api/returns/admin/statistics
// @access  Private/Admin
exports.getReturnStatistics = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const matchStage = {};

  if (startDate || endDate) {
    matchStage.requestedAt = {};
    if (startDate) matchStage.requestedAt.$gte = new Date(startDate);
    if (endDate) matchStage.requestedAt.$lte = new Date(endDate);
  }

  const stats = await Return.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalReturns: { $sum: 1 },
        pending: {
          $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
        },
        approved: {
          $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] }
        },
        rejected: {
          $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
        },
        refunded: {
          $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] }
        },
        totalRefundAmount: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'refunded'] },
              '$refundDetails.totalAmount',
              0
            ]
          }
        }
      }
    }
  ]);

  res.status(200).json({
    success: true,
    statistics: stats[0] || {
      totalReturns: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      refunded: 0,
      totalRefundAmount: 0
    }
  });
});

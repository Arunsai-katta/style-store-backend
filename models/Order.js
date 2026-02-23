const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  colorVariant: {
    colorName: {
      type: String,
      required: true
    },
    colorCode: {
      type: String,
      required: true
    },
    image: {
      type: String,
      required: true
    }
  },
  size: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  originalPrice: {
    type: Number,
    required: true
  },
  sellingPrice: {
    type: Number,
    required: true
  },
  totalPrice: {
    type: Number,
    required: true
  }
}, { _id: true });

const shippingAddressSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  addressLine1: {
    type: String,
    required: true
  },
  addressLine2: {
    type: String,
    default: ''
  },
  city: {
    type: String,
    required: true
  },
  state: {
    type: String,
    required: true
  },
  pincode: {
    type: String,
    required: true
  },
  country: {
    type: String,
    default: 'India'
  }
}, { _id: false });

const paymentDetailsSchema = new mongoose.Schema({
  method: {
    type: String,
    enum: ['cod', 'razorpay', 'wallet'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded', 'partially_refunded'],
    default: 'pending'
  },
  razorpayOrderId: {
    type: String
  },
  razorpayPaymentId: {
    type: String
  },
  razorpaySignature: {
    type: String
  },
  paidAt: {
    type: Date
  },
  refundedAt: {
    type: Date
  },
  refundAmount: {
    type: Number,
    default: 0
  },
  refundReason: {
    type: String
  },
  // For COD orders: amount paid in advance via Razorpay
  codAdvanceAmount: {
    type: Number,
    default: 0
  }
}, { _id: false });

const shippingDetailsSchema = new mongoose.Schema({
  provider: {
    type: String,
    default: 'Shiprocket'
  },
  shipmentId: {
    type: String
  },
  awbCode: {
    type: String
  },
  courierName: {
    type: String
  },
  trackingUrl: {
    type: String
  },
  status: {
    type: String,
    enum: ['pending', 'label_generated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled', 'returned'],
    default: 'pending'
  },
  estimatedDelivery: {
    type: Date
  },
  shippedAt: {
    type: Date
  },
  deliveredAt: {
    type: Date
  },
  shippingCost: {
    type: Number,
    default: 0
  },
  weight: {
    type: Number
  },
  dimensions: {
    length: Number,
    width: Number,
    height: Number
  }
}, { _id: false });

const timelineEventSchema = new mongoose.Schema({
  status: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  isPublic: {
    type: Boolean,
    default: true
  }
}, { _id: true });

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [orderItemSchema],
  shippingAddress: shippingAddressSchema,
  billingAddress: shippingAddressSchema,
  payment: paymentDetailsSchema,
  shipping: shippingDetailsSchema,
  pricing: {
    subtotal: {
      type: Number,
      required: true
    },
    discount: {
      type: Number,
      default: 0
    },
    shippingCost: {
      type: Number,
      default: 0
    },
    tax: {
      type: Number,
      default: 0
    },
    total: {
      type: Number,
      required: true
    }
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned', 'refunded'],
    default: 'pending'
  },
  timeline: [timelineEventSchema],
  notes: {
    customer: {
      type: String,
      maxlength: 500
    },
    internal: {
      type: String
    }
  },
  returnEligibleUntil: {
    type: Date
  },
  isReturnEligible: {
    type: Boolean,
    default: true
  },
  couponCode: {
    type: String
  },
  couponDiscount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for return requests
orderSchema.virtual('returnRequest', {
  ref: 'Return',
  localField: '_id',
  foreignField: 'order'
});

// Generate order number before validation so required validator passes.
// Uses a retry loop to handle the (rare) case of collision on the unique index.
orderSchema.pre('validate', async function (next) {
  if (!this.orderNumber) {
    const generateOrderNumber = async (retries = 0) => {
      const now = new Date();
      const year = now.getFullYear().toString().slice(-2);
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const prefix = `ORD${year}${month}`;

      // Find the latest order with this prefix for the current month
      const latestOrder = await mongoose.model('Order').findOne({
        orderNumber: new RegExp(`^${prefix}`)
      }).sort({ orderNumber: -1 }).select('orderNumber').lean();

      let sequence = 1;
      if (latestOrder && latestOrder.orderNumber.startsWith(prefix)) {
        const lastSeqStr = latestOrder.orderNumber.substring(prefix.length);
        const lastSeq = parseInt(lastSeqStr, 10);
        if (!isNaN(lastSeq)) {
          sequence = lastSeq + 1;
        }
      }

      const candidate = `${prefix}${sequence.toString().padStart(3, '0')}`;

      // Double check for collision (important during high concurrency)
      const exists = await mongoose.model('Order').exists({ orderNumber: candidate });
      if (exists) {
        if (retries >= 5) throw new Error('Failed to generate unique order number after retries');
        // Simple delay before retry to let other processes finish
        await new Promise(resolve => setTimeout(resolve, 50));
        return generateOrderNumber(retries + 1);
      }
      return candidate;
    };

    try {
      this.orderNumber = await generateOrderNumber();
    } catch (err) {
      return next(err);
    }
  }

  // Set return eligibility date when order is delivered
  if (this.isModified('status') && this.status === 'delivered') {
    const returnDays = parseInt(process.env.RETURN_EXCHANGE_DAYS) || 7;
    this.returnEligibleUntil = new Date(Date.now() + returnDays * 24 * 60 * 60 * 1000);
    this.isReturnEligible = true;
    // Note: the 'delivered' timeline event is added by the controller via
    // addTimelineEvent() — we do NOT push it here to avoid duplicates.
  }

  next();
});

// Index for efficient queries
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ createdAt: -1 });

// Method to calculate totals
orderSchema.methods.calculateTotals = function () {
  this.pricing.subtotal = this.items.reduce((sum, item) => sum + item.totalPrice, 0);
  this.pricing.total = this.pricing.subtotal - this.pricing.discount + this.pricing.shippingCost + this.pricing.tax;
  return this.pricing;
};

// Method to check if return is eligible
orderSchema.methods.canReturn = function () {
  if (!this.isReturnEligible) return false;
  if (this.status !== 'delivered') return false;
  if (!this.returnEligibleUntil) return false;
  return new Date() <= this.returnEligibleUntil;
};

// Method to add timeline event
orderSchema.methods.addTimelineEvent = function (status, description, isPublic = true) {
  this.timeline.push({
    status,
    description,
    isPublic,
    timestamp: new Date()
  });
};

module.exports = mongoose.model('Order', orderSchema);

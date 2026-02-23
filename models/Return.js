const mongoose = require('mongoose');

const returnItemSchema = new mongoose.Schema({
  orderItem: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  colorName: {
    type: String,
    required: true
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
  reason: {
    type: String,
    required: true,
    enum: ['defective', 'wrong_item', 'not_as_described', 'size_issue', 'changed_mind', 'other']
  },
  reasonDescription: {
    type: String,
    maxlength: 500
  },
  images: [{
    type: String
  }],
  refundAmount: {
    type: Number,
    required: true
  }
}, { _id: true });

const returnSchema = new mongoose.Schema({
  returnNumber: {
    type: String,
    unique: true,
    required: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [returnItemSchema],
  refundDetails: {
    totalAmount: {
      type: Number,
      required: true
    },
    method: {
      type: String,
      enum: ['original_payment', 'store_credit', 'bank_transfer', 'upi'],
      default: 'original_payment'
    },
    // UPI for COD refunds
    upiId: {
      type: String,
      trim: true
    },
    // Bank account for COD refunds (alternative to UPI)
    bankDetails: {
      accountNumber: String,
      ifscCode: String,
      accountHolderName: String,
      bankName: String
    },
    // Razorpay Payout tracking
    payoutId: {
      type: String
    },
    payoutStatus: {
      type: String,
      enum: ['not_required', 'queued', 'processing', 'processed', 'cancelled', 'reversed', 'failed'],
      default: 'not_required'
    },
    manualTransferAmount: {
      type: Number,
      default: 0
    },
    processedAt: {
      type: Date
    },
    transactionId: {
      type: String
    }
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'pickup_scheduled', 'picked_up', 'received', 'inspected', 'refund_initiated', 'refunded', 'cancelled'],
    default: 'pending'
  },
  pickupDetails: {
    scheduledDate: {
      type: Date
    },
    courierName: {
      type: String
    },
    trackingNumber: {
      type: String
    },
    pickedUpAt: {
      type: Date
    }
  },
  inspectionDetails: {
    inspectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    inspectedAt: {
      type: Date
    },
    condition: {
      type: String,
      enum: ['excellent', 'good', 'fair', 'damaged', 'not_returnable']
    },
    notes: {
      type: String
    },
    images: [{
      type: String
    }]
  },
  adminNotes: {
    type: String
  },
  rejectionReason: {
    type: String
  },
  timeline: [{
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
  }],
  requestedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Generate return number before saving
returnSchema.pre('save', async function (next) {
  if (!this.returnNumber) {
    const prefix = 'RET';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    this.returnNumber = `${prefix}-${timestamp}-${random}`;
  }

  // Add timeline event for status changes
  if (this.isModified('status')) {
    const statusDescriptions = {
      'pending': 'Return request submitted',
      'approved': 'Return request approved',
      'rejected': 'Return request rejected',
      'pickup_scheduled': 'Pickup scheduled',
      'picked_up': 'Item picked up by courier',
      'received': 'Item received at warehouse',
      'inspected': 'Item inspected',
      'refund_initiated': 'Refund initiated',
      'refunded': 'Refund completed',
      'cancelled': 'Return request cancelled'
    };

    this.timeline.push({
      status: this.status,
      description: statusDescriptions[this.status] || `Status updated to ${this.status}`,
      timestamp: new Date(),
      isPublic: true
    });

    // Set completedAt if refunded
    if (this.status === 'refunded') {
      this.completedAt = new Date();
    }
  }

  next();
});

// Index for efficient queries
returnSchema.index({ order: 1 });
returnSchema.index({ user: 1 });
returnSchema.index({ status: 1 });
returnSchema.index({ requestedAt: -1 });

// Method to calculate total refund amount
returnSchema.methods.calculateRefundAmount = function () {
  return this.items.reduce((sum, item) => sum + item.refundAmount, 0);
};

// Method to add timeline event
returnSchema.methods.addTimelineEvent = function (status, description, isPublic = true) {
  this.timeline.push({
    status,
    description,
    timestamp: new Date(),
    isPublic
  });
};

module.exports = mongoose.model('Return', returnSchema);

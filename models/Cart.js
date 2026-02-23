const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  colorVariantId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
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
  },
  size: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  originalPrice: {
    type: Number,
    required: true
  },
  sellingPrice: {
    type: Number,
    required: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  items: [cartItemSchema],
  couponCode: {
    type: String
  },
  couponDiscount: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for cart totals
cartSchema.virtual('totals').get(function() {
  const subtotal = this.items.reduce((sum, item) => {
    return sum + (item.sellingPrice * item.quantity);
  }, 0);
  
  const totalItems = this.items.reduce((sum, item) => sum + item.quantity, 0);
  
  return {
    subtotal,
    discount: this.couponDiscount,
    total: Math.max(0, subtotal - this.couponDiscount),
    totalItems,
    itemCount: this.items.length
  };
});

// Update lastUpdated on modification
cartSchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  next();
});

// Method to add item to cart
cartSchema.methods.addItem = function(itemData) {
  const existingItemIndex = this.items.findIndex(item => 
    item.product.toString() === itemData.product.toString() &&
    item.colorVariantId.toString() === itemData.colorVariantId.toString() &&
    item.size === itemData.size
  );
  
  if (existingItemIndex > -1) {
    // Update quantity if item exists
    this.items[existingItemIndex].quantity += itemData.quantity;
  } else {
    // Add new item
    this.items.push(itemData);
  }
};

// Method to update item quantity
cartSchema.methods.updateQuantity = function(itemId, quantity) {
  const item = this.items.id(itemId);
  if (!item) {
    throw new Error('Item not found in cart');
  }
  
  if (quantity <= 0) {
    item.remove();
  } else {
    item.quantity = quantity;
  }
};

// Method to remove item from cart
cartSchema.methods.removeItem = function(itemId) {
  const item = this.items.id(itemId);
  if (!item) {
    throw new Error('Item not found in cart');
  }
  item.remove();
};

// Method to clear cart
cartSchema.methods.clear = function() {
  this.items = [];
  this.couponCode = undefined;
  this.couponDiscount = 0;
};

// Method to apply coupon
cartSchema.methods.applyCoupon = function(code, discountAmount) {
  this.couponCode = code;
  this.couponDiscount = discountAmount;
};

// Method to remove coupon
cartSchema.methods.removeCoupon = function() {
  this.couponCode = undefined;
  this.couponDiscount = 0;
};

module.exports = mongoose.model('Cart', cartSchema);

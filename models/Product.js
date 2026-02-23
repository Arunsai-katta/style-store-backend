const mongoose = require('mongoose');

const sizeSchema = new mongoose.Schema({
  size: {
    type: String,
    required: true,
    enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
  },
  quantity: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  }
}, { _id: true });

const colorVariantSchema = new mongoose.Schema({
  colorName: {
    type: String,
    required: true,
    trim: true
  },
  colorCode: {
    type: String,
    required: true,
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Please provide a valid hex color code']
  },
  images: [{
    type: String,
    required: true
  }],
  sizes: [sizeSchema],
  isActive: {
    type: Boolean,
    default: true
  }
}, { _id: true });

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    required: true,
    maxlength: 500
  },
  images: [{
    type: String
  }],
  isVerifiedPurchase: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide product name'],
    trim: true,
    maxlength: [100, 'Product name cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Please provide product description'],
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  shortDescription: {
    type: String,
    maxlength: [200, 'Short description cannot exceed 200 characters']
  },
  category: {
    type: String,
    required: [true, 'Please select a category'],
    enum: {
      values: ['t-shirts', 'hoodies', 'sweatshirts'],
      message: 'Category must be t-shirts, hoodies, or sweatshirts'
    }
  },
  subcategory: {
    type: String,
    trim: true
  },
  originalPrice: {
    type: Number,
    required: [true, 'Please provide original price'],
    min: [0, 'Price cannot be negative']
  },
  sellingPrice: {
    type: Number,
    required: [true, 'Please provide selling price'],
    min: [0, 'Price cannot be negative'],
  },
  colorVariants: [colorVariantSchema],
  tags: [{
    type: String,
    trim: true
  }],
  specifications: {
    material: {
      type: String,
      trim: true
    },
    fit: {
      type: String,
      enum: ['Slim', 'Regular', 'Relaxed', 'Oversized']
    },
    careInstructions: [{
      type: String
    }],
    weight: {
      type: Number
    },
    dimensions: {
      length: Number,
      width: Number,
      height: Number
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  isNewArrival: {
    type: Boolean,
    default: true
  },
  sku: {
    type: String,
    unique: true,
    sparse: true
  },
  metaTitle: {
    type: String,
    maxlength: 60
  },
  metaDescription: {
    type: String,
    maxlength: 160
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for calculating discount percentage
productSchema.virtual('discountPercentage').get(function () {
  if (this.originalPrice === 0) return 0;
  return Math.round(((this.originalPrice - this.sellingPrice) / this.originalPrice) * 100);
});

// Virtual for total stock across all variants
productSchema.virtual('totalStock').get(function () {
  if (!this.colorVariants || this.colorVariants.length === 0) return 0;

  return this.colorVariants.reduce((total, variant) => {
    if (!variant.sizes) return total;
    return total + variant.sizes.reduce((sizeTotal, size) => sizeTotal + (size.quantity || 0), 0);
  }, 0);
});

// Virtual for reviews
productSchema.virtual('reviews', {
  ref: 'Review',
  localField: '_id',
  foreignField: 'product'
});

// Virtual for average rating
productSchema.virtual('averageRating').get(function () {
  if (!this.reviews || this.reviews.length === 0) return 0;
  const sum = this.reviews.reduce((acc, review) => acc + review.rating, 0);
  return (sum / this.reviews.length).toFixed(1);
});

// Index for search
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ isFeatured: 1, isActive: 1 });
productSchema.index({ isNewArrival: 1, createdAt: -1 });
productSchema.index({ sellingPrice: 1 });

// Pre-save middleware to generate SKU if not provided
productSchema.pre('save', async function (next) {
  if (!this.sku) {
    // Format: P + category code + YY + MM + 3-digit sequential count
    // e.g. PT2601001, PH2601002, PS2602001
    const categoryCodeMap = {
      't-shirts': 'T',
      'hoodies': 'H',
      'sweatshirts': 'S',
    };
    const catCode = categoryCodeMap[this.category] || this.category.substring(0, 1).toUpperCase();
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);   // "26"
    const mm = String(now.getMonth() + 1).padStart(2, '0'); // "01"

    // Count products created this month in the same category to get the sequence
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const count = await this.constructor.countDocuments({
      category: this.category,
      createdAt: { $gte: startOfMonth }
    });
    const seq = String(count + 1).padStart(3, '0'); // "001", "002", ...

    this.sku = `P${catCode}${yy}${mm}${seq}`;
  }

  // Validate price relationship
  if (this.sellingPrice > this.originalPrice) {
    const error = new Error('Selling price cannot be greater than original price');
    return next(error);
  }

  next();
});

// Pre-update middleware to validate prices during updates
productSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate();

  if (update.sellingPrice && update.originalPrice) {
    if (update.sellingPrice > update.originalPrice) {
      const error = new Error('Selling price cannot be greater than original price');
      return next(error);
    }
  } else if (update.sellingPrice && !update.originalPrice) {
    // If only sellingPrice is being updated, we need to check against existing originalPrice
    // This is more complex, so for now we'll skip validation in this case
    // The application should send both prices when updating
  }

  next();
});

// Method to check stock availability
productSchema.methods.checkStock = function (colorId, size) {
  const colorVariant = this.colorVariants.id(colorId);
  if (!colorVariant) return { available: false, quantity: 0 };

  const sizeVariant = colorVariant.sizes.find(s => s.size === size);
  if (!sizeVariant) return { available: false, quantity: 0 };

  return {
    available: sizeVariant.quantity > 0,
    quantity: sizeVariant.quantity
  };
};

// Method to reduce stock
productSchema.methods.reduceStock = async function (colorId, size, quantity) {
  const colorVariant = this.colorVariants.id(colorId);
  if (!colorVariant) throw new Error('Color variant not found');

  const sizeVariant = colorVariant.sizes.find(s => s.size === size);
  if (!sizeVariant) throw new Error('Size variant not found');

  if (sizeVariant.quantity < quantity) {
    throw new Error('Insufficient stock');
  }

  sizeVariant.quantity -= quantity;
  await this.save();
};

module.exports = mongoose.model('Product', productSchema);

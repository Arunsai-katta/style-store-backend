const { Cart, Product } = require('../models');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// @desc    Get user's cart
// @route   GET /api/cart
// @access  Private
exports.getCart = asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ user: req.userId })
    .populate('items.product', 'name colorVariants isActive');
  
  if (!cart) {
    cart = await Cart.create({ user: req.userId, items: [] });
  }
  
  res.status(200).json({
    success: true,
    cart: {
      ...cart.toObject(),
      totals: cart.totals
    }
  });
});

// @desc    Add item to cart
// @route   POST /api/cart/items
// @access  Private
exports.addItem = asyncHandler(async (req, res) => {
  const { productId, colorVariantId, size, quantity = 1 } = req.body;
  
  // Validate input
  if (!productId || !colorVariantId || !size) {
    throw new AppError('Please provide productId, colorVariantId, and size', 400);
  }
  
  // Get product
  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    throw new AppError('Product not found or inactive', 404);
  }
  
  // Check color variant
  const colorVariant = product.colorVariants.id(colorVariantId);
  if (!colorVariant || !colorVariant.isActive) {
    throw new AppError('Color variant not found', 404);
  }
  
  // Check size availability
  const sizeVariant = colorVariant.sizes.find(s => s.size === size);
  if (!sizeVariant) {
    throw new AppError('Size not available', 400);
  }
  
  // Check stock
  if (sizeVariant.quantity < quantity) {
    throw new AppError(`Only ${sizeVariant.quantity} items available in stock`, 400);
  }
  
  // Get or create cart
  let cart = await Cart.findOne({ user: req.userId });
  if (!cart) {
    cart = new Cart({ user: req.userId, items: [] });
  }
  
  // Check if item already exists in cart
  const existingItemIndex = cart.items.findIndex(item => 
    item.product.toString() === productId &&
    item.colorVariantId.toString() === colorVariantId &&
    item.size === size
  );
  
  if (existingItemIndex > -1) {
    // Update quantity
    const newQuantity = cart.items[existingItemIndex].quantity + quantity;
    if (newQuantity > sizeVariant.quantity) {
      throw new AppError(`Cannot add more than ${sizeVariant.quantity} items`, 400);
    }
    cart.items[existingItemIndex].quantity = newQuantity;
  } else {
    // Add new item
    cart.items.push({
      product: productId,
      colorVariantId,
      colorName: colorVariant.colorName,
      colorCode: colorVariant.colorCode,
      image: colorVariant.images[0],
      size,
      quantity,
      originalPrice: product.originalPrice,
      sellingPrice: product.sellingPrice
    });
  }
  
  await cart.save();
  
  // Populate and return
  cart = await Cart.findById(cart._id)
    .populate('items.product', 'name colorVariants isActive');
  
  res.status(200).json({
    success: true,
    message: 'Item added to cart',
    cart: {
      ...cart.toObject(),
      totals: cart.totals
    }
  });
});

// @desc    Update cart item quantity
// @route   PUT /api/cart/items/:itemId
// @access  Private
exports.updateQuantity = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  const { itemId } = req.params;
  
  if (quantity === undefined || quantity < 0) {
    throw new AppError('Please provide valid quantity', 400);
  }
  
  const cart = await Cart.findOne({ user: req.userId });
  if (!cart) {
    throw new AppError('Cart not found', 404);
  }

  const item = cart.items.id(itemId);
  if (!item) {
    throw new AppError('Item not found in cart', 404);
  }

  // Check stock availability
  const product = await Product.findById(item.product);
  const colorVariant = product.colorVariants.id(item.colorVariantId);
  const sizeVariant = colorVariant.sizes.find(s => s.size === item.size);

  if (quantity > sizeVariant.quantity) {
    throw new AppError(`Only ${sizeVariant.quantity} items available in stock`, 400);
  }

  if (quantity === 0) {
    // Remove item from array when quantity is set to 0
    cart.items = cart.items.filter(i => i._id.toString() !== itemId);
  } else {
    item.quantity = quantity;
  }
  
  await cart.save();
  
  // Populate and return
  const updatedCart = await Cart.findById(cart._id)
    .populate('items.product', 'name colorVariants isActive');
  
  res.status(200).json({
    success: true,
    message: 'Cart updated',
    cart: {
      ...updatedCart.toObject(),
      totals: updatedCart.totals
    }
  });
});

// @desc    Remove item from cart
// @route   DELETE /api/cart/items/:itemId
// @access  Private
exports.removeItem = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  
  const cart = await Cart.findOne({ user: req.userId });
  if (!cart) {
    throw new AppError('Cart not found', 404);
  }

  const item = cart.items.id(itemId);
  if (!item) {
    throw new AppError('Item not found in cart', 404);
  }

  // Remove item from array safely
  cart.items = cart.items.filter(i => i._id.toString() !== itemId);
  await cart.save();
  
  // Populate and return
  const updatedCart = await Cart.findById(cart._id)
    .populate('items.product', 'name colorVariants isActive');
  
  res.status(200).json({
    success: true,
    message: 'Item removed from cart',
    cart: {
      ...updatedCart.toObject(),
      totals: updatedCart.totals
    }
  });
});

// @desc    Clear cart
// @route   DELETE /api/cart
// @access  Private
exports.clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.userId });
  
  if (cart) {
    cart.items = [];
    cart.couponCode = undefined;
    cart.couponDiscount = 0;
    await cart.save();
  }
  
  res.status(200).json({
    success: true,
    message: 'Cart cleared',
    cart: {
      items: [],
      totals: {
        subtotal: 0,
        discount: 0,
        total: 0,
        totalItems: 0,
        itemCount: 0
      }
    }
  });
});

// @desc    Apply coupon
// @route   POST /api/cart/coupon
// @access  Private
exports.applyCoupon = asyncHandler(async (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    throw new AppError('Please provide coupon code', 400);
  }
  
  // For now, simple coupon logic - can be enhanced with coupon model
  const coupons = {
    'WELCOME10': { discount: 10, type: 'percentage', maxDiscount: 500 },
    'FLAT500': { discount: 500, type: 'fixed' },
    'SAVE20': { discount: 20, type: 'percentage', maxDiscount: 1000 }
  };
  
  const coupon = coupons[code.toUpperCase()];
  if (!coupon) {
    throw new AppError('Invalid coupon code', 400);
  }
  
  const cart = await Cart.findOne({ user: req.userId });
  if (!cart || cart.items.length === 0) {
    throw new AppError('Cart is empty', 400);
  }
  
  const subtotal = cart.totals.subtotal;
  let discountAmount = 0;
  
  if (coupon.type === 'percentage') {
    discountAmount = (subtotal * coupon.discount) / 100;
    if (coupon.maxDiscount) {
      discountAmount = Math.min(discountAmount, coupon.maxDiscount);
    }
  } else {
    discountAmount = coupon.discount;
  }
  
  cart.applyCoupon(code.toUpperCase(), discountAmount);
  await cart.save();
  
  res.status(200).json({
    success: true,
    message: 'Coupon applied successfully',
    cart: {
      ...cart.toObject(),
      totals: cart.totals
    }
  });
});

// @desc    Remove coupon
// @route   DELETE /api/cart/coupon
// @access  Private
exports.removeCoupon = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.userId });
  
  if (cart) {
    cart.removeCoupon();
    await cart.save();
  }
  
  res.status(200).json({
    success: true,
    message: 'Coupon removed',
    cart: cart ? {
      ...cart.toObject(),
      totals: cart.totals
    } : null
  });
});

// @desc    Sync cart (for logged in users coming from guest cart)
// @route   POST /api/cart/sync
// @access  Private
exports.syncCart = asyncHandler(async (req, res) => {
  const { items } = req.body;
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new AppError('Please provide items to sync', 400);
  }
  
  let cart = await Cart.findOne({ user: req.userId });
  if (!cart) {
    cart = new Cart({ user: req.userId, items: [] });
  }
  
  // Process each item
  for (const item of items) {
    const { productId, colorVariantId, size, quantity } = item;
    
    try {
      const product = await Product.findById(productId);
      if (!product || !product.isActive) continue;
      
      const colorVariant = product.colorVariants.id(colorVariantId);
      if (!colorVariant) continue;
      
      const sizeVariant = colorVariant.sizes.find(s => s.size === size);
      if (!sizeVariant || sizeVariant.quantity < quantity) continue;
      
      // Check if item exists
      const existingItemIndex = cart.items.findIndex(ci => 
        ci.product.toString() === productId &&
        ci.colorVariantId.toString() === colorVariantId &&
        ci.size === size
      );
      
      if (existingItemIndex > -1) {
        cart.items[existingItemIndex].quantity = Math.min(
          cart.items[existingItemIndex].quantity + quantity,
          sizeVariant.quantity
        );
      } else {
        cart.items.push({
          product: productId,
          colorVariantId,
          colorName: colorVariant.colorName,
          colorCode: colorVariant.colorCode,
          image: colorVariant.images[0],
          size,
          quantity: Math.min(quantity, sizeVariant.quantity),
          originalPrice: product.originalPrice,
          sellingPrice: product.sellingPrice
        });
      }
    } catch (error) {
      console.error('Error syncing item:', error);
      continue;
    }
  }
  
  await cart.save();
  
  // Populate and return
  cart = await Cart.findById(cart._id)
    .populate('items.product', 'name colorVariants isActive');
  
  res.status(200).json({
    success: true,
    message: 'Cart synced successfully',
    cart: {
      ...cart.toObject(),
      totals: cart.totals
    }
  });
});

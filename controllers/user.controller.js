const { User } = require('../models');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
exports.getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId)
    .populate('wishlist', 'name sellingPrice colorVariants')
    .select('-password');

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.status(200).json({
    success: true,
    user
  });
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, phone, avatar } = req.body;

  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Update fields
  if (name) user.name = name;
  if (phone) user.phone = phone;
  if (avatar) user.avatar = avatar;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    user: user.getPublicProfile()
  });
});

// @desc    Add address
// @route   POST /api/users/addresses
// @access  Private
exports.addAddress = asyncHandler(async (req, res) => {
  const { name, phone, addressLine1, addressLine2, city, state, pincode, isDefault } = req.body;

  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // If setting as default, unset other defaults
  if (isDefault) {
    user.addresses.forEach(addr => addr.isDefault = false);
  }

  user.addresses.push({
    name,
    phone,
    addressLine1,
    addressLine2,
    city,
    state,
    pincode,
    isDefault
  });

  await user.save();

  res.status(201).json({
    success: true,
    message: 'Address added successfully',
    addresses: user.addresses
  });
});

// @desc    Update address
// @route   PUT /api/users/addresses/:addressId
// @access  Private
exports.updateAddress = asyncHandler(async (req, res) => {
  const { name, phone, addressLine1, addressLine2, city, state, pincode, isDefault } = req.body;

  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const address = user.addresses.id(req.params.addressId);
  if (!address) {
    throw new AppError('Address not found', 404);
  }

  // If setting as default, unset other defaults
  if (isDefault) {
    user.addresses.forEach(addr => {
      if (addr._id.toString() !== req.params.addressId) {
        addr.isDefault = false;
      }
    });
  }

  // Update fields
  if (name) address.name = name;
  if (phone) address.phone = phone;
  if (addressLine1) address.addressLine1 = addressLine1;
  if (addressLine2 !== undefined) address.addressLine2 = addressLine2;
  if (city) address.city = city;
  if (state) address.state = state;
  if (pincode) address.pincode = pincode;
  if (isDefault !== undefined) address.isDefault = isDefault;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Address updated successfully',
    addresses: user.addresses
  });
});

// @desc    Delete address
// @route   DELETE /api/users/addresses/:addressId
// @access  Private
exports.deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const address = user.addresses.id(req.params.addressId);
  if (!address) {
    throw new AppError('Address not found', 404);
  }

  user.addresses.pull({ _id: req.params.addressId });
  await user.save();

  res.status(200).json({
    success: true,
    message: 'Address deleted successfully',
    addresses: user.addresses
  });
});

// @desc    Set default address
// @route   PUT /api/users/addresses/:addressId/default
// @access  Private
exports.setDefaultAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const address = user.addresses.id(req.params.addressId);
  if (!address) {
    throw new AppError('Address not found', 404);
  }

  // Unset all defaults
  user.addresses.forEach(addr => addr.isDefault = false);

  // Set new default
  address.isDefault = true;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Default address updated',
    addresses: user.addresses
  });
});

// @desc    Add to wishlist
// @route   POST /api/users/wishlist
// @access  Private
exports.addToWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.body;

  if (!productId) {
    throw new AppError('Please provide product ID', 400);
  }

  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Check if already in wishlist
  if (user.wishlist.includes(productId)) {
    throw new AppError('Product already in wishlist', 400);
  }

  user.wishlist.push(productId);
  await user.save();

  res.status(200).json({
    success: true,
    message: 'Added to wishlist',
    wishlist: user.wishlist
  });
});

// @desc    Remove from wishlist
// @route   DELETE /api/users/wishlist/:productId
// @access  Private
exports.removeFromWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  user.wishlist = user.wishlist.filter(
    id => id.toString() !== req.params.productId
  );

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Removed from wishlist',
    wishlist: user.wishlist
  });
});

// @desc    Get wishlist
// @route   GET /api/users/wishlist
// @access  Private
exports.getWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId)
    .populate('wishlist', 'name sellingPrice originalPrice colorVariants category isActive');

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.status(200).json({
    success: true,
    count: user.wishlist.length,
    wishlist: user.wishlist
  });
});

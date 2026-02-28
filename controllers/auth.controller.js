const { User, Otp } = require('../models');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { sendTokenResponse } = require('../middleware/auth');
const { emailService } = require('../services');
const crypto = require('crypto');

// @desc    Send OTP to email
// @route   POST /api/auth/send-otp
// @access  Public
exports.sendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new AppError('Please provide an email address', 400);
  }

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new AppError('Email already registered', 400);
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // Save OTP in the database (upsert to overwrite any existing OTPs for this email)
  await Otp.findOneAndUpdate(
    { email },
    { otp, createdAt: Date.now() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Send OTP via email
  try {
    await emailService.sendOtpEmail(email, otp);
  } catch (err) {
    console.error('Failed to send OTP email:', err);
    throw new AppError('Failed to send OTP email. Please try again.', 500);
  }

  res.status(200).json({
    success: true,
    message: 'OTP sent successfully to ' + email
  });
});

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
exports.register = asyncHandler(async (req, res) => {
  const { name, email, phone, password, otp } = req.body;

  if (!otp) {
    throw new AppError('Please provide the OTP sent to your email', 400);
  }

  // Verify OTP
  const otpRecord = await Otp.findOne({ email });
  if (!otpRecord) {
    throw new AppError('OTP expired or not found. Please request a new one.', 400);
  }

  if (otpRecord.otp !== otp) {
    throw new AppError('Invalid OTP', 400);
  }

  // Check if user exists (edge case check again)
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new AppError('Email already registered', 400);
  }

  // Create user
  const user = await User.create({
    name,
    email,
    phone,
    password,
    emailVerified: true // Set to true since OTP was just verified
  });

  // Delete the OTP record after successful registration
  await Otp.deleteOne({ email });

  // Send token response
  sendTokenResponse(user, 201, res);
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    throw new AppError('Please provide email and password', 400);
  }

  // Check for user
  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    throw new AppError('Invalid credentials', 401);
  }

  // Check if user is active
  if (!user.isActive) {
    throw new AppError('Your account has been deactivated', 401);
  }

  // Check password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError('Invalid credentials', 401);
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  // Send token response
  sendTokenResponse(user, 200, res);
});

// @desc    Admin login
// @route   POST /api/auth/admin/login
// @access  Public
exports.adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    throw new AppError('Please provide email and password', 400);
  }

  // Check for user
  const user = await User.findOne({ email, role: 'admin' }).select('+password');
  if (!user) {
    throw new AppError('Invalid admin credentials', 401);
  }

  // Check password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError('Invalid admin credentials', 401);
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  // Send token response
  sendTokenResponse(user, 200, res);
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
exports.logout = asyncHandler(async (req, res) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });

  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId)
    .populate('wishlist', 'name sellingPrice colorVariants');

  res.status(200).json({
    success: true,
    user: user.getPublicProfile()
  });
});

// @desc    Update user details
// @route   PUT /api/auth/updatedetails
// @access  Private
exports.updateDetails = asyncHandler(async (req, res) => {
  const fieldsToUpdate = {
    name: req.body.name,
    phone: req.body.phone,
    avatar: req.body.avatar
  };

  // Remove undefined fields
  Object.keys(fieldsToUpdate).forEach(key => {
    if (fieldsToUpdate[key] === undefined) delete fieldsToUpdate[key];
  });

  const user = await User.findByIdAndUpdate(
    req.userId,
    fieldsToUpdate,
    {
      new: true,
      runValidators: true
    }
  );

  res.status(200).json({
    success: true,
    user: user.getPublicProfile()
  });
});

// @desc    Update password
// @route   PUT /api/auth/updatepassword
// @access  Private
exports.updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Please provide current and new password', 400);
  }

  const user = await User.findById(req.userId).select('+password');

  // Check current password
  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw new AppError('Current password is incorrect', 401);
  }

  user.password = newPassword;
  await user.save();

  sendTokenResponse(user, 200, res);
});

// @desc    Forgot password
// @route   POST /api/auth/forgotpassword
// @access  Public
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new AppError('Please provide an email address', 400);
  }

  const user = await User.findOne({ email });

  // Don't reveal if user exists or not for security
  if (!user) {
    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists, password reset instructions have been sent'
    });
  }

  // Generate reset token (simple random string for now)
  const crypto = require('crypto');
  const resetToken = crypto.randomBytes(32).toString('hex');

  // Hash token and set to resetPasswordToken field
  user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes

  await user.save({ validateBeforeSave: false });

  // Send password reset email
  try {
    await emailService.sendPasswordResetEmail(user.email, resetToken, user.name);
  } catch (error) {
    // If email fails, still allow the process but log the error
    console.error('Failed to send password reset email:', error);
    // In development, still return the token
    if (process.env.NODE_ENV === 'development') {
      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
      console.log('Password Reset URL (email failed):', resetUrl);
      return res.status(200).json({
        success: true,
        message: 'Password reset email failed, but here is your reset link (development only)',
        resetToken: resetToken,
        resetUrl: resetUrl
      });
    }
  }

  res.status(200).json({
    success: true,
    message: 'If an account with that email exists, password reset instructions have been sent'
  });
});

// @desc    Reset password
// @route   PUT /api/auth/resetpassword/:resettoken
// @access  Public
exports.resetPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const { resettoken } = req.params;

  if (!password) {
    throw new AppError('Please provide a new password', 400);
  }

  if (password.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400);
  }

  // Get hashed token
  const resetPasswordToken = crypto.createHash('sha256').update(resettoken).digest('hex');

  const user = await User.findOne({
    resetPasswordToken,
    resetPasswordExpire: { $gt: Date.now() }
  });

  if (!user) {
    throw new AppError('Invalid or expired reset token', 400);
  }

  // Set new password
  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  sendTokenResponse(user, 200, res);
});

// @desc    Verify email address
// @route   GET /api/auth/verify-email/:token
// @access  Public
exports.verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.params;

  if (!token) {
    throw new AppError('Verification token is required', 400);
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    emailVerifyToken: hashedToken,
    emailVerifyExpire: { $gt: Date.now() }
  });

  if (!user) {
    throw new AppError('Invalid or expired verification link', 400);
  }

  user.emailVerified = true;
  user.emailVerifyToken = undefined;
  user.emailVerifyExpire = undefined;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: 'Email verified successfully'
  });
});

// @desc    Create admin user (for initial setup)
// @route   POST /api/auth/create-admin
// @access  Public (with secret key)
exports.createAdmin = asyncHandler(async (req, res) => {
  const { secretKey, name, email, password } = req.body;

  // Verify secret key
  if (secretKey !== process.env.ADMIN_SECRET_KEY) {
    throw new AppError('Invalid secret key', 401);
  }

  // Check if admin exists
  const existingAdmin = await User.findOne({ email });
  if (existingAdmin) {
    throw new AppError('Admin already exists', 400);
  }

  // Create admin
  const admin = await User.create({
    name,
    email,
    password,
    role: 'admin'
  });

  res.status(201).json({
    success: true,
    message: 'Admin created successfully',
    admin: admin.getPublicProfile()
  });
});

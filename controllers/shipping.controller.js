const { shiprocketService } = require('../services');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// @desc    Check serviceability
// @route   GET /api/shipping/serviceability
// @access  Public
exports.checkServiceability = asyncHandler(async (req, res) => {
  const { pickupPincode, deliveryPincode, weight, cod } = req.query;
  
  if (!pickupPincode || !deliveryPincode) {
    throw new AppError('Please provide pickup and delivery pincode', 400);
  }
  
  const result = await shiprocketService.checkServiceability(
    pickupPincode,
    deliveryPincode,
    parseFloat(weight) || 0.5,
    cod === 'true'
  );
  
  res.status(200).json({
    success: true,
    couriers: result.availableCouriers
  });
});

// @desc    Get tracking details
// @route   GET /api/shipping/track/:awbCode
// @access  Private
exports.getTracking = asyncHandler(async (req, res) => {
  const { awbCode } = req.params;
  
  if (!awbCode) {
    throw new AppError('Please provide AWB code', 400);
  }
  
  const result = await shiprocketService.getTracking(awbCode);
  
  res.status(200).json({
    success: true,
    tracking: result.tracking
  });
});

// @desc    Get all couriers
// @route   GET /api/shipping/couriers
// @access  Private/Admin
exports.getCouriers = asyncHandler(async (req, res) => {
  const result = await shiprocketService.getCouriers();
  
  res.status(200).json({
    success: true,
    couriers: result.couriers
  });
});

// @desc    Get shipping cost estimate
// @route   POST /api/shipping/estimate
// @access  Public
exports.estimateShipping = asyncHandler(async (req, res) => {
  const { pickupPincode, deliveryPincode, weight, dimensions } = req.body;
  
  if (!pickupPincode || !deliveryPincode || !weight) {
    throw new AppError('Please provide all required fields', 400);
  }
  
  try {
    const result = await shiprocketService.checkServiceability(
      pickupPincode,
      deliveryPincode,
      weight,
      false
    );
    
    // Get the cheapest courier rate
    const couriers = result.availableCouriers || [];
    if (couriers.length === 0) {
      // Return default shipping cost
      return res.status(200).json({
        success: true,
        estimate: {
          cost: parseInt(process.env.STATIC_SHIPPING_COST) || 100,
          estimatedDays: '3-5',
          currency: 'INR'
        }
      });
    }
    
    // Sort by rate
    const sortedCouriers = couriers.sort((a, b) => a.rate - b.rate);
    const cheapest = sortedCouriers[0];
    
    res.status(200).json({
      success: true,
      estimate: {
        cost: cheapest.rate,
        estimatedDays: cheapest.estimated_delivery_days || '3-5',
        courier: cheapest.courier_name,
        currency: 'INR'
      },
      allOptions: sortedCouriers.map(c => ({
        cost: c.rate,
        estimatedDays: c.estimated_delivery_days || '3-5',
        courier: c.courier_name
      }))
    });
  } catch (error) {
    // Return default shipping cost on error
    res.status(200).json({
      success: true,
      estimate: {
        cost: parseInt(process.env.STATIC_SHIPPING_COST) || 100,
        estimatedDays: '3-5',
        currency: 'INR'
      }
    });
  }
});

// @desc    Get shipping configuration
// @route   GET /api/shipping/config
// @access  Public
exports.getShippingConfig = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    config: {
      staticShippingCost: parseInt(process.env.STATIC_SHIPPING_COST) || 100,
      freeShippingThreshold: 5000,
      defaultEstimatedDays: '3-5',
      cod: {
        enabled: true,
        maxOrderAmount: parseInt(process.env.COD_MAX_ORDER_AMOUNT) || 5000
      }
    }
  });
});

const s3Service = require('./s3Service');
const razorpayService = require('./razorpayService');
const razorpayPayoutService = require('./razorpayPayoutService');
const shiprocketService = require('./shiprocketService');
const emailService = require('./emailService');

module.exports = {
  s3Service,
  razorpayService,
  razorpayPayoutService,
  shiprocketService,
  emailService
};

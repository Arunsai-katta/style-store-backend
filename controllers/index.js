const authController = require('./auth.controller');
const userController = require('./user.controller');
const productController = require('./product.controller');
const orderController = require('./order.controller');
const cartController = require('./cart.controller');
const reviewController = require('./review.controller');
const adminController = require('./admin.controller');
const dashboardController = require('./dashboard.controller');
const returnController = require('./return.controller');
const shippingController = require('./shipping.controller');
const paymentController = require('./payment.controller');
const uploadController = require('./upload.controller');

module.exports = {
  authController,
  userController,
  productController,
  orderController,
  cartController,
  reviewController,
  adminController,
  dashboardController,
  returnController,
  shippingController,
  paymentController,
  uploadController
};

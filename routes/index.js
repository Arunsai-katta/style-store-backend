const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const productRoutes = require('./product.routes');
const orderRoutes = require('./order.routes');
const cartRoutes = require('./cart.routes');
const reviewRoutes = require('./review.routes');
const adminRoutes = require('./admin.routes');
const dashboardRoutes = require('./dashboard.routes');
const returnRoutes = require('./return.routes');
const shippingRoutes = require('./shipping.routes');
const paymentRoutes = require('./payment.routes');
const uploadRoutes = require('./upload.routes');

module.exports = {
  authRoutes,
  userRoutes,
  productRoutes,
  orderRoutes,
  cartRoutes,
  reviewRoutes,
  adminRoutes,
  dashboardRoutes,
  returnRoutes,
  shippingRoutes,
  paymentRoutes,
  uploadRoutes
};

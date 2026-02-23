class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Async handler to catch errors in async functions
exports.asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Custom error class
exports.AppError = AppError;

// Not found error
exports.notFound = (resource = 'Resource') => {
  return new AppError(`${resource} not found`, 404);
};

// Bad request error
exports.badRequest = (message = 'Bad request') => {
  return new AppError(message, 400);
};

// Unauthorized error
exports.unauthorized = (message = 'Not authorized') => {
  return new AppError(message, 401);
};

// Forbidden error
exports.forbidden = (message = 'Forbidden') => {
  return new AppError(message, 403);
};

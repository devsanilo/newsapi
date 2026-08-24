/**
 * Error Handling Middleware
 * Centralized error handler for Express
 */
const logger = require('../utils/logger');

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
}

/**
 * Global error handler
 */
function errorHandler(err, req, res, next) {
  // Log the error
  logger.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    body: req.body,
    query: req.query,
  });

  // Sequelize validation errors
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: err.errors.map((e) => ({
        field: e.path,
        message: e.message,
      })),
    });
  }

  // Sequelize database errors
  if (err.name === 'SequelizeDatabaseError') {
    return res.status(500).json({
      success: false,
      error: 'Database Error',
      message: process.env.NODE_ENV === 'production'
        ? 'An internal database error occurred'
        : err.message,
    });
  }

  // Sequelize connection errors
  if (err.name === 'SequelizeConnectionError') {
    return res.status(503).json({
      success: false,
      error: 'Service Unavailable',
      message: 'Database connection error. Please try again later.',
    });
  }

  // Default error response
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    success: false,
    error: err.name || 'Internal Server Error',
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};

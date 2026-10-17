const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  // A 404 (browsers probing /apple-touch-icon.png, /favicon.ico, bots) is not a server fault:
  // one short line instead of a 25-line stack trace that buries real errors in the PM2 log.
  if (statusCode === 404) console.warn(`[404] ${req.method} ${req.originalUrl}`);
  else console.error(err.stack);

  const message = err.message || 'Internal Server Error';

  if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
    return res.status(statusCode).json({
      success: false,
      error: message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }

  res.status(statusCode).render('error', {
    error: message,
    status: statusCode
  });
};

const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

module.exports = {
  errorHandler,
  notFound
};

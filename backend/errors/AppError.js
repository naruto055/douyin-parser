class AppError extends Error {
  constructor({ code, message, httpStatus = 200, data = null, isBusiness = true }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.data = data;
    this.isBusiness = isBusiness;
  }
}

module.exports = AppError;

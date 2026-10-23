class ErrorHandler extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);

    this.statusCode = statusCode;

    // Fix prototype chain for custom Class
    Object.setPrototypeOf(this, new.target.prototype);

    // Attach stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

export default ErrorHandler;

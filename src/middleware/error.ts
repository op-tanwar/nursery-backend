import { Request, Response, NextFunction } from "express";

const errorMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";

  // Wrong MongoDB ID
  if (err.name === "CastError") {
    message = `Resource not found. Invalid: ${err.path}`;
    statusCode = 400;
  }

  // Mongoose Validation Error
  if (err.name === "ValidationError") {
    message = Object.values(err.errors)
      .map((val: any) => val.message)
      .join(", ");
    statusCode = 400;
  }

  // Duplicate Key Error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {});
    message = `Duplicate field value: ${field.join(", ")}`;
    statusCode = 400;
  }

  // JWT Errors
  if (err.name === "JsonWebTokenError") {
    message = "Invalid token. Please try again.";
    statusCode = 401;
  }

  if (err.name === "TokenExpiredError") {
    message = "Token expired. Please login again.";
    statusCode = 401;
  }

  // 🛡️ FIXED: Hide stack trace details if environment context matches production to protect internals
  const isProduction = process.env.NODE_ENV === "production";

  return res.status(statusCode).json({
    success: false,
    message,
    ...(isProduction ? {} : { stack: err.stack, details: err }),
  });
};

export default errorMiddleware;
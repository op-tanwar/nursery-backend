import { Response, Request } from "express";
import jwt, { SignOptions } from "jsonwebtoken";
import { IUser } from "../models/userModel";
import * as crypto from "node:crypto";
import { getAuthCookieOptions } from "./cookieHelper";
import { assertAccountActive } from "./authGuard";

const sendToken = (user: IUser, statusCode: number, res: Response, req?: Request) => {
  // 🔒 DEFENSE-IN-DEPTH: Ensure blocked or deactivated accounts can never mint JWT tokens
  assertAccountActive(user);

  const JWT_SECRET = process.env.JWT_SECRET!;

  const signOptions: SignOptions = {
    algorithm: "HS256",
    expiresIn: (process.env.JWT_EXPIRES_TIME || "7d") as any,
  };

  const jti = crypto.randomUUID();

  const token = jwt.sign(
    {
      id: String(user._id),
      role: user.role,
      jti: jti,
    },
    JWT_SECRET,
    signOptions
  );

  // Cross-site production cookie options
  const tokenCookieOptions = getAuthCookieOptions(req, { httpOnly: true });
  // Role cookie readable by Next.js middleware and client
  const roleCookieOptions = getAuthCookieOptions(req, { httpOnly: false });

  const userData = user.toObject ? user.toObject() : JSON.parse(JSON.stringify(user));
  if (userData.password) delete userData.password;
  if (userData.dashboardPassword) delete userData.dashboardPassword;

  res
    .status(statusCode)
    .cookie("token", token, tokenCookieOptions)
    .cookie("role", user.role, roleCookieOptions)
    .cookie("planto_token", token, tokenCookieOptions)
    .cookie("planto_role", user.role, roleCookieOptions)
    .json({
      success: true,
      token,
      role: user.role,
      user: userData,
    });
};

export default sendToken;
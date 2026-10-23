import { IUser } from "./user.types";

// ======================================================================
// 👑 GLOBAL EXPRESS REQUEST EXTENSION
// ======================================================================

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

export { };
import { Document } from "mongoose";

export type NewsletterStatus = "active" | "unsubscribed";

export interface INewsletter {
  email: string;
  status: NewsletterStatus;
  isActive: boolean; // Preserved for backwards compatibility
  subscribedAt: Date;
}

export interface INewsletterDocument extends INewsletter, Document {}
export type EmailProviderType = "BREVO_API" | "RESEND_API" | "GMAIL_SMTP";

export interface EmailOptions {
  email: string;
  name?: string;
  subject: string;
  message: string;
  html?: string;
  type?: string;
  replyTo?: string;
  bcc?: string | string[];
  cc?: string | string[];
  attachments?: Array<{
    filename: string;
    content?: any;
    path?: string;
    contentType?: string;
  }>;
}

export interface EmailResult {
  success: boolean;
  providerUsed?: EmailProviderType;
  messageId?: string | null;
  error?: string;
  code?: string;
  response?: string;
  responseCode?: number;
  command?: string;
  errorDetails?: {
    code?: string;
    message?: string;
    providerResponse?: any;
  } | null;
}

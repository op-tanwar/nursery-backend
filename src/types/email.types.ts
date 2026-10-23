export interface EmailOptions {
  email: string;
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
  messageId?: string;
  error?: string;
}

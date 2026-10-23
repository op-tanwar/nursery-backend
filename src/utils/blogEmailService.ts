import Newsletter from "../models/newsletterModel";
import { getTransporter } from "../utils/sendEmail"; // 🔥 FIXED: Reusing unified global SMTP pipeline configuration

export const sendNewBlogNotificationEmail = async (blogData: {
  title: string;
  slug: string;
  coverImage: string;
  excerpt: string;
}) => {
  try {
    // Check SMTP availability context first
    const transporter = getTransporter();
    const fromEmail = process.env.EMAIL_USER;

    if (!fromEmail) {
      console.error("Skipping newsletter broadcast operation: EMAIL_USER definition not accessible.");
      return;
    }

    const blogUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/blogs/${blogData.slug}`;

    // ⚡ FIXED: Prevent heap memory crashes on high subscriber counts using MongoDB Streaming Cursor chunks of 100 record
    const cursor = Newsletter.find({ isActive: true }).select("email").cursor();

    let currentBatch: string[] = [];
    const BATCH_SIZE = 100; // Optimal safe parameter limit context for BCC fields inside single mail commands
    let totalProcessedCount = 0;

    const dispatchMailChunk = async (recipients: string[]) => {
      const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || "Urban Nursery Community"}" <${fromEmail}>`,
        to: fromEmail,
        bcc: recipients, // Secure payload distribution array masking
        subject: `🌱 Freshly Baked Article: ${blogData.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #10b981; padding: 20px; text-align: center; color: white;">
              <h1 style="margin: 0; font-size: 24px;">Urban Nursery Weekly Garden-Log</h1>
            </div>
            <div style="padding: 20px; color: #333333; line-height: 1.6;">
              <h2 style="color: #10b981; margin-top: 0;">${blogData.title}</h2>
              <img src="${blogData.coverImage}" alt="Blog Cover" style="width: 100%; max-height: 250px; object-fit: cover; border-radius: 6px; margin-bottom: 15px;" />
              <p style="font-size: 16px;">Hey Plant Lover! We just published a brand new guide packed with amazing tips for your green buddies.</p>
              <p style="background-color: #f9fafb; padding: 15px; border-left: 4px solid #10b981; font-style: italic;">
                "${blogData.excerpt}"
              </p>
              <div style="text-align: center; margin: 25px 0;">
                <a href="${blogUrl}" style="background-color: #10b981; color: white; padding: 12px 25px; text-align: center; text-decoration: none; font-size: 16px; font-weight: bold; border-radius: 5px; display: inline-block;">Read Full Article Here</a>
              </div>
              <hr style="border: 0; border-top: 1px solid #eaeaea;" />
              <p style="font-size: 12px; color: #9ca3af; text-align: center;">
                You received this because you subscribed to Urban Nursery's updates. <br/>
                If you want to opt-out, you can click Unsubscribe on our website dashboard footer.
              </p>
            </div>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
    };

    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      if (doc.email) {
        currentBatch.push(doc.email);
      }

      if (currentBatch.length === BATCH_SIZE) {
        await dispatchMailChunk(currentBatch);
        totalProcessedCount += currentBatch.length;
        currentBatch = []; // Purge heap memory reference references
      }
    }

    // Process leftover tail signatures array context
    if (currentBatch.length > 0) {
      await dispatchMailChunk(currentBatch);
      totalProcessedCount += currentBatch.length;
    }

    console.log(`Successfully broadcasted new blog email alert blocks to ${totalProcessedCount} active subscribers via chunk cursors.`);
  } catch (error) {
    console.error("Failed to run email marketing background broadcast engine:", error);
  }
};
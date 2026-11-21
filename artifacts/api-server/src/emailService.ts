import nodemailer from 'nodemailer';
import { emailDispatchPaused } from "./email-dispatch-state";

// Gmail SMTP configuration
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // Use STARTTLS
  auth: {
    user: process.env.SMTP_USER || 'info@thepartybank.com',
    pass: (process.env.SMTP_PASS || 'pmhkiaiupoizgarr').replace(/\s+/g, '')
  }
});

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  // A staged payment release must not activate unrelated application mail.
  // Return an explicit failure, never a fabricated successful delivery.
  if (emailDispatchPaused()) return false;
  try {
    const mailOptions = {
      from: `"Brikvest" <${process.env.SMTP_USER || 'info@thepartybank.com'}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent successfully to ${params.to}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('Gmail email error:', error);
    return false;
  }
}
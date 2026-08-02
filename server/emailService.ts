import nodemailer from 'nodemailer';

// Gmail SMTP configuration — requires SMTP_USER and SMTP_PASS secrets
if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  throw new Error('SMTP_USER and SMTP_PASS environment variables must be set to send emails.');
}

const smtpUser = process.env.SMTP_USER;

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // Use STARTTLS
  auth: {
    user: smtpUser,
    pass: process.env.SMTP_PASS.replace(/\s+/g, '')
  }
});

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  try {
    const mailOptions = {
      from: `"Brikvest" <${smtpUser}>`,
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
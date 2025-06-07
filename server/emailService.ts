import nodemailer from 'nodemailer';

// Gmail SMTP configuration
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // Use STARTTLS
  auth: {
    user: 'info@thepartybank.com',
    pass: 'pmhkiaiupoizgarr' // App password
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
      from: '"Brikvest" <info@thepartybank.com>',
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
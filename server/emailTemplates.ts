export function investmentEmailTemplate({
    fullName,
    propertyName,
    amount,
    referralCode,
  }: {
    fullName: string;
    propertyName: string;
    amount: number;
    referralCode: string;
  }) {
    return {
      subject: "Your Investment Confirmation – Brikvest",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #f9f9f9;">
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="https://res.cloudinary.com/drddoxnsi/image/upload/v1746646662/brikvest-logo_uw0zi0.png" alt="Brikvest Logo" style="height: 50px;" />
          </div>

          <div style="background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
            <h2 style="color: #222;">Hello ${fullName},</h2>

            <p style="font-size: 16px; color: #444;">
              Thank you for submitting your interest to invest <strong>₦${amount.toLocaleString()}</strong> in the <strong>${propertyName}</strong> property.
            </p>

            <p style="font-size: 16px; color: #444;">
              While we're thrilled to have you on board, please note that we are currently in the process of securing our licensing from the Securities and Exchange Commission (SEC). 
              As such, we will only begin collecting investment funds once this licensing process is successfully completed. 
              You'll be notified immediately when the platform is ready to accept payments.
            </p>

            <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />

            <p style="font-size: 16px; color: #444;"><strong>Your Unique Referral Code:</strong> <span style="color: #000; font-weight: bold;">${referralCode}</span></p>
            
            <p style="font-size: 14px; color: #666;">
              Share this code with at least 5 friends. Each friend must commit to invest ₦100,000 or more. Once all 5 investments are verified, 
              you'll receive <strong>10% of each investment</strong> — either as equity in ${propertyName} or cash rewards, based on your preference.
            </p>

            <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />

            <p style="font-size: 16px; color: #444;">We're excited to have you on board and look forward to helping you grow your real estate portfolio with ease.</p>

            <p style="margin-top: 40px; font-size: 14px; color: #888;">
              Warm regards, <br /><strong>The Brikvest Team</strong>
            </p>
          </div>

          <div style="text-align: center; font-size: 12px; color: #aaa; margin-top: 20px;">
            © ${new Date().getFullYear()} Brikvest. All rights reserved.
          </div>
        </div>
      `,
    };
  }

export function kycApprovedEmailTemplate({
  fullName,
}: {
  fullName: string;
}) {
  return {
    subject: "KYC Verification Approved – Brikvest",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/drddoxnsi/image/upload/v1746646662/brikvest-logo_uw0zi0.png" alt="Brikvest Logo" style="height: 50px;" />
        </div>

        <div style="background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 20px;">
            <div style="width: 80px; height: 80px; background: #10b981; border-radius: 50%; margin: 0 auto; display: flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 48px;">✓</span>
            </div>
          </div>

          <h2 style="color: #222; text-align: center;">Congratulations, ${fullName}!</h2>

          <p style="font-size: 16px; color: #444; text-align: center;">
            Your KYC (Know Your Customer) verification has been <strong style="color: #10b981;">approved</strong>!
          </p>

          <p style="font-size: 16px; color: #444;">
            You now have full access to your investment dashboard and can view all your investment details without any restrictions.
          </p>

          <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 15px; color: #065f46;">
              <strong>What's Next?</strong><br>
              You can now explore investment opportunities, track your portfolio, and make informed decisions with complete access to your account.
            </p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.REPLIT_DEV_DOMAIN || 'https://brikvest.com'}/dashboard" 
               style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
              Go to Dashboard
            </a>
          </div>

          <p style="font-size: 16px; color: #444;">
            Thank you for completing your verification. We're excited to help you grow your real estate portfolio!
          </p>

          <p style="margin-top: 40px; font-size: 14px; color: #888;">
            Best regards, <br /><strong>The Brikvest Team</strong>
          </p>
        </div>

        <div style="text-align: center; font-size: 12px; color: #aaa; margin-top: 20px;">
          © ${new Date().getFullYear()} Brikvest. All rights reserved.
        </div>
      </div>
    `,
  };
}

export function kycRejectedEmailTemplate({
  fullName,
}: {
  fullName: string;
}) {
  return {
    subject: "KYC Verification Update – Brikvest",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/drddoxnsi/image/upload/v1746646662/brikvest-logo_uw0zi0.png" alt="Brikvest Logo" style="height: 50px;" />
        </div>

        <div style="background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
          <h2 style="color: #222;">Hello ${fullName},</h2>

          <p style="font-size: 16px; color: #444;">
            Thank you for submitting your KYC (Know Your Customer) verification documents.
          </p>

          <p style="font-size: 16px; color: #444;">
            Unfortunately, we were unable to approve your verification at this time. This could be due to one of the following reasons:
          </p>

          <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <ul style="margin: 0; padding-left: 20px; font-size: 15px; color: #7f1d1d;">
              <li>Documents are unclear or difficult to read</li>
              <li>Information provided doesn't match your ID document</li>
              <li>ID document has expired</li>
              <li>Required documents are missing</li>
            </ul>
          </div>

          <p style="font-size: 16px; color: #444;">
            <strong>What can you do?</strong><br>
            Please review your documents and resubmit your KYC verification with clear, valid documents that match your information.
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.REPLIT_DEV_DOMAIN || 'https://brikvest.com'}/dashboard" 
               style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
              Resubmit KYC
            </a>
          </div>

          <p style="font-size: 14px; color: #666;">
            If you have questions or need assistance, please contact our support team at <a href="mailto:info@thepartybank.com" style="color: #2563eb;">info@thepartybank.com</a>
          </p>

          <p style="margin-top: 40px; font-size: 14px; color: #888;">
            Best regards, <br /><strong>The Brikvest Team</strong>
          </p>
        </div>

        <div style="text-align: center; font-size: 12px; color: #aaa; margin-top: 20px;">
          © ${new Date().getFullYear()} Brikvest. All rights reserved.
        </div>
      </div>
    `,
  };
}

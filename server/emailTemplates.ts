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

export function developerBidEmailTemplate({
    fullName,
    propertyName,
  }: {
    fullName: string;
    propertyName: string;
  }) {
    return {
      subject: "Your Development Proposal – Brikvest",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #f9f9f9;">
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="https://res.cloudinary.com/drddoxnsi/image/upload/v1746646662/brikvest-logo_uw0zi0.png" alt="Brikvest Logo" style="height: 50px;" />
          </div>

          <div style="background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
            <h2 style="color: #222;">Hello ${fullName},</h2>

            <p style="font-size: 16px; color: #444;">
              Thank you for submitting your initial proposal to develop <strong>${propertyName}</strong>.
            </p>

            <p style="font-size: 16px; color: #444;">
              We appreciate your interest and the effort put into your submission. Our team will be reviewing all proposals and will reach out shortly to begin the due diligence phase of the selection process.
            </p>

            <p style="font-size: 16px; color: #444;">
              We look forward to learning more about your capabilities and exploring the potential for partnership.
            </p>

            <p style="margin-top: 40px; font-size: 14px; color: #888;">
              Warm regards,<br />
              <strong>The Brikvest Team</strong>
            </p>
          </div>

          <div style="text-align: center; font-size: 12px; color: #aaa; margin-top: 20px;">
            © ${new Date().getFullYear()} Brikvest. All rights reserved.
          </div>
        </div>
      `,
    };
  };
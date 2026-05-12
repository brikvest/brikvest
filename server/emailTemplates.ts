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
              Thank you for reserving your investment of <strong>₦${amount.toLocaleString()}</strong> in the <strong>${propertyName}</strong> property.
            </p>

            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 24px 0; border-radius: 4px;">
              <p style="margin: 0; font-size: 15px; color: #92400e;">
                <strong>⏰ Important:</strong> This reservation expires in <strong>24 hours</strong>. Units are temporarily held for you but will be released if payment is not completed within this time.
              </p>
            </div>

            <p style="font-size: 16px; color: #444;">
              <strong>Next Steps:</strong><br>
              1. Sign in to your Brikvest account<br>
              2. Complete your KYC verification (if not already done)<br>
              3. Complete your payment to confirm this investment
            </p>

            <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />

            <p style="font-size: 16px; color: #444;"><strong>Your Unique Referral Code:</strong> <span style="color: #000; font-weight: bold;">${referralCode}</span></p>
            
            <p style="font-size: 14px; color: #666;">
              Share your code with friends and earn rewards when they join:
            </p>
            <ul style="font-size: 14px; color: #666; line-height: 1.8; margin: 8px 0;">
              <li>Refer <strong>1 person</strong> — earn <strong>$20</strong></li>
              <li>Refer <strong>2 or more</strong> — earn <strong>$50</strong></li>
            </ul>

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
            <a href="https://www.brikvest.net/dashboard" 
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
            <a href="https://www.brikvest.net/dashboard" 
               style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
              Resubmit KYC
            </a>
          </div>

          <p style="font-size: 14px; color: #666;">
            If you have questions or need assistance, please contact our support team at <a href="mailto:info@brikvest.net" style="color: #2563eb;">info@brikvest.net</a>
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

export function investmentCreatedEmailTemplate({
  fullName,
  propertyName,
  units,
  amount,
  currency,
}: {
  fullName: string;
  propertyName: string;
  units: number;
  amount: number;
  currency: string;
}) {
  return {
    subject: "Investment Reservation Created – Brikvest",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/drddoxnsi/image/upload/v1746646662/brikvest-logo_uw0zi0.png" alt="Brikvest Logo" style="height: 50px;" />
        </div>

        <div style="background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
          <h2 style="color: #222; text-align: center;">Investment Reservation Created</h2>

          <p style="font-size: 16px; color: #444;">
            Hello ${fullName},
          </p>

          <p style="font-size: 16px; color: #444;">
            An investment reservation has been created for you in <strong>${propertyName}</strong>.
          </p>

          <div style="background: #f0f9ff; border-left: 4px solid #2563eb; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <h3 style="margin: 0 0 12px 0; color: #1e40af; font-size: 18px;">Investment Details</h3>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;">
              <strong>Property:</strong> ${propertyName}
            </p>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;">
              <strong>Units:</strong> ${units}
            </p>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;">
              <strong>Amount:</strong> ${currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : currency} ${amount.toLocaleString()}
            </p>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;">
              <strong>Status:</strong> Payment Pending
            </p>
          </div>

          <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 15px; color: #92400e;">
              <strong>⏰ Important:</strong> This reservation expires in <strong>24 hours</strong>. Units are temporarily held for you but will be released if payment is not completed within this time.
            </p>
          </div>

          <p style="font-size: 16px; color: #444;">
            <strong>Next Steps:</strong><br>
            1. Sign in to your Brikvest account<br>
            2. Complete your KYC verification (if not already done)<br>
            3. Complete your payment to confirm this investment
          </p>
          
          <p style="font-size: 14px; color: #666;">
            Once payment is received and verified, your investment will be confirmed and you'll receive your ownership certificate.
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://www.brikvest.net/dashboard" 
               style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
              View Dashboard
            </a>
          </div>

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

export function paymentReceivedEmailTemplate({
  fullName,
  propertyName,
  units,
  amount,
  currency,
  paymentReference,
}: {
  fullName: string;
  propertyName: string;
  units: number;
  amount: number;
  currency: string;
  paymentReference?: string;
}) {
  return {
    subject: "Payment Received – Brikvest",
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

          <h2 style="color: #222; text-align: center;">Payment Received!</h2>

          <p style="font-size: 16px; color: #444;">
            Hello ${fullName},
          </p>

          <p style="font-size: 16px; color: #444;">
            We've received your payment for your investment in <strong>${propertyName}</strong>!
          </p>

          <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <h3 style="margin: 0 0 12px 0; color: #065f46; font-size: 18px;">Payment Details</h3>
            <p style="margin: 8px 0; font-size: 15px; color: #064e3b;">
              <strong>Property:</strong> ${propertyName}
            </p>
            <p style="margin: 8px 0; font-size: 15px; color: #064e3b;">
              <strong>Units:</strong> ${units}
            </p>
            <p style="margin: 8px 0; font-size: 15px; color: #064e3b;">
              <strong>Amount:</strong> ${currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : currency} ${amount.toLocaleString()}
            </p>
            ${paymentReference ? `
            <p style="margin: 8px 0; font-size: 15px; color: #064e3b;">
              <strong>Reference:</strong> ${paymentReference}
            </p>
            ` : ''}
          </div>

          <p style="font-size: 16px; color: #444;">
            <strong>What's Next?</strong><br>
            Your payment is being processed. Once verification is complete (including KYC if not yet verified), your investment will be confirmed and you'll have full access to all investment details.
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://www.brikvest.net/dashboard" 
               style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
              View Dashboard
            </a>
          </div>

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

export function investmentConfirmedEmailTemplate({
  fullName,
  propertyName,
  units,
  amount,
  currency,
  certificateNumber,
}: {
  fullName: string;
  propertyName: string;
  units: number;
  amount: number | string;
  currency: string;
  certificateNumber?: string;
}) {
  const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount;
  return {
    subject: "Investment Confirmed – Your Ownership Certificate is Ready – Brikvest",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/drddoxnsi/image/upload/v1746646662/brikvest-logo_uw0zi0.png" alt="Brikvest Logo" style="height: 50px;" />
        </div>

        <div style="background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 20px;">
            <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #2563eb, #1e40af); border-radius: 50%; margin: 0 auto; display: flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 40px;">✓</span>
            </div>
          </div>

          <h2 style="color: #222; text-align: center;">Congratulations ${fullName}!</h2>

          <p style="font-size: 16px; color: #444; text-align: center;">
            Your investment in <strong>${propertyName}</strong> has been <strong style="color: #2563eb;">confirmed</strong>!
          </p>

          ${certificateNumber ? `
          <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); border: 2px solid #f59e0b; padding: 20px; margin: 24px 0; border-radius: 8px; text-align: center;">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #92400e; font-weight: 600;">OWNERSHIP CERTIFICATE ISSUED</p>
            <p style="margin: 0; font-size: 24px; color: #78350f; font-weight: bold; letter-spacing: 1px;">${certificateNumber}</p>
            <p style="margin: 12px 0 0 0; font-size: 13px; color: #92400e;">
              Your digital ownership certificate is now available in your dashboard.
            </p>
          </div>
          ` : ''}

          <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <h3 style="margin: 0 0 12px 0; color: #1e40af; font-size: 18px;">Investment Summary</h3>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;">
              <strong>Property:</strong> ${propertyName}
            </p>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;">
              <strong>Units Owned:</strong> ${units}
            </p>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;">
              <strong>Total Investment:</strong> ${currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : currency} ${amountNum.toLocaleString()}
            </p>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;">
              <strong>Status:</strong> <span style="color: #10b981;">Confirmed</span>
            </p>
          </div>

          <p style="font-size: 16px; color: #444;">
            <strong>What's Included:</strong>
          </p>
          <ul style="font-size: 15px; color: #666; line-height: 1.8;">
            <li>Digital Ownership Certificate with QR verification</li>
            <li>Full access to property updates and progress</li>
            <li>Detailed investment analytics in your dashboard</li>
            <li>Regular updates on property development</li>
          </ul>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://www.brikvest.net/dashboard" 
               style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
              View Your Certificate
            </a>
          </div>

          <p style="font-size: 16px; color: #444;">
            Thank you for choosing Brikvest. We're excited to have you as an investor!
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

export function referralSuccessEmailTemplate({
  referrerName,
  referredName,
  referralCount,
  rewardAmount,
}: {
  referrerName: string;
  referredName: string;
  referralCount: number;
  rewardAmount: number;
}) {
  return {
    subject: "Great News! Someone Joined Brikvest Using Your Referral",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/drddoxnsi/image/upload/v1746646662/brikvest-logo_uw0zi0.png" alt="Brikvest Logo" style="height: 50px;" />
        </div>
        <div style="background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
          <h2 style="color: #222;">Hi ${referrerName},</h2>
          <p style="font-size: 16px; color: #444;">
            Great news! <strong>${referredName}</strong> just joined Brikvest using your referral link.
          </p>
          <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 15px; color: #166534;">
              You now have <strong>${referralCount} successful referral${referralCount > 1 ? 's' : ''}</strong>.<br/>
              Your current reward: <strong>$${rewardAmount}</strong>
            </p>
          </div>
          ${referralCount < 2 ? `
          <p style="font-size: 14px; color: #666;">
            Keep going! Refer one more friend to earn <strong>$50 total</strong>.
          </p>` : `
          <p style="font-size: 14px; color: #666;">
            Awesome — you've hit the top referral tier! Keep sharing your link to help grow the Brikvest community.
          </p>`}
          <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
          <p style="margin-top: 20px; font-size: 14px; color: #888;">
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

export function welcomeReferralEmailTemplate({
  userName,
  referralCode,
  referralLink,
}: {
  userName: string;
  referralCode: string;
  referralLink: string;
}) {
  return {
    subject: "Welcome to Brikvest — Earn Rewards by Inviting Friends!",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/drddoxnsi/image/upload/v1746646662/brikvest-logo_uw0zi0.png" alt="Brikvest Logo" style="height: 50px;" />
        </div>
        <div style="background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
          <h2 style="color: #222;">Welcome, ${userName}!</h2>
          <p style="font-size: 16px; color: #444;">
            Your Brikvest account has been approved. Start building wealth through fractional real estate investing!
          </p>
          <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <p style="margin: 0 0 8px; font-size: 16px; font-weight: bold; color: #1e40af;">Invite Friends & Earn Cash Rewards</p>
            <p style="margin: 0; font-size: 14px; color: #1e40af;">
              Refer 1 friend &rarr; <strong>$20</strong><br/>
              Refer 2 friends &rarr; <strong>$50</strong>
            </p>
          </div>
          <p style="font-size: 14px; color: #444;">
            Your referral code: <strong style="font-size: 16px; color: #1a365d;">${referralCode}</strong>
          </p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${referralLink}" style="display: inline-block; background: #1a365d; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-size: 16px;">
              Share Your Referral Link
            </a>
          </div>
          <p style="font-size: 13px; color: #888; text-align: center;">
            Or copy this link: ${referralLink}
          </p>
          <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
          <p style="margin-top: 20px; font-size: 14px; color: #888;">
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

export function valuationUpdateEmailTemplate({
  firstName,
  propertyName,
  valuationDate,
  hasReport,
}: {
  firstName: string;
  propertyName: string;
  valuationDate: string;
  hasReport: boolean;
}) {
  return {
    subject: `Property Update – ${propertyName} – Brikvest`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/drddoxnsi/image/upload/v1746646662/brikvest-logo_uw0zi0.png" alt="Brikvest Logo" style="height: 50px;" />
        </div>

        <div style="background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
          <h2 style="color: #222; margin-bottom: 6px;">Hi ${firstName},</h2>

          <p style="font-size: 16px; color: #444; line-height: 1.6;">
            A new valuation update has been recorded for <strong>${propertyName}</strong> as of <strong>${valuationDate}</strong>.
          </p>

          ${hasReport ? `
          <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 14px 18px; margin: 20px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 15px; color: #1e40af;">
              A valuation report has been attached. You can view or download it from your dashboard.
            </p>
          </div>
          ` : ''}

          <p style="font-size: 16px; color: #444; line-height: 1.6;">
            Head over to your portfolio to see your updated performance charts and any new reports.
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://www.brikvest.net/dashboard"
               style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
              View My Portfolio
            </a>
          </div>

          <p style="margin-top: 30px; font-size: 14px; color: #888;">
            Best regards, <br /><strong>The Brikvest Team</strong>
          </p>
        </div>

        <div style="text-align: center; font-size: 12px; color: #aaa; margin-top: 20px;">
          &copy; ${new Date().getFullYear()} Brikvest. All rights reserved.
        </div>
      </div>
    `,
  };
}

export function developerInvestmentRecordedEmailTemplate({
  fullName,
  developerCompanyName,
  propertyName,
  propertyLocation,
  units,
  amount,
  currency,
  certificateNumber,
  paymentDate,
  isNewAccount,
  loginEmail,
  tempPassword,
  loginUrl,
}: {
  fullName: string;
  developerCompanyName: string;
  propertyName: string;
  propertyLocation?: string | null;
  units: number;
  amount: number | string;
  currency: string;
  certificateNumber?: string;
  paymentDate?: string;
  isNewAccount: boolean;
  loginEmail: string;
  tempPassword?: string;
  loginUrl: string;
}) {
  const amountNum = typeof amount === "string" ? parseFloat(amount) : amount;
  const symbol = currency === "NGN" ? "₦" : currency === "USD" ? "$" : currency === "GBP" ? "£" : currency + " ";
  return {
    subject: `${developerCompanyName} recorded your investment in ${propertyName} – Brikvest`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/drddoxnsi/image/upload/v1746646662/brikvest-logo_uw0zi0.png" alt="Brikvest Logo" style="height: 50px;" />
        </div>

        <div style="background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 20px;">
            <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #2563eb, #1e40af); border-radius: 50%; margin: 0 auto; display: flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 40px;">✓</span>
            </div>
          </div>

          <h2 style="color: #222; text-align: center; margin: 0 0 8px;">Hello ${fullName},</h2>
          <p style="font-size: 16px; color: #444; text-align: center; margin: 0 0 24px;">
            <strong>${developerCompanyName}</strong> has recorded your investment in
            <strong>${propertyName}</strong>${propertyLocation ? ` (${propertyLocation})` : ""}.
            You can now track it from your Brikvest portfolio.
          </p>

          ${certificateNumber ? `
          <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); border: 2px solid #f59e0b; padding: 20px; margin: 24px 0; border-radius: 8px; text-align: center;">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #92400e; font-weight: 600;">OWNERSHIP CERTIFICATE ISSUED</p>
            <p style="margin: 0; font-size: 24px; color: #78350f; font-weight: bold; letter-spacing: 1px;">${certificateNumber}</p>
          </div>
          ` : ""}

          <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <h3 style="margin: 0 0 12px 0; color: #1e40af; font-size: 18px;">Investment Summary</h3>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;"><strong>Project:</strong> ${propertyName}</p>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;"><strong>Developer:</strong> ${developerCompanyName}</p>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;"><strong>Units:</strong> ${units}</p>
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;"><strong>Amount:</strong> ${symbol}${amountNum.toLocaleString()}</p>
            ${paymentDate ? `<p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;"><strong>Payment date:</strong> ${paymentDate}</p>` : ""}
            <p style="margin: 8px 0; font-size: 15px; color: #1e3a8a;"><strong>Status:</strong> <span style="color: #10b981;">Confirmed</span></p>
          </div>

          ${isNewAccount && tempPassword ? `
          <div style="background: #fef9c3; border: 1px solid #facc15; padding: 16px; margin: 24px 0; border-radius: 6px;">
            <h3 style="margin: 0 0 8px; color: #854d0e; font-size: 16px;">Your Brikvest account is ready</h3>
            <p style="margin: 0 0 8px; font-size: 14px; color: #713f12;">We created an account for you so you can track this investment.</p>
            <p style="margin: 4px 0; font-size: 14px; color: #713f12;"><strong>Email:</strong> ${loginEmail}</p>
            <p style="margin: 4px 0; font-size: 14px; color: #713f12;"><strong>Temporary password:</strong> <code style="background: #fff; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${tempPassword}</code></p>
            <p style="margin: 8px 0 0; font-size: 13px; color: #854d0e;">Please change this password after your first sign-in.</p>
          </div>
          ` : `
          <p style="font-size: 14px; color: #444; text-align: center; margin: 16px 0;">
            Sign in with your existing Brikvest account to view this investment alongside the rest of your portfolio.
          </p>
          `}

          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginUrl}"
               style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
              ${isNewAccount ? "Sign in &amp; track my investment" : "View my portfolio"}
            </a>
          </div>

          <p style="font-size: 13px; color: #6b7280; text-align: center; margin-top: 24px;">
            Questions about this investment? Reply to this email or contact ${developerCompanyName} directly.
          </p>

          <p style="margin-top: 30px; font-size: 14px; color: #888;">
            Best regards, <br /><strong>The Brikvest Team</strong>
          </p>
        </div>

        <div style="text-align: center; font-size: 12px; color: #aaa; margin-top: 20px;">
          &copy; ${new Date().getFullYear()} Brikvest. All rights reserved.
        </div>
      </div>
    `,
  };
}

export function developerTeamInviteEmailTemplate({
  inviteName,
  inviteEmail,
  inviteRole,
  permissions,
  companyName,
  inviterName,
  acceptUrl,
  expiresAt,
}: {
  inviteName?: string | null;
  inviteEmail: string;
  inviteRole: string;
  permissions?: string[];
  companyName: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: string;
}) {
  const greeting = inviteName ? `Hi ${inviteName},` : "Hello,";
  const roleLabel = inviteRole.replace(/_/g, " ");
  const permLabels: Record<string, string> = {
    fundraising: "Fundraising",
    construction: "Construction",
    cap_table: "Cap table",
    sales: "Sales & clients",
    comms: "Communications",
    settings: "Project settings",
  };
  const permList = (permissions || []).map((p) => permLabels[p] || p).filter(Boolean);
  const permissionsBlock = permList.length > 0
    ? `<div style="margin: 16px 0 0;">
         <p style="margin: 0 0 6px; font-size: 13px; color: #475569;"><strong>Access granted:</strong></p>
         <div style="display: block;">
           ${permList.map(p => `<span style="display:inline-block;background:#e0e7ff;color:#3730a3;font-size:12px;padding:3px 10px;border-radius:999px;margin:0 4px 4px 0;">${p}</span>`).join("")}
         </div>
       </div>`
    : `<p style="margin: 16px 0 0; font-size: 13px; color: #64748b;"><em>The owner hasn't granted any feature access yet — they may update your permissions after you accept.</em></p>`;
  return {
    subject: `${inviterName} invited you to ${companyName} on Brikvest`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #f9fafb;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/drddoxnsi/image/upload/v1746646662/brikvest-logo_uw0zi0.png" alt="Brikvest Logo" style="height: 50px;" />
        </div>
        <div style="background: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
          <h2 style="color: #0f172a; margin: 0 0 8px;">You've been invited to join ${companyName}</h2>
          <p style="font-size: 15px; color: #475569; margin: 0 0 24px;">${greeting}</p>
          <p style="font-size: 15px; color: #334155; line-height: 1.6;">
            <strong>${inviterName}</strong> has invited you to join <strong>${companyName}</strong>'s developer workspace on Brikvest as a <strong>${roleLabel}</strong>.
            You'll be able to help manage projects, investors, and updates from a shared dashboard.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${acceptUrl}"
               style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600;">
              Accept invitation
            </a>
          </div>
          <p style="font-size: 13px; color: #64748b; text-align: center; margin: 0 0 24px;">
            Or copy this link: <br />
            <span style="word-break: break-all; color: #2563eb;">${acceptUrl}</span>
          </p>
          <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 24px 0;">
            <p style="margin: 0 0 6px; font-size: 13px; color: #475569;"><strong>Invited email:</strong> ${inviteEmail}</p>
            <p style="margin: 0; font-size: 13px; color: #475569;"><strong>Invitation expires:</strong> ${expiresAt}</p>
            ${permissionsBlock}
          </div>
          <p style="font-size: 13px; color: #94a3b8; text-align: center; margin-top: 24px;">
            If you weren't expecting this invitation, you can safely ignore this email.
          </p>
          <p style="margin-top: 30px; font-size: 14px; color: #888;">
            Welcome aboard,<br /><strong>The Brikvest Team</strong>
          </p>
        </div>
        <div style="text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px;">
          &copy; ${new Date().getFullYear()} Brikvest. All rights reserved.
        </div>
      </div>
    `,
  };
}

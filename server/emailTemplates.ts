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

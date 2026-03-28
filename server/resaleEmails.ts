import { sendEmail } from './emailService';

const PLATFORM_URL = process.env.REPLIT_DOMAINS
  ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
  : 'https://brikvest.replit.app';

const BANK_DETAILS = `
  <table style="width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px;">
    <tr style="background: #f8fafc;">
      <td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">NGN Account</td>
      <td style="padding: 10px; border: 1px solid #e2e8f0;">Zenith Bank — Brikvest Limited — 1310320691</td>
    </tr>
    <tr>
      <td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">USD Account</td>
      <td style="padding: 10px; border: 1px solid #e2e8f0;">Charles Giadom — 483106622433</td>
    </tr>
    <tr style="background: #f8fafc;">
      <td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">GBP Account</td>
      <td style="padding: 10px; border: 1px solid #e2e8f0;">Revolut — Sort: 04-00-75 — Acct: 67385923</td>
    </tr>
  </table>
`;

function emailWrapper(content: string): string {
  return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #1a365d 0%, #2563eb 100%); padding: 24px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px;">BRIKVEST</h1>
        <p style="color: #93c5fd; margin: 4px 0 0; font-size: 13px;">Real Estate Investment Club</p>
      </div>
      <div style="padding: 32px;">
        ${content}
      </div>
      <div style="background: #f8fafc; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="color: #64748b; font-size: 12px; margin: 0;">
          This is an automated notification from Brikvest. Please do not reply to this email.
        </p>
        <p style="margin: 8px 0 0;">
          <a href="${PLATFORM_URL}" style="color: #2563eb; font-size: 12px; text-decoration: none;">Visit Brikvest</a>
        </p>
      </div>
    </div>
  `;
}

function detailsTable(rows: [string, string][]): string {
  return `
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      ${rows.map(([label, value]) => `
        <tr>
          <td style="padding: 8px 12px; font-weight: 600; color: #475569; border-bottom: 1px solid #f1f5f9; width: 40%;">${label}</td>
          <td style="padding: 8px 12px; color: #1e293b; border-bottom: 1px solid #f1f5f9;">${value}</td>
        </tr>
      `).join('')}
    </table>
  `;
}

function actionButton(text: string, url: string): string {
  return `
    <div style="text-align: center; margin: 24px 0;">
      <a href="${url}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
        ${text}
      </a>
    </div>
  `;
}

function formatAmount(currency: string, amount: string | number): string {
  return `${currency} ${parseFloat(String(amount)).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

// 1. Listing approved (to seller)
export async function sendListingApprovedEmail(sellerEmail: string, sellerName: string, propertyName: string, units: string, sellingType: string) {
  const typeLabel = sellingType === 'fixed_price' ? 'fixed-price listing' : 'auction listing';
  await sendEmail({
    to: sellerEmail,
    subject: `Your Resale Listing Has Been Approved — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #1a365d; margin: 0 0 16px;">Listing Approved</h2>
      <p style="color: #475569;">Hi ${sellerName},</p>
      <p style="color: #475569;">Great news! Your ${typeLabel} for <strong>${propertyName}</strong> has been approved and is now live on the marketplace.</p>
      ${detailsTable([
        ['Property', propertyName],
        ['Units Listed', units],
        ['Listing Type', sellingType === 'fixed_price' ? 'Fixed Price' : 'Auction'],
      ])}
      <p style="color: #475569;">Interested buyers can now view and ${sellingType === 'bidding' ? 'place bids on' : 'purchase'} your listing.</p>
      ${actionButton('View My Listings', `${PLATFORM_URL}/marketplace`)}
    `),
  });
}

// 2. Listing rejected (to seller)
export async function sendListingRejectedEmail(sellerEmail: string, sellerName: string, propertyName: string, units: string, adminNote?: string) {
  await sendEmail({
    to: sellerEmail,
    subject: `Resale Listing Not Approved — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #dc2626; margin: 0 0 16px;">Listing Not Approved</h2>
      <p style="color: #475569;">Hi ${sellerName},</p>
      <p style="color: #475569;">Unfortunately, your resale listing for <strong>${propertyName}</strong> (${units} units) was not approved.</p>
      ${adminNote ? `<div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin: 16px 0; border-radius: 4px;"><p style="color: #991b1b; margin: 0;"><strong>Reason:</strong> ${adminNote}</p></div>` : ''}
      <p style="color: #475569;">You may revise and submit a new listing if you'd like to try again.</p>
      ${actionButton('Go to Dashboard', `${PLATFORM_URL}/dashboard`)}
    `),
  });
}

// 3. New bid placed on listing (to seller)
export async function sendNewBidNotificationEmail(sellerEmail: string, sellerName: string, propertyName: string, bidderName: string, bidAmount: string, currency: string, bidCount: number) {
  await sendEmail({
    to: sellerEmail,
    subject: `New Bid on Your Listing — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #1a365d; margin: 0 0 16px;">New Bid Received</h2>
      <p style="color: #475569;">Hi ${sellerName},</p>
      <p style="color: #475569;">A new bid has been placed on your listing for <strong>${propertyName}</strong>.</p>
      ${detailsTable([
        ['Property', propertyName],
        ['Bidder', bidderName],
        ['Bid Amount', formatAmount(currency, bidAmount)],
        ['Total Bids', String(bidCount)],
      ])}
      <p style="color: #475569;">You can monitor bidding activity on the marketplace.</p>
      ${actionButton('View Marketplace', `${PLATFORM_URL}/marketplace`)}
    `),
  });
}

// 4. User has been outbid (to previous highest bidder)
export async function sendOutbidEmail(bidderEmail: string, bidderName: string, propertyName: string, theirBid: string, newHighestBid: string, currency: string) {
  await sendEmail({
    to: bidderEmail,
    subject: `You've Been Outbid — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #d97706; margin: 0 0 16px;">You've Been Outbid</h2>
      <p style="color: #475569;">Hi ${bidderName},</p>
      <p style="color: #475569;">Someone has placed a higher bid on <strong>${propertyName}</strong>.</p>
      ${detailsTable([
        ['Property', propertyName],
        ['Your Bid', formatAmount(currency, theirBid)],
        ['New Highest Bid', formatAmount(currency, newHighestBid)],
      ])}
      <p style="color: #475569;"><strong>Next step:</strong> Place a higher bid if you still want these units.</p>
      ${actionButton('Place a Higher Bid', `${PLATFORM_URL}/marketplace`)}
    `),
  });
}

// 5. User is the highest bidder (to bidder, after placing)
export async function sendHighestBidderEmail(bidderEmail: string, bidderName: string, propertyName: string, bidAmount: string, currency: string) {
  await sendEmail({
    to: bidderEmail,
    subject: `You're the Highest Bidder — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #059669; margin: 0 0 16px;">You're the Highest Bidder!</h2>
      <p style="color: #475569;">Hi ${bidderName},</p>
      <p style="color: #475569;">Your bid on <strong>${propertyName}</strong> is currently the highest.</p>
      ${detailsTable([
        ['Property', propertyName],
        ['Your Bid', formatAmount(currency, bidAmount)],
      ])}
      <p style="color: #475569;">We'll notify you if someone outbids you or when the auction ends.</p>
      ${actionButton('View My Bids', `${PLATFORM_URL}/marketplace`)}
    `),
  });
}

// 6. User wins the auction (to winning bidder)
export async function sendAuctionWonEmail(winnerEmail: string, winnerName: string, propertyName: string, units: string, winningAmount: string, currency: string, paymentDeadline: Date) {
  const deadlineStr = paymentDeadline.toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' });
  await sendEmail({
    to: winnerEmail,
    subject: `Congratulations! You Won the Auction — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #059669; margin: 0 0 16px;">You Won the Auction!</h2>
      <p style="color: #475569;">Hi ${winnerName},</p>
      <p style="color: #475569;">Congratulations! You are the winning bidder for units in <strong>${propertyName}</strong>.</p>
      ${detailsTable([
        ['Property', propertyName],
        ['Units Won', units],
        ['Winning Bid', formatAmount(currency, winningAmount)],
        ['Payment Deadline', deadlineStr],
      ])}
      <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
        <p style="color: #92400e; margin: 0;"><strong>Action Required:</strong> Complete your payment by <strong>${deadlineStr}</strong> to secure your units.</p>
      </div>
      <p style="color: #475569; font-weight: 600;">Transfer the exact amount to one of the following Brikvest accounts:</p>
      ${BANK_DETAILS}
      <p style="color: #475569;">After making the transfer, click the button below to confirm your payment on the platform.</p>
      ${actionButton('Confirm Payment', `${PLATFORM_URL}/marketplace`)}
    `),
  });
}

// 7. Fixed-price purchase — payment needed (to buyer)
export async function sendFixedPricePurchaseEmail(buyerEmail: string, buyerName: string, propertyName: string, units: string, amount: string, currency: string, paymentDeadline: Date) {
  const deadlineStr = paymentDeadline.toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' });
  await sendEmail({
    to: buyerEmail,
    subject: `Complete Your Purchase — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #1a365d; margin: 0 0 16px;">Purchase Confirmed — Payment Required</h2>
      <p style="color: #475569;">Hi ${buyerName},</p>
      <p style="color: #475569;">You have successfully reserved units in <strong>${propertyName}</strong>. Please complete payment to finalize the purchase.</p>
      ${detailsTable([
        ['Property', propertyName],
        ['Units', units],
        ['Amount Due', formatAmount(currency, amount)],
        ['Payment Deadline', deadlineStr],
      ])}
      <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
        <p style="color: #92400e; margin: 0;"><strong>Action Required:</strong> Transfer the exact amount below by <strong>${deadlineStr}</strong>.</p>
      </div>
      <p style="color: #475569; font-weight: 600;">Transfer to one of the following Brikvest accounts:</p>
      ${BANK_DETAILS}
      <p style="color: #475569;">After making the transfer, confirm your payment on the platform.</p>
      ${actionButton('Confirm Payment', `${PLATFORM_URL}/marketplace`)}
    `),
  });
}

// 8. Payment approved (to buyer)
export async function sendPaymentApprovedEmail(buyerEmail: string, buyerName: string, propertyName: string, units: string, amount: string, currency: string) {
  await sendEmail({
    to: buyerEmail,
    subject: `Payment Verified — Units Transferred — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #059669; margin: 0 0 16px;">Payment Approved</h2>
      <p style="color: #475569;">Hi ${buyerName},</p>
      <p style="color: #475569;">Your payment has been verified and the units have been transferred to your account.</p>
      ${detailsTable([
        ['Property', propertyName],
        ['Units Acquired', units],
        ['Amount Paid', formatAmount(currency, amount)],
        ['Status', '✅ Transfer Complete'],
      ])}
      <p style="color: #475569;">You can now view your updated holdings in your dashboard.</p>
      ${actionButton('View My Holdings', `${PLATFORM_URL}/dashboard`)}
    `),
  });
}

// 9. Payment rejected (to buyer)
export async function sendPaymentRejectedEmail(buyerEmail: string, buyerName: string, propertyName: string, amount: string, currency: string, reason: string, attemptsRemaining: number) {
  await sendEmail({
    to: buyerEmail,
    subject: `Payment Not Verified — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #dc2626; margin: 0 0 16px;">Payment Not Verified</h2>
      <p style="color: #475569;">Hi ${buyerName},</p>
      <p style="color: #475569;">Your payment for <strong>${propertyName}</strong> could not be verified.</p>
      ${detailsTable([
        ['Property', propertyName],
        ['Amount', formatAmount(currency, amount)],
        ['Reason', reason],
      ])}
      ${attemptsRemaining > 0
        ? `<div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
            <p style="color: #92400e; margin: 0;"><strong>You have ${attemptsRemaining} attempt(s) remaining.</strong> Please verify your payment details and try again.</p>
          </div>
          ${actionButton('Retry Payment', `${PLATFORM_URL}/marketplace`)}`
        : `<div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
            <p style="color: #991b1b; margin: 0;">You have exhausted all payment attempts. The slot will be offered to the next bidder.</p>
          </div>`
      }
    `),
  });
}

// 10. Transfer complete — seller notification
export async function sendTransferCompleteToSellerEmail(sellerEmail: string, sellerName: string, propertyName: string, units: string, amount: string, currency: string, buyerName: string) {
  await sendEmail({
    to: sellerEmail,
    subject: `Units Sold Successfully — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #059669; margin: 0 0 16px;">Sale Complete</h2>
      <p style="color: #475569;">Hi ${sellerName},</p>
      <p style="color: #475569;">Your units in <strong>${propertyName}</strong> have been successfully sold and transferred.</p>
      ${detailsTable([
        ['Property', propertyName],
        ['Units Sold', units],
        ['Sale Amount', formatAmount(currency, amount)],
        ['Buyer', buyerName],
        ['Status', '✅ Transfer Complete'],
      ])}
      <p style="color: #475569;">Your payout will be processed shortly (minus any applicable platform fees).</p>
      ${actionButton('View Dashboard', `${PLATFORM_URL}/dashboard`)}
    `),
  });
}

// 11. Deadline expired / next bidder offered (to failed buyer)
export async function sendPaymentExpiredEmail(buyerEmail: string, buyerName: string, propertyName: string) {
  await sendEmail({
    to: buyerEmail,
    subject: `Payment Deadline Expired — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #dc2626; margin: 0 0 16px;">Payment Deadline Expired</h2>
      <p style="color: #475569;">Hi ${buyerName},</p>
      <p style="color: #475569;">Your payment deadline for <strong>${propertyName}</strong> has passed. The slot has been offered to the next highest bidder or the listing has been returned to active status.</p>
      <p style="color: #475569;">You can still browse other listings on the marketplace.</p>
      ${actionButton('Browse Marketplace', `${PLATFORM_URL}/marketplace`)}
    `),
  });
}

// 12. Next bidder offered the slot (to next bidder)
export async function sendNextBidderOfferedEmail(bidderEmail: string, bidderName: string, propertyName: string, units: string, bidAmount: string, currency: string, paymentDeadline: Date) {
  const deadlineStr = paymentDeadline.toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' });
  await sendEmail({
    to: bidderEmail,
    subject: `You've Been Offered Units — ${propertyName}`,
    html: emailWrapper(`
      <h2 style="color: #2563eb; margin: 0 0 16px;">You've Been Offered the Slot!</h2>
      <p style="color: #475569;">Hi ${bidderName},</p>
      <p style="color: #475569;">The previous winner did not complete payment for <strong>${propertyName}</strong>. As the next highest bidder, these units are now being offered to you.</p>
      ${detailsTable([
        ['Property', propertyName],
        ['Units', units],
        ['Your Bid Amount', formatAmount(currency, bidAmount)],
        ['Payment Deadline', deadlineStr],
      ])}
      <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
        <p style="color: #92400e; margin: 0;"><strong>Action Required:</strong> Complete your payment by <strong>${deadlineStr}</strong> to secure your units.</p>
      </div>
      <p style="color: #475569; font-weight: 600;">Transfer the exact amount to one of the following Brikvest accounts:</p>
      ${BANK_DETAILS}
      ${actionButton('Confirm Payment', `${PLATFORM_URL}/marketplace`)}
    `),
  });
}

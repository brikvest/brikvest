# Brikvest - Real Estate Investment Platform

## Overview
Brikvest is a membership-based fractional real estate investment club platform. It enables approved members to invest in properties with fractional ownership, starting from ₦30,000. Properties are exclusively available to approved members to maintain club status and SEC compliance. The platform features a members-only investor interface and a comprehensive administrative dashboard for property and member management.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
The application employs a modern full-stack architecture with a clear separation of concerns.

**Frontend**: Built with React, TypeScript, Vite, Wouter for routing, React Query for state management, shadcn/ui and Radix UI for components, TipTap for rich text editing, React Hook Form with Zod for forms, and Tailwind CSS for styling.

**Backend**: Powered by an Express.js server with TypeScript, utilizing Drizzle ORM for PostgreSQL, Express session for admin authentication, `crypto` for password hashing, Multer with Cloudinary for image uploads, and Nodemailer with Gmail SMTP for email services.

**Database**: PostgreSQL managed with Drizzle ORM.

**Authentication**: Features a dual authentication system for both general users (email/password) and administrators, with a membership-based access control system where new users require admin approval.

**File Storage**: Cloudinary is used for image storage, while Replit Object Storage handles PDF documents.

**Email Service**: Gmail SMTP is integrated for sending transactional emails and automated notifications.

**UI/UX Decisions**: The platform adopts a modern, responsive design using Tailwind CSS and shadcn/ui. Key UI/UX elements include a Stripe-inspired user dashboard, gradient designs for public insights pages, mobile-first responsiveness, and optimized layouts. Sensitive dashboard statistics are blurred until KYC verification is completed.

**Key Features**: Includes fractional property investment, detailed property listings, investment reservations, robust admin property management, multi-currency support with real-time exchange rates, market insights for multiple Abuja locations derived from web scraping PropertyPro.ng with data visualization, a comprehensive user dashboard, and a full KYC (Know Your Customer) verification system with document uploads. The system also handles currency conversion consistently across the platform for accurate financial representation. A comprehensive ownership certificate generation and verification system is implemented for confirmed investments. Automated 24-hour reservation expiration and a user-initiated payment submission workflow are core functionalities. Per-property valuation report PDFs can be uploaded by admins and viewed/downloaded by investors who hold confirmed investments in that property. A `property_valuations` table stores historical valuation records (date, value, appreciation %, PDF report, notes) per property. Admin can manage multiple valuation entries per property. Investor dashboard renders two real data-driven charts: Land Appreciation (property value trend from valuations) and Investment Performance (personalized: starts from investor's entry date, shows initial vs current value with return %).

**Account Status Flow**: `pending` → `approved` / `rejected`. New users register, their account goes to `pending` status, requiring admin approval.
**KYC Status Flow**: `not_started` → `submitted` → `approved` / `rejected`.
**Investment Status Flow**: `reserved` → `expired` / `converted_to_investment` / `cancelled`.
**Payment Submission Flow**: User reserves → completes KYC → uploads payment proof → Admin reviews (approves/rejects). Approval converts reservation to investment and generates a certificate.

**Referral Program**: Users get a unique referral code (BRIK-XXXXXX) on registration. Shareable link: `/login?ref=CODE`. Referral codes stored in localStorage/URL params. On signup with valid code, a `referrals` record is created, rewards calculated per configurable tiers ($20 for 1 referral, $50 for 2+). `referral_rewards` table tracks payout status (pending/approved/paid). User dashboard shows referral stats, link sharing (WhatsApp/Twitter/Facebook/Email), and referral history. Admin endpoints for viewing/managing reward payouts. Anti-abuse: no self-referrals, only new accounts count, code validated before linking.

**P2P Unit Resale System**: Properties have an `isTransferable` boolean (default `false`) that admins toggle per-property via the admin property form. When enabled, investors holding confirmed investments can list their units for resale to other approved members. The `resale_listings` table stores seller listings with fields for units, selling type (`fixed_price` or `bidding`), asking price, minimum/reserve price, bidding end time, winner tracking, payment deadline, and status (`pending_review` → `approved` / `rejected` / `sold` / `cancelled` / `awaiting_payment`). Units in pending or approved listings are "locked" — the system prevents double-listing by checking active listings when a new one is created. Sellers can cancel pending/approved listings to unlock units. Admin reviews listings via a dedicated "Resale Listings" tab with approve/reject, "End Bidding", "Cancel Listing", and "Expire & Next Bidder" actions. The admin listings tab has clickable status filter cards (All/Pending/Live/Awaiting Pay/Sold) and shows enriched data: bid count, highest bid, winner info, and payment status. The `resale_bids` table tracks bids with status (`active` / `outbid` / `won` / `lost` / `failed_payment`). A dedicated `/marketplace` page lets approved users browse live listings, place bids on auction listings (must exceed current highest bid and reserve price), or buy fixed-price listings directly. When bidding ends (admin action), the highest bidder wins, all others are marked as lost, and the winner gets 48 hours to complete payment. Fixed-price buyers also get 48 hours. User dashboard has a "Marketplace" button and "My Resale Listings" section. The marketplace shows "My Bids" with real-time status tracking.

**Resale Payment Flow**: When a buyer wins a bid or buys fixed-price, the listing enters `awaiting_payment` status. The marketplace shows a "Pending Payments" section at the top with Brikvest bank details (NGN/USD/GBP), the exact amount to pay, and the payment deadline. Buyer transfers externally, then clicks "I've Made Payment" with a bank reference and optional proof upload (image/PDF). The `resale_payments` table tracks submissions with status `pending_verification` → `approved` / `rejected`, plus `attemptNumber` for retry tracking. Admin reviews via a "Resale Payments" tab (with status filter cards) in the admin panel. On approval: listing → `sold`, seller's units are decremented, buyer gets a new `converted_to_investment` reservation. On rejection: buyer can retry up to 3 times; after exhausting retries, slot is offered to next bidder.

**Resale Anti-Abuse & Fallback System**:
- **KYC Gating**: Only KYC-verified users (`kycStatus === "approved"`) can place bids or purchase fixed-price listings.
- **Self-trade Prevention**: Sellers cannot bid on or buy their own listings (enforced server-side).
- **Unit Locking**: Units in active listings (pending_review, approved, awaiting_payment) are locked and cannot be double-listed. Available units = owned - locked.
- **Anti-Sniping**: If a bid is placed within the last 5 minutes of an auction's end time, the auction auto-extends by 5 minutes.
- **Payment Retry Limits**: Buyers get max 3 payment attempts per listing. After 3 rejections, the slot is automatically offered to the next highest bidder.
- **Expired Payment Deadline Fallback**: When a payment deadline expires, the system (via scheduled job every 30 min, or admin "Expire & Next Bidder" button) marks the bid as `failed_payment`, rejects pending payments, and offers the slot to the next highest bidder. If no eligible bidders remain (or next bid is below reserve), the listing returns to active status.
- **Next-Bidder Cascade**: The `handleNextBidderFallback` helper function finds the next highest bidder excluding all failed bidders, checks reserve price, and either assigns a new winner with a fresh 48-hour deadline or returns the listing to active.
- **Admin-Controlled Transfers**: No unit transfer happens until admin explicitly approves the payment — platform controls the process end-to-end.
- **Admin Cancel**: Admin can force-cancel any non-sold listing. Cancelling an awaiting_payment listing rejects pending payments; cancelling an auction listing marks all active bids as lost.

**Valuation System (Dual-Value Model)**: The `property_valuations` table stores two distinct value types per entry: `rawAssetValue` (actual land/market value, powers the Land Appreciation graph) and `investorBasisValue` (investor-facing value including SPV/legal/deal costs, powers the Investment Performance graph). This separation allows land to appreciate while investor performance may be flat or negative due to cost overhead. Old records are backfill-compatible (fallback to `currentValue` if new fields are null). Admin form clearly labels both fields with help text.

**Resale Audit Trail**: The `resale_audit_logs` table records every significant P2P resale action with full context: listing creation/approval/rejection/cancellation, bids placed (with amounts and timestamps), winner selection, payment submissions, admin approval/rejection of payments, unit transfer completion, deadline expirations, and next-bidder fallback events. Each log entry captures: `action`, `actorType` (user/admin/system), `actorId`, `actorName`, `sellerId`, `buyerId`, `propertyId`, `listingId`, `bidId`, `paymentId`, `units`, `amount`, `currency`, `details` (human-readable), and optional `metadata` (JSON). The `logResaleAudit()` helper in routes.ts wraps all logging in try/catch so audit failures never block business logic. Admin can view the full audit trail via a "Resale Audit Trail" tab with filtering by listing ID, and can click any listing ID to open a visual timeline dialog showing the complete chronological history. API endpoints: `GET /api/admin/resale-audit-logs` (with optional `listingId`, `propertyId`, `limit` query params) and `GET /api/admin/resale-audit-logs/listing/:id` (returns listing + timeline). Supports dispute resolution, compliance, and internal reporting.

**Data Integrity Safeguards**: The system automatically links orphaned reservations to user accounts by email on login/registration and uses audit logging to track critical actions. Referral codes have a unique DB constraint, and referral pairs have a unique index on `(referrer_user_id, referred_user_id)` to prevent double-counting.

## External Dependencies
*   **Database & ORM**: `@neondatabase/serverless`, `drizzle-orm`.
*   **Frontend State Management**: `@tanstack/react-query`.
*   **UI Components**: `@radix-ui/react-*`, `@tiptap/react`.
*   **Authentication**: `passport`.
*   **File Storage**: `cloudinary`.
*   **Email**: `nodemailer`.
*   **Web Scraping**: `cheerio`, `got`.
*   **Development Tools**: Vite, TypeScript, Tailwind CSS, ESBuild, Drizzle Kit.
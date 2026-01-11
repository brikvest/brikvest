# Brikvest - Real Estate Investment Platform

## Overview
Brikvest is a full-stack fractional real estate investment platform designed to democratize real estate investment. It enables users to invest in properties with fractional ownership starting from ₦30,000. The platform features a public-facing investor interface and a comprehensive administrative dashboard for property management, aiming to make real estate accessible to a wider audience.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
The application employs a modern full-stack architecture with a clear separation of concerns.

-   **Frontend**: Built with React, TypeScript, Vite, Wouter for routing, React Query for state management, shadcn/ui and Radix UI for components, TipTap for rich text editing, React Hook Form with Zod for forms, and Tailwind CSS for styling.
-   **Backend**: Powered by an Express.js server with TypeScript, utilizing Drizzle ORM for PostgreSQL, Express session for admin authentication, `crypto` for password hashing, Multer with Cloudinary for image uploads, and Nodemailer with Gmail SMTP for email services.
-   **Database**: PostgreSQL managed with Drizzle ORM.
-   **Authentication**: Features a dual authentication system for both general users (email/password) and administrators.
-   **File Storage**: Cloudinary is used for image storage, while Replit Object Storage handles PDF documents.
-   **Email Service**: Gmail SMTP is integrated for sending transactional emails.
-   **UI/UX Decisions**: The platform adopts a modern, responsive design using Tailwind CSS and shadcn/ui. Key UI/UX elements include a Stripe-inspired user dashboard, gradient designs for public insights pages, mobile-first responsiveness with slide-in sidebars, and optimized layouts. Sensitive dashboard statistics are blurred until KYC verification is completed.
-   **Key Features**: Includes fractional property investment, detailed property listings, investment reservations, robust admin property management, multi-currency support with real-time exchange rates, market insights for multiple Abuja locations (Guzape, Jahi, Lugbe) derived from web scraping PropertyPro.ng with data visualization, a comprehensive user dashboard, and a full KYC (Know Your Customer) verification system with document uploads (supporting various image formats and PDFs). The system also handles currency conversion consistently across the platform for accurate financial representation.

## Recent Updates (January 11, 2026)
-   **User-Initiated Payment Submission Workflow**: Complete overhaul from admin-assisted to user-initiated payment proof upload system.
    - **New Flow**: Users upload payment proof → Admin reviews → Approval converts reservation to investment with certificate
    - **Payment Submissions Table**: New `payment_submissions` table with statuses: `pending_admin_review`, `approved`, `rejected`
    - **User Endpoints**: 
      - `POST /api/payment-submissions/:reservationId` - Upload payment proof
      - `GET /api/payment-submissions/reservation/:reservationId` - Get submission by reservation
      - `GET /api/payment-submissions/my-submissions` - Get user's submissions
    - **Admin Endpoints**:
      - `GET /api/admin/payment-submissions` - View pending submissions
      - `POST /api/admin/payment-submissions/:id/approve` - Approve and convert to investment
      - `POST /api/admin/payment-submissions/:id/reject` - Reject with reason
    - **Atomic Updates**: Approved submissions atomically update reservation status, generate ownership certificates, and send confirmation emails

-   **Status Value Migration**: Standardized status enums across the platform.
    - **KYC Statuses**: `not_started` → `submitted` → `approved` / `rejected` (replaces old pending/verified)
    - **Reservation Statuses**: `reserved` → `expired` / `converted_to_investment` / `cancelled` (replaces old payment_pending/payment_received/confirmed)
    - **UI Updates**: All admin and dashboard components updated to use new status values with appropriate badges and gating

-   **24-Hour Reservation Expiration System**: Implemented automatic expiration for investment reservations to prevent indefinite unit holds.
    - **Schema Update**: Added `expiresAt` field to `investment_reservations` table
    - **Expiration Setting**: All new reservations automatically expire 24 hours from creation
    - **Email Notifications**: Updated investment email templates to notify users about 24-hour deadline and required steps (sign in → complete KYC → get approval → pay)
    - **Automatic Cleanup**: Server runs cleanup on startup and hourly to cancel expired 'reserved' reservations
    - **Admin Endpoint**: POST `/api/admin/cleanup-expired-reservations` for manual cleanup
    - **Race Condition Protection**: Cleanup uses guarded UPDATE with RETURNING to prevent cancelling reservations whose status changed during cleanup
    - **Inventory Consistency**: Cancelled reservations properly restore both `availableSlots` and `reservedUnits`

## Previous Updates (November 29, 2025)
-   **Ownership Certificate System**: Implemented comprehensive ownership certificate generation and verification for confirmed investments.
    - **Certificate Generation**: Auto-generates CERT-YYYY-NNNN format certificates with UUID verification tokens when admin confirms investment
    - **Dashboard Integration**: Investors can view and download certificates from the "My Property Holdings" section via "Certificate" button
    - **Premium Certificate Design**: Professional financial document styling with Brikvest branding, QR code for verification, owner details, property information, and investment amount
    - **Download Functionality**: Uses html2canvas to generate downloadable PNG images of certificates
    - **Public Verification**: QR codes link to `/verify/:token` public page where anyone can verify certificate authenticity
    - **Verification API**: Public endpoints at `/api/verify/certificate/:token` and `/api/verify/certificate-number/:certNumber`
    - **Database Schema**: `ownership_certificates` table with unique certificate numbers, verification tokens, and investment details

## Previous Updates (November 20, 2025)
-   **Market Insights Multi-Location Support**: Successfully implemented support for **eight Abuja locations** (Guzape, Jahi, Lugbe, Asokoro, Lokogoma, Maitama, Apo, Gwarinpa) on the Market Insights page. Each location displays historical price trends, index growth charts, and market statistics from 2019-2025 with exact data extracted from PropertyPro.ng.
    - **Data Source**: PropertyPro.ng market insights pages (`https://propertypro.ng/index/sale/all/abuja/:location`)
    - **Technical Approach**:
      - **Guzape**: Uses cached HTML file with embedded `priceHistoryData` and `priceIndexData` JavaScript variables
      - **All Other Locations**: Real-time extraction of `renderGlobalChart()` function calls and historical price cards from PropertyPro.ng HTML using regex and cheerio parsing
      - All locations return consistent data structure: `{priceChart, indexChart, historicalPrices, scrapedAt}`
    - **Implementation Details**:
      - Backend endpoint `/api/scrape/:location-graphs` handles data extraction with robust validation
      - Regex patterns handle scientific notation (e.g., `1.9625E8`) and varying whitespace
      - HTML parsing extracts exact historical prices supporting both "million" and "billion" formats
      - Comprehensive error handling for missing data, parse failures, and network issues
      - Frontend dynamically switches between locations with React Query cache management
    - **Data Examples**: 
      - Jahi: ₦340M (6mo), ₦322.5M (1yr), ₦205.42M (2yr)
      - Maitama: ₦3.50B (6mo), ₦2.33B (1yr), ₦1.39B (2yr)

## Previous Updates (November 14, 2025)
-   **Portfolio Calculation Fix**: Corrected dashboard portfolio calculations to accurately reflect payment status. Total Portfolio Value now only includes investments with status 'confirmed' or 'payment_received', excluding 'payment_pending' reservations. This ensures investors see accurate financial data based on actual payment confirmation.
-   **Investment Status Migration**: Migrated legacy status values ('pending', 'reserved') to new standardized statuses ('payment_pending', 'payment_received', 'confirmed', 'cancelled') for data consistency across the platform.
-   **PDF Document Routing**: Fixed PDF document serving by implementing wildcard route pattern (`/api/documents/*`) to handle nested folder paths (e.g., `kyc/documents/filename.pdf`) in Replit Object Storage.
-   **Orphaned Reservations Fix**: Resolved issue where investment reservations with NULL user_id caused portfolios to show 0. Implemented automatic linking of reservations to user accounts by email on login/registration. Fixed 25 existing orphaned reservations and added safeguards to prevent future occurrences.

## Investment Status Flow
1. **reserved**: Initial reservation created, awaiting payment proof upload
2. **expired**: Reservation expired (24-hour timeout without payment submission)
3. **converted_to_investment**: Investment confirmed and active (counts toward portfolio value and properties owned)
4. **cancelled**: Reservation cancelled by admin or user

## KYC Status Flow
1. **not_started**: User has not begun KYC verification
2. **submitted**: User has submitted KYC documents, awaiting admin review
3. **approved**: Admin has verified and approved KYC
4. **rejected**: Admin has rejected KYC (user can resubmit)

## Payment Submission Flow
1. User creates reservation → status: `reserved`
2. User completes KYC → kycStatus: `submitted` → `approved`
3. User uploads payment proof → creates `payment_submissions` record with status: `pending_admin_review`
4. Admin reviews → approves: reservation becomes `converted_to_investment`, certificate generated
5. Or admin rejects → submission status: `rejected`, user can upload new proof

## Payment Rules
- **Reservations**: Users can reserve without an account (creates orphaned reservation with email only)
- **Payment Proof Upload Requirements**: User must:
  1. Be signed in (reservation must have userId linked)
  2. Have KYC approved (kycStatus = 'approved')
  3. Have reservation in 'reserved' status
- **Admin Approval**: Admin reviews payment proof and approves/rejects
- **Investment Confirmation**: Approved payments automatically convert reservations and generate ownership certificates

## Data Integrity Safeguards
-   **Auto-Linking on Authentication**: When users log in or register, the system automatically links any orphaned investment reservations (those with NULL user_id) to their account by matching email addresses. This ensures portfolios display all user investments even if reservations were created before account creation.
-   **Reservation Creation**: All reservation endpoints automatically set user_id when the user is authenticated, preventing new orphaned records.
-   **Audit Logging**: Auto-linking operations are logged with format `[AUTO-LINK] Linked N orphaned reservation(s) to user ID (email)` for monitoring and troubleshooting.

## External Dependencies
-   **Database & ORM**: `@neondatabase/serverless` (PostgreSQL connection pooling), `drizzle-orm`.
-   **Frontend State Management**: `@tanstack/react-query`.
-   **UI Components**: `@radix-ui/react-*`, `@tiptap/react`.
-   **Authentication**: `passport`.
-   **File Storage**: `cloudinary`.
-   **Email**: `nodemailer`.
-   **Web Scraping**: `cheerio`, `got`.
-   **Development Tools**: Vite, TypeScript, Tailwind CSS, ESBuild, Drizzle Kit.
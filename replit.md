# Brikvest - Real Estate Investment Platform

## Overview
Brikvest is a full-stack fractional real estate investment platform enabling users to invest in real estate properties with fractional ownership starting from ₦30,000. The platform includes a public-facing investor interface and an administrative dashboard for property management. Its purpose is to democratize real estate investment, making it accessible to a broader audience.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
The application uses a modern full-stack architecture with clear separation of concerns:
-   **Frontend**: React with TypeScript, Vite, Wouter for routing, React Query for state management, shadcn/ui and Radix UI for components, TipTap for rich text editing, React Hook Form with Zod for forms, and Tailwind CSS for styling.
-   **Backend**: Express.js server with TypeScript, Drizzle ORM for PostgreSQL, Express session for admin authentication, `crypto` for password hashing, Multer with Cloudinary for file uploads, and Nodemailer with Gmail SMTP for emails.
-   **Database**: PostgreSQL with Drizzle ORM.
-   **Authentication**: Dual system for user (email/password) and admin sessions.
-   **File Storage**: Cloudinary for images, Replit Object Storage for PDF documents.
-   **Email Service**: Gmail SMTP for transactional emails.
-   **UI/UX Decisions**: Employs Tailwind CSS with shadcn/ui for a modern, responsive design. Features include a Stripe-inspired user dashboard, gradient designs for public insights pages, and mobile-first responsiveness with slide-in sidebars and optimized layouts. Sensitive dashboard stats are blurred until KYC verification is complete.
-   **Key Features**: Fractional property investment, property listings, investment reservations, admin property management, multi-currency support with real-time exchange rates, market insights (via web scraping and data visualization), comprehensive user dashboard, and a full KYC (Know Your Customer) verification system with file uploads.

## Recent Changes

### November 13, 2025
-   **Currency Conversion Fix for Portfolio and Admin**: Fixed critical currency conversion bugs throughout the application
    -   **Portfolio Total Invested Fix**: Changed from summing raw `reservation.amount` values to converting each amount using `convertAmount(Number(reservation.amount), reservation.currency)` before summing, ensuring accurate multi-currency aggregation
    -   **Chart Data Conversion**: Portfolio growth chart now converts each investment amount from its source currency to user's selected currency before calculating cumulative totals
    -   **Admin Panel Currency Integration**: Replaced hardcoded `₦` symbol with `useCurrency` hook for proper multi-currency support
    -   **formatCurrency Enhancement**: Updated admin `formatCurrency` function to accept source currency parameter and convert using `convertAmount(amount, currency)` before applying abbreviations (B/M/K)
    -   **Property Display Updates**: All `formatCurrency` calls for properties now pass `property.currency` parameter for accurate conversion
    -   **Aggregate Calculations**: Total Value calculations in admin now convert each property using `convertAmount(p.totalValue, p.currency)` before summing, then format with `formatCurrencyBase`
    -   **Currency Conversion Path**: All amounts convert from source currency → USD → user's selected currency using exchange rates from `/api/exchange-rates`
    -   **Files Modified**: `client/src/pages/dashboard.tsx` (lines 258-264, 571-574, 675-678, 790-793), `client/src/pages/admin.tsx` (lines 1052, 1265-1288, 1686-1688, 1779-1783, 1955-1956, 2045-2047, 2960-2964)

### November 06, 2025
-   **KYC Document PDF Support**: Extended PDF support to KYC verification system
    -   **ID Document PDF Support**: ID documents now accept both images (JPG, PNG, WEBP, HEIC) and PDF files
    -   **Selective PDF Support**: Only ID documents accept PDFs; signatures and selfies remain image-only for security
    -   **Smart File Routing**: ID document PDFs automatically routed to Replit Object Storage, images to Cloudinary
    -   **Frontend Validation**: Updated file type validation to accept `.pdf` files for ID documents (max 10MB)
    -   **Backend Logic**: Enhanced `/api/kyc/submit` endpoint to detect PDF MIME type and route accordingly
    -   **Admin Display**: KYC detail modal detects PDF documents by URL pattern and shows file icon with "View PDF" button
    -   **Storage Location**: KYC PDFs stored in `.private/kyc/documents/` folder within Object Storage
    -   **User Experience**: Help text updated to show "JPG, PNG, WEBP, HEIC, or PDF" for ID document uploads
-   **PDF Document Storage Enhancement**: Implemented Replit Object Storage for PDF documents
    -   **Storage Strategy**: PDFs now stored in Replit Object Storage, images continue using Cloudinary
    -   **Upload Function**: New `uploadToObjectStorage()` function in `server/cloudinary.ts` handles PDF uploads
    -   **Smart Routing**: `/api/upload/document` endpoint automatically routes PDFs to Object Storage, images to Cloudinary
    -   **PDF Serving**: New `/api/documents/:folder/:filename` endpoint streams PDFs from Object Storage
    -   **Admin Display**: Payment evidence in admin panel now shows PDF icon with "View PDF Document" link for PDFs, image previews for images
    -   **File Detection**: System detects file type by URL pattern (`/api/documents/` = PDF, Cloudinary URL = image)
    -   **Browser Compatibility**: PDFs served with proper Content-Type headers for inline viewing
    -   **Storage Location**: PDFs stored in `.private/documents/` folder within Replit Object Storage bucket
-   **Currency Conversion Fix for Reservations**: Fixed critical bug where converted currency amounts were being stored instead of original property prices
    -   **Backend Enhancement**: `/api/properties-converted` endpoint now returns both original values (`originalUnitPrice`, `originalCurrency`) and converted values for display
    -   **Reservation Logic**: Reservation creation now uses original property price and currency instead of user's display currency
    -   **Admin Display**: Admin panel now correctly shows reservations in property's native currency (e.g., ₦325,000 NGN instead of ₦225.85)
    -   **Database Fix**: Corrected existing test reservation (ID 63) from ₦225.85 to ₦325,000
    -   **User Experience**: Users still see converted prices for convenience, but system stores correct original amounts
-   **Portfolio Page Redesign**: Transformed the user dashboard into a professional investment portfolio experience
    -   **Renamed**: Changed "Dashboard" to "Portfolio" throughout the user interface
    -   **Navigation Icon**: Updated sidebar icon from Home to PieChart for better portfolio representation
    -   **Portfolio Growth Chart**: Added interactive AreaChart showing cumulative investment growth over time using Recharts
    -   **Visual Design**: Enhanced stat cards with gradient background for Total Portfolio Value (blue gradient) and improved styling
    -   **Portfolio Metrics**: Updated cards to show Properties Owned, Total Investments with detailed sub-metrics
    -   **Chart Features**: Shows investment timeline, cumulative value, with summary statistics (Total Invested, Properties count, Average Investment)
    -   **Component**: Renamed Dashboard component to Portfolio in `client/src/pages/dashboard.tsx`
-   **KYC Document Upload Enhancement**: Improved KYC document upload system for better user experience
    -   **Allowed Formats**: JPG, PNG, WEBP, and HEIC images (removed PDF support)
    -   **HEIC Support**: Added support for Apple's HEIC/HEIF image format from iPhones and iPads
    -   **Smart Update System**: When updating KYC information, users no longer need to re-upload documents they've already submitted
    -   **Visual Indicators**: Form now shows "Already uploaded" message for existing documents with checkmark icon
    -   **Optional Re-upload**: Users can choose to replace existing documents by uploading new ones
    -   **Frontend Validation**: Client-side file type and size validation only when new files are provided
    -   **Backend Validation**: Server-side validation preserves existing document URLs when no new file is uploaded
    -   **User Guidance**: Updated help text to clarify image formats with HEIC support and indicate which fields are already completed
    -   **Admin Image Display**: HEIC images automatically converted to JPG format for browser compatibility in admin panel
    -   **Cloudinary Integration**: All uploaded images automatically converted to JPG for universal browser support
-   **Investment Reservation Validation Improvements**: Enhanced error messages and data validation for better user experience
    -   **User-Friendly Error Messages**: Replaced generic "Invalid data provided" with specific, actionable messages (e.g., "Please enter your full name", "Only 5 units available. Please select a smaller quantity.")
    -   **Schema Fix**: Changed `amount` and `unitPriceSnapshot` from integer to decimal to support fractional prices
    -   **Field-Specific Validation**: Each form field now returns clear, understandable error messages
    -   **Availability Messaging**: Shows exact number of available units when user tries to reserve more than available
    -   **Auto-Fill for Logged-in Users**: When authenticated users reserve slots, their name, email, and phone are automatically pre-filled and hidden from the form
    -   **Simplified Reservation Flow**: Logged-in users only need to select units and optionally enter a referral code
-   **Investment Currency Fix**: Corrected Gilmore Land, Guzape 2 property to use Naira (NGN) currency
    -   **Property**: Updated from USD to NGN with ₦325,000 per unit pricing
    -   **Reservations**: All existing Gilmore Land investments updated to NGN currency
    -   **Admin Panel**: Dropdown menu now always shows "View Details" option for all investment statuses, including confirmed investments
-   **Investment Reservation Management Enhancement**: Added comprehensive editing capabilities for investment reservations
    -   **Edit Investment Endpoint**: New `PUT /api/admin/investments/:id` endpoint allows updating reservation details
    -   **Editable Fields**: Admins can now edit units, payment method, payment reference, payment evidence, and internal notes
    -   **Smart Unit Management**: When units are changed, the system automatically validates availability and updates property counts
    -   **Amount Recalculation**: Investment amount is automatically recalculated when units are changed
    -   **Edit Dialog**: Added user-friendly edit dialog in admin panel with all reservation details with live price calculator
    -   **Workflow**: Edit → Mark Paid → Confirm sequence allows flexible investment management
    -   **File Upload**: Support for updating payment evidence documents during editing
    -   **Three-Dots Menu**: Actions column now uses a scalable dropdown menu instead of individual buttons
    -   **Price Display**: Table and modal show current amount and real-time calculation when editing units
-   **KYC Document Viewing Enhancement**: Improved admin KYC document viewing with visual previews
    -   **Image Previews**: Documents now show thumbnail previews instead of just links
    -   **Error Handling**: Added fallback images if document loading fails
    -   **PDF Support**: Shows file icon for PDF documents
    -   **Grid Layout**: Documents displayed in a clean 3-column grid
    -   **Cloudinary Integration**: Verified all uploads are properly saved to Cloudinary with correct URLs

### November 05, 2025
-   **Enhanced KYC Verification**: Added two new required fields to the KYC verification process
    -   **Occupation Field**: Required text input for user's occupation/profession with minimum 2 character validation
    -   **Signature Upload**: Required image upload (JPG/PNG/WEBP only, max 5MB) for user's signature
    -   Database fields: `kycOccupation` (text) and `kycSignatureUrl` (text) added to users table
    -   Frontend validation: Client-side file type and size validation before submission
    -   Backend validation: Server-side file type and size validation with Cloudinary upload to 'brikvest/kyc/signatures'
    -   Admin panel: Both fields now visible in KYC detail modal for verification review
    -   Updated KYC submission schema in `shared/schema.ts` to include occupation validation
-   **KYC Update System for Existing Users**: Implemented automatic detection and update workflow for existing verified users
    -   Orange banner appears on dashboard when verified users are missing new required fields (occupation/signature)
    -   KYC form automatically prefills with existing user data when modal is opened for updates
    -   Resubmitting KYC always changes status to 'submitted' for admin review, regardless of previous status
    -   Separate update banner from regular KYC verification banner for better UX
-   **Mobile Navigation Improvement**: Changed mobile sidebar authentication button from "Get Started" to "Sign In" with bold font styling for improved clarity and visibility

### November 04, 2025
-   **Developer Bids Feature Removed**: Completely removed the Developer Bids feature from the platform as it was not being actively used. This included:
    -   Removal of all Developer Bid API endpoints (`/api/developer-bids`, `/api/admin/developer-bids`)
    -   Removal of all Developer Bid UI components from home page (form, modal, buttons)
    -   Removal of Developer Bid management section from admin panel
    -   Removal of Developer Bid email template
    -   Database schema definition retained in `shared/schema.ts` for historical data preservation
-   **Admin Panel Enhancement**: Replaced Developer Bids section with KYC Verifications management in admin panel
    -   New KYC management endpoints: `GET /api/admin/kyc/submissions`, `PUT /api/admin/kyc/:userId/status`
    -   Admin can now view all KYC submissions and approve/reject them directly from the admin panel
    -   Comprehensive KYC detail modal showing user information, identity verification, documents, and quick actions
    -   Removed inline approve/reject buttons from table - all actions now in detailed modal
-   **KYC Email Notifications**: Automated email notifications sent when KYC status is updated
    -   **Approval Email**: Sent when KYC is verified, includes congratulations message and dashboard link
    -   **Rejection Email**: Sent when KYC is rejected, explains common reasons and provides resubmission link
    -   Email templates: `kycApprovedEmailTemplate` and `kycRejectedEmailTemplate` in `server/emailTemplates.ts`
    -   Users receive their KYC status updates via email in addition to seeing updates in the dashboard

## External Dependencies
-   **Database & ORM**: `@neondatabase/serverless` (PostgreSQL connection pooling), `drizzle-orm`.
-   **Frontend State Management**: `@tanstack/react-query`.
-   **UI Components**: `@radix-ui/react-*`, `@tiptap/react` (rich text editor).
-   **Authentication**: `passport`.
-   **File Storage**: `cloudinary`.
-   **Email**: `nodemailer`.
-   **Web Scraping**: `cheerio`, `got`.
-   **Development Tools**: Vite, TypeScript, Tailwind CSS, ESBuild, Drizzle Kit.
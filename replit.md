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
-   **File Storage**: Cloudinary for images and documents.
-   **Email Service**: Gmail SMTP for transactional emails.
-   **UI/UX Decisions**: Employs Tailwind CSS with shadcn/ui for a modern, responsive design. Features include a Stripe-inspired user dashboard, gradient designs for public insights pages, and mobile-first responsiveness with slide-in sidebars and optimized layouts. Sensitive dashboard stats are blurred until KYC verification is complete.
-   **Key Features**: Fractional property investment, property listings, investment reservations, admin property management, multi-currency support with real-time exchange rates, market insights (via web scraping and data visualization), comprehensive user dashboard, and a full KYC (Know Your Customer) verification system with file uploads.

## Recent Changes

### November 06, 2025
-   **Portfolio Page Redesign**: Transformed the user dashboard into a professional investment portfolio experience
    -   **Renamed**: Changed "Dashboard" to "Portfolio" throughout the user interface
    -   **Navigation Icon**: Updated sidebar icon from Home to PieChart for better portfolio representation
    -   **Portfolio Growth Chart**: Added interactive AreaChart showing cumulative investment growth over time using Recharts
    -   **Visual Design**: Enhanced stat cards with gradient background for Total Portfolio Value (blue gradient) and improved styling
    -   **Portfolio Metrics**: Updated cards to show Properties Owned, Total Investments with detailed sub-metrics
    -   **Chart Features**: Shows investment timeline, cumulative value, with summary statistics (Total Invested, Properties count, Average Investment)
    -   **Component**: Renamed Dashboard component to Portfolio in `client/src/pages/dashboard.tsx`
-   **KYC Document Upload Restriction**: Limited KYC document uploads to image formats only
    -   **Allowed Formats**: JPG, PNG, WEBP images only (removed PDF support)
    -   **Frontend Validation**: Client-side file type and size validation for ID document, signature, and selfie
    -   **Backend Validation**: Server-side MIME type checking to enforce image-only uploads
    -   **User Guidance**: Updated help text to clarify image-only requirement
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
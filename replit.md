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
# Brikvest - Real Estate Investment Platform

## Overview
Brikvest is a membership-based fractional real estate investment platform. It allows approved members to invest in properties with fractional ownership, starting from ₦30,000. The platform aims to provide exclusive property access to its members while adhering to SEC compliance. It features a dedicated investor interface and a comprehensive administrative dashboard for managing properties and members. The platform also includes a self-service portal for property developers to list and manage their projects, aiming to expand property offerings and cater to a broader market.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
The application utilizes a modern full-stack architecture designed for scalability and maintainability.

**Frontend**: Developed with React, TypeScript, and Vite. It uses Wouter for routing, React Query for state management, shadcn/ui and Radix UI for UI components, TipTap for rich text editing, React Hook Form with Zod for form management, and Tailwind CSS for styling.

**Backend**: Implemented with an Express.js server in TypeScript, leveraging Drizzle ORM for PostgreSQL interactions. It uses Express session for admin authentication, `crypto` for password hashing, Multer with Cloudinary for image uploads, and Nodemailer with Gmail SMTP for email services.

**Database**: PostgreSQL is used as the primary data store, managed through Drizzle ORM.

**Authentication**: A dual authentication system is in place for general users and administrators. Access to investment features requires approved membership, which is granted by an administrator. Property listings and P2P marketplace listings are publicly viewable.

**File Storage**: Cloudinary is used for storing images, while Replit Object Storage handles PDF documents.

**Email Service**: Gmail SMTP is integrated for transactional emails and automated notifications.

**UI/UX Decisions**: The platform features a modern, responsive design with Tailwind CSS and shadcn/ui components, inspired by Stripe's user dashboards. It incorporates gradient designs for public-facing pages and is optimized for mobile-first responsiveness. Sensitive financial data in dashboards is blurred until KYC verification is complete. The public landing-page header is intentionally minimal — only essential primary links (Properties, Insights, About), a compact currency selector, a subtle "List your project" CTA, and either a "Sign in" button or an avatar `DropdownMenu` (My Portfolio / List your project / Sign out) — keeping the top bar uncluttered and professional.

**Key Features**:
- **Fractional Property Investment**: Enables investment in properties with fractional ownership.
- **Membership Management**: Admin approval for new members and comprehensive member management.
- **Property Management**: Detailed property listings, investment reservations, and robust admin tools for property management.
- **Financial Features**: Multi-currency support with real-time exchange rates, consistent currency conversion across the platform.
- **Market Insights**: Provides market data for specific locations with data visualization, derived from web scraping.
- **User Dashboard**: A comprehensive dashboard for investors to manage their investments and view performance.
- **KYC Verification**: A full Know Your Customer (KYC) system with document uploads for compliance.
- **Ownership Certificates**: Generation and verification of ownership certificates for confirmed investments.
- **Reservation System**: Automated 24-hour reservation expiration and a user-initiated payment submission workflow.
- **Property Valuation**: Admins can upload per-property valuation report PDFs. The system stores historical valuation records and renders two data-driven charts for investors: Land Appreciation and Investment Performance.
- **Referral Program**: Users receive a unique referral code with configurable reward tiers and tracking.
- **P2P Unit Resale System**: Allows approved investors to list their units for resale to other approved members. Features include fixed-price and bidding options, unit locking, admin review, and a dedicated marketplace.
- **Resale Anti-Abuse & Fallback**: Implements KYC gating, self-trade prevention, unit locking, anti-sniping, payment retry limits, and an expired payment deadline fallback system to ensure fair and secure transactions. An admin-controlled transfer process ensures integrity.
- **Resale Audit Trail**: A comprehensive logging system records every significant P2P resale action for dispute resolution, compliance, and reporting.
- **Co-Investor Notifications**: Co-investors in a property are notified via email when a unit in that property is listed for resale.
- **Developer Portal**: A self-service portal for property developers to list, manage, and communicate about their projects. The portal uses a fully responsive shell (`DeveloperLayout`) — fixed sidebar on desktop (≥`lg`), slide-over drawer (shadcn `Sheet`) with hamburger trigger on mobile/tablet, sticky `backdrop-blur` top bar, and a user `DropdownMenu` (profile + sign out) accessible from both the desktop sidebar footer and the mobile top bar avatar. Includes project creation (draft, pending approval, live), an explicit **sales lifecycle stage** (`off_plan` | `completed`) toggleable from the Sales tab and surfaced as a badge on project cards, construction milestone tracking with drag-and-drop reordering (single bulk `POST /api/developer/projects/:id/milestones/reorder` endpoint, optimistic UI via `@dnd-kit/sortable`) and per-milestone progress photos with drag-to-reorder thumbnail strip in the milestone dialog (saved via the existing PATCH `mediaUrls` array, no new endpoint), sales analytics (stage-filtered investor list, 4-week velocity, sell-out forecast, sales-velocity chart), **multi-currency fundraising rollups (NGN/USD/GBP equivalents) for both list and per-project rollup endpoints**, **CRM-style pre-reservation Leads sub-section on the Sales tab** backed by a `developer_leads` table (stages: `lead`/`contacted`/`qualified`/`converted`/`lost`) with stage filter chips, manual lead capture, in-line stage editing, one-click conversion to a soft-locked reservation, and a sell-out forecast that factors in qualified-lead pipeline using historical qualified→converted conversion rate, investor updates with email broadcast, communications history, profile management, and private investor notes. A demo seed (`scripts/seed-demo-developer.ts`, run with `npx tsx scripts/seed-demo-developer.ts`) provisions a demo developer with two showcase projects — **"Lekki Heights — Off-Plan"** at ~62% funded and **"Maitama Garden Villas — Completed"** at ~91% funded — six milestones each, six to seven confirmed investors per project (back-dated for realistic velocity charts), and three project updates each. The seed is fully idempotent: re-running it converges existing reservations and milestones to the seed-defined state.
- **Data Integrity**: Safeguards include linking orphaned reservations, unique constraints for referral codes, and audit logging for critical actions.

## External Dependencies
*   **Database & ORM**: `@neondatabase/serverless`, `drizzle-orm`
*   **Frontend State Management**: `@tanstack/react-query`
*   **UI Components**: `@radix-ui/react-*`, `@tiptap/react`
*   **Authentication**: `passport`
*   **File Storage**: `cloudinary`
*   **Email**: `nodemailer`
*   **Web Scraping**: `cheerio`, `got`
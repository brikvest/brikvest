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
-   **Key Features**: Fractional property investment, property listings, investment reservations, admin property management, developer applications, multi-currency support with real-time exchange rates, market insights (via web scraping and data visualization), comprehensive user dashboard, and a full KYC (Know Your Customer) verification system with file uploads.

## External Dependencies
-   **Database & ORM**: `@neondatabase/serverless` (PostgreSQL connection pooling), `drizzle-orm`.
-   **Frontend State Management**: `@tanstack/react-query`.
-   **UI Components**: `@radix-ui/react-*`, `@tiptap/react` (rich text editor).
-   **Authentication**: `passport`.
-   **File Storage**: `cloudinary`.
-   **Email**: `nodemailer`.
-   **Web Scraping**: `cheerio`, `got`.
-   **Development Tools**: Vite, TypeScript, Tailwind CSS, ESBuild, Drizzle Kit.
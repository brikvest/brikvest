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
-   **Key Features**: Includes fractional property investment, detailed property listings, investment reservations, robust admin property management, multi-currency support with real-time exchange rates, market insights (derived from web scraping and data visualization), a comprehensive user dashboard, and a full KYC (Know Your Customer) verification system with document uploads (supporting various image formats and PDFs). The system also handles currency conversion consistently across the platform for accurate financial representation.

## External Dependencies
-   **Database & ORM**: `@neondatabase/serverless` (PostgreSQL connection pooling), `drizzle-orm`.
-   **Frontend State Management**: `@tanstack/react-query`.
-   **UI Components**: `@radix-ui/react-*`, `@tiptap/react`.
-   **Authentication**: `passport`.
-   **File Storage**: `cloudinary`.
-   **Email**: `nodemailer`.
-   **Web Scraping**: `cheerio`, `got`.
-   **Development Tools**: Vite, TypeScript, Tailwind CSS, ESBuild, Drizzle Kit.
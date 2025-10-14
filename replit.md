# Brikvest - Real Estate Investment Platform

## Overview

Brikvest is a full-stack fractional real estate investment platform built with TypeScript, React, Express.js, and PostgreSQL. The application enables users to invest in real estate properties with fractional ownership, starting from ₦30,000. It features both a public-facing investor interface and an administrative dashboard for property management.

## System Architecture

The application follows a modern full-stack architecture with clear separation of concerns:

- **Frontend**: React with TypeScript, using Vite for development and building
- **Backend**: Express.js server with TypeScript
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Authentication**: Dual authentication system (user email/password and admin sessions)
- **File Storage**: Cloudinary integration for image and document uploads
- **Email Service**: Gmail SMTP for transactional emails
- **UI Framework**: Tailwind CSS with shadcn/ui component library

## Key Components

### Frontend Architecture
- **React Router**: Using Wouter for client-side routing
- **State Management**: React Query for server state management and caching
- **UI Components**: shadcn/ui components with Radix UI primitives
- **Rich Text Editing**: TipTap editor for property descriptions
- **Form Handling**: React Hook Form with Zod validation
- **Styling**: Tailwind CSS with custom design tokens

### Backend Architecture
- **Express.js**: RESTful API server with middleware for authentication and error handling
- **Session Management**: Express session with PostgreSQL store for admin authentication
- **Password Security**: Crypto module with scrypt for password hashing
- **File Upload**: Multer middleware with Cloudinary storage
- **Email Service**: Nodemailer with Gmail SMTP configuration

### Database Schema
- **Users**: Email/password authentication for investors
- **Admin Users**: Separate admin authentication system
- **Properties**: Real estate investment opportunities
- **Investment Reservations**: User investment commitments
- **Developer Bids**: Property developer applications
- **Investment Groups**: Collaborative investment features
- **Sessions**: Session storage for authentication

## Data Flow

1. **User Registration/Login**: Users authenticate via email/password, creating sessions stored in PostgreSQL
2. **Property Investment**: Users browse properties and submit investment reservations
3. **Admin Management**: Administrators manage properties, view investments, and handle developer applications
4. **File Uploads**: Images and documents are uploaded to Cloudinary via the backend API
5. **Email Notifications**: Investment confirmations and notifications sent via Gmail SMTP
6. **Real-time Updates**: React Query manages cache invalidation and optimistic updates

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: PostgreSQL connection pooling
- **drizzle-orm**: Type-safe ORM with PostgreSQL dialect
- **@tanstack/react-query**: Server state management
- **@radix-ui/react-***: Headless UI components
- **@tiptap/react**: Rich text editor
- **passport**: Authentication middleware
- **cloudinary**: Image and file storage
- **nodemailer**: Email service

### Development Tools
- **Vite**: Frontend build tool and development server
- **TypeScript**: Type safety across the stack
- **Tailwind CSS**: Utility-first CSS framework
- **ESBuild**: Backend bundling for production
- **Drizzle Kit**: Database migrations and schema management

## Deployment Strategy

The application is configured for deployment on Replit with the following setup:

- **Build Process**: Vite builds the frontend, ESBuild bundles the backend
- **Production Server**: Node.js serves both API and static files
- **Database**: PostgreSQL with connection pooling via @neondatabase/serverless
- **Environment Variables**: Database URL, Cloudinary credentials, email configuration
- **Port Configuration**: Server runs on port 5000 with external port 80
- **Session Storage**: PostgreSQL-backed sessions for scalability

The deployment uses autoscale deployment target with proper build and start commands configured in the .replit file.

## Changelog

```
Changelog:
- June 15, 2025. Initial setup
- June 16, 2025. Fixed admin authentication system - created admin accounts for Charles, Dej, and Sam with secure password hashing
- June 16, 2025. Enhanced password reset page with working update button and password visibility toggle
- June 16, 2025. Updated test user credentials to dejalltime@gmail.com for production testing
- June 18, 2025. Fixed property creation system to use admin's actual input for description, developer notes, and investment details instead of defaults
- June 18, 2025. Implemented automatic minimum investment calculation (Total Value ÷ Total Slots) with real-time display
- June 18, 2025. Enhanced property thumbnail system with smart fallback: main image → first gallery photo → placeholder
- June 18, 2025. Added content validation requiring minimum 50 characters for description, 30 for developer notes and investment details
- June 19, 2025. Implemented multi-currency system with real-time exchange rates and automatic currency detection based on user location
- June 19, 2025. Added currency selector component allowing users to manually choose their preferred currency from 12 popular options
- July 4, 2025. Enhanced currency system to support properties stored in different currencies - properties now store their native currency (NGN for existing properties)
- July 4, 2025. Fixed existing properties to display correct Naira values (The Vertex: ₦120,000 minimum, Guzape Heights: ₦32,353 minimum)
- July 4, 2025. Added currency field to properties schema and updated conversion logic to handle mixed-currency property databases
- July 4, 2025. Added AED (UAE Dirham) currency support with proper symbol (د.إ) and auto-detection for UAE users
- July 4, 2025. Removed projected return field from property creation form and database schema to simplify property management
- July 4, 2025. Changed terminology from "Investment Details" to "Co-Ownership Details" throughout the admin interface
- July 4, 2025. Enhanced reservation details to display property names instead of IDs and added "Mark as Paid" functionality with email notifications
- July 4, 2025. Fixed property creation form to display USD ($) currency symbols instead of Naira (₦) since all properties are uploaded in dollars
- October 14, 2025. Implemented Market Insights feature - admins can scrape PropertyPro.ng for Abuja market data analysis
- October 14, 2025. Added cheerio library for web scraping with rate limiting (1 second between requests) and error handling
- October 14, 2025. Created Market Insights tab in admin dashboard displaying competitive property data with statistics and property cards
- October 14, 2025. Added market_insights database table to store scraped property data (title, price, size, location, type, images)
- October 14, 2025. Fixed admin authentication to use Bearer token sessions for all admin-only endpoints
```

## User Preferences

```
Preferred communication style: Simple, everyday language.
```
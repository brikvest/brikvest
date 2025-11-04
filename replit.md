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
- October 14, 2025. Built Guzape scraper module (server/scrape/guzape.ts) with TypeScript, Express, Cheerio stack
- October 14, 2025. Created guzape_listings database table for storing PropertyPro.ng Guzape area listings
- October 14, 2025. Added GET /api/scrape/guzape endpoint with persist and limit query parameters
- October 14, 2025. Discovered PropertyPro.ng limitation: site loads listings via JavaScript, static HTML parsing with Cheerio cannot access property data
- October 15, 2025. Implemented raw HTML scraper flow: GET /api/scrape/guzape-html fetches and optionally persists HTML to public/guzape.html
- October 15, 2025. Created /guzape React route with iframe display of scraped HTML, includes Refresh button for re-scraping
- October 15, 2025. Added script `tsx scripts/scrape-guzape-html.ts` to manually scrape and persist HTML for analysis
- October 15, 2025. Installed `got` package for reliable HTTP requests with timeout and retry logic
- October 15, 2025. Fixed relative asset URLs in scraped HTML - converts /assets/* to https://propertypro.ng/assets/* for proper image loading
- October 15, 2025. Implemented graph data extraction from PropertyPro.ng - extracts Price Change and Index Change chart data from JavaScript
- October 15, 2025. Created /guzape-graphs route with recharts visualization showing price trends (2019-2025) and index growth
- October 15, 2025. Added GET /api/scrape/guzape-graphs endpoint to serve extracted chart data from scraped HTML
- October 15, 2025. Built server/scrape/guzapeGraphs.ts module to parse renderGlobalChart() calls and extract data arrays
- October 15, 2025. Added navigation links between /guzape (HTML view) and /guzape-graphs (charts view) for easy switching
- October 15, 2025. Integrated Guzape market analysis into admin dashboard Market Insights tab with historical price charts and growth metrics
- October 15, 2025. Admin Market Insights now displays: Current Average Price (₦500M), Price Growth (+567%), Market Trend, and two interactive charts
- October 15, 2025. Created public Insights page at /insights with beautiful gradient design and city selector for market analysis
- October 15, 2025. Added "Insights" link to header navigation (desktop and mobile) for easy access to market data
- October 15, 2025. Public Insights displays key metrics (Average Price, Price Growth, Market Status) with interactive recharts visualizations
- October 15, 2025. Implemented city selector component (Guzape default, other cities coming soon) for multi-location market insights
- October 15, 2025. Added Key Investment Insights section with bullet points explaining market trends and growth potential
- October 15, 2025. Enhanced Insights page with historical price data from PropertyPro.ng scraping
- October 15, 2025. Displays 4 time periods: Last Month, 6 Months Ago (₦470M), 1 Year Ago (₦435M, +17.50%), 2 Years Ago (₦396.67M, +78.57%)
- October 15, 2025. Historical price cards feature gradient backgrounds (blue, emerald, purple, orange) with responsive grid layout
- October 15, 2025. Redesigned Insights page with modern borderless aesthetic - removed borders from all cards and added shadow effects (shadow-lg, shadow-md)
- October 15, 2025. Enhanced card styling with hover effects (hover:shadow-xl transitions) for interactive feel
- October 15, 2025. Added PropertyPro.ng attribution section with external link (opens in new tab) and ExternalLink icon for data transparency
- October 15, 2025. Updated guzapeGraphs.ts module to extract and parse historical price data from scraped HTML
- October 15, 2025. Implemented Refresh Data button on Insights page - re-scrapes PropertyPro.ng for latest market data with loading states and toast notifications
- October 15, 2025. Refresh button features: spinning icon during load, "Refreshing..." text state, success/error toast notifications, automatic cache invalidation
- October 15, 2025. Removed /guzape and /guzape-graphs routes and pages - consolidated market insights functionality into single public /insights page
- October 15, 2025. Removed Market Insights tab from admin dashboard - market data now accessible only through public /insights page
- October 15, 2025. Implemented slide-in sidebar for mobile navigation - burger menu now opens right-side drawer with smooth animation and overlay backdrop
- October 15, 2025. Enhanced mobile menu with user profile section, currency selector, and sign in/out buttons for improved mobile UX
- October 15, 2025. Admin credentials for testing: username "dej", password "dej123"
- November 4, 2025. Created comprehensive user dashboard at /dashboard with professional Stripe-inspired design and sidebar navigation
- November 4, 2025. Dashboard features: portfolio overview stats, investment reservations list with property details, and account information section
- November 4, 2025. Added backend API endpoint GET /api/user/reservations - returns user's investment reservations with complete property data
- November 4, 2025. Updated login and registration flows to redirect authenticated users to /dashboard instead of homepage
- November 4, 2025. Dashboard sidebar navigation includes: Dashboard, Browse Properties, Market Insights, with user profile and sign-out button
- November 4, 2025. Stats cards display: Total Invested (sum of all reservations), Active Reservations (pending payment), Completed investments
- November 4, 2025. Reservations display property name, slots, amount, status badges (Completed/Pending Payment), and reservation date
- November 4, 2025. Account information shows user details: Full Name, Email, Phone, Preferred Currency, Member Since, and Account Status
- November 4, 2025. Test user created for testing: test@brikvest.com / Test123!
- November 4, 2025. Made dashboard fully mobile responsive with hamburger menu and slide-in sidebar navigation
- November 4, 2025. Added mobile menu overlay with backdrop blur and smooth animations for better UX
- November 4, 2025. Optimized header for mobile: compact layout, icon-only "New Investment" button, responsive welcome message
- November 4, 2025. Stats cards now responsive: single column on mobile, 2 columns on tablet, 3 columns on desktop
- November 4, 2025. Reservations list stacks vertically on mobile with proper touch targets and readable text sizes
- November 4, 2025. Account information grid adapts to single column on mobile for better readability
- November 4, 2025. All text sizes and spacing optimized for mobile viewing (text-xs/sm/base breakpoints)
- November 4, 2025. Mobile viewport tested successfully on iPhone 12 dimensions (390x844)
```

## User Preferences

```
Preferred communication style: Simple, everyday language.
```
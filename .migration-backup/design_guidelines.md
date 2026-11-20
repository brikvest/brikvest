# Brikvest Investment Dashboard - Design Guidelines

## Design Approach

**Selected Framework**: Design System Approach with premium fintech customization
**Primary References**: Stripe Dashboard, Plaid, Robinhood (financial data presentation) + Airbnb Host Dashboard (property management)
**Design Principles**: 
- Data clarity and hierarchy above all
- Premium, trustworthy aesthetic
- Efficient information scanning
- Progressive disclosure of complex data

## Typography System

**Font Stack**: Inter (primary), SF Pro Display (headings)
- Page Headers: 32px, semibold (Portfolio Overview, Account Settings)
- Section Titles: 24px, semibold (Recent Investments, Reserved Properties)
- Card Headers: 18px, medium
- Metrics/Values: 28px, bold (investment amounts, returns)
- Body Text: 14px, regular
- Captions/Metadata: 12px, medium (dates, property details)
- Labels: 12px, semibold, uppercase with letter-spacing

## Layout System

**Spacing Primitives**: Use Tailwind units of 2, 4, 6, 8, and 12 consistently
- Component padding: p-6
- Card spacing: space-y-6
- Section margins: mb-8 to mb-12
- Grid gaps: gap-6
- Inner element spacing: space-y-2 or space-y-4

**Grid Structure**:
- Main container: max-w-7xl, px-6
- Primary content: Full-width minus sidebar
- Dashboard cards: 3-column grid on desktop (grid-cols-3), 2-column tablet (md:grid-cols-2), single column mobile

## Core Layout Architecture

### Sidebar Navigation (Fixed Left, 280px width)
- Logo/branding at top (p-6)
- Primary navigation items with icons and labels (space-y-2, p-3 each)
- Navigation sections: Dashboard, Portfolio, Properties, Transactions, Account, Settings
- Account widget at bottom showing user avatar, name, account tier
- Active state: subtle background highlight, border accent on left

### Top Bar (Fixed, across main content area)
- Left: Breadcrumb navigation (Home / Dashboard / Portfolio)
- Right: Search icon, notifications bell with badge, user profile dropdown
- Height: h-16, border-bottom separator

### Main Content Area
**Dashboard Overview Section** (first viewport):
- Hero Stats Cards (grid-cols-3):
  - Total Portfolio Value (large number, percentage change indicator)
  - Monthly Returns (with sparkline graph)
  - Active Investments (count + trend)
- Each card: p-6, rounded-xl, subtle shadow, icon top-left, metric center

**Portfolio Holdings Section**:
- Section header with "View All" link
- Property cards in grid-cols-3:
  - Property thumbnail image (16:9 aspect ratio, rounded-t-xl)
  - Property name and location (truncate long names)
  - Investment amount and share percentage
  - Current value and return badge (+X% in green accent)
  - Status indicator (Active, Reserved, Pending)
- Cards with hover elevation transition

**Reserved Properties Section**:
- Horizontal scrollable list (overflow-x-auto, snap-x)
- Property cards (min-w-[320px]):
  - Large property image (4:3 ratio)
  - Reservation countdown timer (Days remaining)
  - Required investment amount
  - Complete reservation CTA button (prominent, full-width)
- Scroll indicators on edges

**Investment History Table**:
- Clean table with alternating row backgrounds
- Columns: Date, Property, Type (Buy/Sell/Dividend), Amount, Status
- Sortable headers with arrow indicators
- Pagination at bottom (max 10 rows per page)
- Filter chips above table (All, This Month, This Year)

**Quick Actions Panel** (sticky right sidebar, 320px):
- "Make New Investment" CTA (prominent button)
- Portfolio Performance Chart (donut chart showing diversification)
- Upcoming Dividends list (date + amount, space-y-3)
- Recent Activity feed (icon + description + timestamp, space-y-4)

## Component Library

### Data Cards
- Standard: rounded-xl, p-6, border, hover:shadow-lg transition
- Metric: Large number top, label below, trend indicator (arrow + percentage)
- Property: Image top, content p-4, status badge top-right overlay

### Buttons
- Primary CTA: px-6 py-3, rounded-lg, medium font weight
- Secondary: px-4 py-2, rounded-lg, border variant
- Icon buttons: p-2, rounded-full for notifications/actions
- On-image buttons: backdrop-blur-md, semi-transparent background

### Status Indicators
- Badges: px-3 py-1, rounded-full, text-xs uppercase, semibold
- Success (Active/Completed): green variant
- Warning (Reserved/Pending): amber variant  
- Info (Processing): blue variant

### Charts & Data Visualization
- Sparklines: 60px height, 120px width, simple line graphs
- Donut charts: 200px diameter for portfolio distribution
- Bar charts: For comparing property performance
- All charts: minimal grid lines, clear axis labels, tooltips on hover

### Forms & Inputs
- Input fields: h-12, rounded-lg, border, px-4
- Select dropdowns: Match input styling with chevron icon
- Search bar: Icon prefix, rounded-full variant
- Validation: Inline error messages below fields

### Navigation
- Sidebar items: rounded-lg, p-3, icon-left (20px), text-right
- Tabs: Underline variant with active indicator
- Breadcrumbs: Separator chevrons, clickable links
- Pagination: Numbered with prev/next arrows

## Images

**Property Thumbnails**: 
- Portfolio cards: 384x216px (16:9), display property exterior/aerial views
- Reserved properties: 400x300px (4:3), hero shots of property
- All images: rounded corners (rounded-t-xl for card tops), object-cover fit
- Overlay gradient on reservation cards for countdown legibility

**No large hero image needed** - This is a functional dashboard focused on data presentation. All images serve as property identifiers and visual anchors within data cards.

## Responsive Behavior

Desktop (lg): 3-column grids, fixed sidebar visible, quick actions panel visible
Tablet (md): 2-column grids, collapsible sidebar (hamburger menu), quick actions below main content
Mobile: Single column, bottom navigation bar replaces sidebar, stacked sections, horizontal scroll for property lists

## Accessibility

- Minimum touch targets: 44x44px for all interactive elements
- Focus indicators: 2px outline offset on all focusable elements
- ARIA labels on icon-only buttons
- Skip-to-content link for keyboard navigation
- Sufficient contrast ratios maintained throughout (handled by color implementation)
- Screen reader announcements for live data updates (portfolio values)
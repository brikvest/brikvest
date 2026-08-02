// Feature flags for the MVP. Flip a flag to true to re-enable the feature —
// no code was removed, only hidden behind these switches.

// CRM leads funnel in the developer portal (leads section, pipeline-adjusted
// sell-out forecast). Backend endpoints stay live; only the UI is hidden.
export const CRM_ENABLED = false;

// Funding-model step in the developer project wizard + funding model card on
// the project page. Hidden for the MVP: it's pure land banking, so every
// project defaults to equity co-ownership.
export const FUNDING_MODEL_ENABLED = false;

// Fundraising ("Funding") tab + funding-raised stat on the developer project
// page. Hidden for the pure land-banking MVP.
export const FUNDRAISING_TAB_ENABLED = false;

// Construction ("Build") tab + construction stat on the developer project
// page. Hidden for the pure land-banking MVP.
export const CONSTRUCTION_TAB_ENABLED = false;

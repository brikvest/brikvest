// Fixed messages only: legacy servers can return SQL/exception text in `error`.
export const HISTORICAL_SEARCH_LIMIT = 150;
export const historicalLoadFailures = {
  HOLDINGS_INVALID_REQUEST: {
    summary: "The holdings request is invalid.",
    nextAction: "Use a search of 150 characters or fewer and reload the first page.",
  },
  HOLDINGS_SETUP_REQUIRED: {
    summary: "Legal-document database setup is incomplete.",
    nextAction: "Ask the system administrator to verify the required additive legal schema before retrying. No documents or notifications were changed.",
  },
  HOLDINGS_UNAVAILABLE: {
    summary: "Holdings are temporarily unavailable.",
    nextAction: "Try again. If this continues, ask the system administrator to investigate.",
  },
  HOLDINGS_PROPERTY_NOT_FOUND: {
    summary: "This property is no longer available.",
    nextAction: "Refresh the property list and choose an available property.",
  },
  HOLDINGS_UNAUTHORIZED: {
    summary: "Your administrator session is unavailable.",
    nextAction: "Sign in again before loading investor documents.",
  },
  HOLDINGS_FORBIDDEN: {
    summary: "Your account cannot access investor documents.",
    nextAction: "Ask an administrator to verify your access.",
  },
} as const;

export type HistoricalLoadCode = keyof typeof historicalLoadFailures;

export function historicalLoadFailure(status: number, code?: string) {
  // Status takes precedence over untrusted response content.
  const key: HistoricalLoadCode = status === 401 ? "HOLDINGS_UNAUTHORIZED"
    : status === 403 ? "HOLDINGS_FORBIDDEN"
    : status === 400 ? "HOLDINGS_INVALID_REQUEST"
    : status === 404 ? "HOLDINGS_PROPERTY_NOT_FOUND"
    : status === 503 && code === "HOLDINGS_SETUP_REQUIRED" ? "HOLDINGS_SETUP_REQUIRED"
    : "HOLDINGS_UNAVAILABLE";
  return historicalLoadFailures[key];
}
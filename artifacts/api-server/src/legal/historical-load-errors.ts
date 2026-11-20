import { historicalLoadFailures, type HistoricalLoadCode } from "../../shared/historical-holdings-errors";

export class HistoricalLoadInputError extends Error {
  constructor(readonly code: "HOLDINGS_INVALID_REQUEST" | "HOLDINGS_PROPERTY_NOT_FOUND") {
    super(historicalLoadFailures[code].summary);
  }
}

export function historicalLoadError(error: unknown) {
  // Drizzle wraps driver errors in `cause`; inspect only bounded codes.
  let current: any = error;
  let sqlState: string | undefined;
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) {
    if (typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) sqlState = current.code;
  }
  const code: HistoricalLoadCode = error instanceof HistoricalLoadInputError ? error.code
    : ["42P01", "42703"].includes(sqlState || "") ? "HOLDINGS_SETUP_REQUIRED" : "HOLDINGS_UNAVAILABLE";
  const status = code === "HOLDINGS_INVALID_REQUEST" ? 400 : code === "HOLDINGS_PROPERTY_NOT_FOUND" ? 404
    : code === "HOLDINGS_SETUP_REQUIRED" ? 503 : 500;
  return { status, code, sqlState, ...historicalLoadFailures[code] };
}
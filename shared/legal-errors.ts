/** Safe administrator-facing details; never put raw exceptions in this contract. */
export type LegalFailureStage = "upload" | "validation" | "save" | "inspection" | "storage" | "render" | "conversion" | "placement" | "preview" | "activation";
export interface LegalCorrectionIssue {
  code: string;
  message: string;
  instruction: string;
  token?: string;
  location?: string;
  excerpt?: string;
}
export interface LegalActionFailure {
  code: string;
  stage: LegalFailureStage;
  summary: string;
  issues: LegalCorrectionIssue[];
  nextAction: string;
  supportReference?: string;
}
export const LEGAL_SUPPORTED_TOKENS = [
  "USER_FULL_NAME", "USER_HOME_ADDRESS", "PROPERTY_AREA_SQM",
  "PAYMENT_AMOUNT_NAIRA_NUMERIC", "PAYMENT_AMOUNT_NAIRA_WORDS",
  "DOCUMENT_DATE", "DOCUMENT_DATE_DAY", "DOCUMENT_DATE_MONTH", "DOCUMENT_DATE_YEAR",
] as const;
export const LEGAL_REQUIRED_TOKENS = {
  deed_of_assignment: ["USER_FULL_NAME", "USER_HOME_ADDRESS", "PROPERTY_AREA_SQM", "PAYMENT_AMOUNT_NAIRA_NUMERIC", "PAYMENT_AMOUNT_NAIRA_WORDS", "DOCUMENT_DATE"],
  transfer_exit_rights: ["USER_FULL_NAME", "USER_HOME_ADDRESS", "PROPERTY_AREA_SQM", "DOCUMENT_DATE"],
} as const;
import type { LegalDocumentType } from "./templates";

export interface LegalTemplateValues {
  USER_FULL_NAME: string;
  USER_HOME_ADDRESS: string;
  PROPERTY_AREA_SQM: string;
  PAYMENT_AMOUNT_NAIRA_NUMERIC: string;
  PAYMENT_AMOUNT_NAIRA_WORDS: string;
  DOCUMENT_DATE: string;
  DOCUMENT_DATE_DAY: string;
  DOCUMENT_DATE_MONTH: string;
  DOCUMENT_DATE_YEAR: string;
}

/**
 * This input is intended to be assembled by trusted backend code from verified
 * user, ownership, and approved-payment records. Never populate it from request
 * body fields.
 */
export interface TrustedLegalDocumentData {
  verifiedFullName: string;
  verifiedHomeAddress: string;
  propertyAreaSqm: number | string;
  approvedPaymentAmountNaira?: number | string;
  documentDate: Date;
}

const SMALL_NUMBERS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion", "Quadrillion"];

interface NairaMinorUnits {
  naira: bigint;
  kobo: number;
}

function parseNairaMinorUnits(value: number | string, fieldName: string): NairaMinorUnits {
  const normalized = String(value).trim();
  const amountMatch = normalized.match(
    /^(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.(\d{1,2}))?$/,
  );
  if (!amountMatch) {
    throw new Error(`${fieldName} must be a non-negative Naira amount with no more than two kobo digits`);
  }
  const [wholeText = "0", fractionText = ""] = normalized.replace(/,/g, "").split(".");
  if (wholeText.length > 18) {
    throw new Error(`${fieldName} exceeds the supported Naira amount range`);
  }
  return {
    naira: BigInt(wholeText),
    kobo: Number(fractionText.padEnd(2, "0") || "0"),
  };
}

function underThousandToWords(value: number): string {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  if (hundreds > 0) words.push(`${SMALL_NUMBERS[hundreds]} Hundred`);
  if (remainder >= 20) {
    const tens = TENS[Math.floor(remainder / 10)];
    const ones = remainder % 10;
    words.push(ones > 0 ? `${tens} ${SMALL_NUMBERS[ones]}` : tens);
  } else if (remainder > 0 || words.length === 0) {
    words.push(SMALL_NUMBERS[remainder]);
  }
  return words.join(" ");
}

function nairaIntegerToWords(amount: bigint): string {
  if (amount === BigInt(0)) return "Zero";
  const groups: string[] = [];
  let remaining = amount;
  let scale = 0;
  while (remaining > BigInt(0)) {
    const group = Number(remaining % BigInt(1000));
    if (group > 0) {
      if (scale >= SCALES.length) {
        throw new Error("Approved payment amount exceeds the supported word range");
      }
      const words = underThousandToWords(group);
      groups.unshift(SCALES[scale] ? `${words} ${SCALES[scale]}` : words);
    }
    remaining /= BigInt(1000);
    scale += 1;
  }
  return groups.join(" ");
}

function formatMoneyWords(value: NairaMinorUnits): string {
  const nairaWords = `${nairaIntegerToWords(value.naira)} Naira`;
  if (value.kobo === 0) return nairaWords;
  return `${nairaWords} and ${underThousandToWords(value.kobo)} Kobo`;
}

function formatMoneyNumeric(value: NairaMinorUnits): string {
  const whole = value.naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return value.kobo === 0 ? whole : `${whole}.${String(value.kobo).padStart(2, "0")}`;
}

export function amountToWordsNaira(value: number | string): string {
  return formatMoneyWords(parseNairaMinorUnits(value, "Approved payment amount"));
}

/**
 * Spell the amount as a decimal fraction of a Naira when the frozen source
 * clause already prints a literal " Naira" after its dynamic amount token.
 * The source suffix remains unchanged while Kobo precision stays exact.
 */
export function amountToWordsNairaBeforeCurrencySuffix(value: number | string): string {
  const amount = parseNairaMinorUnits(value, "Approved payment amount");
  const nairaWords = amount.naira === BigInt(0) ? "" : nairaIntegerToWords(amount.naira);
  if (amount.kobo === 0) return nairaWords || "Zero";
  const koboWords = underThousandToWords(amount.kobo);
  const fractionalWords = `${koboWords} ${amount.kobo === 1 ? "Hundredth" : "Hundredths"} of a`;
  return nairaWords ? `${nairaWords} and ${fractionalWords}` : fractionalWords;
}

export function formatNairaNumeric(value: number | string): string {
  return formatMoneyNumeric(parseNairaMinorUnits(value, "Approved payment amount"));
}

function ordinalDay(day: number): string {
  const lastTwoDigits = day % 100;
  const suffix = lastTwoDigits >= 11 && lastTwoDigits <= 13
    ? "th"
    : day % 10 === 1
      ? "st"
      : day % 10 === 2
        ? "nd"
        : day % 10 === 3
          ? "rd"
          : "th";
  return `${day}${suffix}`;
}

export interface LegalDocumentDateParts {
  DOCUMENT_DATE: string;
  DOCUMENT_DATE_DAY: string;
  DOCUMENT_DATE_MONTH: string;
  DOCUMENT_DATE_YEAR: string;
}

/** Split one validated timestamp into all template date tokens. */
export function formatLegalDocumentDate(date: Date): LegalDocumentDateParts {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error("Document date must be a valid Date");
  }
  const day = ordinalDay(date.getUTCDate());
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
  const year = String(date.getUTCFullYear());
  return {
    DOCUMENT_DATE: `${day} ${month} ${year}`,
    DOCUMENT_DATE_DAY: day,
    DOCUMENT_DATE_MONTH: month,
    DOCUMENT_DATE_YEAR: year,
  };
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

export function buildLegalTemplateValues(
  documentType: LegalDocumentType,
  data: TrustedLegalDocumentData,
): LegalTemplateValues {
  const date = formatLegalDocumentDate(data.documentDate);
  let paymentNumeric = "";
  let paymentWords = "";
  if (documentType === "deed_of_assignment" || data.approvedPaymentAmountNaira !== undefined) {
    if (
      data.approvedPaymentAmountNaira === undefined ||
      data.approvedPaymentAmountNaira === null ||
      (typeof data.approvedPaymentAmountNaira === "string" &&
        !data.approvedPaymentAmountNaira.trim())
    ) {
      throw new Error("Approved payment amount is required for the deed");
    }
    const approvedAmount = parseNairaMinorUnits(
      data.approvedPaymentAmountNaira,
      "Approved payment amount",
    );
    if (approvedAmount.naira === BigInt(0) && approvedAmount.kobo === 0) {
      throw new Error("Approved payment amount must be greater than zero");
    }
    paymentNumeric = formatMoneyNumeric(approvedAmount);
    paymentWords = formatMoneyWords(approvedAmount);
  }
  const values: LegalTemplateValues = {
    USER_FULL_NAME: normalizeRequiredText(data.verifiedFullName, "Verified full name"),
    USER_HOME_ADDRESS: normalizeRequiredText(data.verifiedHomeAddress, "Verified home address"),
    PROPERTY_AREA_SQM: formatAreaSqm(data.propertyAreaSqm),
    PAYMENT_AMOUNT_NAIRA_NUMERIC: paymentNumeric,
    PAYMENT_AMOUNT_NAIRA_WORDS: paymentWords,
    ...date,
  };

  // Populate payment tokens for either type when trusted payment data exists.
  // Rendering uses only actual template tokens; no extra wording is inserted.
  if (
    documentType === "deed_of_assignment" &&
    (!values.PAYMENT_AMOUNT_NAIRA_NUMERIC || !values.PAYMENT_AMOUNT_NAIRA_WORDS)
  ) {
    throw new Error("The deed requires approved payment amount fields");
  }
  return values;
}

function formatAreaSqm(value: number | string): string {
  const area = Number(typeof value === "string" ? value.trim() : value);
  if (!Number.isFinite(area) || area <= 0) {
    throw new Error("Property area must be greater than zero square metres");
  }
  return area.toLocaleString("en-NG", {
    minimumFractionDigits: Number.isInteger(area) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Safe sample values for admin template previews only. Callers should display
 * the returned warning prominently and must never treat the output as signable.
 */
export function buildIllustrativeTemplateValues(
  _documentType: LegalDocumentType,
): LegalTemplateValues {
  return {
    USER_FULL_NAME: "Illustrative Example — Not for Execution",
    USER_HOME_ADDRESS: "Example Address, Abuja — Not for Execution",
    PROPERTY_AREA_SQM: "20",
    PAYMENT_AMOUNT_NAIRA_NUMERIC: "1,000,000",
    PAYMENT_AMOUNT_NAIRA_WORDS: "One Million Naira",
    DOCUMENT_DATE: "30th September 2026",
    DOCUMENT_DATE_DAY: "30th",
    DOCUMENT_DATE_MONTH: "September",
    DOCUMENT_DATE_YEAR: "2026",
  };
}

export interface PaymentInstructionMethod {
  title: string;
  icon: string;
  details: Array<{ label: string; value: string }>;
  alternative?: {
    title: string;
    details: Array<{ label: string; value: string }>;
  };
}

const paymentInstructions: Record<string, PaymentInstructionMethod> = {
  NGN: {
    title: "Naira Transfer (Nigeria)",
    icon: "₦",
    details: [
      { label: "Bank Name", value: "Zenith Bank" },
      { label: "Account Name", value: "Brikvest Limited" },
      { label: "Account Number", value: "1310320691" },
    ],
  },
  USD: {
    title: "USD Transfer (U.S. Bank / Wire)",
    icon: "$",
    details: [
      { label: "Beneficiary Name", value: "Charles Giadom" },
      { label: "Address", value: "2100 North Central Road" },
      { label: "Account Number", value: "483106622433" },
      { label: "Routing Number", value: "026009593" },
    ],
    alternative: {
      title: "Or via Zelle",
      details: [
        { label: "Name", value: "Charles Giadom" },
        { label: "Phone", value: "+1 (646) 204-4536" },
      ],
    },
  },
  GBP: {
    title: "GBP Transfer (United Kingdom)",
    icon: "£",
    details: [
      { label: "Beneficiary Name", value: "Samuel Asasa" },
      { label: "Sort Code", value: "20-26-22" },
      { label: "Account Number", value: "90424102" },
      { label: "Bank Name", value: "Barclays Bank" },
    ],
  },
};

export function getPaymentInstructions(currency?: string): PaymentInstructionMethod {
  return paymentInstructions[currency || "NGN"] || paymentInstructions.NGN;
}
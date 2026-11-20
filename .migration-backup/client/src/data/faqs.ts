// Source: Brikvest_Editable_FAQs_1792635437462.docx.
// Preserve policy wording; only whitespace and the final instruction in Q11 are cleaned up.
export type FAQSection = {
  title: string;
  items: { id: number; question: string; answer: string }[];
};

export const faqSections: FAQSection[] = [
  {
    title: "Understanding Brikvest",
    items: [
      {
        id: 1,
        question: "What is Brikvest, and how does it work?",
        answer: "Brikvest is a digital land banking and trading platform that allows individuals to buy, hold and sell land, including fractional portions of larger land parcels. You can hold your land for potential capital appreciation and sell your ownership interest through the Brikvest marketplace or during the scheduled exit process.",
      },
      {
        id: 2,
        question: "What is fractional land ownership, and what do I actually own?",
        answer: "Fractional land ownership allows you to purchase a specified portion of a larger land parcel, measured in square metres, without buying the entire property. You acquire an interest in the designated land parcel and receive a personal Deed of Assignment documenting your interest.",
      },
      {
        id: 3,
        question: "What is a maturity date?",
        answer: "The maturity date is the agreed date when your land is scheduled to be sold. Following this date, Brikvest has a one-year period to facilitate the sale of your land. If the land cannot be sold within this period, Brikvest will buy it back at the market value stated in the most recent independent valuation report.",
      },
      {
        id: 4,
        question: "Who can invest through Brikvest? Can I invest from abroad?",
        answer: "Eligible individuals living in Nigeria or abroad can register on Brikvest, explore available properties and complete purchases online, subject to identity verification and applicable legal requirements.",
      },
    ],
  },
  {
    title: "Property Verification and Legal Ownership",
    items: [
      {
        id: 5,
        question: "How does Brikvest verify the legitimacy of listed properties?",
        answer: "Before listing a property, Brikvest engages an independent law firm to conduct due diligence. This includes reviewing title and ownership documents, investigating ownership history and conducting relevant land registry searches to identify potential legal issues.",
      },
      {
        id: 6,
        question: "What legal documents will I receive after purchasing land?",
        answer: "You will receive a personal Deed of Assignment documenting your ownership interest. Your ownership documents will be available through your Brikvest portfolio.",
      },
      {
        id: 7,
        question: "Can I visit a property or review its title documents before purchasing?",
        answer: "Yes. You can request relevant title documents or arrange a site visit by emailing info@brikvest.net. Our team will help coordinate your request.",
      },
      {
        id: 8,
        question: "What happens if a property develops a legal dispute or ownership issue?",
        answer: "Brikvest conducts thorough legal due diligence before listing properties. If a legal dispute or ownership issue affects your investment, you will be fully refunded based on the property value stated in the most recent independent valuation report.",
      },
    ],
  },
  {
    title: "Investment and Payments",
    items: [
      {
        id: 9,
        question: "What fees and additional costs should I expect?",
        answer: "Property pricing incorporates a 5% due diligence fee, 5% agent fee, 5% Brikvest service charge and 5% operating expenditure allowance. These are included in the displayed purchase price rather than added again at checkout. Applicable resale transaction fees, if any, are shown separately during the resale process.",
      },
      {
        id: 10,
        question: "How do I earn returns, and are returns guaranteed?",
        answer: "Potential returns come primarily from capital appreciation: the increase in the value of your land over time. You may realise a profit if you sell the land for more than your total purchase and selling costs, either through the marketplace or during the exit process. Returns are not guaranteed; land values can rise or fall.",
      },
    ],
  },
  {
    title: "Selling and Withdrawals",
    items: [
      {
        id: 11,
        question: "Can I sell my land before its maturity date?",
        answer: "Yes. List your land on the Brikvest marketplace, set your asking price and review offers from interested buyers. You may accept, reject or counter an offer. Following an accepted offer and confirmed payment to Brikvest, the transfer will be processed, and sale proceeds remitted to your designated bank account, subject to applicable fees and checks. Go to your portfolio, view your assets and click Sell Units.",
      },
      {
        id: 12,
        question: "What if I need my money back or want to cancel my investment?",
        answer: "A completed land purchase is not a withdrawable savings balance. To exit before maturity, you can offer your land for sale on the Brikvest marketplace; a sale depends on finding a buyer. Alternatively, you can hold the land until the scheduled exit process, subject to the applicable agreements.",
      },
      {
        id: 13,
        question: "Is Brikvest’s secondary marketplace available, and how does it work?",
        answer: "Yes. The marketplace allows landowners to list their interests and prospective buyers to make offers. Sellers set an asking price and may accept, decline or counter offers. After acceptance and payment confirmation, Brikvest facilitates the transfer and updates ownership records.",
      },
      {
        id: 14,
        question: "Can I develop or build on land purchased for land banking?",
        answer: "No. Brikvest’s land banking offerings are intended for holding and resale rather than immediate property development. Buyers must follow the restrictions and exit terms of the relevant property agreements.",
      },
    ],
  },
  {
    title: "Account and Customer Support",
    items: [
      {
        id: 15,
        question: "How do I create an account and complete identity verification?",
        answer: "Select Sign Up on Brikvest, enter your details and complete the required Know Your Customer (KYC) identity verification. Once your account is approved, you can begin making purchases.",
      },
      {
        id: 16,
        question: "How do I track my land holdings and access ownership documents?",
        answer: "Visit your portfolio to view your land holdings, access ownership documents and manage marketplace listings.",
      },
      {
        id: 17,
        question: "How does Brikvest protect my personal information?",
        answer: "Brikvest is committed to handling personal data in accordance with the Nigeria Data Protection Act, 2023. Your identity is not publicly displayed to other users on the secondary marketplace. Information may be shared where necessary for identity verification, transaction processing, or compliance with applicable law.",
      },
      {
        id: 18,
        question: "How can I contact Brikvest or resolve an issue?",
        answer: "For assistance with your account, land purchases, documentation or marketplace transactions, contact our support team at info@brikvest.net.",
      },
    ],
  },
];

import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock("../server/emailService", () => ({
  sendEmail,
}));

import { sendNewListingNotificationToCoInvestors } from "../server/resaleEmails";

describe("co-investor resale listing notification", () => {
  beforeEach(() => {
    sendEmail.mockReset();
    sendEmail.mockResolvedValue(true);
  });

  it("labels a fixed-price listing with Asking Price", async () => {
    await sendNewListingNotificationToCoInvestors(
      "investor@example.com",
      "Ada Investor",
      "Guzape Residences",
      "3",
      "fixed_price",
      "1250000",
      "NGN",
      "listing-token",
    );

    const message = sendEmail.mock.calls[0][0];
    expect(message.html).toContain("Asking Price");
    expect(message.html).not.toContain("Starting Price");
    expect(message.html).toContain("NGN 1,250,000.00");
    expect(message.html).toContain("Fixed Price");
    expect(message.html).toContain("/listing/listing-token");
    expect(message.html).not.toContain("${sellingType");
    expect(message.html).toContain('alt="Brikvest"');
    expect(message.html).not.toContain("Real Estate Investment Club");
  });

  it("labels an auction listing with Starting Price", async () => {
    await sendNewListingNotificationToCoInvestors(
      "investor@example.com",
      "Ada Investor",
      "Guzape Residences",
      "3",
      "bidding",
      "950000",
      "USD",
      null,
    );

    const message = sendEmail.mock.calls[0][0];
    expect(message.html).toContain("Starting Price");
    expect(message.html).not.toContain("Asking Price");
    expect(message.html).toContain("USD 950,000.00");
    expect(message.html).toContain("Auction");
    expect(message.html).toContain("/marketplace");
    expect(message.html).not.toContain("${sellingType");
    expect(message.html).toContain('alt="Brikvest"');
    expect(message.html).not.toContain("Real Estate Investment Club");
  });
});
import { describe, expect, it } from "vitest";
import { legalDocumentsReadyEmailTemplate } from "../server/emailTemplates";

describe("Brikvest legal documents ready email", () => {
  it("matches the shared brand layout and explains secure investor-only signing", () => {
    const email = legalDocumentsReadyEmailTemplate({
      fullName: "Sample Investor",
      propertyName: "North Estate",
      dashboardUrl: "https://brikvest.example/dashboard?holding=12",
    });
    expect(email.subject).toBe("Your Brikvest legal documents are ready");
    for (const content of [
      'alt="Brikvest Logo"', "max-width: 600px", "#2563eb",
      "Deed of Assignment", "Transfer and Exit Rights Agreement",
      "North Estate holding",
      "Review &amp; Sign Your Documents", "must sign in",
      "fresh drawn or typed signature", "not full legal execution",
      "handled separately", "The Brikvest Team", "All rights reserved.",
    ]) expect(email.html).toContain(content);
    expect(email.html).toContain('href="https://brikvest.example/dashboard?holding=12"');
    expect(email.html).not.toContain("DocuSign");
    expect(email.html).not.toContain("SD118");
  });

  it("escapes names and query attributes without breaking the holding link", () => {
    const email = legalDocumentsReadyEmailTemplate({
      fullName: '<img src=x onerror="alert(1)"> & O\'Brien',
      propertyName: '<b>East & West</b>',
      dashboardUrl: "https://brikvest.example/dashboard?holding=12&source=email",
    });
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; O&#39;Brien");
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain("&lt;b&gt;East &amp; West&lt;/b&gt;");
    expect(email.html).toContain("holding=12&amp;source=email");
  });

  it.each(["javascript:alert(1)", "data:text/html,test", "https://user:password@brikvest.example/dashboard"])(
    "rejects unsafe dashboard links: %s", (dashboardUrl) => {
      expect(() => legalDocumentsReadyEmailTemplate({
        fullName: "Sample Investor", propertyName: "North Estate", dashboardUrl,
      })).toThrow("safe dashboard URL");
    },
  );
});
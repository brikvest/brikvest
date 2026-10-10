import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { FooterSocialLinks } from "../client/src/components/FooterSocialLinks";

const expected = [
  ["Instagram", "https://www.instagram.com/brik.vest/"],
  ["TikTok", "https://www.tiktok.com/@brikvest"],
  ["LinkedIn", "https://www.linkedin.com/company/brikvest"],
];

describe("shared website footer socials", () => {
  for (const tone of ["default", "inverse"] as const) {
    it(`renders the official ordered accessible external links on ${tone} surfaces`, () => {
      const $ = load(renderToStaticMarkup(<FooterSocialLinks tone={tone} />));
      expect($("nav").attr("aria-label")).toBe("Brikvest social media");
      expect($("a")).toHaveLength(3);
      expected.forEach(([name, href], index) => {
        const link = $("a").eq(index);
        expect(link.text()).toBe(name);
        expect(link.attr("aria-label")).toBe(`Brikvest on ${name} (opens in a new tab)`);
        expect(link.attr("href")).toBe(href);
        expect(link.attr("target")).toBe("_blank");
        expect(link.attr("rel")?.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
        expect(link.attr("tabindex")).toBeUndefined();
        expect(link.find("svg").attr("aria-hidden")).toBe("true");
        expect(link.attr("class")).toContain("focus-visible:ring-2");
        expect(link.attr("class")).toContain(tone === "inverse" ? "text-slate-300" : "text-slate-600");
      });
      expect($("nav").attr("class")).toContain("flex-wrap");
    });
  }

  it("integrates once inside each of the four existing website footers", () => {
    for (const [file, inverse] of [
      ["home.tsx", true], ["about.tsx", true],
      ["public-listing.tsx", false], ["developer/pricing.tsx", false],
    ] as const) {
      const source = fs.readFileSync(path.resolve("client/src/pages", file), "utf8");
      const footers = source.match(/<footer\b[\s\S]*?<\/footer>/g)!;
      expect(footers).toHaveLength(1);
      expect(footers[0].match(/<FooterSocialLinks\b/g)).toHaveLength(1);
      expect(footers[0]).toContain(inverse ? '<FooterSocialLinks tone="inverse" />' : "<FooterSocialLinks />");
      expect(footers[0]).toContain("All rights reserved.");
    }
  });
});

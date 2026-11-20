import fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { faqSections } from "../client/src/data/faqs";
import { getInvestorScrollDestination } from "../client/src/lib/investorNavigation";

vi.mock("../client/src/components/InvestorHeader", () => ({
  InvestorHeader: () => <header>Public header</header>,
}));
// Expose closed answer bodies for exhaustive static rendering checks.
// Real Radix controls and keyboard behaviour are covered in browser tests.
vi.mock("../client/src/components/ui/accordion", () => ({
  Accordion: ({ children }: any) => <div>{children}</div>,
  AccordionItem: ({ children }: any) => <article>{children}</article>,
  AccordionTrigger: ({ children }: any) => <button>{children}</button>,
  AccordionContent: ({ children }: any) => <div>{children}</div>,
}));
import FAQs from "../client/src/pages/faqs";

describe("document-backed public FAQs", () => {
  it("preserves every source category, question and full answer in order", () => {
    // Tracked verbatim text extraction of Brikvest_Editable_FAQs_1792635437462.docx,
    // so clean checkouts do not depend on ignored user uploads.
    const paragraphs = fs.readFileSync("tests/fixtures/brikvest-faqs-source.txt", "utf8")
      .split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const categories: string[] = [];
    const questions: { id: number; question: string; answer: string }[] = [];
    for (const paragraph of paragraphs.slice(2)) {
      const match = /^(\d+)\.\s+(.+)$/.exec(paragraph);
      if (match) questions.push({ id: Number(match[1]), question: match[2], answer: "" });
      else if (faqSections.some(s => s.title === paragraph)) categories.push(paragraph);
      else if (questions.length) questions.at(-1)!.answer += `${questions.at(-1)!.answer ? " " : ""}${paragraph}`;
    }
    const sourceEleven = questions.find(q => q.id === 11)!;
    sourceEleven.answer = sourceEleven.answer.replace(
      "Go to your portfolio view your assets and click sell units",
      "Go to your portfolio, view your assets and click Sell Units.",
    );
    expect(categories).toEqual(faqSections.map(s => s.title));
    expect(faqSections.map(s => s.items.length)).toEqual([4, 4, 2, 4, 4]);
    expect(questions).toHaveLength(18);
    expect(faqSections.flatMap(s => s.items)).toEqual(questions);
  });

  it("renders complete answers under their headings, with clickable support email and no draft metadata", () => {
    const $ = load(renderToStaticMarkup(<FAQs />));
    expect($("h1").text()).toBe("Frequently Asked Questions");
    expect($("h2").map((_, el) => $(el).text()).get()).toEqual(faqSections.map(s => s.title));
    faqSections.forEach(section => {
      const renderedSection = $("h2").filter((_, el) => $(el).text() === section.title).parent();
      expect(renderedSection.find("button")).toHaveLength(section.items.length);
      section.items.forEach(item => {
        expect(renderedSection.text()).toContain(item.question);
        expect(renderedSection.text()).toContain(item.answer);
      });
    });
    expect($('a[href="mailto:info@brikvest.net"]')).toHaveLength(2);
    expect($("body").text()).not.toMatch(/Editable app content|Draft for review/);
    expect($("footer nav[aria-label='Brikvest social media'] a")).toHaveLength(3);
  });

  it("keeps material qualifications and all four fee percentages", () => {
    const items = faqSections.flatMap(s => s.items);
    const answer = (id: number) => items.find(q => q.id === id)!.answer;
    expect(answer(9).match(/5%/g)).toHaveLength(4);
    expect(answer(9)).toContain("rather than added again at checkout");
    expect(answer(10)).toContain("Returns are not guaranteed; land values can rise or fall.");
    expect(answer(3)).toContain("one-year period");
    expect(answer(3)).toContain("Brikvest will buy it back at the market value");
    expect(answer(8)).toContain("fully refunded");
    expect(answer(11)).toContain("subject to applicable fees and checks");
    expect(answer(12)).toContain("a sale depends on finding a buyer");
    expect(answer(17)).toContain("Nigeria Data Protection Act, 2023");
    expect(answer(17)).toContain("Information may be shared where necessary");
  });

  it("registers an unguarded public route and resets its scroll position", () => {
    const app = fs.readFileSync("client/src/App.tsx", "utf8");
    expect(app).toContain('<Route path="/faqs" component={FAQs} />');
    expect(getInvestorScrollDestination("/faqs", "")).toBe("top");
    expect(getInvestorScrollDestination("/faqs", "section=properties")).toBe("top");
    expect(getInvestorScrollDestination("/", "section=properties")).toBe("properties");
  });
});

import { useId } from "react";
import { InvestorHeader } from "@/components/InvestorHeader";
import { FooterSocialLinks } from "@/components/FooterSocialLinks";
import brikvest_logo from "@/assets/brikvest-logo.png";
import { faqSections } from "@/data/faqs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

function AnswerText({ answer }: { answer: string }) {
  const parts = answer.split(/(info@brikvest\.net)/gi);

  return (
    <p className="text-base leading-7 text-slate-600">
      {parts.map((part, index) =>
        part.toLowerCase() === "info@brikvest.net" ? (
          <a
            key={`${index}-${part}`}
            href="mailto:info@brikvest.net"
            className="break-words font-medium text-blue-700 underline decoration-blue-300 underline-offset-4 transition-colors hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 rounded-sm"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

export default function FAQs() {
  const accordionId = useId();

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <InvestorHeader />

      <main>
        <section className="bg-gradient-to-br from-blue-50 to-slate-100 py-16 sm:py-20">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">
              Brikvest support
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Frequently Asked Questions
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-600">
              Clear answers to help you understand investing in fractional land
              with Brikvest.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <Accordion type="multiple" className="space-y-10">
            {faqSections.map((section, sectionIndex) => (
              <section
                key={section.title}
                aria-labelledby={`${accordionId}-section-${sectionIndex}`}
              >
                <h2
                  id={`${accordionId}-section-${sectionIndex}`}
                  className="mb-4 border-b border-slate-200 pb-3 text-xl font-bold text-slate-900 sm:text-2xl"
                >
                  {section.title}
                </h2>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  {section.items.map((item) => (
                    <AccordionItem
                      key={item.id}
                      value={`${accordionId}-faq-${item.id}`}
                      className="border-slate-200 px-4 last:border-b-0 sm:px-6"
                    >
                      <AccordionTrigger className="min-w-0 gap-4 rounded-sm py-5 text-left text-base leading-6 text-slate-800 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:text-lg [&>svg]:text-blue-700">
                        <span className="min-w-0 flex-1 whitespace-normal break-words">
                          {item.question}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-5 pt-0">
                        <AnswerText answer={item.answer} />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </div>
              </section>
            ))}
          </Accordion>
        </div>
      </main>

      <footer className="bg-slate-900 py-12 text-white">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <img
            src={brikvest_logo}
            alt="Brikvest Logo"
            className="mx-auto mb-4 h-10 w-auto brightness-0 invert"
          />
          <p className="text-slate-400">
            &copy; {new Date().getFullYear()} Brikvest. All rights reserved.
          </p>
          <div className="mt-4 flex justify-center">
            <FooterSocialLinks tone="inverse" />
          </div>
        </div>
      </footer>
    </div>
  );
}

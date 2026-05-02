import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Check, Sparkles, ArrowRight, Mail } from "lucide-react";

type Billing = "monthly" | "yearly";

type Plan = {
  id: "starter" | "growth";
  name: string;
  tagline: string;
  monthly: number;
  yearly: number;
  features: string[];
  highlight?: boolean;
  cta: string;
};

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For developers launching their first 1–2 projects on Brikvest.",
    monthly: 25000,
    yearly: 240000,
    cta: "Start free trial",
    features: [
      "Up to 2 active projects",
      "Investor CRM with leads pipeline",
      "Email broadcasts to your investors",
      "Sales velocity & sell-out forecast",
      "Construction milestone tracking",
      "Investor list & CSV export",
      "Standard email support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "For active developers managing a growing portfolio of projects.",
    monthly: 75000,
    yearly: 720000,
    highlight: true,
    cta: "Start free trial",
    features: [
      "Unlimited active projects",
      "Everything in Starter, plus:",
      "Off-platform investor recording",
      "Advanced cap table & equity reports",
      "Per-project valuation reports",
      "Branded developer landing page",
      "Priority support + dedicated manager",
      "Custom investor onboarding flow",
    ],
  },
];

const fmtNGN = (n: number) => `₦${n.toLocaleString()}`;

export default function DeveloperPricing() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      {/* Top nav */}
      <header className="border-b border-slate-200/70 bg-white/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" data-testid="link-home">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <div className="text-base font-bold text-slate-900">Brikvest</div>
              <div className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">Developer Portal</div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/developer/login">
              <Button variant="ghost" size="sm" data-testid="button-nav-signin">Sign in</Button>
            </Link>
            <Link href="/developer/signup">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700" data-testid="button-nav-signup">
                Get started
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12 sm:py-16">
        {/* Hero */}
        <div className="text-center max-w-2xl mx-auto">
          <Badge className="bg-blue-100 text-blue-700 border-blue-200 mb-4">
            <Sparkles className="w-3 h-3 mr-1.5" /> 3 months free trial on every plan
          </Badge>
          <h1 className="text-3xl sm:text-5xl font-bold text-slate-900 tracking-tight">
            Simple pricing for developers
          </h1>
          <p className="mt-4 text-base sm:text-lg text-slate-600">
            Reach vetted investors, manage your fundraising, and keep your cap table clean — all from one place. No setup fees. Cancel anytime.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="mt-10 flex justify-center">
          <div className="inline-flex bg-white border border-slate-200 rounded-full p-1 shadow-sm" role="tablist">
            <button
              type="button"
              onClick={() => setBilling("monthly")}
              className={`px-5 py-2 text-sm font-medium rounded-full transition ${
                billing === "monthly" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
              data-testid="toggle-monthly"
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBilling("yearly")}
              className={`px-5 py-2 text-sm font-medium rounded-full transition flex items-center gap-2 ${
                billing === "yearly" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
              data-testid="toggle-yearly"
            >
              Yearly
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                billing === "yearly" ? "bg-emerald-400 text-emerald-950" : "bg-emerald-100 text-emerald-700"
              }`}>
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Plans */}
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {PLANS.map((plan) => {
            const price = billing === "monthly" ? plan.monthly : Math.round(plan.yearly / 12);
            const billedAs = billing === "monthly"
              ? "billed monthly"
              : `${fmtNGN(plan.yearly)} billed yearly`;
            return (
              <Card
                key={plan.id}
                className={`relative overflow-hidden ${
                  plan.highlight
                    ? "border-blue-500 shadow-xl ring-2 ring-blue-200"
                    : "border-slate-200 shadow-sm"
                }`}
                data-testid={`card-plan-${plan.id}`}
              >
                {plan.highlight && (
                  <div className="absolute top-0 right-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-xs font-semibold px-3 py-1 rounded-bl-lg">
                    Most popular
                  </div>
                )}
                <CardContent className="p-7">
                  <div className="text-sm font-semibold text-blue-600 uppercase tracking-wide">{plan.name}</div>
                  <p className="mt-1 text-sm text-slate-600 min-h-[40px]">{plan.tagline}</p>

                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-slate-900" data-testid={`price-${plan.id}`}>
                      {fmtNGN(price)}
                    </span>
                    <span className="text-sm text-slate-500">/month</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{billedAs}</div>

                  <Link href="/developer/signup">
                    <Button
                      className={`w-full mt-6 ${
                        plan.highlight ? "bg-blue-600 hover:bg-blue-700" : ""
                      }`}
                      variant={plan.highlight ? "default" : "outline"}
                      data-testid={`button-cta-${plan.id}`}
                    >
                      {plan.cta}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                  <div className="mt-2 text-center text-xs text-slate-500">
                    No credit card required · 3 months free
                  </div>

                  <ul className="mt-6 space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                        <Check className="w-4 h-4 mt-0.5 text-emerald-600 flex-shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Trial reassurance strip */}
        <div className="mt-12 max-w-3xl mx-auto bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm">
          <div className="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-6 h-6 text-emerald-600" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-slate-900">Try it for 3 months, free</div>
            <p className="text-sm text-slate-600 mt-0.5">
              List a project, talk to real investors, and run a full sales cycle before you pay anything. We'll email you a reminder 7 days before your trial ends.
            </p>
          </div>
          <Link href="/developer/signup">
            <Button className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-trial-cta">
              Start your free trial
            </Button>
          </Link>
        </div>

        {/* FAQ */}
        <div className="mt-16 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-slate-900 text-center">Frequently asked questions</h2>
          <div className="mt-8 space-y-4">
            {[
              {
                q: "How does the 3-month free trial work?",
                a: "Sign up with your company details and you'll get full access to your chosen plan for 90 days. No card required upfront. You'll receive a reminder before the trial ends and can pick a plan or downgrade at that time.",
              },
              {
                q: "What's the difference between Starter and Growth?",
                a: "Starter is built for developers launching one or two projects with the core CRM, sales analytics, and milestone tools. Growth unlocks unlimited projects, off-platform investor recording, branded landing pages, and priority support.",
              },
              {
                q: "Can I switch plans or cancel later?",
                a: "Yes. Upgrade, downgrade, or cancel at any time from your developer profile. Yearly subscribers can switch to monthly at renewal.",
              },
              {
                q: "Does Brikvest take a commission on the funds I raise?",
                a: "Your subscription covers platform usage. Transaction and escrow fees on raised funds are billed separately and itemized on each settlement statement.",
              },
              {
                q: "Do you offer custom or enterprise pricing?",
                a: "Yes — for developers running 10+ active projects or needing white-label/SLA arrangements, contact us for a tailored quote.",
              },
            ].map((item) => (
              <details
                key={item.q}
                className="group bg-white border border-slate-200 rounded-lg p-4 open:shadow-sm"
                data-testid={`faq-${item.q.slice(0, 20).replace(/\s/g, "-").toLowerCase()}`}
              >
                <summary className="cursor-pointer font-medium text-slate-900 flex items-center justify-between list-none">
                  {item.q}
                  <span className="text-blue-600 transition group-open:rotate-45 text-xl leading-none">+</span>
                </summary>
                <p className="mt-3 text-sm text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>

        {/* Contact strip */}
        <div className="mt-16 text-center">
          <p className="text-sm text-slate-600">
            Have a question or need a custom plan?{" "}
            <a href="mailto:developers@brikvest.net" className="text-blue-600 hover:underline font-medium inline-flex items-center gap-1" data-testid="link-contact">
              <Mail className="w-3.5 h-3.5" /> developers@brikvest.net
            </a>
          </p>
        </div>
      </main>

      <footer className="mt-16 border-t border-slate-200 bg-white/60">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div>© {new Date().getFullYear()} Brikvest. All rights reserved.</div>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-slate-900">Home</Link>
            <Link href="/about" className="hover:text-slate-900">About</Link>
            <Link href="/developer/login" className="hover:text-slate-900">Developer sign-in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

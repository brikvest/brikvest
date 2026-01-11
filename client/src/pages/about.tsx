import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Target, Shield, TrendingUp, Users, Building, CheckCircle } from "lucide-react";
import brikvest_logo from "@/assets/brikvest-logo.png";

export default function About() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/">
              <img 
                src={brikvest_logo} 
                alt="Brikvest Logo" 
                className="h-10 w-auto cursor-pointer"
              />
            </Link>
            <Link href="/">
              <Button variant="ghost" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-blue-50 to-slate-100 py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6">
            About Brikvest
          </h1>
          <p className="text-xl text-slate-600 leading-relaxed">
            Brikvest is a digital land investment platform designed to make land ownership more accessible, flexible, and structured through fractional ownership.
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Introduction */}
          <div className="mb-16">
            <p className="text-lg text-slate-600 leading-relaxed">
              We enable individuals to own land in defined units, rather than requiring the purchase of an entire plot up front. By breaking land into clearly priced, measurable units, Brikvest lowers the capital barrier to entry while maintaining legal clarity and transparency.
            </p>
          </div>

          {/* What We Do */}
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <Target className="w-6 h-6 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900">What We Do</h2>
            </div>
            <p className="text-lg text-slate-600 leading-relaxed mb-6">
              Brikvest structures verified land assets into investable units that can be acquired, held, and transferred more efficiently. Each asset is organised under a formal legal framework, such as a trustee or SPV arrangement, to ensure ownership rights are clearly defined and protected.
            </p>
            <div className="bg-slate-50 rounded-xl p-6">
              <p className="font-semibold text-slate-900 mb-4">Our platform allows investors to:</p>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-slate-600">Purchase land in smaller, clearly defined units</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-slate-600">Allocate capital gradually rather than all at once</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-slate-600">Retain flexibility to sell part or all of their holdings over time</span>
                </li>
              </ul>
            </div>
          </div>

          {/* How Value Is Created */}
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900">How Value Is Created</h2>
            </div>
            <p className="text-lg text-slate-600 leading-relaxed mb-4">
              Value is realised over time through land appreciation, unit resale via peer-to-peer trading, aggregation for development, or other exit opportunities depending on the asset strategy.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
              <p className="text-amber-800">
                <strong>Important:</strong> Brikvest does not guarantee liquidity or returns. Instead, we provide the infrastructure that makes ownership and transfer more practical and transparent.
              </p>
            </div>
          </div>

          {/* What You Own */}
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                <Building className="w-6 h-6 text-purple-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900">What You Own</h2>
            </div>
            <p className="text-lg text-slate-600 leading-relaxed mb-6">
              When you invest through Brikvest, you acquire:
            </p>
            <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide md:grid md:grid-cols-3 md:overflow-x-visible md:pb-0">
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm min-w-[260px] md:min-w-0 snap-start">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <Shield className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Defined Land Units</h3>
                    <p className="text-slate-600">Tied to a real underlying asset</p>
                  </div>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm min-w-[260px] md:min-w-0 snap-start">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <Users className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Economic Rights</h3>
                    <p className="text-slate-600">Proportional to your ownership</p>
                  </div>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm min-w-[260px] md:min-w-0 snap-start">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Long-term Value Exposure</h3>
                    <p className="text-slate-600">Access to land value appreciation and future opportunities</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="text-center bg-gradient-to-br from-blue-50 to-slate-100 rounded-2xl p-10">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Ready to Start Investing?</h2>
            <p className="text-slate-600 mb-6">
              Join thousands of investors building wealth through fractional land ownership.
            </p>
            <Link href="/">
              <Button size="lg" className="bg-blue-600 hover:bg-blue-700">
                Explore Properties
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <img 
            src={brikvest_logo} 
            alt="Brikvest Logo" 
            className="h-10 w-auto mx-auto mb-4 filter brightness-0 invert"
          />
          <p className="text-slate-400">
            &copy; {new Date().getFullYear()} Brikvest. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

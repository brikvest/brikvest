import { useEffect } from "react";
import { Switch, Route, useLocation, useSearch, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CurrencyProvider } from "@/hooks/useCurrency";
import Home from "@/pages/home";
import Login from "@/pages/login";
import ResetPassword from "@/pages/reset-password";
import Dashboard from "@/pages/dashboard";
import AdminProtected from "@/pages/admin-protected";
import Insights from "@/pages/insights";
import CertificateVerification from "@/pages/verify";
import About from "@/pages/about";
import FAQs from "@/pages/faqs";
import Marketplace from "@/pages/marketplace";
import PublicListing from "@/pages/public-listing";
import DeveloperLogin from "@/pages/developer/login";
import DeveloperSignup from "@/pages/developer/signup";
import DeveloperPricing from "@/pages/developer/pricing";
import DeveloperProjects from "@/pages/developer/index";
import DeveloperNewProject from "@/pages/developer/new-project";
import DeveloperProjectDetail from "@/pages/developer/project-detail";
import DeveloperCommunications from "@/pages/developer/communications";
import DeveloperProfile from "@/pages/developer/profile";
import DeveloperTeam from "@/pages/developer/team";
import DeveloperAcceptInvite from "@/pages/developer/accept-invite";
import ContractorLogin from "@/pages/contractor/login";
import ContractorSignup from "@/pages/contractor/signup";
import ContractorDashboard from "@/pages/contractor/index";
import ContractorNewProject from "@/pages/contractor/new-project";
import ContractorProjectDetail from "@/pages/contractor/project-detail";
import ContractorProfile from "@/pages/contractor/profile";
import NotFound from "@/pages/not-found";
import { getInvestorScrollDestination } from "@/lib/investorNavigation";

function InvestorScrollManager() {
  const [location] = useLocation();
  const search = useSearch();

  useEffect(() => {
    const destination = getInvestorScrollDestination(location, search);
    if (!destination) return;

    if (destination === "properties") {
      const scrollTimer = window.setTimeout(() => {
        document.getElementById("properties")?.scrollIntoView({ block: "start" });
      }, 0);
      return () => window.clearTimeout(scrollTimer);
    }

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location, search]);

  return null;
}

function Router() {
  return (
    <>
      <InvestorScrollManager />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/login" component={Login} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/admin" component={AdminProtected} />
        <Route path="/insights" component={Insights} />
        <Route path="/verify/:token" component={CertificateVerification} />
        <Route path="/about" component={About} />
        <Route path="/faqs" component={FAQs} />
        <Route path="/marketplace" component={Marketplace} />
        <Route path="/listing/:shareToken" component={PublicListing} />
        <Route path="/developer/login" component={DeveloperLogin} />
        <Route path="/developer/signup" component={DeveloperSignup} />
        <Route path="/developer/pricing" component={DeveloperPricing} />
        <Route path="/developer/new" component={DeveloperNewProject} />
        <Route path="/developer/communications" component={DeveloperCommunications} />
        <Route path="/developer/profile" component={DeveloperProfile} />
        <Route path="/developer/team" component={DeveloperTeam} />
        <Route path="/developer/accept-invite/:token" component={DeveloperAcceptInvite} />
        <Route path="/developer/projects/:id" component={DeveloperProjectDetail} />
        <Route path="/developer" component={DeveloperProjects} />
        <Route path="/contractor/login" component={ContractorLogin} />
        <Route path="/contractor/signup" component={ContractorSignup} />
        <Route path="/contractor/new" component={ContractorNewProject} />
        <Route path="/contractor/profile" component={ContractorProfile} />
        <Route path="/contractor/projects/:id" component={ContractorProjectDetail} />
        <Route path="/contractor" component={ContractorDashboard} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CurrencyProvider>
        <TooltipProvider>
          <Toaster />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </TooltipProvider>
      </CurrencyProvider>
    </QueryClientProvider>
  );
}

export default App;

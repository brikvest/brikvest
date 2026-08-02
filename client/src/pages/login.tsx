import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";
import { loginUserSchema, registerUserSchema } from "@shared/schema";
import type { LoginUser, RegisterUser } from "@shared/schema";

export default function Login() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const [isRegistering, setIsRegistering] = useState(false);
  // null = not chosen yet; investors continue here, developers/agents/land
  // vendors are sent to the developer portal auth pages.
  const [role, setRole] = useState<"investor" | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [referralValid, setReferralValid] = useState<boolean | null>(null);
  const [referralName, setReferralName] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const ref = params.get("ref");
    if (ref) {
      setReferralCode(ref);
      setIsRegistering(true);
      setRole("investor"); // referral links are investor invites — skip the chooser
      try {
        localStorage.setItem('brikvest_referral', ref);
      } catch {}
      fetch(`/api/validate-referral/${encodeURIComponent(ref)}`)
        .then(r => r.json())
        .then(data => {
          setReferralValid(data.valid);
          if (data.valid) setReferralName(data.referrerName);
        })
        .catch(() => {});
    } else {
      try {
        const stored = localStorage.getItem('brikvest_referral');
        if (stored) {
          setReferralCode(stored);
          fetch(`/api/validate-referral/${encodeURIComponent(stored)}`)
            .then(r => r.json())
            .then(data => {
              setReferralValid(data.valid);
              if (data.valid) setReferralName(data.referrerName);
            })
            .catch(() => {});
        }
      } catch {}
    }
  }, [searchString]);

  const getRedirectUrl = () => {
    const params = new URLSearchParams(searchString);
    const redirect = params.get("redirect");
    if (redirect && redirect.startsWith("/") && !redirect.startsWith("//")) {
      return redirect;
    }
    return "/dashboard";
  };

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      setLocation(getRedirectUrl());
    }
  }, [isAuthenticated, isLoading, setLocation]);

  const loginForm = useForm<LoginUser>({
    resolver: zodResolver(loginUserSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const registerForm = useForm<RegisterUser>({
    resolver: zodResolver(registerUserSchema),
    defaultValues: {
      email: "",
      password: "",
      firstName: "",
      lastName: "",
      phone: "",
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginUser) => {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include"
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || "Login failed");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Welcome back!",
        description: "You have been logged in successfully.",
      });
      setLocation(getRedirectUrl());
    },
    onError: (error: any) => {
      toast({
        title: "Login failed",
        description: error.message || "Invalid email or password",
        variant: "destructive",
      });
    },
  });

  const [showPendingMessage, setShowPendingMessage] = useState(false);

  const registerMutation = useMutation({
    mutationFn: async (data: RegisterUser) => {
      const payload: any = { ...data };
      if (referralCode) payload.referralCode = referralCode;
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || "Registration failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      try { localStorage.removeItem('brikvest_referral'); } catch {}
      if (data.pendingApproval) {
        setShowPendingMessage(true);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        setLocation(getRedirectUrl());
      }
    },
    onError: (error: any) => {
      toast({
        title: "Registration failed",
        description: error.message || "Failed to create account",
        variant: "destructive",
      });
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "include"
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || "Failed to send reset email");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Reset email sent",
        description: "If the email exists, a password reset link has been sent to your inbox.",
      });
      setShowForgotPassword(false);
      setForgotPasswordEmail("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send reset email",
        variant: "destructive",
      });
    },
  });

  const onLoginSubmit = (data: LoginUser) => {
    loginMutation.mutate(data);
  };

  const onRegisterSubmit = (data: RegisterUser) => {
    registerMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (showPendingMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-900">Application Submitted</h2>
            <p className="text-slate-600">
              Thank you for applying to join Brikvest. Your membership application is being reviewed by our team.
            </p>
            <p className="text-slate-600">
              You will receive an email once your application has been approved. This usually takes less than 24 hours.
            </p>
            <div className="pt-4">
              <Button 
                variant="outline"
                onClick={() => {
                  setShowPendingMessage(false);
                  setIsRegistering(false);
                }}
                className="text-blue-600 border-blue-600 hover:bg-blue-50"
              >
                Back to Sign In
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-blue-600">
            {isRegistering ? "Join Brikvest" : "Welcome Back"}
          </CardTitle>
          <CardDescription>
            {role === null && !showForgotPassword
              ? "First, tell us who you are"
              : isRegistering
              ? "Apply for membership to access exclusive real estate investments"
              : "Sign in to your Brikvest account"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {role === null && !showForgotPassword ? (
            // Role chooser: investor vs developer/agent/land vendor
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setRole("investor")}
                className="w-full text-left rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors p-4"
                data-testid="button-role-investor"
              >
                <div className="font-semibold text-slate-900">I'm an Investor</div>
                <div className="text-sm text-slate-500 mt-0.5">
                  I want to {isRegistering ? "join Brikvest and invest in" : "sign in and manage my"} fractional land investments.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setLocation(isRegistering ? "/developer/signup" : "/developer/login")}
                className="w-full text-left rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors p-4"
                data-testid="button-role-developer"
              >
                <div className="font-semibold text-slate-900">I'm a Developer / Agent / Land Vendor</div>
                <div className="text-sm text-slate-500 mt-0.5">
                  I want to list land or projects for sale on Brikvest.
                </div>
              </button>
            </div>
          ) : showForgotPassword ? (
            // Forgot Password Form
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgotEmail">Enter your email address</Label>
                <Input
                  id="forgotEmail"
                  type="email"
                  placeholder="Enter your email"
                  value={forgotPasswordEmail}
                  onChange={(e) => setForgotPasswordEmail(e.target.value)}
                />
              </div>

              <Button 
                onClick={() => forgotPasswordMutation.mutate(forgotPasswordEmail)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                disabled={forgotPasswordMutation.isPending || !forgotPasswordEmail}
              >
                {forgotPasswordMutation.isPending ? "Sending..." : "Send Reset Link"}
              </Button>

              <Button
                variant="ghost"
                onClick={() => setShowForgotPassword(false)}
                className="w-full text-sm text-blue-600 hover:underline"
              >
                Back to Sign In
              </Button>
            </div>
          ) : !isRegistering ? (
            // Login Form
            <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  {...loginForm.register("email")}
                />
                {loginForm.formState.errors.email && (
                  <p className="text-sm text-red-600">{loginForm.formState.errors.email.message}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  {...loginForm.register("password")}
                />
                {loginForm.formState.errors.password && (
                  <p className="text-sm text-red-600">{loginForm.formState.errors.password.message}</p>
                )}
              </div>

              <Button 
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? "Signing in..." : "Sign In"}
              </Button>

              <div className="text-center">
                <Button
                  variant="ghost"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-sm text-blue-600 hover:underline"
                  type="button"
                >
                  Forgot your password?
                </Button>
              </div>
            </form>
          ) : (
            // Registration Form
            <form onSubmit={registerForm.handleSubmit(onRegisterSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    placeholder="John"
                    {...registerForm.register("firstName")}
                  />
                  {registerForm.formState.errors.firstName && (
                    <p className="text-sm text-red-600">{registerForm.formState.errors.firstName.message}</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    placeholder="Doe"
                    {...registerForm.register("lastName")}
                  />
                  {registerForm.formState.errors.lastName && (
                    <p className="text-sm text-red-600">{registerForm.formState.errors.lastName.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="registerEmail">Email</Label>
                <Input
                  id="registerEmail"
                  type="email"
                  placeholder="john@example.com"
                  {...registerForm.register("email")}
                />
                {registerForm.formState.errors.email && (
                  <p className="text-sm text-red-600">{registerForm.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  placeholder="+234 xxx xxx xxxx"
                  {...registerForm.register("phone")}
                />
                {registerForm.formState.errors.phone && (
                  <p className="text-sm text-red-600">{registerForm.formState.errors.phone.message}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="registerPassword">Password</Label>
                <Input
                  id="registerPassword"
                  type="password"
                  placeholder="Create a strong password"
                  {...registerForm.register("password")}
                />
                {registerForm.formState.errors.password && (
                  <p className="text-sm text-red-600">{registerForm.formState.errors.password.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="referralCode">Referral Code (Optional)</Label>
                <Input
                  id="referralCode"
                  placeholder="e.g. BRIK-ABC123"
                  value={referralCode}
                  onChange={(e) => {
                    setReferralCode(e.target.value);
                    setReferralValid(null);
                  }}
                  className={referralValid === true ? "border-green-500" : referralValid === false ? "border-red-400" : ""}
                />
                {referralValid === true && (
                  <p className="text-sm text-green-600">Referred by {referralName}</p>
                )}
                {referralValid === false && referralCode && (
                  <p className="text-sm text-red-500">Invalid referral code</p>
                )}
              </div>

              <Button 
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                disabled={registerMutation.isPending}
              >
                {registerMutation.isPending ? "Creating Account..." : "Create Account"}
              </Button>
            </form>
          )}

          <div className="text-center">
            <Button
              variant="ghost"
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-sm text-blue-600 hover:underline"
            >
              {isRegistering 
                ? "Already have an account? Sign in" 
                : "Don't have an account? Sign up"
              }
            </Button>
            {role === "investor" && !showForgotPassword && (
              <div>
                <Button
                  variant="ghost"
                  onClick={() => setRole(null)}
                  className="text-xs text-slate-500 hover:underline"
                  data-testid="button-back-to-role"
                >
                  Not an investor? Go back
                </Button>
              </div>
            )}
          </div>
          
          <div className="text-center text-xs text-gray-500 mt-4">
            <p>By continuing, you agree to our Terms of Service and Privacy Policy</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
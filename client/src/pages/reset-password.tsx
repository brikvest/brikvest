import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Eye, EyeOff } from "lucide-react";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Get token from URL query parameter
    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('token');
    if (!resetToken) {
      toast({
        title: "Invalid reset link",
        description: "The password reset link is invalid or expired.",
        variant: "destructive",
      });
      setLocation("/login");
      return;
    }
    setToken(resetToken);
  }, [setLocation, toast]);

  const form = useForm({
    defaultValues: {
      password: "",
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (password: string) => {
      if (!password || password.length < 6) {
        throw new Error("Password must be at least 6 characters long");
      }
      
      if (!token) {
        throw new Error("Invalid reset token");
      }
      
      const response = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
        credentials: "include"
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = "Password reset failed";
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Password reset successful",
        description: "Your password has been updated. You can now sign in with your new password.",
      });
      setLocation("/login");
    },
    onError: (error: any) => {
      toast({
        title: "Password reset failed",
        description: error.message || "Failed to reset password",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: any) => {
    const password = data.password?.trim();
    if (!password) {
      toast({
        title: "Password required",
        description: "Please enter a new password",
        variant: "destructive",
      });
      return;
    }
    resetMutation.mutate(password);
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-emerald-600">
            Reset Your Password
          </CardTitle>
          <CardDescription>
            Enter your new password below
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your new password (min 6 characters)"
                  {...form.register("password")}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </Button>
              </div>
              {form.formState.errors.password && (
                <p className="text-sm text-red-600">{form.formState.errors.password.message}</p>
              )}
            </div>

            <Button 
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={resetMutation.isPending}
              onClick={form.handleSubmit(onSubmit)}
            >
              {resetMutation.isPending ? "Updating..." : "Update Password"}
            </Button>
          </form>

          <div className="text-center">
            <Button
              variant="ghost"
              onClick={() => setLocation("/login")}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Back to Sign In
            </Button>
          </div>
          
          <div className="text-center text-xs text-gray-500 mt-4">
            <p>Remember your password? Sign in instead</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
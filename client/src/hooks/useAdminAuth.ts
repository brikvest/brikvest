import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface AdminUser {
  id: number;
  username: string;
  role: string;
}

interface AdminAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AdminUser | null;
  sessionId: string | null;
}

export function useAdminAuth() {
  const [authState, setAuthState] = useState<AdminAuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    sessionId: null,
  });

  // Get session from localStorage on mount
  useEffect(() => {
    const sessionId = localStorage.getItem("admin_session_id");
    if (sessionId) {
      setAuthState(prev => ({ ...prev, sessionId }));
    } else {
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Verify session with server
  const { data: userData, isLoading: isVerifying } = useQuery({
    queryKey: ["/api/admin/me"],
    queryFn: async () => {
      const sessionId = authState.sessionId || localStorage.getItem("admin_session_id");
      if (!sessionId) throw new Error("No session");
      
      return await apiRequest("/api/admin/me", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${sessionId}`,
        },
      });
    },
    enabled: !!authState.sessionId,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Update auth state when user data changes
  useEffect(() => {
    if (userData?.user) {
      setAuthState(prev => ({
        ...prev,
        isAuthenticated: true,
        isLoading: false,
        user: userData.user,
      }));
    } else if (!isVerifying && authState.sessionId) {
      // Session is invalid
      logout();
    } else if (!authState.sessionId) {
      setAuthState(prev => ({
        ...prev,
        isLoading: false,
      }));
    }
  }, [userData, isVerifying, authState.sessionId]);

  const login = (sessionId: string, user: AdminUser) => {
    localStorage.setItem("admin_session_id", sessionId);
    setAuthState({
      isAuthenticated: true,
      isLoading: false,
      user,
      sessionId,
    });
  };

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const sessionId = localStorage.getItem("admin_session_id");
      if (sessionId) {
        await apiRequest("/api/admin/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionId}`,
          },
        });
      }
    },
    onSettled: () => {
      // Always clear local state regardless of API response
      localStorage.removeItem("admin_session_id");
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        sessionId: null,
      });
    },
  });

  const logout = () => {
    logoutMutation.mutate();
  };

  // Custom API request with auth headers
  const authenticatedRequest = async (url: string, options: any = {}) => {
    const sessionId = authState.sessionId || localStorage.getItem("admin_session_id");
    if (!sessionId) {
      throw new Error("No authentication session");
    }

    return await apiRequest(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${sessionId}`,
      },
    });
  };

  return {
    ...authState,
    login,
    logout,
    authenticatedRequest,
  };
}
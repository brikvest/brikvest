import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/queryClient";

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

  useEffect(() => {
    const sessionId = localStorage.getItem("admin_session_id");
    if (sessionId) {
      setAuthState(prev => ({ ...prev, sessionId }));
    } else {
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

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
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (userData?.user) {
      setAuthState(prev => ({
        ...prev,
        isAuthenticated: true,
        isLoading: false,
        user: userData.user,
      }));
    } else if (!isVerifying && authState.sessionId) {
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

  const authenticatedRequest = async (url: string, options: any = {}) => {
    const sessionId = authState.sessionId || localStorage.getItem("admin_session_id");
    if (!sessionId) {
      throw new ApiError({ status: 401 });
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
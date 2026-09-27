"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api } from "./api-client";
import { clearStoredToken, getStoredToken, setStoredToken } from "./session-storage";
import type { MeResponse } from "./types";

interface AuthContextValue {
  token: string | null;
  user: MeResponse | null;
  isLoading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<MeResponse | null>(null);
  // Always start as loading: the server can't see sessionStorage, so deriving the initial
  // value from it made the server and client render different headers (hydration mismatch).
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const existing = getStoredToken();
    if (!existing) {
      Promise.resolve().then(() => setIsLoading(false));
      return;
    }
    api
      .me(existing)
      .then((profile) => {
        setToken(existing);
        setUser(profile);
      })
      .catch((err: unknown) => {
        // Only a rejected session means "logged out". A network/server hiccup must not
        // silently discard a valid session — keep the token so pages can retry and show
        // their own error instead of bouncing the user to the login page.
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
        } else {
          setToken(existing);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      isLoading,
      async login(newToken: string) {
        setStoredToken(newToken);
        setToken(newToken);
        const profile = await api.me(newToken);
        setUser(profile);
      },
      async logout() {
        const current = getStoredToken();
        clearStoredToken();
        setToken(null);
        setUser(null);
        if (current) {
          await api.logout(current).catch(() => undefined);
        }
      },
    }),
    [token, user, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

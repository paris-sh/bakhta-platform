"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api-client";
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
  const [isLoading, setIsLoading] = useState(() => getStoredToken() !== null);

  useEffect(() => {
    const existing = getStoredToken();
    if (!existing) return;
    api
      .me(existing)
      .then((profile) => {
        setToken(existing);
        setUser(profile);
      })
      .catch(() => {
        clearStoredToken();
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

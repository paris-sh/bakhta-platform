"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "../api-client";
import { adminApi } from "./api";
import { clearAdminToken, getAdminToken, setAdminToken } from "./session";
import type { AdminMe, AdminPermission } from "./types";

type Status = "loading" | "authenticated" | "anonymous";

interface AdminAuthValue {
  status: Status;
  /** True when the last admin session was rejected by the server (expired or revoked). */
  expired: boolean;
  token: string | null;
  me: AdminMe | null;
  /** UI gating only — every endpoint enforces the same permission server-side. */
  can: (permission: AdminPermission) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Runs an authenticated admin call; a 401 ends the admin session and returns to login. */
  run: <T>(fn: (token: string) => Promise<T>) => Promise<T>;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<AdminMe | null>(null);
  const [expired, setExpired] = useState(false);

  const expire = useCallback(() => {
    clearAdminToken();
    setToken(null);
    setMe(null);
    setExpired(true);
    setStatus("anonymous"); // the panel guard then returns to /admin/login
  }, []);

  useEffect(() => {
    const existing = getAdminToken();
    if (!existing) {
      Promise.resolve().then(() => setStatus("anonymous"));
      return;
    }
    adminApi
      .me(existing)
      .then((profile) => {
        setToken(existing);
        setMe(profile);
        setStatus("authenticated");
      })
      .catch((err: unknown) => {
        // A rejected session (401/403) ends it; a network hiccup keeps the token so a reload can retry.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          expire();
          return;
        }
        setStatus("anonymous");
      });
    // Only on first mount: later session changes go through login/logout/expire.
  }, [expire]);

  const value = useMemo<AdminAuthValue>(
    () => ({
      status,
      expired,
      token,
      me,
      can: (permission) => me?.permissions.includes(permission) ?? false,
      async login(email, password) {
        const session = await adminApi.login(email, password);
        const profile = await adminApi.me(session.token);
        setAdminToken(session.token);
        setToken(session.token);
        setMe(profile);
        setExpired(false);
        setStatus("authenticated");
      },
      async logout() {
        const current = token;
        clearAdminToken();
        setToken(null);
        setMe(null);
        setStatus("anonymous");
        if (current) await adminApi.logout(current).catch(() => undefined);
        router.replace("/admin/login");
      },
      async run(fn) {
        if (!token) {
          expire();
          throw new ApiError(401, "UNAUTHORIZED", "unauthorized");
        }
        try {
          return await fn(token);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) expire();
          throw err;
        }
      },
    }),
    [status, expired, token, me, router, expire],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}

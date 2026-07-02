import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, saveToken, clearToken, getToken } from "@/src/api/client";

export type User = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "supervisor" | "user";
  position?: string | null;
  division?: string | null;
  warehouse_id?: string | null;
  must_change_password?: boolean;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ must_change_password: boolean }>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      const tok = await getToken();
      if (!tok) {
        setUser(null);
        return;
      }
      const me = await api.get<User>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
      await clearToken();
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refreshMe();
      setLoading(false);
    })();
  }, [refreshMe]);

  const login = async (username: string, password: string) => {
    const res = await api.post<{ access_token: string; user: User; must_change_password: boolean }>(
      "/auth/login",
      { username, password },
      false,
    );
    await saveToken(res.access_token);
    setUser(res.user);
    return { must_change_password: res.must_change_password };
  };

  const logout = async () => {
    await clearToken();
    setUser(null);
  };

  const changePassword = async (current: string, next: string) => {
    await api.post("/auth/change-password", { current_password: current, new_password: next });
    if (user) setUser({ ...user, must_change_password: false });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changePassword, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

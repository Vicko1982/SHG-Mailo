import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "main_admin" | "admin" | "user";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  roles: AppRole[];
  isMainAdmin: boolean;
  isAdmin: boolean; // main_admin OR admin
  canEdit: boolean;
  fullName: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [fullName, setFullName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        setTimeout(() => {
          void loadRoles(newSession.user.id);
        }, 0);
        if (event === "SIGNED_IN") {
          setTimeout(() => {
            void supabase.from("activity_log").insert({
              user_id: newSession.user.id,
              action: "sign_in",
            });
          }, 0);
        }
      } else {
        setRoles([]);
        setFullName(null);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) {
        // Keep the initial auth state loading until permissions are available.
        // Otherwise protected admin routes can redirect during refresh while the
        // user's roles are still temporarily empty.
        await loadRoles(existing.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadRoles(userId: string) {
    const [rolesRes, profileRes] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("profiles").select("is_active, full_name").eq("id", userId).maybeSingle(),
    ]);
    if (profileRes.data && (profileRes.data as { is_active?: boolean }).is_active === false) {
      await supabase.auth.signOut();
      setRoles([]);
      setFullName(null);
      return;
    }
    setRoles((rolesRes.data?.map((r) => r.role) ?? []) as AppRole[]);
    setFullName((profileRes.data?.full_name as string | null) ?? null);
  }

  const isMainAdmin = roles.includes("main_admin");
  const isAdmin = isMainAdmin || roles.includes("admin");
  const canEdit = isAdmin || roles.includes("user");

  async function signOut() {
    if (user) {
      await supabase.from("activity_log").insert({ user_id: user.id, action: "sign_out" });
    }
    try { sessionStorage.removeItem("shg.impersonate"); } catch { /* noop */ }
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ user, session, loading, roles, isMainAdmin, isAdmin, canEdit, fullName, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

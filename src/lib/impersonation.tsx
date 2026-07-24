import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

const KEY = "shg.impersonate";

type Ctx = {
  impersonatedUserId: string | null;
  impersonatedName: string | null;
  isImpersonating: boolean;
  startImpersonation: (userId: string, name: string) => Promise<void>;
  stopImpersonation: () => Promise<void>;
};

const ImpersonationContext = createContext<Ctx | undefined>(undefined);

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as { id: string; name: string };
        setUid(p.id); setName(p.name);
      }
    } catch { /* noop */ }
  }, []);

  const start = async (userId: string, fullName: string) => {
    sessionStorage.setItem(KEY, JSON.stringify({ id: userId, name: fullName }));
    setUid(userId); setName(fullName);
    const { data: me } = await supabase.auth.getUser();
    if (me.user) {
      await supabase.from("activity_log").insert({
        user_id: me.user.id,
        action: "impersonate_start",
        metadata: { target_user_id: userId, target_name: fullName },
      });
    }
  };

  const stop = async () => {
    const targetName = name;
    const targetId = uid;
    sessionStorage.removeItem(KEY);
    setUid(null); setName(null);
    const { data: me } = await supabase.auth.getUser();
    if (me.user) {
      await supabase.from("activity_log").insert({
        user_id: me.user.id,
        action: "impersonate_stop",
        metadata: { target_user_id: targetId, target_name: targetName },
      });
    }
  };

  return (
    <ImpersonationContext.Provider
      value={{
        impersonatedUserId: uid,
        impersonatedName: name,
        isImpersonating: !!uid,
        startImpersonation: start,
        stopImpersonation: stop,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  const ctx = useContext(ImpersonationContext);
  if (!ctx) throw new Error("useImpersonation must be used within ImpersonationProvider");
  return ctx;
}

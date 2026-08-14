import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/language";
import { createEmailOnlyLogin } from "@/lib/demo-auth.functions";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Smart Homes Task Manager" },
      { name: "description", content: "Sign in to Smart Homes Task Manager." },
      { property: "og:title", content: "Sign in — Smart Homes Task Manager" },
      { property: "og:description", content: "Sign in to Smart Homes Task Manager." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { tr } = useLanguage();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");

  // Bootstrap (πρώτος admin)
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [showBootstrap, setShowBootstrap] = useState(false);
  const [bEmail, setBEmail] = useState("");
  const [bName, setBName] = useState("");
  const [bPass, setBPass] = useState("");
  const [bLoading, setBLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.functions.invoke("admin-list-auth-users", { body: {} });
      if (!error && (data as { bootstrap?: boolean } | null)?.bootstrap) {
        setBootstrapAvailable(true);
        setShowBootstrap(true);
      }
    })();
  }, []);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const { tokenHash } = await createEmailOnlyLogin({ data: { email: normalizedEmail } });
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "magiclink",
      });
      if (error) throw error;
      toast.success(tr("Welcome!", "Καλωσόρισες!"));
      router.navigate({ to: "/", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr("Login failed", "Σφάλμα σύνδεσης"));
    } finally {
      setLoading(false);
    }
  }

  async function handleBootstrap(e: FormEvent) {
    e.preventDefault();
    setBLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: { email: bEmail, full_name: bName, password: bPass, role: "main_admin" },
    });
    if (error || (data as { error?: string })?.error) {
      setBLoading(false);
      toast.error((data as { error?: string })?.error ?? error?.message ?? tr("Creation failed", "Σφάλμα δημιουργίας"));
      return;
    }
    const { error: signErr } = await supabase.auth.signInWithPassword({ email: bEmail, password: bPass });
    setBLoading(false);
    if (signErr) {
      toast.error(signErr.message);
      return;
    }
    toast.success(tr("The first administrator was created!", "Δημιουργήθηκε ο πρώτος διαχειριστής!"));
    router.navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold tracking-wide">SMART HOMES</h1>
          <p className="text-xs tracking-[0.3em] text-muted-foreground uppercase mt-1">
            Task Manager
          </p>
        </div>
        <Card className="p-6">
          {showBootstrap && bootstrapAvailable ? (
            <form onSubmit={handleBootstrap} className="space-y-4">
              <div>
                <h2 className="font-semibold">{tr("Create first administrator", "Δημιουργία πρώτου διαχειριστή")}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {tr("No users exist yet. Create the first Main Admin.", "Δεν υπάρχει ακόμα κανένας χρήστης. Δημιούργησε τον πρώτο main admin.")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-name">{tr("Full name", "Ονοματεπώνυμο")}</Label>
                <Input id="b-name" required value={bName} onChange={(e) => setBName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-email">Email</Label>
                <Input id="b-email" type="email" required value={bEmail} onChange={(e) => setBEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-pass">{tr("Password (min. 8)", "Κωδικός (min. 8)")}</Label>
                <Input id="b-pass" type="password" required minLength={8} value={bPass} onChange={(e) => setBPass(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={bLoading}>
                {bLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {tr("Create & sign in", "Δημιουργία & σύνδεση")}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {tr("Sign in", "Σύνδεση")}
              </Button>
              <p className="text-xs text-muted-foreground text-center pt-2">
                {tr(
                  "Temporary email-only login. Email verification will be enabled later.",
                  "Προσωρινή σύνδεση μόνο με email. Η επαλήθευση email θα ενεργοποιηθεί αργότερα.",
                )}
              </p>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

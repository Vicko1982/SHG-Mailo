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

  // Passwordless email OTP step for every registered user.
  const [otpStep, setOtpStep] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);

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
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: false,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    setOtpEmail(normalizedEmail);
    setOtpCode("");
    setOtpStep(true);
    toast.success(tr("An 8-digit verification code was sent to your email.", "Στάλθηκε οκταψήφιος κωδικός επαλήθευσης στο email σου."));
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    const normalizedCode = otpCode.replace(/\D/g, "");
    if (normalizedCode.length !== 8) {
      toast.error(tr("Enter the 8-digit code.", "Πληκτρολόγησε τον οκταψήφιο κωδικό."));
      return;
    }

    setOtpLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email: otpEmail,
      token: normalizedCode,
      type: "email",
    });
    setOtpLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(tr("Verification completed. Welcome!", "Η επαλήθευση ολοκληρώθηκε. Καλωσόρισες!"));
    router.navigate({ to: "/", replace: true });
  }

  async function handleResendOtp() {
    setOtpLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: otpEmail,
      options: {
        shouldCreateUser: false,
      },
    });
    setOtpLoading(false);
    if (error) toast.error(error.message);
    else {
      setOtpCode("");
      toast.success(tr("A new 8-digit code was sent.", "Στάλθηκε νέος οκταψήφιος κωδικός."));
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
          {otpStep ? (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <h2 className="font-semibold">{tr("Email verification", "Επαλήθευση email")}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {tr("We sent an 8-digit verification code to", "Στείλαμε έναν οκταψήφιο κωδικό επαλήθευσης στο")} <strong>{otpEmail}</strong>.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-otp">{tr("Verification code", "Κωδικός επαλήθευσης")}</Label>
                <Input
                  id="admin-otp"
                  type="text"
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{8}"
                  minLength={8}
                  maxLength={8}
                  placeholder="00000000"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  className="text-center text-lg tracking-[0.35em]"
                />
              </div>
              <Button type="submit" className="w-full" disabled={otpLoading || otpCode.length !== 8}>
                {otpLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {tr("Verify & sign in", "Επαλήθευση & σύνδεση")}
              </Button>
              <div className="flex justify-between text-xs">
                <button type="button" className="text-muted-foreground hover:underline" onClick={() => setOtpStep(false)}>
                  ← {tr("Back", "Πίσω")}
                </button>
                <button type="button" className="text-muted-foreground hover:underline" onClick={handleResendOtp} disabled={otpLoading}>
                  {tr("Resend code", "Επαναποστολή κωδικού")}
                </button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {tr("If you cannot find the email, check your spam folder.", "Αν δεν βλέπεις το email, έλεγξε και τον φάκελο ανεπιθύμητης αλληλογραφίας.")}
              </p>
            </form>
          ) : showBootstrap && bootstrapAvailable ? (
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
                {tr("Send verification code", "Αποστολή κωδικού επαλήθευσης")}
              </Button>
              <p className="text-xs text-muted-foreground text-center pt-2">
                {tr("Access is restricted to Smart Homes users. Contact an administrator to create an account.", "Πρόσβαση μόνο για χρήστες της Smart Homes. Επικοινώνησε με τον διαχειριστή για δημιουργία λογαριασμού.")}
              </p>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

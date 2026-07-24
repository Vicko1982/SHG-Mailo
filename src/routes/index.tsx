import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart Homes Task Manager" },
      { name: "description", content: "Smart Homes task management." },
      { property: "og:title", content: "Smart Homes Task Manager" },
      { property: "og:description", content: "Smart Homes task management." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RootRedirect,
});

function RootRedirect() {
  const { loading, user } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.navigate({ to: user ? "/dashboard" : "/login", replace: true });
  }, [loading, user, router]);
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listTasks } from "@/lib/tasks.functions";
import { STATUS_META } from "@/lib/task-ui";
import { ListChecks, Eye, ClipboardList } from "lucide-react";
import { useLanguage } from "@/lib/language";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Smart Homes Task Manager" },
      { name: "description", content: "Your task overview." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { fullName, roles } = useAuth();
  const { tr } = useLanguage();
  const fetch = useServerFn(listTasks);

  const { data: mine } = useQuery({
    queryKey: ["tasks", "dash-mine"],
    queryFn: () => fetch({ data: { scope: "mine", pageSize: 100 } }),
  });
  const { data: supervising } = useQuery({
    queryKey: ["tasks", "dash-sup"],
    queryFn: () => fetch({ data: { scope: "supervising", pageSize: 100 } }),
  });

  const mineActive = (mine?.rows ?? []).filter(
    (t) => t.status !== "done" && t.status !== "cancelled",
  );
  const supActive = (supervising?.rows ?? []).filter(
    (t) => t.status !== "done" && t.status !== "cancelled",
  );

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold">{tr("Welcome", "Καλώς ήρθες")}, {fullName}</h1>
        <p className="text-sm text-muted-foreground">{tr("Role", "Ρόλος")}: {roles.join(", ") || "—"}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<ListChecks className="h-5 w-5" />}
          title={tr("Assigned to me", "Ανατεθειμένα σε εμένα")}
          value={mineActive.length}
          href="/my-tasks"
        />
        <StatCard
          icon={<Eye className="h-5 w-5" />}
          title={tr("I supervise", "Εποπτεύω")}
          value={supActive.length}
          href="/my-tasks"
        />
        <StatCard
          icon={<ClipboardList className="h-5 w-5" />}
          title={tr("Total (mine, all)", "Σύνολο (δικά μου, όλα)")}
          value={mine?.count ?? 0}
          href="/my-tasks"
        />
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">{tr("My active tasks", "Οι ενεργές εργασίες μου")}</h2>
        {mineActive.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("Nothing on your plate.", "Δεν έχεις εκκρεμότητες.")} 🎉</p>
        ) : (
          <ul className="divide-y">
            {mineActive.slice(0, 10).map((t) => (
              <li key={t.id} className="py-2 flex items-center gap-3">
                <span
                  className="inline-block h-2 w-2 rounded-sm shrink-0"
                  style={{ backgroundColor: t.space?.color ?? "#888" }}
                />
                <Link
                  to="/spaces/$key"
                  params={{ key: t.space!.key }}
                  className="text-sm hover:underline flex-1 truncate"
                >
                  <span className="font-mono text-xs text-muted-foreground mr-2">{t.task_key}</span>
                  {t.title}
                </Link>
                <Badge className={STATUS_META[t.status]?.className}>
                  {STATUS_META[t.status]?.label}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  icon, title, value, href,
}: { icon: React.ReactNode; title: string; value: number; href: string }) {
  return (
    <Link to={href}>
      <Card className="p-4 hover:bg-muted/40 transition-colors">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-muted rounded-md">{icon}</div>
          <div>
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-xs text-muted-foreground">{title}</div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

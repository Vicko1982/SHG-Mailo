import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listActivity, listActionTypes } from "@/lib/activity.functions";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Search } from "lucide-react";
import { useLanguage } from "@/lib/language";

export const Route = createFileRoute("/_authenticated/admin/activity")({
  head: () => ({
    meta: [
      { title: "Activity Log — Smart Homes Task Manager" },
      { name: "description", content: "Audit trail of user and system actions." },
      { property: "og:title", content: "Activity Log — Smart Homes Task Manager" },
      { property: "og:description", content: "Audit trail of user and system actions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ActivityPage,
});

const ACTION_LABELS: Record<string, string> = {
  sign_in: "Sign in",
  sign_out: "Sign out",
  impersonate_start: "Started impersonation",
  impersonate_stop: "Stopped impersonation",
  task_update_status: "Task status changed",
  task_edit: "Task edited",
  task_comment: "Task commented",
  space_create: "Space created",
  space_update: "Space updated",
  space_delete: "Space deleted",
};

function ActivityPage() {
  const { language, tr } = useLanguage();
  const { isAdmin } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => { if (!isAdmin) router.navigate({ to: "/" }); }, [isAdmin, router]);

  const fetchActivity = useServerFn(listActivity);
  const fetchActions = useServerFn(listActionTypes);

  const { data: actionTypes = [] } = useQuery({
    queryKey: ["activity-actions"],
    queryFn: () => fetchActions(),
    enabled: isAdmin,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["activity", { search, action, page }],
    queryFn: () => fetchActivity({ data: { search, action: action || undefined, page, pageSize } }),
    enabled: isAdmin,
  });

  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (!isAdmin) return null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{tr("Activity Log", "Αρχείο δραστηριότητας")}</h1>
        <p className="text-sm text-muted-foreground">{tr("Chronological audit trail of user and system events.", "Χρονολογικό ιστορικό ενεργειών χρηστών και συστήματος.")}</p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tr("Search action or task…", "Αναζήτηση ενέργειας ή εργασίας…")}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 w-72 h-9"
          />
        </div>
        <Select value={action || "all"} onValueChange={(v) => { setAction(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-56 h-9"><SelectValue placeholder={tr("All actions", "Όλες οι ενέργειες")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr("All actions", "Όλες οι ενέργειες")}</SelectItem>
            {actionTypes.map((a) => (
              <SelectItem key={a} value={a}>{ACTION_LABELS[a] ?? a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-muted-foreground">{total} {tr("events", "συμβάντα")}</div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">{tr("When", "Πότε")}</TableHead>
              <TableHead className="w-48">{tr("User", "Χρήστης")}</TableHead>
              <TableHead className="w-56">{tr("Action", "Ενέργεια")}</TableHead>
              <TableHead>{tr("Details", "Λεπτομέρειες")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-10"><Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-10 text-sm text-muted-foreground">{tr("No events.", "Δεν υπάρχουν συμβάντα.")}</TableCell></TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString(language === "el" ? "el-GR" : "en-GB")}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{r.user?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.user?.email ?? ""}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ACTION_LABELS[r.action] ?? r.action}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.task_title && <div className="truncate">{r.task_title}</div>}
                    {r.metadata && Object.keys(r.metadata as Record<string, unknown>).length > 0 && (
                      <pre className="text-[11px] text-muted-foreground font-mono whitespace-pre-wrap max-w-3xl">
                        {JSON.stringify(r.metadata, null, 0)}
                      </pre>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {totalPages > 1 && (
        <div className="flex justify-between items-center text-sm">
          <div className="text-muted-foreground">
            {tr("Showing", "Εμφάνιση")} {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} {tr("of", "από")} {total}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>{tr("Previous", "Προηγούμενη")}</Button>
            <span className="text-xs self-center text-muted-foreground">{tr("Page", "Σελίδα")} {page} {tr("of", "από")} {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>{tr("Next", "Επόμενη")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { STATUS_META, ALL_STATUSES, PRIORITY_META, ALL_PRIORITIES } from "@/lib/task-ui";
import { useLanguage } from "@/lib/language";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "General Settings · Smart Homes" },
      { name: "description", content: "Reference for task statuses, priorities, and workflow rules." },
    ],
  }),
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

const TRANSITIONS: Record<string, string[]> = {
  backlog: ["todo", "cancelled"],
  todo: ["progress", "pause", "blocked", "cancelled"],
  progress: ["pause", "blocked", "review", "done"],
  pause: ["progress", "cancelled"],
  blocked: ["progress", "cancelled"],
  review: ["progress", "done"],
  done: ["progress"],
  cancelled: ["backlog"],
};

function SettingsPage() {
  const { tr } = useLanguage();
  const statusLabel = (s: string) => tr(STATUS_META[s]?.label ?? s, ({ backlog: "Εκκρεμότητες", todo: "Προς εκτέλεση", progress: "Σε εξέλιξη", in_progress: "Σε εξέλιξη", pause: "Σε παύση", blocked: "Μπλοκαρισμένο", review: "Έλεγχος", done: "Ολοκληρωμένο", cancelled: "Ακυρωμένο" } as Record<string, string>)[s] ?? s);
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold">{tr("General Settings", "Γενικές ρυθμίσεις")}</h1>
        <p className="text-xs text-muted-foreground">
          {tr("Workflow reference. Statuses and priorities are defined in code and enforced by the database.", "Αναφορά ροής εργασίας. Οι καταστάσεις και οι προτεραιότητες ορίζονται στον κώδικα και επιβάλλονται από τη βάση δεδομένων.")}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{tr("Statuses", "Καταστάσεις")}</h2>
        <div className="border rounded-md overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 text-xs uppercase text-muted-foreground">{tr("Status", "Κατάσταση")}</th>
                <th className="text-left px-3 py-2 text-xs uppercase text-muted-foreground">{tr("Key", "Κωδικός")}</th>
                <th className="text-left px-3 py-2 text-xs uppercase text-muted-foreground">{tr("Can transition to", "Μπορεί να μεταβεί σε")}</th>
              </tr>
            </thead>
            <tbody>
              {ALL_STATUSES.map((s) => (
                <tr key={s} className="border-t">
                  <td className="px-3 py-2">
                    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_META[s].className}`}>
                      {statusLabel(s)}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{s}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 flex-wrap">
                      {(TRANSITIONS[s] ?? []).map((t) => (
                        <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_META[t]?.className ?? ""}`}>
                          {statusLabel(t)}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{tr("Priorities", "Προτεραιότητες")}</h2>
        <div className="border rounded-md bg-card p-3 flex flex-wrap gap-3">
          {ALL_PRIORITIES.map((p) => (
            <span key={p} className={`inline-flex items-center text-xs ${PRIORITY_META[p]?.className ?? ""}`}>
              {p}
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{tr("Roles", "Ρόλοι")}</h2>
        <div className="border rounded-md bg-card divide-y text-sm">
          <div className="p-3"><b>main_admin</b> — {tr("full control, including impersonation and role assignment.", "πλήρης έλεγχος, συμπεριλαμβανομένης της προβολής ως άλλος χρήστης και της ανάθεσης ρόλων.")}</div>
          <div className="p-3"><b>admin</b> — {tr("manages users, spaces and members; cannot impersonate.", "διαχειρίζεται χρήστες, χώρους και μέλη· δεν μπορεί να προβληθεί ως άλλος χρήστης.")}</div>
          <div className="p-3"><b>user</b> — {tr("access through space membership, assignment, supervision or mention.", "πρόσβαση μέσω συμμετοχής σε χώρο, ανάθεσης, εποπτείας ή αναφοράς.")}</div>
        </div>
      </section>
    </div>
  );
}

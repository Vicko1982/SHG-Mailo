import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { getAccessMatrix, setSpaceMembership } from "@/lib/access-matrix.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/language";
import { DIRECTORY_USERS, directoryUserId } from "@/lib/directory-users";

export const Route = createFileRoute("/_authenticated/admin/access")({
  component: AccessMatrixPage,
  head: () => ({
    meta: [
      { title: "Access Matrix · Smart Homes" },
      { name: "description", content: "Manage which users can access each space." },
    ],
  }),
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function AccessMatrixPage() {
  const { tr } = useLanguage();
  const fetchMatrix = useServerFn(getAccessMatrix);
  const setMembership = useServerFn(setSpaceMembership);
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["access-matrix"],
    queryFn: () => fetchMatrix(),
  });

  const mutation = useMutation({
    mutationFn: (v: { space_id: string; user_id: string; enabled: boolean }) =>
      setMembership({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["access-matrix"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const memberSet = useMemo(() => {
    const s = new Set<string>();
    (data?.members ?? []).forEach((m) => s.add(`${m.space_id}:${m.user_id}`));
    return s;
  }, [data]);

  const registeredUsers = data?.users ?? [];
  const registeredNames = new Set(
    registeredUsers.map((user) => user.full_name?.trim().toLocaleLowerCase()).filter(Boolean),
  );
  const allUsers = [
    ...registeredUsers.map((user) => ({ ...user, is_directory_only: false })),
    ...DIRECTORY_USERS
      .filter((fullName) => !registeredNames.has(fullName.toLocaleLowerCase()))
      .map((fullName) => ({
        id: directoryUserId(fullName),
        full_name: fullName,
        email: null,
        is_active: false,
        is_directory_only: true,
      })),
  ].sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", undefined, { sensitivity: "base" }));
  const users = allUsers.filter((u) =>
    !q || u.full_name?.toLowerCase().includes(q.toLowerCase()) || u.email?.toLowerCase().includes(q.toLowerCase()),
  );
  const shared = (data?.spaces ?? []).filter((s) => s.type === "shared");

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">{tr("Access Matrix", "Πίνακας πρόσβασης")}</h1>
          <p className="text-xs text-muted-foreground">
            {tr("Choose which users are members of each shared space. Personal spaces are managed by their owner.", "Επίλεξε ποιοι χρήστες είναι μέλη κάθε κοινόχρηστου χώρου. Οι προσωπικοί χώροι διαχειρίζονται από τον ιδιοκτήτη τους.")}
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search users…", "Αναζήτηση χρηστών…")} className="pl-8 h-9 w-64" />
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center"><Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" /></div>
      ) : (
        <div className="border rounded-md overflow-auto bg-card">
          <table className="text-sm border-collapse">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr>
                <th className="text-left font-medium text-xs uppercase tracking-wide text-muted-foreground px-3 py-2 border-b border-r sticky left-0 bg-muted/80 z-20 w-56">{tr("User", "Χρήστης")}</th>
                {shared.map((s) => (
                  <th key={s.id} className="px-2 py-2 border-b border-r text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color ?? "#888" }} />
                      <span>{s.key}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  <td className="px-3 py-1.5 border-b border-r sticky left-0 bg-inherit">
                    <div className="truncate font-medium text-sm">{u.full_name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {u.is_directory_only
                        ? tr("Pending registration", "Εκκρεμεί εγγραφή")
                        : <>{u.email}{u.is_active === false && ` · ${tr("disabled", "ανενεργός")}`}</>}
                    </div>
                  </td>
                  {shared.map((s) => {
                    const enabled = memberSet.has(`${s.id}:${u.id}`);
                    return (
                      <td key={s.id} className="px-2 py-1.5 border-b border-r text-center">
                        <Checkbox
                          checked={enabled}
                          disabled={mutation.isPending || u.is_directory_only}
                          title={u.is_directory_only ? tr("Register this user before assigning Space access", "Καταχωρήστε πρώτα τον χρήστη για να ορίσετε πρόσβαση") : undefined}
                          onCheckedChange={(v) =>
                            mutation.mutate({ space_id: s.id, user_id: u.id, enabled: !!v })
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

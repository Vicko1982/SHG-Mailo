import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, UserPlus, UserCheck, UserX, KeyRound, Eye, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useImpersonation } from "@/lib/impersonation";
import { useLanguage } from "@/lib/language";
import { DIRECTORY_USERS, directoryUserId } from "@/lib/directory-users";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "User Management — Smart Homes Task Manager" },
      { name: "description", content: "Create and manage users." },
      { property: "og:title", content: "User Management — Smart Homes Task Manager" },
      { property: "og:description", content: "Create and manage users." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminUsersPage,
});

interface Row {
  id: string;
  full_name: string | null;
  email: string | null;
  role: AppRole | null;
  is_active: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
  is_directory_only?: boolean;
}

type SortKey = "full_name" | "email" | "role" | "created_at" | "last_sign_in_at" | "is_active";
type SortDirection = "asc" | "desc";
type SortRule = { key: SortKey; direction: SortDirection };
type ColumnKey = SortKey | "actions";

const defaultColumnWidths: Record<ColumnKey, number> = {
  full_name: 180,
  email: 240,
  role: 155,
  created_at: 150,
  last_sign_in_at: 150,
  is_active: 120,
  actions: 410,
};

function formatDT(iso: string | null, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function AdminUsersPage() {
  const { isAdmin, isMainAdmin, user: currentUser } = useAuth();
  const router = useRouter();
  const { startImpersonation } = useImpersonation();
  const { language, tr } = useLanguage();
  const [users, setUsers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("user");

  const [activeBusyId, setActiveBusyId] = useState<string | null>(null);
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);
  const [pwBusyId, setPwBusyId] = useState<string | null>(null);
  const [nameBusyId, setNameBusyId] = useState<string | null>(null);
  const [sorts, setSorts] = useState<SortRule[]>([]);
  const [columnWidths, setColumnWidths] = useState(defaultColumnWidths);

  const sortedUsers = useMemo(() => {
    if (sorts.length === 0) return users;
    return [...users].sort((a, b) => {
      for (const sort of sorts) {
        const multiplier = sort.direction === "asc" ? 1 : -1;
        let comparison = 0;
        if (sort.key === "is_active") {
          comparison = Number(a.is_active) - Number(b.is_active);
        } else if (sort.key === "created_at" || sort.key === "last_sign_in_at") {
          const aTime = a[sort.key] ? new Date(a[sort.key]!).getTime() : 0;
          const bTime = b[sort.key] ? new Date(b[sort.key]!).getTime() : 0;
          comparison = aTime - bTime;
        } else {
          comparison = (a[sort.key] ?? "").localeCompare(b[sort.key] ?? "", "el", {
            sensitivity: "base",
            numeric: true,
          });
        }
        if (comparison !== 0) return comparison * multiplier;
      }
      return 0;
    });
  }, [sorts, users]);

  function toggleSort(key: SortKey) {
    setSorts((current) => {
      const index = current.findIndex((rule) => rule.key === key);
      if (index >= 0) {
        if (current[index].direction === "asc") {
          return current.map((rule, ruleIndex) =>
            ruleIndex === index ? { ...rule, direction: "desc" } : rule,
          );
        }
        return current.filter((_, ruleIndex) => ruleIndex !== index);
      }
      if (current.length >= 3) {
        toast.info(tr("You can use up to three sorting levels", "Μπορείτε να χρησιμοποιήσετε έως τρία επίπεδα ταξινόμησης"));
        return current;
      }
      return [...current, { key, direction: "asc" }];
    });
  }

  function beginColumnResize(key: ColumnKey, event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[key];
    const handleMove = (moveEvent: PointerEvent) => {
      setColumnWidths((current) => ({
        ...current,
        [key]: Math.max(70, startWidth + moveEvent.clientX - startX),
      }));
    };
    const handleUp = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  }

  function autoFitColumn(key: ColumnKey, target: HTMLSpanElement) {
    const table = target.closest("table");
    if (!table) return;
    const cells = table.querySelectorAll<HTMLElement>(`[data-user-column="${key}"]`);
    let requiredWidth = 70;
    cells.forEach((cell) => {
      requiredWidth = Math.max(requiredWidth, cell.scrollWidth + 20);
    });
    setColumnWidths((current) => ({
      ...current,
      [key]: Math.min(requiredWidth, 640),
    }));
  }

  function sortIcon(key: SortKey) {
    const index = sorts.findIndex((rule) => rule.key === key);
    if (index < 0) return <ArrowUpDown className="h-3.5 w-3.5 opacity-45" />;
    const rule = sorts[index];
    return (
      <span className="flex items-center gap-0.5 text-primary">
        {rule.direction === "asc"
          ? <ArrowUp className="h-3.5 w-3.5" />
          : <ArrowDown className="h-3.5 w-3.5" />}
        <span className="text-[10px] font-bold leading-none">{index + 1}</span>
      </span>
    );
  }

  useEffect(() => {
    if (!isAdmin) router.navigate({ to: "/" });
  }, [isAdmin, router]);

  async function load() {
    setLoading(true);
    const [{ data: profiles }, { data: roleRows }, fnRes] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, is_active"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.functions.invoke("admin-list-auth-users", { body: {} }),
    ]);
    const roleMap = new Map<string, AppRole>();
    roleRows?.forEach((r) => roleMap.set(r.user_id, r.role as AppRole));
    const authMap = new Map<string, { created_at: string | null; last_sign_in_at: string | null; email: string | null }>();
    const authUsers =
      (fnRes.data as { users?: Array<{ id: string; email: string | null; created_at: string | null; last_sign_in_at: string | null }> } | null)
        ?.users ?? [];
    authUsers.forEach((a) => authMap.set(a.id, { created_at: a.created_at, last_sign_in_at: a.last_sign_in_at, email: a.email }));
    const registered = (profiles ?? []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email ?? authMap.get(p.id)?.email ?? null,
        role: roleMap.get(p.id) ?? null,
        is_active: (p as { is_active?: boolean }).is_active ?? true,
        created_at: authMap.get(p.id)?.created_at ?? null,
        last_sign_in_at: authMap.get(p.id)?.last_sign_in_at ?? null,
      }));
    const registeredNames = new Set(
      registered.map((profile) => profile.full_name?.trim().toLocaleLowerCase()).filter(Boolean),
    );
    const directoryOnly: Row[] = DIRECTORY_USERS
      .filter((fullName) => !registeredNames.has(fullName.toLocaleLowerCase()))
      .map((fullName) => ({
        id: directoryUserId(fullName),
        full_name: fullName,
        email: null,
        role: "user",
        is_active: false,
        created_at: null,
        last_sign_in_at: null,
        is_directory_only: true,
      }));
    setUsers([...registered, ...directoryOnly]);
    setLoading(false);
  }

  async function handleRenameUser(u: Row) {
    if (!isMainAdmin) {
      toast.error(tr(
        "Only the Main Admin can rename users",
        "Μόνο ο Main Admin μπορεί να μετονομάζει χρήστες",
      ));
      return;
    }
    const nextName = window.prompt(
      tr("Enter the user's new name", "Πληκτρολογήστε το νέο όνομα του χρήστη"),
      u.full_name ?? "",
    )?.trim();
    if (!nextName || nextName === u.full_name) return;

    setNameBusyId(u.id);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: nextName })
      .eq("id", u.id);
    setNameBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setUsers((current) => current.map((row) => (
      row.id === u.id ? { ...row, full_name: nextName } : row
    )));
    toast.success(tr("User renamed", "Ο χρήστης μετονομάστηκε"));
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: { email, full_name: fullName, password, role },
    });
    setSubmitting(false);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? tr("Creation failed", "Σφάλμα δημιουργίας"));
      return;
    }
    toast.success(`Δημιουργήθηκε ο χρήστης ${email}`);
    setEmail("");
    setFullName("");
    setPassword("");
    setRole("user");
    setShowCreateUser(false);
    void load();
  }

  async function handleToggleActive(u: Row) {
    if (u.id === currentUser?.id) {
      toast.error(tr("You cannot deactivate yourself", "Δεν μπορείτε να απενεργοποιήσετε τον εαυτό σας"));
      return;
    }
    if (!isMainAdmin && u.role !== "user") {
      toast.error(tr("Administrators can change the status of ordinary users only", "Οι Administrators μπορούν να αλλάζουν την κατάσταση μόνο απλών χρηστών"));
      return;
    }
    const action = u.is_active ? tr("deactivate", "απενεργοποιήσετε") : tr("activate", "ενεργοποιήσετε");
    if (!window.confirm(tr(`Are you sure you want to ${action} ${u.full_name ?? u.email ?? ""}?`, `Είστε βέβαιοι ότι θέλετε να ${action} τον χρήστη ${u.full_name ?? u.email ?? ""};`))) {
      return;
    }
    setActiveBusyId(u.id);
    const { data, error } = await supabase.functions.invoke("admin-set-user-active", {
      body: { user_id: u.id, is_active: !u.is_active },
    });
    setActiveBusyId(null);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? tr("Update failed", "Σφάλμα ενημέρωσης"));
      return;
    }
    toast.success(!u.is_active ? `Ο χρήστης ${u.email} ενεργοποιήθηκε` : `Ο χρήστης ${u.email} απενεργοποιήθηκε`);
    void load();
  }

  async function handleChangeRole(u: Row, newRole: AppRole) {
    if (u.role === newRole) return;
    if (u.role === "main_admin") {
      toast.error(tr(
        "The Main Admin role is permanent and cannot be changed",
        "Ο ρόλος του Main Admin είναι μόνιμος και δεν μπορεί να αλλάξει",
      ));
      return;
    }
    if (newRole === "main_admin") {
      toast.error(tr(
        "Victor Stavropoulos is the only Main Admin",
        "Ο Βίκτωρ Σταυρόπουλος είναι ο μοναδικός Main Admin",
      ));
      return;
    }
    if (u.id === currentUser?.id) {
      toast.error(tr("You cannot change your own role", "Δεν μπορείτε να αλλάξετε τον δικό σας ρόλο"));
      return;
    }
    setRoleBusyId(u.id);
    const { data, error } = await supabase.functions.invoke("admin-set-user-role", {
      body: { user_id: u.id, role: newRole },
    });
    setRoleBusyId(null);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? tr("Role change failed", "Σφάλμα αλλαγής ρόλου"));
      return;
    }
    toast.success(`Ο ρόλος του ${u.email} άλλαξε σε ${newRole}`);
    void load();
  }

  async function handleResetPassword(u: Row) {
    const pw = window.prompt(`Νέος κωδικός για ${u.email} (τουλάχιστον 8 χαρακτήρες):`);
    if (!pw || pw.length < 8) {
      if (pw !== null) toast.error(tr("The password must contain at least 8 characters", "Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες"));
      return;
    }
    setPwBusyId(u.id);
    const { data, error } = await supabase.functions.invoke("admin-update-password", {
      body: { user_id: u.id, password: pw },
    });
    setPwBusyId(null);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? tr("Password change failed", "Σφάλμα αλλαγής κωδικού"));
      return;
    }
    toast.success(`Ο κωδικός του ${u.email} ενημερώθηκε`);
  }

  if (!isAdmin) return null;

  const availableRolesForCreate: AppRole[] = ["admin", "user"];

  return (
    <div className="w-full max-w-none space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{tr("Users", "Χρήστες")}</h1>
          <p className="text-sm text-muted-foreground">
            {tr("Create and manage application users.", "Δημιουργία και διαχείριση χρηστών της εφαρμογής.")}
          </p>
        </div>
        {!showCreateUser && (
          <Button type="button" className="shrink-0" onClick={() => setShowCreateUser(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            {tr("Create user", "Δημιουργία χρήστη")}
          </Button>
        )}
      </div>

      {showCreateUser && (
        <Card className="p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            {tr("New user", "Νέος χρήστης")}
          </h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="u-name">{tr("Full name", "Ονοματεπώνυμο")}</Label>
            <Input id="u-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-email">Email</Label>
            <Input
              id="u-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-pass">{tr("Temporary password", "Προσωρινός κωδικός")}</Label>
            <Input
              id="u-pass"
              type="text"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{tr("Role", "Ρόλος")}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableRolesForCreate.includes("main_admin") && (
                  <SelectItem value="main_admin">Main Admin</SelectItem>
                )}
                {availableRolesForCreate.includes("admin") && (
                  <SelectItem value="admin">Admin</SelectItem>
                )}
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {tr("Create user", "Δημιουργία χρήστη")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => setShowCreateUser(false)}
            >
              {tr("Cancel", "Ακύρωση")}
            </Button>
          </div>
          </form>
        </Card>
      )}

      <Card className="w-full overflow-hidden">
        <Table className="w-full table-fixed">
          <colgroup>
            {(Object.keys(defaultColumnWidths) as ColumnKey[]).map((key) => (
              <col key={key} style={{ width: columnWidths[key] }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              {([
                ["full_name", tr("Name", "Όνομα")],
                ["email", "Email"],
                ["role", tr("Role", "Ρόλος")],
                ["created_at", tr("Created", "Δημιουργήθηκε")],
                ["last_sign_in_at", tr("Last login", "Τελευταίο login")],
                ["is_active", tr("Status", "Κατάσταση")],
              ] as Array<[SortKey, string]>).map(([key, label]) => (
                <TableHead key={key} data-user-column={key} className="relative select-none pr-4">
                  <button
                    type="button"
                    className="flex h-full w-full items-center gap-1.5 text-left hover:text-foreground"
                    onClick={() => toggleSort(key)}
                  >
                    <span className="truncate">{label}</span>
                    {sortIcon(key)}
                  </button>
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Αλλαγή πλάτους στήλης ${label}`}
                    className="absolute inset-y-1 -right-1 z-10 w-2 cursor-col-resize touch-none border-r border-border/70 hover:border-primary"
                    onPointerDown={(event) => beginColumnResize(key, event)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      autoFitColumn(key, event.currentTarget);
                    }}
                  />
                </TableHead>
              ))}
              <TableHead data-user-column="actions" className="relative select-none pr-4 text-right">
                {tr("Actions", "Ενέργειες")}
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={tr("Resize Actions column", "Αλλαγή πλάτους στήλης Ενέργειες")}
                  className="absolute inset-y-1 -right-1 z-10 w-2 cursor-col-resize touch-none border-r border-border/70 hover:border-primary"
                  onPointerDown={(event) => beginColumnResize("actions", event)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    autoFitColumn("actions", event.currentTarget);
                  }}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin inline" />
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {tr("No users", "Κανείς χρήστης")}
                </TableCell>
              </TableRow>
            ) : (
              sortedUsers.map((u) => (
                <TableRow key={u.id}>
                  <TableCell data-user-column="full_name">{u.full_name ?? "—"}</TableCell>
                  <TableCell data-user-column="email">{u.email ?? "—"}</TableCell>
                  <TableCell data-user-column="role">
                    {u.is_directory_only ? (
                      <span className="text-sm text-muted-foreground">{tr("User · pending registration", "Χρήστης · εκκρεμεί εγγραφή")}</span>
                    ) : u.id === currentUser?.id || u.role === "main_admin" ? (
                      <span className="capitalize text-sm text-muted-foreground">
                        {u.role ?? "—"}
                      </span>
                    ) : (
                      <Select
                        value={u.role ?? undefined}
                        disabled={roleBusyId === u.id}
                        onValueChange={(v) => handleChangeRole(u, v as AppRole)}
                      >
                        <SelectTrigger className="h-8 w-[140px]">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell data-user-column="created_at" className="text-muted-foreground text-xs whitespace-nowrap">
                    {formatDT(u.created_at, language === "el" ? "el-GR" : "en-GB")}
                  </TableCell>
                  <TableCell data-user-column="last_sign_in_at" className="text-muted-foreground text-xs whitespace-nowrap">
                    {formatDT(u.last_sign_in_at, language === "el" ? "el-GR" : "en-GB")}
                  </TableCell>
                  <TableCell data-user-column="is_active">
                    {u.is_directory_only ? (
                      <Badge variant="secondary">{tr("Pending", "Σε αναμονή")}</Badge>
                    ) : activeBusyId === u.id ? (
                      <Badge variant="secondary" className="gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" /> {tr("Updating…", "Ενημέρωση…")}
                      </Badge>
                    ) : u.is_active ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                        {tr("Active", "Ενεργός")}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-red-100 text-red-800">
                        {tr("Inactive", "Ανενεργός")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell data-user-column="actions" className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {!u.is_directory_only && isMainAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={nameBusyId === u.id}
                          onClick={() => handleRenameUser(u)}
                        >
                          {nameBusyId === u.id
                            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            : <Pencil className="w-3.5 h-3.5 mr-1.5" />}
                          {tr("Rename", "Μετονομασία")}
                        </Button>
                      )}
                      {!u.is_directory_only && u.id !== currentUser?.id && (
                        <>
                        {isMainAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              await startImpersonation(u.id, u.full_name ?? u.email ?? "user");
                              toast.success(`Viewing as ${u.full_name ?? u.email}`);
                              router.navigate({ to: "/dashboard" });
                            }}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1.5" /> View as
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pwBusyId === u.id}
                          onClick={() => handleResetPassword(u)}
                        >
                          {pwBusyId === u.id ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                          )}
                          {tr("Password", "Κωδικός")}
                        </Button>
                        <Button
                          size="sm"
                          variant={u.is_active ? "outline" : "default"}
                          disabled={activeBusyId === u.id || (!isMainAdmin && u.role !== "user")}
                          title={!isMainAdmin && u.role !== "user" ? tr("Only the Main Admin can change an Administrator's status", "Μόνο ο Main Admin μπορεί να αλλάξει την κατάσταση Administrator") : undefined}
                          onClick={() => handleToggleActive(u)}
                        >
                          {activeBusyId === u.id ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          ) : u.is_active ? (
                            <UserX className="w-3.5 h-3.5 mr-1.5" />
                          ) : (
                            <UserCheck className="w-3.5 h-3.5 mr-1.5" />
                          )}
                          {u.is_active ? tr("Deactivate", "Απενεργοποίηση") : tr("Activate", "Ενεργοποίηση")}
                        </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

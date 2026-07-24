import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Boxes, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/language";
import { sharedSpaceKey } from "@/lib/space-key";
import { listSpaces, syncPersonalSpaces, updateSpace } from "@/lib/spaces.functions";
import { SpaceDialog } from "@/components/space-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/spaces")({
  component: SpacesAdminPage,
  head: () => ({
    meta: [
      { title: "Spaces — Smart Homes Task Manager" },
      { name: "description", content: "Create and rename spaces." },
    ],
  }),
});

function SpacesAdminPage() {
  const { isAdmin, isMainAdmin } = useAuth();
  const { tr } = useLanguage();
  const router = useRouter();
  const qc = useQueryClient();
  const fetchSpaces = useServerFn(listSpaces);
  const syncExistingPersonalSpaces = useServerFn(syncPersonalSpaces);
  const renameSpace = useServerFn(updateSpace);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; key: string; type: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState("");

  useEffect(() => {
    if (!isAdmin) router.navigate({ to: "/dashboard" });
  }, [isAdmin, router]);

  const { data: spaces = [], isLoading } = useQuery({
    queryKey: ["spaces"],
    queryFn: () => fetchSpaces({ data: {} }),
    enabled: isAdmin,
  });
  useQuery({
    queryKey: ["sync-personal-spaces", "shared-three-letter-keys-v4"],
    queryFn: async () => {
      const result = await syncExistingPersonalSpaces();
      if (result.changed > 0) {
        await qc.invalidateQueries({ queryKey: ["spaces"] });
      }
      return result;
    },
    enabled: isMainAdmin,
    staleTime: Infinity,
  });

  const renameMutation = useMutation({
    mutationFn: () => renameSpace({
      data: { id: renameTarget!.id, name: newName.trim(), key: newKey.trim() },
    }),
    onSuccess: () => {
      toast.success(tr("Space name and key updated", "Το όνομα και ο κωδικός του χώρου ενημερώθηκαν"));
      qc.invalidateQueries({ queryKey: ["spaces"] });
      qc.invalidateQueries({ queryKey: ["space-detail"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task"] });
      setRenameTarget(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!isAdmin) return null;

  const openRename = (space: { id: string; name: string; key: string; type: string }) => {
    setRenameTarget(space);
    setNewName(space.name);
    setNewKey(space.key);
  };
  const normalizedNewKey = newKey.trim().toUpperCase();
  const keyIsValid = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*\*?$/.test(normalizedNewKey);
  const renameHasChanges = newName.trim() !== renameTarget?.name
    || normalizedNewKey !== renameTarget?.key;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Boxes className="h-6 w-6" />
            {tr("Spaces", "Χώροι")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tr(
              "Create new spaces or rename existing ones.",
              "Δημιουργήστε νέους χώρους ή μετονομάστε τους υπάρχοντες.",
            )}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {tr("Create space", "Δημιουργία χώρου")}
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("Name", "Όνομα")}</TableHead>
              <TableHead>{tr("Key", "Κωδικός")}</TableHead>
              <TableHead>{tr("Type", "Τύπος")}</TableHead>
              <TableHead className="w-36 text-right">{tr("Actions", "Ενέργειες")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                  {tr("Loading…", "Φόρτωση…")}
                </TableCell>
              </TableRow>
            ) : spaces.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                  {tr("No spaces found.", "Δεν βρέθηκαν χώροι.")}
                </TableCell>
              </TableRow>
            ) : spaces.map((space, index) => {
              const isFirstPersonalSpace = space.type === "personal"
                && (index === 0 || spaces[index - 1]?.type !== "personal");
              return (
              <TableRow
                key={space.id}
                className={isFirstPersonalSpace ? "border-t-4 border-t-slate-400" : undefined}
              >
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: space.color ?? "#888" }}
                    />
                    {space.name}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{space.key}</TableCell>
                <TableCell>
                  {space.type === "personal"
                    ? tr("Personal", "Προσωπικός")
                    : tr("Shared", "Κοινόχρηστος")}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => openRename(space)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    {tr("Rename", "Μετονομασία")}
                  </Button>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <SpaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode={{ kind: "create" }}
      />

      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("Rename space", "Μετονομασία χώρου")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="space-name">{tr("New name", "Νέο όνομα")}</Label>
              <Input
                id="space-name"
                value={newName}
                onChange={(event) => {
                  const value = event.target.value;
                  setNewName(value);
                  if (renameTarget?.type === "shared") setNewKey(sharedSpaceKey(value));
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="space-key">{tr("New key", "Νέος κωδικός")}</Label>
              <Input
                id="space-key"
                value={newKey}
                onChange={(event) => setNewKey(event.target.value.toUpperCase())}
                disabled={renameTarget?.type === "shared"}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter"
                    && newName.trim()
                    && keyIsValid
                    && renameHasChanges
                  ) renameMutation.mutate();
                }}
                className="font-mono uppercase"
              />
              <p className="text-xs text-muted-foreground">
                {tr(
                  "Changing the key also updates the key of every task in this space.",
                  "Η αλλαγή του κωδικού ενημερώνει και τον κωδικό κάθε task αυτού του χώρου.",
                )}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {tr("Cancel", "Ακύρωση")}
            </Button>
            <Button
              onClick={() => renameMutation.mutate()}
              disabled={
                !newName.trim()
                || !keyIsValid
                || !renameHasChanges
                || renameMutation.isPending
              }
            >
              {renameMutation.isPending
                ? tr("Saving…", "Αποθήκευση…")
                : tr("Save", "Αποθήκευση")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  createSpace, updateSpace, deleteSpace, getSpaceDetail, listProfiles,
} from "@/lib/spaces.functions";
import { useLanguage } from "@/lib/language";
import { sharedSpaceKey } from "@/lib/space-key";

const PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
  "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#78716c",
];

type Mode = { kind: "create" } | { kind: "edit"; spaceId: string };

export function SpaceDialog({
  open, onOpenChange, mode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: Mode;
}) {
  const qc = useQueryClient();
  const { tr } = useLanguage();
  const fetchProfiles = useServerFn(listProfiles);
  const fetchDetail = useServerFn(getSpaceDetail);
  const doCreate = useServerFn(createSpace);
  const doUpdate = useServerFn(updateSpace);
  const doDelete = useServerFn(deleteSpace);

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => fetchProfiles(),
    enabled: open,
  });

  const { data: detail } = useQuery({
    queryKey: ["space-detail", mode.kind === "edit" ? mode.spaceId : null],
    queryFn: () => fetchDetail({ data: { id: (mode as { spaceId: string }).spaceId } }),
    enabled: open && mode.kind === "edit",
  });

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PALETTE[10]);
  const [type, setType] = useState<"shared" | "personal">("shared");
  const [ownerId, setOwnerId] = useState<string>("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    if (mode.kind === "create") {
      setKey(""); setName(""); setColor(PALETTE[10]); setType("shared");
      setOwnerId(""); setMemberIds(new Set());
    } else if (detail?.space) {
      setKey(detail.space.key);
      setName(detail.space.name);
      setColor(detail.space.color ?? PALETTE[10]);
      setType(detail.space.type as "shared" | "personal");
      setOwnerId(detail.space.owner_id ?? "");
      setMemberIds(new Set(detail.memberIds));
    }
  }, [open, mode, detail]);

  const toggleMember = (id: string) => {
    setMemberIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (mode.kind === "create") {
        return doCreate({ data: {
          key: type === "shared" ? sharedSpaceKey(name) : key, name, color, type,
          owner_id: type === "personal" ? (ownerId || null) : null,
          member_ids: Array.from(memberIds),
        }});
      }
      return doUpdate({ data: {
        id: mode.spaceId,
        name, color, key: type === "shared" ? sharedSpaceKey(name) : undefined,
        owner_id: type === "personal" ? (ownerId || null) : null,
        member_ids: Array.from(memberIds),
      }});
    },
    onSuccess: () => {
      toast.success(mode.kind === "create" ? tr("Space created", "Ο χώρος δημιουργήθηκε") : tr("Space updated", "Ο χώρος ενημερώθηκε"));
      qc.invalidateQueries({ queryKey: ["spaces"] });
      qc.invalidateQueries({ queryKey: ["space-detail"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => doDelete({ data: { id: (mode as { spaceId: string }).spaceId } }),
    onSuccess: () => {
      toast.success(tr("Space deleted", "Ο χώρος διαγράφηκε"));
      qc.invalidateQueries({ queryKey: ["spaces"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode.kind === "create" ? tr("New Space", "Νέος χώρος") : tr("Space Properties", "Ιδιότητες χώρου")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <Label>{tr("Key", "Κωδικός")}</Label>
              <Input
                value={type === "shared" ? sharedSpaceKey(name) : key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                disabled={type === "shared" || mode.kind === "edit"}
                placeholder="ABC"
              />
            </div>
            <div className="col-span-2">
              <Label>{tr("Name", "Όνομα")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Space name", "Όνομα χώρου")} />
            </div>
          </div>

          <div>
            <Label>{tr("Type", "Τύπος")}</Label>
            <Select
              value={type}
              onValueChange={(v: "shared" | "personal") => setType(v)}
              disabled={mode.kind === "edit"}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="shared">{tr("Shared", "Κοινόχρηστος")}</SelectItem>
                <SelectItem value="personal">{tr("Personal", "Προσωπικός")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === "personal" && (
            <div>
              <Label>{tr("Owner", "Ιδιοκτήτης")}</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue placeholder={tr("Select owner", "Επιλογή ιδιοκτήτη")} /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>{tr("Color", "Χρώμα")}</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {PALETTE.map((c) => (
                <button
                  key={c} type="button" onClick={() => setColor(c)}
                  className="h-6 w-6 rounded border-2"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? "hsl(var(--foreground))" : "transparent",
                  }}
                />
              ))}
            </div>
          </div>

          <div>
            <Label>{tr("Members", "Μέλη")}</Label>
            <div className="mt-2 max-h-52 overflow-y-auto border rounded p-2 space-y-1">
              {profiles.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={memberIds.has(p.id)}
                    onCheckedChange={() => toggleMember(p.id)}
                  />
                  <span>{p.full_name ?? p.email}</span>
                  {!p.is_active && <span className="text-xs text-muted-foreground">({tr("inactive", "ανενεργός")})</span>}
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {mode.kind === "edit" && (
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm(tr("Delete this space? Existing tasks will be kept.", "Να διαγραφεί αυτός ο χώρος; Οι υπάρχουσες εργασίες θα διατηρηθούν."))) deleteMut.mutate();
              }}
              disabled={deleteMut.isPending}
              className="mr-auto"
            >
              {tr("Delete", "Διαγραφή")}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tr("Cancel", "Ακύρωση")}</Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !name.trim() || (mode.kind === "create" && type === "personal" && !key.trim())}
          >
            {saveMut.isPending ? tr("Saving…", "Αποθήκευση…") : tr("Save", "Αποθήκευση")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

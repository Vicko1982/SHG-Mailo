import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  getTask, updateTaskFields, getTaskActivity, getTaskAccess, createSubtask, listTaskLabels,
} from "@/lib/tasks.functions";
import { listComments, addComment } from "@/lib/comments.functions";
import { listProfiles, listSpaces } from "@/lib/spaces.functions";
import { ALL_PRIORITIES, ALL_STATUSES, initials } from "@/lib/task-ui";
import { useAuth } from "@/lib/auth-context";
import { useImpersonation } from "@/lib/impersonation";
import { useLanguage } from "@/lib/language";

type Draft = {
  title: string;
  description: string;
  status: string;
  assigneeId: string;
  spaceId: string;
  priority: string;
  labelsText: string;
};

const EMPTY_DRAFT: Draft = {
  title: "", description: "", status: "backlog", assigneeId: "",
  spaceId: "", priority: "", labelsText: "",
};

export function TaskSidePanel({
  taskKey,
  onClose,
}: {
  taskKey: string | null;
  onClose: () => void;
}) {
  const open = !!taskKey;
  const qc = useQueryClient();
  const { user, isAdmin } = useAuth();
  const { isImpersonating } = useImpersonation();
  const { language, tr } = useLanguage();
  const fetchTask = useServerFn(getTask);
  const fetchComments = useServerFn(listComments);
  const fetchProfiles = useServerFn(listProfiles);
  const fetchSpaces = useServerFn(listSpaces);
  const fetchActivity = useServerFn(getTaskActivity);
  const fetchAccess = useServerFn(getTaskAccess);
  const fetchLabels = useServerFn(listTaskLabels);
  const saveTask = useServerFn(updateTaskFields);
  const postComment = useServerFn(addComment);
  const addSubtask = useServerFn(createSubtask);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [initialDraft, setInitialDraft] = useState<Draft>(EMPTY_DRAFT);
  const [newComment, setNewComment] = useState("");

  const { data: task, isLoading } = useQuery({
    queryKey: ["task", taskKey],
    queryFn: () => fetchTask({ data: { taskKey: taskKey! } }),
    enabled: open,
  });
  const { data: comments = [] } = useQuery({
    queryKey: ["comments", task?.id],
    queryFn: () => fetchComments({ data: { taskId: task!.id } }),
    enabled: !!task?.id,
  });
  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => fetchProfiles(),
    enabled: open,
  });
  const { data: spaces = [] } = useQuery({
    queryKey: ["spaces"],
    queryFn: () => fetchSpaces({ data: {} }),
    enabled: open,
  });
  const { data: activity = [] } = useQuery({
    queryKey: ["task-activity", task?.id],
    queryFn: () => fetchActivity({ data: { taskId: task!.id } }),
    enabled: !!task?.id,
  });
  const { data: accessUsers = [] } = useQuery({
    queryKey: ["task-access", task?.id],
    queryFn: () => fetchAccess({ data: { taskId: task!.id } }),
    enabled: !!task?.id,
  });
  const { data: availableLabels = [] } = useQuery({
    queryKey: ["task-labels"],
    queryFn: () => fetchLabels(),
    enabled: open,
  });

  useEffect(() => {
    if (!task) return;
    const next: Draft = {
      title: task.title ?? "",
      description: task.description ?? "",
      status: task.status ?? "backlog",
      assigneeId: task.assignee?.id ?? "",
      spaceId: task.space?.id ?? "",
      priority: task.priority ?? "",
      labelsText: (task.labels ?? []).join(", "),
    };
    setDraft(next);
    setInitialDraft(next);
  }, [task]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialDraft),
    [draft, initialDraft],
  );
  const canEdit = !!task && !isImpersonating
    && (isAdmin || task.supervisor?.id === user?.id);
  const canMoveFromOwnPersonalSpace = !!task && !isImpersonating
    && !canEdit
    && task.space?.type === "personal"
    && task.space?.owner_id === user?.id;

  const saveMutation = useMutation({
    mutationFn: () => saveTask({
      data: canMoveFromOwnPersonalSpace ? {
        taskId: task!.id,
        space_id: draft.spaceId,
      } : {
        taskId: task!.id,
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        status: draft.status,
        assignee_id: draft.assigneeId || null,
        space_id: draft.spaceId,
        priority: draft.priority || null,
        labels: draft.labelsText.split(",").map((label) => label.trim()).filter(Boolean),
      },
    }),
    onSuccess: () => {
      toast.success(tr("Task updated", "Η εργασία ενημερώθηκε"));
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task", taskKey] });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const commentMutation = useMutation({
    mutationFn: () => postComment({ data: { taskId: task!.id, content: newComment } }),
    onSuccess: () => {
      setNewComment("");
      qc.invalidateQueries({ queryKey: ["comments", task?.id] });
      qc.invalidateQueries({ queryKey: ["task-activity", task?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const subtaskMutation = useMutation({
    mutationFn: (title: string) => addSubtask({ data: { parentTaskId: task!.id, title } }),
    onSuccess: () => {
      toast.success(tr("Subtask created", "Η υποεργασία δημιουργήθηκε"));
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const requestClose = () => {
    if (dirty) {
      const discard = window.confirm(tr(
        "You have unsaved changes. Press OK to discard them, or Cancel to stay and press Submit.",
        "Υπάρχουν μη αποθηκευμένες αλλαγές. Πατήστε OK για να τις απορρίψετε ή Ακύρωση για να παραμείνετε και να πατήσετε Submit.",
      ));
      if (!discard) return;
    }
    onClose();
  };

  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const statusLabel = (status: string) => ({
    backlog: tr("Backlog", "Εκκρεμότητες"),
    todo: tr("To Do", "Προς εκτέλεση"),
    progress: tr("In Progress", "Σε εξέλιξη"),
    pause: tr("Paused", "Σε παύση"),
    blocked: tr("Blocked", "Μπλοκαρισμένο"),
    review: tr("Review", "Έλεγχος"),
    done: tr("Done", "Ολοκληρωμένο"),
    cancelled: tr("Cancelled", "Ακυρωμένο"),
  } as Record<string, string>)[status] ?? status;

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && requestClose()}>
      <SheetContent className="w-full sm:max-w-4xl p-0 flex flex-col overflow-hidden">
        {isLoading || !task ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <SheetHeader className="px-6 pt-6 pb-4 border-b">
                <div className="text-xs font-medium text-muted-foreground">
                  {task.space?.key} / {task.task_key}
                </div>
                {canEdit ? (
                  <Input
                    value={draft.title}
                    onChange={(event) => change("title", event.target.value)}
                    className="h-10 px-2 text-xl font-semibold"
                  />
                ) : (
                  <SheetTitle className="text-left text-xl">{task.title}</SheetTitle>
                )}
                <p className="text-sm text-muted-foreground text-left">
                  {tr("Task details", "Λεπτομέρειες εργασίας")}
                </p>
              </SheetHeader>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label={tr("Status", "Κατάσταση")}>
                    <Select value={draft.status} onValueChange={(value) => change("status", value)} disabled={!canEdit}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ALL_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>{statusLabel(status)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label={tr("Assignee", "Υπεύθυνος")}>
                    <Select
                      value={draft.assigneeId || "__none__"}
                      onValueChange={(value) => change("assigneeId", value === "__none__" ? "" : value)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{tr("Unassigned", "Χωρίς ανάθεση")}</SelectItem>
                        {profiles.filter((profile) => profile.is_active !== false).map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>{profile.full_name ?? profile.email}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label={tr("Space", "Χώρος")}>
                    <Select
                      value={draft.spaceId}
                      onValueChange={(value) => change("spaceId", value)}
                      disabled={!canEdit && !canMoveFromOwnPersonalSpace}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {spaces.map((space) => (
                          <SelectItem key={space.id} value={space.id}>{space.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label={tr("Priority", "Προτεραιότητα")}>
                    <Select
                      value={draft.priority || "__none__"}
                      onValueChange={(value) => change("priority", value === "__none__" ? "" : value)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{tr("None", "Καμία")}</SelectItem>
                        {ALL_PRIORITIES.map((priority) => (
                          <SelectItem key={priority} value={priority}>{priority}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field label={tr("Labels", "Ετικέτες")}>
                  <LabelPicker
                    selected={draft.labelsText.split(",").map((label) => label.trim()).filter(Boolean)}
                    options={availableLabels}
                    onChange={(labels) => change("labelsText", labels.join(", "))}
                    disabled={!canEdit}
                    tr={tr}
                  />
                </Field>

                <Field label={tr("Description", "Περιγραφή")}>
                  <Textarea
                    value={draft.description}
                    onChange={(event) => change("description", event.target.value)}
                    rows={6}
                    disabled={!canEdit}
                  />
                </Field>

                <section className="space-y-3 border-t pt-5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide">
                      {tr("Comments", "Σχόλια")}
                    </h3>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs">{comments.length}</span>
                  </div>
                  {!isImpersonating && (
                    <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                      <Textarea
                        value={newComment}
                        onChange={(event) => setNewComment(event.target.value)}
                        placeholder={tr("Write a comment… Use @ to mention a user", "Γράψτε ένα σχόλιο… Χρησιμοποιήστε @ για αναφορά χρήστη")}
                        rows={3}
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          onClick={() => commentMutation.mutate()}
                          disabled={!newComment.trim() || commentMutation.isPending}
                        >
                          {tr("Post comment", "Δημοσίευση σχολίου")}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    {comments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{tr("No comments yet.", "Δεν υπάρχουν ακόμη σχόλια.")}</p>
                    ) : comments.map((comment) => (
                      <div key={comment.id} className="rounded-lg border p-3 flex gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">{initials(comment.author?.full_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                            <strong className="text-foreground">{comment.author?.full_name ?? tr("Unknown", "Άγνωστος")}</strong>
                            <span>{new Date(comment.created_at).toLocaleString(language === "el" ? "el-GR" : "en-GB")}</span>
                          </div>
                          <p className="mt-2 text-sm whitespace-pre-wrap break-words">{comment.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <details className="group border-t pt-4">
                  <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    {tr("Activity History", "Ιστορικό δραστηριότητας")}
                    <span className="text-xs text-muted-foreground">({activity.length})</span>
                  </summary>
                  <div className="mt-3 space-y-2">
                    {activity.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{tr("No activity yet.", "Δεν υπάρχει ακόμη δραστηριότητα.")}</p>
                    ) : activity.map((entry) => (
                      <div key={entry.id} className="rounded border p-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span><strong>{entry.user?.full_name ?? "System"}</strong> · {entry.action.replaceAll("_", " ")}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(entry.created_at).toLocaleString(language === "el" ? "el-GR" : "en-GB")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>

                <details className="group border-t pt-4 pb-4">
                  <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    {tr("Task Access", "Πρόσβαση εργασίας")}
                    <span className="text-xs text-muted-foreground">({accessUsers.length})</span>
                  </summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {accessUsers.map((accessUser) => (
                      <div key={accessUser.id} className="flex items-center gap-2 rounded border p-2">
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="text-xs">{initials(accessUser.full_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{accessUser.full_name ?? accessUser.email}</div>
                          <div className="text-xs text-muted-foreground">{accessUser.reason}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </div>

            <footer className="shrink-0 border-t bg-background p-4 flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  const title = window.prompt(tr("Subtask title:", "Τίτλος υποεργασίας:"));
                  if (title?.trim()) subtaskMutation.mutate(title.trim());
                }}
                disabled={subtaskMutation.isPending}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                {tr("Create subtask", "Δημιουργία υποεργασίας")}
              </Button>
              <div className="flex-1" />
              <Button variant="outline" onClick={requestClose}>
                {tr("Cancel", "Ακύρωση")}
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={
                  (!canEdit && !canMoveFromOwnPersonalSpace)
                  || !dirty
                  || !draft.title.trim()
                  || saveMutation.isPending
                }
              >
                {saveMutation.isPending ? tr("Saving…", "Αποθήκευση…") : tr("Submit", "Υποβολή")}
              </Button>
            </footer>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3 space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function LabelPicker({
  selected,
  options,
  onChange,
  disabled,
  tr,
}: {
  selected: string[];
  options: string[];
  onChange: (labels: string[]) => void;
  disabled: boolean;
  tr: (english: string, greek: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const selectedKeys = new Set(selected.map((label) => label.toLocaleLowerCase()));
  const matching = options
    .filter((label) => !selectedKeys.has(label.toLocaleLowerCase()))
    .filter((label) => !search.trim() || label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => {
      const query = search.trim().toLocaleLowerCase();
      const aExact = a.toLocaleLowerCase() === query;
      const bExact = b.toLocaleLowerCase() === query;
      if (aExact !== bExact) return aExact ? -1 : 1;
      const aStarts = a.toLocaleLowerCase().startsWith(query);
      const bStarts = b.toLocaleLowerCase().startsWith(query);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.localeCompare(b);
    });

  const addLabel = (label: string) => {
    const clean = label.trim();
    if (!clean) return;
    const existing = options.find(
      (option) => option.toLocaleLowerCase() === clean.toLocaleLowerCase(),
    );
    const value = existing ?? clean;
    if (!selectedKeys.has(value.toLocaleLowerCase())) onChange([...selected, value]);
    setSearch("");
    setHighlighted(0);
  };

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) {
        setSearch("");
        setHighlighted(0);
      }
    }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="min-h-10 w-full rounded-md border bg-background px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selected.length === 0 ? (
            <span className="text-sm text-muted-foreground">{tr("No labels", "Χωρίς ετικέτες")}</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {selected.map((label) => (
                <span key={label} className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                  {label}
                  {!disabled && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onChange(selected.filter((item) => item !== label));
                      }}
                      className="rounded hover:bg-amber-200"
                    >
                      <X className="h-3 w-3" />
                    </span>
                  )}
                </span>
              ))}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setHighlighted(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlighted((current) => Math.min(current + 1, Math.max(0, matching.length - 1)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlighted((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (matching[highlighted]) addLabel(matching[highlighted]);
              else if (search.trim()) addLabel(search);
            }
          }}
          placeholder={tr("Search or create a label…", "Αναζήτηση ή δημιουργία ετικέτας…")}
          autoFocus
        />
        <div className="mt-2 max-h-56 overflow-y-auto">
          {matching.map((label, index) => (
            <button
              key={label}
              type="button"
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => addLabel(label)}
              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${
                index === highlighted ? "bg-accent" : "hover:bg-accent"
              }`}
            >
              <span>{label}</span>
              {index === highlighted && <Check className="h-4 w-4 text-primary" />}
            </button>
          ))}
          {matching.length === 0 && search.trim() && (
            <button
              type="button"
              onClick={() => addLabel(search)}
              className="w-full rounded px-2 py-2 text-left text-sm hover:bg-accent"
            >
              {tr("Create", "Δημιουργία")} “{search.trim()}”
            </button>
          )}
          {matching.length === 0 && !search.trim() && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {tr("No more labels available.", "Δεν υπάρχουν άλλες διαθέσιμες ετικέτες.")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

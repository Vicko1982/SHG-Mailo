import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search, ArrowUp, ArrowDown, ArrowUpDown, ListFilter, Bookmark, Star, X, GripVertical } from "lucide-react";
import { listTasks, setTaskPlacement, updateTaskFields, type TaskFilters, type TaskSortKey } from "@/lib/tasks.functions";
import { listProfiles } from "@/lib/spaces.functions";
import { listSavedFilters, saveFilter, deleteSavedFilter } from "@/lib/saved-filters.functions";
import {
  STATUS_META,
  ALL_STATUSES,
  PRIORITY_META,
  ALL_PRIORITIES,
  initials,
  avatarColor,
} from "@/lib/task-ui";
import { TaskSidePanel } from "@/components/task-side-panel";
import { useImpersonation } from "@/lib/impersonation";
import { toast } from "sonner";
import { useLanguage } from "@/lib/language";
import { useAuth } from "@/lib/auth-context";

type ColumnKey = TaskSortKey | "assignee" | "space" | "labels";
type Col = { key: ColumnKey; label: string; width: number };
type SortRule = { key: ColumnKey; direction: "asc" | "desc" };
type DropMode = "before" | "child" | "after";

const COLUMNS: Col[] = [
  { key: "task_key", label: "Key", width: 120 },
  { key: "title", label: "Work", width: 360 },
  { key: "space", label: "Space", width: 180 },
  { key: "status", label: "Status", width: 140 },
  { key: "labels", label: "Labels", width: 170 },
  { key: "assignee", label: "Assignee", width: 190 },
  { key: "priority", label: "Priority", width: 130 },
  { key: "due_date", label: "Due date", width: 140 },
  { key: "updated_at", label: "Updated", width: 140 },
];

export function TaskList({
  spaceKey,
  scope,
  title,
  spaceColor,
}: {
  spaceKey?: string;
  scope?: "all" | "mine" | "supervising";
  title: string;
  spaceColor?: string | null;
}) {
  const { tr } = useLanguage();
  const displayTitle = title === "All Tasks" ? tr("All Tasks", "Όλες οι εργασίες") : title === "My Tasks" ? tr("My Tasks", "Οι εργασίες μου") : title;
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>(
    ALL_STATUSES.filter((s) => s !== "done" && s !== "cancelled"),
  );
  const [priorities, setPriorities] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [sorts, setSorts] = useState<SortRule[]>([]);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColumnKey, string>>>({});
  const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(
    Object.fromEntries(COLUMNS.map((column) => [column.key, column.width])) as Record<ColumnKey, number>,
  );
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ taskId: string; mode: DropMode } | null>(null);
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [openTaskKey, setOpenTaskKey] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageSize = 50;

  const fetchTasks = useServerFn(listTasks);
  const fetchProfiles = useServerFn(listProfiles);
  const fetchSaved = useServerFn(listSavedFilters);
  const createSaved = useServerFn(saveFilter);
  const removeSaved = useServerFn(deleteSavedFilter);
  const editTask = useServerFn(updateTaskFields);
  const placeTask = useServerFn(setTaskPlacement);
  const qc = useQueryClient();
  const { isAdmin, user } = useAuth();
  const { impersonatedUserId, isImpersonating } = useImpersonation();
  const orderStorageKey = useMemo(
    () => `shg.taskOrder.${user?.id ?? "anonymous"}.${spaceKey ?? scope ?? "all"}`,
    [scope, spaceKey, user?.id],
  );

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(orderStorageKey) ?? "[]");
      setManualOrder(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []);
    } catch {
      setManualOrder([]);
    }
  }, [orderStorageKey]);

  const filters: TaskFilters = {
    spaceKey, scope, statuses, priorities, assigneeIds,
    search, page: 1, pageSize: 5000,
    sortBy: sorts[0] && !["assignee", "space", "labels"].includes(sorts[0].key)
      ? sorts[0].key as TaskSortKey
      : "updated_at",
    sortDir: sorts[0]?.direction ?? "desc",
    asUserId: impersonatedUserId ?? undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ["tasks", filters],
    queryFn: () => fetchTasks({ data: filters }),
  });
  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => fetchProfiles(),
  });
  const { data: savedFilters = [] } = useQuery({
    queryKey: ["saved-filters"],
    queryFn: () => fetchSaved(),
  });

  const saveMutation = useMutation({
    mutationFn: (name: string) => createSaved({ data: {
      name, filter_data: { statuses, priorities, assigneeIds, sorts, columnFilters, columnWidths, search },
    }}),
    onSuccess: () => { toast.success(tr("Filter saved", "Το φίλτρο αποθηκεύτηκε")); qc.invalidateQueries({ queryKey: ["saved-filters"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeSaved({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-filters"] }),
  });
  const editTitleMutation = useMutation({
    mutationFn: (data: { taskId: string; title: string }) =>
      editTask({ data: { taskId: data.taskId, title: data.title } }),
    onSuccess: () => {
      toast.success(tr("Task title updated", "Ο τίτλος της εργασίας ενημερώθηκε"));
      setEditingTaskId(null);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const placementMutation = useMutation({
    mutationFn: (data: { taskId: string; parentTaskId: string | null }) =>
      placeTask({ data }),
    onSuccess: () => {
      toast.success(tr("Task hierarchy updated", "Η ιεραρχία της εργασίας ενημερώθηκε"));
      setDraggedTaskId(null);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error: Error) => {
      setDraggedTaskId(null);
      toast.error(error.message);
    },
  });

  const clearClickTimer = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
  };

  const scheduleSingleClick = (task: { id: string; title: string }, allowEdit: boolean) => {
    clearClickTimer();
    clickTimer.current = setTimeout(() => {
      if (allowEdit && selectedTaskId === task.id && isAdmin && !isImpersonating) {
        setEditingTaskId(task.id);
        setEditingTitle(task.title);
      } else {
        setSelectedTaskId(task.id);
        setEditingTaskId(null);
      }
      clickTimer.current = null;
    }, 220);
  };

  const openDetails = (taskKey: string) => {
    clearClickTimer();
    setEditingTaskId(null);
    setOpenTaskKey(taskKey);
  };

  const saveInlineTitle = (taskId: string, originalTitle: string) => {
    const nextTitle = editingTitle.trim();
    if (!nextTitle || nextTitle === originalTitle) {
      setEditingTaskId(null);
      setEditingTitle("");
      return;
    }
    editTitleMutation.mutate({ taskId, title: nextTitle });
  };

  const applySaved = (fd: any) => {
    setStatuses(Array.isArray(fd.statuses) ? fd.statuses : []);
    setPriorities(Array.isArray(fd.priorities) ? fd.priorities : []);
    setAssigneeIds(Array.isArray(fd.assigneeIds) ? fd.assigneeIds : []);
    setSorts(Array.isArray(fd.sorts) ? fd.sorts.slice(0, 3) : []);
    setColumnFilters(fd.columnFilters && typeof fd.columnFilters === "object" ? fd.columnFilters : {});
    if (fd.columnWidths && typeof fd.columnWidths === "object") {
      setColumnWidths((current) => ({ ...current, ...fd.columnWidths }));
    }
    if (typeof fd.search === "string") setSearch(fd.search);
    setPage(1);
  };


  const rows = data?.rows ?? [];
  const displayedRows = useMemo(() => {
    const statusOrder = ["backlog", "todo", "progress", "pause", "blocked", "review", "done", "cancelled"];
    const priorityOrder = ["Highest", "High", "Medium", "Low", "Lowest"];
    const value = (task: any, key: ColumnKey): string => {
      if (key === "assignee") return task.assignee?.full_name ?? "";
      if (key === "space") return task.space?.name ?? "";
      if (key === "labels") return (task.labels ?? []).join(", ");
      return String(task[key] ?? "");
    };
    const filtered = rows.filter((task) =>
      COLUMNS.every((column) => {
        const query = columnFilters[column.key]?.trim().toLocaleLowerCase();
        return !query || value(task, column.key).toLocaleLowerCase().includes(query);
      })
    );
    const ordered = [...filtered];
    if (sorts.length > 0) {
      ordered.sort((a, b) => {
        for (const rule of sorts) {
          const direction = rule.direction === "asc" ? 1 : -1;
          let comparison: number;
          if (rule.key === "status") {
            comparison = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
          } else if (rule.key === "priority") {
            comparison = priorityOrder.indexOf(a.priority ?? "") - priorityOrder.indexOf(b.priority ?? "");
          } else {
            comparison = value(a, rule.key).localeCompare(value(b, rule.key), undefined, {
              sensitivity: "base",
              numeric: true,
            });
          }
          if (comparison !== 0) return comparison * direction;
        }
        return 0;
      });
    } else if (manualOrder.length > 0) {
      const rank = new Map(manualOrder.map((id, index) => [id, index]));
      ordered.sort((a, b) => {
        const aRank = rank.get(a.id);
        const bRank = rank.get(b.id);
        if (aRank === undefined && bRank === undefined) return 0;
        if (aRank === undefined) return 1;
        if (bRank === undefined) return -1;
        return aRank - bRank;
      });
    }

    const visibleIds = new Set(ordered.map((task) => task.id));
    const children = new Map<string, typeof ordered>();
    ordered.forEach((task) => {
      if (!task.parent_id || !visibleIds.has(task.parent_id)) return;
      const list = children.get(task.parent_id) ?? [];
      list.push(task);
      children.set(task.parent_id, list);
    });
    const grouped: typeof ordered = [];
    ordered.forEach((task) => {
      if (task.parent_id && visibleIds.has(task.parent_id)) return;
      grouped.push(task, ...(children.get(task.id) ?? []));
    });
    return grouped;
  }, [rows, columnFilters, sorts, manualOrder]);
  const total = displayedRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = displayedRows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const persistManualOrder = (order: string[]) => {
    setManualOrder(order);
    try {
      localStorage.setItem(orderStorageKey, JSON.stringify(order));
    } catch {
      // Keep the in-memory order if browser preference storage is unavailable.
    }
  };

  const reorderTask = (sourceId: string, targetId: string, mode: "before" | "after") => {
    const ids = displayedRows.map((task) => task.id).filter((id) => id !== sourceId);
    const targetIndex = ids.indexOf(targetId);
    if (targetIndex < 0) return;
    ids.splice(targetIndex + (mode === "after" ? 1 : 0), 0, sourceId);
    setSorts([]);
    persistManualOrder(ids);
    toast.success(tr("Task position updated", "Η θέση της εργασίας ενημερώθηκε"));
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (statuses.length !== ALL_STATUSES.filter((s) => s !== "done" && s !== "cancelled").length) n++;
    if (priorities.length) n++;
    if (assigneeIds.length) n++;
    return n;
  }, [statuses, priorities, assigneeIds]);

  const toggleSort = (key: ColumnKey) => {
    setSorts((current) => {
      const index = current.findIndex((rule) => rule.key === key);
      if (index >= 0) {
        if (current[index].direction === "asc") {
          return current.map((rule, ruleIndex) =>
            ruleIndex === index ? { ...rule, direction: "desc" } : rule
          );
        }
        return current.filter((_, ruleIndex) => ruleIndex !== index);
      }
      if (current.length >= 3) {
        toast.info(tr("Up to three sorting levels are allowed", "Επιτρέπονται έως τρία επίπεδα ταξινόμησης"));
        return current;
      }
      return [...current, { key, direction: "asc" }];
    });
    setPage(1);
  };

  const SortIcon = ({ k }: { k: ColumnKey }) => {
    const index = sorts.findIndex((rule) => rule.key === k);
    if (index < 0) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return <span className="inline-flex items-center text-primary">
      {sorts[index].direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      <span className="text-[9px] font-bold">{index + 1}</span>
    </span>;
  };
  const beginResize = (key: ColumnKey, event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[key];
    const move = (moveEvent: PointerEvent) => {
      setColumnWidths((current) => ({
        ...current,
        [key]: Math.max(55, startWidth + moveEvent.clientX - startX),
      }));
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  const columnLabel = (key: Col["key"], fallback: string) => ({
    task_key: tr("Key", "Κωδικός"), title: tr("Work", "Εργασία"), status: tr("Status", "Κατάσταση"),
    labels: tr("Labels", "Ετικέτες"), assignee: tr("Assignee", "Ανάθεση"), priority: tr("Priority", "Προτεραιότητα"),
    space: tr("Space", "Χώρος"),
    due_date: tr("Due date", "Ημερομηνία λήξης"), updated_at: tr("Updated", "Ενημερώθηκε"),
  } as Record<string, string>)[key] ?? fallback;
  const statusLabel = (status: string) => ({
    backlog: tr("Backlog", "Εκκρεμότητα"), todo: tr("To Do", "Προς εκτέλεση"), progress: tr("In Progress", "Σε εξέλιξη"),
    pause: tr("Paused", "Σε παύση"), blocked: tr("Blocked", "Μπλοκαρισμένο"), review: tr("Review", "Έλεγχος"),
    done: tr("Done", "Ολοκληρωμένο"), cancelled: tr("Cancelled", "Ακυρωμένο"),
  } as Record<string, string>)[status] ?? status;

  return (
    <div className="p-4 md:p-6 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {spaceColor && (
            <span className="inline-block h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: spaceColor }} />
          )}
          <h1 className="text-xl font-semibold truncate">{displayTitle}</h1>
          <span className="text-xs text-muted-foreground rounded bg-muted px-1.5 py-0.5">{total}</span>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tr("Search tasks…", "Αναζήτηση εργασιών…")}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 w-72 h-9"
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap border-y py-2">
        {/* Status quick chips */}
        <div className="flex flex-wrap gap-1">
          {ALL_STATUSES.map((s) => {
            const active = statuses.includes(s);
            return (
              <button
                key={s}
                onClick={() => {
                  setPage(1);
                  setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
                }}
                className={`text-[10px] font-semibold px-2 py-1 rounded border transition ${
                  active ? STATUS_META[s].className + " border-transparent" : "opacity-40 hover:opacity-90 border-border"
                }`}
              >
                {statusLabel(s)}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Priority filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <ListFilter className="h-3.5 w-3.5" /> {tr("Priority", "Προτεραιότητα")}
              {priorities.length > 0 && <span className="ml-1 rounded bg-primary/10 px-1 text-xs">{priorities.length}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-2">
            {ALL_PRIORITIES.map((p) => (
              <label key={p} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                <Checkbox
                  checked={priorities.includes(p)}
                  onCheckedChange={(v) => {
                    setPage(1);
                    setPriorities((cur) => (v ? [...cur, p] : cur.filter((x) => x !== p)));
                  }}
                />
                <span className={PRIORITY_META[p]?.className}>{p}</span>
              </label>
            ))}
          </PopoverContent>
        </Popover>

        {/* Assignee filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <ListFilter className="h-3.5 w-3.5" /> {tr("Assignee", "Ανάθεση")}
              {assigneeIds.length > 0 && <span className="ml-1 rounded bg-primary/10 px-1 text-xs">{assigneeIds.length}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2 max-h-80 overflow-auto">
            {profiles.filter((p) => p.is_active !== false).map((p) => (
              <label key={p.id} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                <Checkbox
                  checked={assigneeIds.includes(p.id)}
                  onCheckedChange={(v) => {
                    setPage(1);
                    setAssigneeIds((cur) => (v ? [...cur, p.id] : cur.filter((x) => x !== p.id)));
                  }}
                />
                <span className="truncate">{p.full_name}</span>
              </label>
            ))}
          </PopoverContent>
        </Popover>

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setPriorities([]);
              setAssigneeIds([]);
              setStatuses(ALL_STATUSES.filter((s) => s !== "done" && s !== "cancelled"));
              setPage(1);
            }}
          >
            {tr("Clear", "Καθαρισμός")}
          </Button>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <Bookmark className="h-3.5 w-3.5" /> {tr("Saved", "Αποθηκευμένα")}
              {savedFilters.length > 0 && <span className="ml-1 rounded bg-primary/10 px-1 text-xs">{savedFilters.length}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2 space-y-2">
            {savedFilters.length === 0 && (
              <div className="text-xs text-muted-foreground p-2">{tr("No saved filters yet.", "Δεν υπάρχουν αποθηκευμένα φίλτρα.")}</div>
            )}
            {savedFilters.map((f) => (
              <div key={f.id} className="flex items-center gap-1">
                <button
                  onClick={() => applySaved(f.filter_data)}
                  className="flex-1 text-left text-sm px-2 py-1 rounded hover:bg-accent flex items-center gap-1.5"
                >
                  <Star className="h-3 w-3 text-amber-500" /> <span className="truncate">{f.name}</span>
                </button>
                <button
                  onClick={() => deleteMutation.mutate(f.id)}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  title={tr("Delete", "Διαγραφή")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <div className="border-t pt-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-xs"
                onClick={() => {
                  const name = window.prompt(tr("Name this filter:", "Ονομάστε αυτό το φίλτρο:"));
                  if (name?.trim()) saveMutation.mutate(name.trim());
                }}
              >
                {tr("Save current as…", "Αποθήκευση τρέχοντος ως…")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>


      {/* Table */}
      {draggedTaskId && (
        <div
          className="rounded-md border-2 border-dashed border-primary/50 bg-primary/5 p-3 text-center text-sm font-medium"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!draggedTaskId) return;
            if (window.confirm(tr(
              "Make this subtask a standalone task?",
              "Να γίνει αυτή η υποεργασία αυτόνομη εργασία;",
            ))) {
              placementMutation.mutate({ taskId: draggedTaskId, parentTaskId: null });
            }
          }}
        >
          {tr("Drop here to make it a standalone task", "Αφήστε εδώ για να γίνει αυτόνομη εργασία")}
        </div>
      )}
      <div className="border rounded-md overflow-auto bg-card">
        <table
          className="text-sm border-collapse table-fixed"
          style={{ minWidth: COLUMNS.reduce((sum, column) => sum + columnWidths[column.key], 0) }}
        >
          <colgroup>
            {COLUMNS.map((column) => (
              <col key={column.key} style={{ width: columnWidths[column.key] }} />
            ))}
          </colgroup>
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  data-task-column={c.key}
                  className="relative text-left font-medium text-xs uppercase tracking-wide text-muted-foreground px-3 py-2 border-b border-r last:border-r-0"
                >
                  <div className="flex items-center gap-1">
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort(c.key)}
                    >
                      {columnLabel(c.key, c.label)} <SortIcon k={c.key} />
                    </button>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className={`rounded p-0.5 hover:bg-accent ${columnFilters[c.key] ? "text-primary" : "opacity-45"}`}
                          title={tr("Filter column", "Φίλτρο στήλης")}
                        >
                          <ListFilter className="h-3 w-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-60 p-2" align="start">
                        <Input
                          autoFocus
                          value={columnFilters[c.key] ?? ""}
                          onChange={(event) => setColumnFilters((current) => ({
                            ...current,
                            [c.key]: event.target.value,
                          }))}
                          placeholder={`${tr("Filter", "Φίλτρο")} ${columnLabel(c.key, c.label)}…`}
                          className="h-8"
                        />
                        {columnFilters[c.key] && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-2 h-7 w-full"
                            onClick={() => setColumnFilters((current) => ({ ...current, [c.key]: "" }))}
                          >
                            {tr("Clear filter", "Καθαρισμός φίλτρου")}
                          </Button>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                  <span
                    role="separator"
                    className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none hover:border-r-2 hover:border-primary"
                    onPointerDown={(event) => beginResize(c.key, event)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const table = event.currentTarget.closest("table");
                      const cells = table?.querySelectorAll<HTMLElement>(`[data-task-column="${c.key}"]`) ?? [];
                      let width = 55;
                      cells.forEach((cell) => { width = Math.max(width, cell.scrollWidth + 20); });
                      setColumnWidths((current) => ({ ...current, [c.key]: Math.min(width, 700) }));
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={COLUMNS.length} className="text-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
                </td>
              </tr>
            ) : displayedRows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="text-center py-10 text-sm text-muted-foreground">
                  {tr("No tasks match these filters.", "Καμία εργασία δεν ταιριάζει με αυτά τα φίλτρα.")}
                </td>
              </tr>
            ) : (
              pageRows.map((t, i) => (
                <tr
                  key={t.id}
                  draggable={!isImpersonating}
                  onDragStart={(event) => {
                    setDraggedTaskId(t.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/task-id", t.id);
                  }}
                  onDragEnd={() => {
                    setDraggedTaskId(null);
                    setDropTarget(null);
                  }}
                  onDragOver={(event) => {
                    if (draggedTaskId && draggedTaskId !== t.id) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      const rect = event.currentTarget.getBoundingClientRect();
                      const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
                      const mode: DropMode = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "child";
                      setDropTarget({ taskId: t.id, mode });
                    }
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDropTarget((current) => current?.taskId === t.id ? null : current);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const sourceId = draggedTaskId || event.dataTransfer.getData("text/task-id");
                    if (!sourceId || sourceId === t.id) return;
                    const source = rows.find((task) => task.id === sourceId);
                    const mode = dropTarget?.taskId === t.id ? dropTarget.mode : "child";
                    setDropTarget(null);
                    if (mode === "child") {
                      const confirmed = window.confirm(tr(
                        `Are you sure you want ${source?.task_key ?? "this task"} to become a subtask of ${t.task_key}?`,
                        `Είστε βέβαιοι ότι θέλετε το ${source?.task_key ?? "task"} να γίνει υποεργασία του ${t.task_key};`,
                      ));
                      if (confirmed) placementMutation.mutate({ taskId: sourceId, parentTaskId: t.id });
                      else setDraggedTaskId(null);
                      return;
                    }
                    if (source?.parent_id) {
                      const confirmed = window.confirm(tr(
                        "Move this subtask out of its parent and make it a standalone task?",
                        "Να αφαιρεθεί αυτή η υποεργασία από τη γονική εργασία και να γίνει αυτόνομη;",
                      ));
                      if (!confirmed) {
                        setDraggedTaskId(null);
                        return;
                      }
                      placementMutation.mutate({ taskId: sourceId, parentTaskId: null });
                    }
                    reorderTask(sourceId, t.id, mode);
                    setDraggedTaskId(null);
                  }}
                  className={`cursor-pointer border-b transition-colors ${
                    dropTarget?.taskId === t.id && dropTarget.mode === "before"
                      ? "border-t-2 border-t-primary "
                      : dropTarget?.taskId === t.id && dropTarget.mode === "after"
                        ? "border-b-2 border-b-primary "
                        : dropTarget?.taskId === t.id
                          ? "outline outline-2 outline-primary/70 bg-primary/10 "
                          : ""
                  }${
                    selectedTaskId === t.id
                      ? "bg-primary/10 ring-1 ring-inset ring-primary/30"
                      : i % 2 === 0
                        ? "bg-background hover:bg-accent/50"
                        : "bg-muted/20 hover:bg-accent/50"
                  }`}
                  onClick={() => scheduleSingleClick(t, false)}
                  onDoubleClick={() => openDetails(t.task_key)}
                >
                  <td data-task-column="task_key" className="px-3 py-1.5 border-r whitespace-nowrap overflow-hidden">
                    <span
                      className="inline-block font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded text-white"
                      style={{ backgroundColor: t.space?.color ?? "hsl(220 60% 50%)" }}
                    >
                      {t.task_key}
                    </span>
                  </td>
                  <td
                    data-task-column="title"
                    className="px-3 py-1.5 border-r max-w-0"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (editingTaskId !== t.id) scheduleSingleClick(t, true);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      openDetails(t.task_key);
                    }}
                  >
                    {editingTaskId === t.id ? (
                      <Input
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onBlur={() => saveInlineTitle(t.id, t.title)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            saveInlineTitle(t.id, t.title);
                          } else if (event.key === "Escape") {
                            setEditingTaskId(null);
                            setEditingTitle("");
                          }
                        }}
                        className="h-7 px-2 text-sm"
                        autoFocus
                        disabled={editTitleMutation.isPending}
                      />
                    ) : (
                      <div className={`truncate flex items-center gap-1 ${t.parent_id ? "pl-5" : ""}`} title={t.title}>
                        <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                        {t.parent_id && <span className="text-muted-foreground">↳</span>}
                        <span className="truncate">{t.title}</span>
                      </div>
                    )}
                  </td>
                  <td data-task-column="space" className="px-3 py-1.5 border-r truncate text-xs">
                    {t.space?.name ?? "—"}
                  </td>
                  <td data-task-column="status" className="px-3 py-1.5 border-r">
                    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_META[t.status]?.className ?? ""}`}>
                      {statusLabel(t.status)}
                    </span>
                  </td>
                  <td data-task-column="labels" className="px-3 py-1.5 border-r">
                    {t.labels && t.labels.length ? (
                      <div className="flex gap-1 flex-wrap">
                        {t.labels.slice(0, 2).map((l: string) => (
                          <span key={l} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 truncate max-w-24">{l}</span>
                        ))}
                        {t.labels.length > 2 && <span className="text-[10px] text-muted-foreground">+{t.labels.length - 2}</span>}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td data-task-column="assignee" className="px-3 py-1.5 border-r">
                    {t.assignee ? (
                      <div className="flex items-center gap-1.5">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback
                            className="text-[9px] text-white"
                            style={{ backgroundColor: avatarColor(t.assignee.full_name) }}
                          >
                            {initials(t.assignee.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs truncate">{t.assignee.full_name}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{tr("Unassigned", "Χωρίς ανάθεση")}</span>
                    )}
                  </td>
                  <td data-task-column="priority" className="px-3 py-1.5 border-r">
                    {t.priority ? (
                      <span className={`inline-flex items-center text-xs ${PRIORITY_META[t.priority]?.className ?? ""}`}>
                        {t.priority}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td data-task-column="due_date" className="px-3 py-1.5 border-r text-xs text-muted-foreground whitespace-nowrap overflow-hidden">
                    {t.due_date ? new Date(t.due_date).toLocaleDateString() : "—"}
                  </td>
                  <td data-task-column="updated_at" className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap overflow-hidden">
                    {new Date(t.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-between items-center text-sm">
          <div className="text-muted-foreground">
            {tr("Showing", "Εμφάνιση")} {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} {tr("of", "από")} {total}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              {tr("Previous", "Προηγούμενη")}
            </Button>
            <span className="text-xs self-center text-muted-foreground">{tr("Page", "Σελίδα")} {page} {tr("of", "από")} {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              {tr("Next", "Επόμενη")}
            </Button>
          </div>
        </div>
      )}

      <TaskSidePanel taskKey={openTaskKey} onClose={() => setOpenTaskKey(null)} />
    </div>
  );
}

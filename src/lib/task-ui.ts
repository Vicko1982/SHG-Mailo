// Jira-inspired status/priority styling.
// Semantic tokens live in styles.css; classes below combine those tokens with fixed contrast pairs.

export const STATUS_META: Record<string, { label: string; className: string }> = {
  backlog:   { label: "BACKLOG",     className: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100" },
  todo:      { label: "TO DO",       className: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100" },
  progress:  { label: "IN PROGRESS", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-100" },
  pause:     { label: "PAUSED",      className: "bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100" },
  blocked:   { label: "BLOCKED",     className: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-100" },
  review:    { label: "IN REVIEW",   className: "bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-100" },
  done:      { label: "DONE",        className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-100" },
  cancelled: { label: "CANCELLED",   className: "bg-zinc-200 text-zinc-600 line-through dark:bg-zinc-800 dark:text-zinc-400" },
};

export const ALL_STATUSES = Object.keys(STATUS_META);

export const PRIORITY_META: Record<string, { className: string }> = {
  Highest: { className: "text-red-600 dark:text-red-400 font-semibold" },
  High:    { className: "text-orange-600 dark:text-orange-400 font-semibold" },
  Medium:  { className: "text-amber-600 dark:text-amber-400" },
  Low:     { className: "text-sky-600 dark:text-sky-400" },
  Lowest:  { className: "text-slate-500" },
};

export const ALL_PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"];

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

// Consistent avatar color derived from name — stable across renders.
export function avatarColor(name: string | null | undefined): string {
  if (!name) return "hsl(220 10% 60%)";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 55% 45%)`;
}

# Wave E — Impersonation (read-only) and Wave H — Activity Log

## Wave E: Impersonation

Main Admin only. When active: banner across the top, all write actions hidden/disabled, data views filtered to what the impersonated user would see.

- New server fn `getImpersonationView({ userId })` — Main Admin only. Returns that user's spaces, memberships, and role for the client to scope its views.
- New server fn `impersonatedTasks({ userId, ...filters })` — Main Admin only. Runs task queries as if `auth.uid()` were the target user (filters by their assignments, supervision, and space memberships).
- Client `ImpersonationProvider` in `src/lib/impersonation.tsx`:
  - `impersonatedUserId` stored in `sessionStorage` (cleared on tab close).
  - `isImpersonating` flag exposed via context.
- Sticky banner in `_authenticated` layout: "Viewing as {name} (read-only) — [Exit]".
- Sidebar + task list use impersonated view when active. All write UI (status change, new space, edit space, comments box, admin actions) hidden while impersonating.
- "Login as…" action added to the `/admin/users` row menu (Main Admin only).
- Every start/stop of impersonation writes an `activity_log` entry.

## Wave H: Activity Log

- Server fn `listActivity({ userId?, action?, from?, to?, page, pageSize })` — Admin and Main Admin only.
- New route `/admin/activity` with:
  - Filters: user, action type, date range, free-text search.
  - Table columns: When, User, Action, Task/Target, Details.
  - Pagination (50/page).
- Instrument key mutations to insert into `activity_log`:
  - `sign_in`, `sign_out`, `impersonate_start`, `impersonate_stop`
  - `task_create`, `task_update_status`, `task_edit`, `task_delete`, `task_comment`
  - `space_create`, `space_update`, `space_delete`
  - `user_create`, `user_role_change`, `user_delete`
- Sidebar link under Admin → **Activity**.

## Files

New:
- `src/lib/impersonation.tsx`
- `src/lib/activity.functions.ts`
- `src/components/impersonation-banner.tsx`
- `src/routes/_authenticated/admin.activity.tsx`

Modified:
- `src/lib/spaces.functions.ts` — add impersonation helpers + write activity entries on create/update/delete.
- `src/lib/tasks.functions.ts` — accept optional `asUserId` (Main Admin only) and write activity entries on updates.
- `src/lib/comments.functions.ts` — write activity entry on new comment.
- `src/components/app-sidebar.tsx` — Activity link + hide write buttons when impersonating.
- `src/components/task-list.tsx` and `src/components/task-side-panel.tsx` — read-only when impersonating.
- `src/routes/_authenticated.tsx` — mount `ImpersonationProvider` + banner.
- `src/routes/_authenticated/admin.users.tsx` — "Login as" action.
- `src/lib/auth-context.tsx` — log `sign_in`/`sign_out` events.

## Security

- Impersonation server fns check `is_main_admin(auth.uid())` before running.
- No client can spoof `asUserId` — server ignores it unless caller is Main Admin.
- Writes remain fully RLS-guarded; impersonated sessions never issue writes because the UI hides them and the server also refuses mutations when an impersonation header is present.

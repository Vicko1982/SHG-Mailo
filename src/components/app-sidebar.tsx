import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ListChecks,
  Users,
  Home,
  LogOut,
  Layers,
  ChevronDown,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
  Plus,
  MoreHorizontal,
  Activity,
  Shield,
  Settings,
  Languages,
  Boxes,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { listSpaces } from "@/lib/spaces.functions";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SpaceDialog } from "@/components/space-dialog";
import { useImpersonation } from "@/lib/impersonation";
import { useLanguage } from "@/lib/language";

const GROUP_STATE_KEY = "shg.sidebarGroups";

function useGroupState() {
  const [open, setOpen] = useState<Record<string, boolean>>({
    main: true, shared: true, personal: true, admin: true,
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(GROUP_STATE_KEY);
      if (raw) setOpen((cur) => ({ ...cur, ...JSON.parse(raw) }));
    } catch { /* noop */ }
  }, []);
  const toggle = (k: string) => setOpen((cur) => {
    const next = { ...cur, [k]: !cur[k] };
    try { localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(next)); } catch { /* noop */ }
    return next;
  });
  return { open, toggle };
}

function GroupHeader({
  label, count, expanded, onToggle,
}: { label: string; count?: number; expanded: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex items-center gap-1 w-full px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground group">
      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      <span className="uppercase tracking-wide">{label}</span>
      {typeof count === "number" && (
        <span className="ml-auto text-[10px] rounded bg-muted px-1">{count}</span>
      )}
    </button>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const { isAdmin, isMainAdmin, fullName, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, tr } = useLanguage();
  const { open, toggle } = useGroupState();
  const { impersonatedUserId, isImpersonating } = useImpersonation();
  const canManage = isAdmin && !isImpersonating;
  const [spaceDialog, setSpaceDialog] = useState<
    | { open: false }
    | { open: true; mode: { kind: "create" } | { kind: "edit"; spaceId: string } }
  >({ open: false });

  const fetchSpaces = useServerFn(listSpaces);
  const { data: spaces = [] } = useQuery({
    queryKey: ["spaces", impersonatedUserId],
    queryFn: () => fetchSpaces({ data: impersonatedUserId ? { asUserId: impersonatedUserId } : {} }),
  });

  const shared = spaces
    .filter((s) => s.type === "shared")
    .sort((a, b) => a.name.localeCompare(b.name));
  const personal = spaces
    .filter((s) => s.type === "personal")
    .sort((a, b) => a.name.localeCompare(b.name));
  const showPersonalFolder = isMainAdmin && !isImpersonating;
  const visibleShared = (showPersonalFolder ? shared : [...shared, ...personal])
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "personal" ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  const sharedActiveCount = visibleShared.reduce((sum, space) => sum + space.active_task_count, 0);
  const personalActiveCount = personal.reduce((sum, space) => sum + space.active_task_count, 0);

  const isActive = (p: string) => currentPath === p;

  const renderSpaceItem = (s: typeof spaces[number], icon: React.ReactNode) => (
    <SidebarMenuItem key={s.id}>
      <div className="group/space relative flex items-center">
        <SidebarMenuButton asChild isActive={currentPath === `/spaces/${s.key}`} tooltip={s.name} className="flex-1">
          <Link to="/spaces/$key" params={{ key: s.key }}>
            {icon}
            <span className="truncate">{s.name}</span>
            {!collapsed && (
              <span className={`ml-auto rounded bg-muted px-1.5 text-[10px] tabular-nums ${canManage ? "mr-5" : ""}`}>
                {s.active_task_count}
              </span>
            )}
          </Link>
        </SidebarMenuButton>
        {canManage && !collapsed && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSpaceDialog({ open: true, mode: { kind: "edit", spaceId: s.id } }); }}
            className="absolute right-1 p-1 rounded opacity-0 group-hover/space:opacity-100 hover:bg-accent"
            title={tr("Space properties", "Ιδιότητες χώρου")}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </SidebarMenuItem>
  );

  return (
    <>
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-1.5 text-sm font-semibold flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-primary text-primary-foreground grid place-items-center text-xs font-bold">S</div>
          {!collapsed && <span>Smart Homes</span>}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel asChild><GroupHeader label={tr("Main", "Κύρια")} expanded={open.main} onToggle={() => toggle("main")} /></SidebarGroupLabel>}
          {(collapsed || open.main) && (
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/dashboard")} tooltip="Dashboard">
                    <Link to="/dashboard"><LayoutDashboard /> <span>{tr("Dashboard", "Επισκόπηση")}</span></Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/all-tasks")} tooltip="All Tasks">
                    <Link to="/all-tasks"><Layers /> <span>{tr("All Tasks", "Όλες οι εργασίες")}</span></Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/my-tasks")} tooltip="My Tasks">
                    <Link to="/my-tasks"><ListChecks /> <span>{tr("My Tasks", "Οι εργασίες μου")}</span></Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          )}
        </SidebarGroup>

        <SidebarGroup>
          {!collapsed && (
            <div className="flex items-center">
              <SidebarGroupLabel asChild className="flex-1">
                <GroupHeader label={tr("Shared Spaces", "Κοινόχρηστοι χώροι")} count={sharedActiveCount} expanded={open.shared} onToggle={() => toggle("shared")} />
              </SidebarGroupLabel>
              {canManage && (
                <button
                  onClick={() => setSpaceDialog({ open: true, mode: { kind: "create" } })}
                  className="p-1 mr-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                  title={tr("New space", "Νέος χώρος")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {(collapsed || open.shared) && (
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleShared.map((s) => renderSpaceItem(
                  s,
                  s.type === "personal"
                    ? <Home style={{ color: s.color ?? undefined }} />
                    : <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: s.color ?? "#888" }} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          )}
        </SidebarGroup>

        {showPersonalFolder && (
          <SidebarGroup>
            {!collapsed && <SidebarGroupLabel asChild><GroupHeader label={tr("Personal Spaces", "Προσωπικοί χώροι")} count={personalActiveCount} expanded={open.personal} onToggle={() => toggle("personal")} /></SidebarGroupLabel>}
            {(collapsed || open.personal) && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {personal.map((s) => renderSpaceItem(
                    s,
                    <Home style={{ color: s.color ?? undefined }} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}

        {canManage && (
          <SidebarGroup>
            {!collapsed && <SidebarGroupLabel asChild><GroupHeader label="Admin" expanded={open.admin} onToggle={() => toggle("admin")} /></SidebarGroupLabel>}
            {(collapsed || open.admin) && (
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive("/admin/users")} tooltip="Users">
                      <Link to="/admin/users"><Users /> <span>{tr("Users", "Χρήστες")}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive("/admin/spaces")} tooltip="Spaces">
                      <Link to="/admin/spaces"><Boxes /> <span>{tr("Spaces", "Χώροι")}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive("/admin/access")} tooltip="Access">
                      <Link to="/admin/access"><Shield /> <span>{tr("Access", "Πρόσβαση")}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive("/admin/activity")} tooltip="Activity">
                      <Link to="/admin/activity"><Activity /> <span>{tr("Activity", "Δραστηριότητα")}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive("/admin/settings")} tooltip="Settings">
                      <Link to="/admin/settings"><Settings /> <span>{tr("Settings", "Ρυθμίσεις")}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <div className="px-1 pb-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-full justify-start gap-2 px-2" title={tr("Language", "Γλώσσα")}>
                <Languages className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{language === "en" ? "English" : "Ελληνικά"}</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-44">
              <DropdownMenuItem onClick={() => setLanguage("en")} className={language === "en" ? "font-semibold" : ""}>🇬🇧 English</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLanguage("el")} className={language === "el" ? "font-semibold" : ""}>🇬🇷 Ελληνικά</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-1 px-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" title={tr("Theme", "Θέμα")}>
                {theme === "dark" ? <Moon className="h-4 w-4" /> : theme === "light" ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setTheme("light")}><Sun className="h-4 w-4 mr-2" /> {tr("Light", "Φωτεινό")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}><Moon className="h-4 w-4 mr-2" /> {tr("Dark", "Σκούρο")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}><Monitor className="h-4 w-4 mr-2" /> {tr("System", "Σύστημα")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!collapsed && (
            <div className="flex-1 min-w-0 text-xs truncate px-1" title={fullName ?? ""}>{fullName ?? "—"}</div>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => signOut()} title={tr("Sign out", "Αποσύνδεση")}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
    {spaceDialog.open && (
      <SpaceDialog
        open
        onOpenChange={(v) => !v && setSpaceDialog({ open: false })}
        mode={spaceDialog.mode}
      />
    )}
    </>
  );
}

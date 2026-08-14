import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type TaskType = "task" | "mini_task";
type Priority = "Highest" | "High" | "Medium" | "Low" | "Lowest";

type DraftRequest = {
  type: TaskType;
  title: string;
  confirmed?: boolean;
  description?: string | null;
  space?: string | null;
  assignee?: string | null;
  supervisor?: string | null;
  priority?: Priority | null;
  dueDate?: string | null;
  labels?: string[];
  explicitFields?: string[];
};

type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  is_active: boolean | null;
  voice_names?: string[];
  aliases?: string[];
};

type Space = {
  id: string;
  key: string;
  name: string;
  type: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("el");
}

function profileSearchTerms(value: unknown) {
  const ignored = new Set([
    "ο", "η", "το", "τον", "την", "του", "της", "στο", "στη", "στον", "στην",
    "με", "για", "απο", "σε", "ως", "assignee", "assign", "αναθεση", "αναθεσε",
    "αναθεσετο", "βαλε", "κανε",
  ]);
  const cleaned = normalize(value).replace(/[^\p{Letter}\p{Number}@.+_-]+/gu, " ");
  const tokens = cleaned.split(/\s+/).filter((token) => token && !ignored.has(token));
  return [...new Set([cleaned, tokens.join(" "), ...tokens].filter(Boolean))];
}

function cleanText(value: unknown, maximum: number) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function splitLongTitle(title: string, description: string) {
  if (title.length <= 100) return { title, description };
  const words = title.split(/\s+/);
  let shortTitle = "";
  while (words.length) {
    const candidate = `${shortTitle} ${words[0]}`.trim();
    if (candidate.length > 88) break;
    shortTitle = candidate;
    words.shift();
  }
  const remainder = words.join(" ").trim();
  return {
    title: shortTitle || `${title.slice(0, 85).trim()}…`,
    description: [remainder, description].filter(Boolean).join("\n\n").slice(0, 10_000),
  };
}

function resolveProfile(profiles: Profile[], value: unknown) {
  const suppliedTerms = profileSearchTerms(value);
  const aliases: Record<string, string> = {
    "αγαπη": "agapi@shd.global",
    "agapi": "agapi@shd.global",
    "αλεξανδρος": "alexandros@shd.global",
    "αλεξανδρο": "alexandros@shd.global",
    "alexandros": "alexandros@shd.global",
    "χαρα": "c.giannoula.law@gmail.com",
    "chara": "c.giannoula.law@gmail.com",
    "χρηστος": "chris@shd.global",
    "χρηστο": "chris@shd.global",
    "chris": "chris@shd.global",
    "ντινος": "dinos@shd.global",
    "ντινο": "dinos@shd.global",
    "dinos": "dinos@shd.global",
    "fang": "fang@shd.global",
    "φωτης": "fotis@shd.global",
    "φωτη": "fotis@shd.global",
    "fotis": "fotis@shd.global",
    "γαληνη": "galini@shd.global",
    "galini": "galini@shd.global",
    "ιφιγενεια": "ifigenia@shd.global",
    "ifigenia": "ifigenia@shd.global",
    "γιαννης": "jtzortzos@shd.global",
    "γιαννη": "jtzortzos@shd.global",
    "γιαννου": "jtzortzos@shd.global",
    "τζωρτζος": "jtzortzos@shd.global",
    "τζορτζος": "jtzortzos@shd.global",
    "john": "jtzortzos@shd.global",
    "σακης": "sakisiliou80@gmail.com",
    "σακη": "sakisiliou80@gmail.com",
    "sakis": "sakisiliou80@gmail.com",
    "assistant": "info+assistant@shd.global",
    "βοηθος": "info+assistant@shd.global",
    "βασιλης": "katsaros@tkcfinance.com",
    "βασιλη": "katsaros@tkcfinance.com",
    "vasilis": "katsaros@tkcfinance.com",
    "βικτωρ": "victor@shd.global",
    "βικτωρα": "victor@shd.global",
    "victor": "victor@shd.global",
  };
  if (!suppliedTerms.length || suppliedTerms.some((term) => term === "unassigned" || term === "none")) return null;
  const wantedTerms = [...new Set(suppliedTerms.flatMap((term) => [term, aliases[term]].filter(Boolean)))];
  const exact = profiles.find((profile) => {
    const fullName = normalize(profile.full_name);
    const email = normalize(profile.email);
    const dynamicAliases=[...(profile.voice_names??[]),...(profile.aliases??[])].map(normalize);
    return wantedTerms.some((wanted) => fullName === wanted || email === wanted || dynamicAliases.includes(wanted));
  });
  if (exact) return exact;
  const matches = profiles.filter((profile) => {
    const fullName = normalize(profile.full_name);
    const nameTokens = fullName.split(/\s+/);
    const dynamicAliases=[...(profile.voice_names??[]),...(profile.aliases??[])].map(normalize);
    return wantedTerms.some((wanted) =>
      fullName.startsWith(wanted) || nameTokens.includes(wanted) || normalize(profile.email) === wanted || dynamicAliases.some(alias=>alias.startsWith(wanted))
    );
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Το όνομα «${value}» αντιστοιχεί σε περισσότερους χρήστες. Πες ολόκληρο το όνομα.`);
  }
  throw new Error(`Δεν βρέθηκε ενεργός χρήστης με το όνομα «${value}».`);
}

function resolveSpace(spaces: Space[], value: unknown) {
  const wanted = normalize(value);
  const defaultSpace = spaces.find((space) =>
    normalize(space.key) === "imi" || normalize(space.name) === "internal & miscellaneous"
  );
  if (!wanted) {
    if (!defaultSpace) throw new Error("Δεν βρέθηκε το προεπιλεγμένο Space Internal & Miscellaneous.");
    return defaultSpace;
  }
  const exact = spaces.find((space) =>
    normalize(space.key) === wanted || normalize(space.name) === wanted
  );
  if (exact) return exact;
  const matches = spaces.filter((space) => normalize(space.name).startsWith(wanted));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Το Space «${value}» δεν είναι αρκετά συγκεκριμένο.`);
  }
  throw new Error(`Δεν βρέθηκε Space με την ονομασία «${value}».`);
}

function sha256(value: string) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    .then((buffer) =>
      [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    );
}

async function validateCaller(request: Request, admin: ReturnType<typeof createClient>) {
  const expected = Deno.env.get("MAILO_VOICE_API_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supplied = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if ((expected && supplied === expected) || (serviceKey && supplied === serviceKey)) return;
  if (!supplied) throw new Error("Μη εξουσιοδοτημένη φωνητική εντολή.");
  const { data: authData } = await admin.auth.getUser(supplied);
  if (!authData.user) throw new Error("Μη εξουσιοδοτημένη φωνητική εντολή.");
  const { data: roles } = await admin.from("user_roles").select("role")
    .eq("user_id", authData.user.id);
  if (!roles?.some((row) => row.role === "main_admin")) {
    throw new Error("Το Voice Task είναι διαθέσιμο μόνο στον Main Admin.");
  }
}

function buildSummary(
  type: TaskType,
  payload: Record<string, unknown>,
  explicitFields: Set<string>,
) {
  const parts = [
    type === "mini_task"
      ? `Περίληψη πριν τη δημιουργία Mini Task, τίτλος: ${payload.title}`
      : `Περίληψη πριν τη δημιουργία, τίτλος: ${payload.title}`,
  ];
  if (explicitFields.has("space")) parts.push(`Space: ${payload.spaceName}`);
  if (explicitFields.has("assignee") && payload.assigneeName) {
    parts.push(`Assignee: ${payload.assigneeName}`);
  }
  if (explicitFields.has("supervisor") && payload.supervisorName) {
    parts.push(`Supervisor: ${payload.supervisorName}`);
  }
  if (explicitFields.has("priority") && payload.priority !== "Medium") {
    parts.push(`Priority: ${payload.priority}`);
  }
  if (explicitFields.has("dueDate") && payload.dueDate) parts.push(`Due Date: ${payload.dueDate}`);
  if (explicitFields.has("labels") && Array.isArray(payload.labels) && payload.labels.length) {
    parts.push(`Labels: ${payload.labels.join(", ")}`);
  }
  if (payload.description) parts.push("οι υπόλοιπες λεπτομέρειες μπήκαν στο Description");
  return `${parts.join(", ")}. Να το δημιουργήσω;`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await validateCaller(request, admin);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*\/voice-task-api\/?/, "/");

    const [{ data: creator, error: creatorError }, { data: profiles, error: profilesError }, {
      data: spaces,
      error: spacesError,
    }] = await Promise.all([
      admin.from("profiles").select("id,full_name,email,is_active,voice_names,aliases")
        .eq("email", "victor@shd.global").eq("is_active", true).single(),
      admin.from("profiles").select("id,full_name,email,is_active,voice_names,aliases")
        .neq("is_active", false).order("full_name"),
      admin.from("spaces").select("id,key,name,type").order("name"),
    ]);
    if (creatorError || !creator) throw new Error("Δεν βρέθηκε ο ενεργός Main Admin Victor.");
    if (profilesError) throw profilesError;
    if (spacesError) throw spacesError;
    const activeProfiles = (profiles ?? []) as Profile[];
    const activeSpaces = (spaces ?? []) as Space[];

    if (request.method === "GET" && path === "/context") {
      return json({
        taskTypes: ["task", "mini_task"],
        defaults: {
          space: "Internal & Miscellaneous",
          assignee: "Unassigned",
          supervisor: "Unassigned",
          priority: "Medium",
          taskDueDate: null,
          miniTaskDueDate: "next_day",
        },
        rules: {
          titleRequired: true,
          miniTaskAssigneeRequired: true,
          confirmationRequired: true,
          omitDefaultsFromSpokenSummary: true,
        },
        users: activeProfiles.map((profile) => ({
          name: profile.full_name,
          email: profile.email,
        })),
        spaces: activeSpaces.map((space) => ({
          key: space.key,
          name: space.name,
          type: space.type,
        })),
        priorities: ["Highest", "High", "Medium", "Low", "Lowest"],
      });
    }

    if (request.method === "POST" && (path === "/drafts" || path === "/create")) {
      const input = await request.json() as DraftRequest;
      const explicitFields = new Set((input.explicitFields ?? []).map(String));
      const createImmediately = path === "/create";
      if (createImmediately && input.confirmed !== true) {
        throw new Error("Απαιτείται ρητή επιβεβαίωση πριν από τη δημιουργία.");
      }
      if (!["task", "mini_task"].includes(input.type)) {
        throw new Error("Πρέπει να διευκρινίσεις αν θέλεις Task ή Mini Task.");
      }
      const rawTitle = cleanText(input.title, 10_000);
      if (!rawTitle) throw new Error("Ο τίτλος είναι υποχρεωτικός.");
      const rawDescription = String(input.description ?? "").trim().slice(0, 10_000);
      const shortened = splitLongTitle(rawTitle, rawDescription);
      const space = resolveSpace(activeSpaces, input.space);
      if (!explicitFields.has("assignee")) {
        return json({
          ready: false,
          missingField: "assigneeDecision",
          question: "Θέλεις να ορίσεις Assignee;",
        }, 422);
      }
      const assignee = input.assignee ? resolveProfile(activeProfiles, input.assignee) : null;
      const supervisor = resolveProfile(activeProfiles, input.supervisor);
      if (input.type === "mini_task" && !assignee) {
        return json({
          ready: false,
          missingField: "assignee",
          question: "Σε ποιον να αναθέσω το Mini Task;",
        }, 422);
      }
      const priority = input.priority &&
          ["Highest", "High", "Medium", "Low", "Lowest"].includes(input.priority)
        ? input.priority
        : "Medium";
      const dueDate = input.dueDate
        ? new Date(`${input.dueDate}T12:00:00Z`).toISOString().slice(0, 10)
        : input.type === "mini_task"
        ? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
        : null;
      const labels = [...new Set((input.labels ?? []).map((label) => cleanText(label, 60)).filter(Boolean))]
        .slice(0, 20);
      const payload = {
        title: shortened.title,
        description: shortened.description || null,
        isMiniTask: input.type === "mini_task",
        spaceId: space.id,
        spaceKey: space.key,
        spaceName: space.name,
        assigneeId: assignee?.id ?? null,
        assigneeName: assignee?.full_name ?? null,
        supervisorId: supervisor?.id ?? null,
        supervisorName: supervisor?.full_name ?? null,
        priority,
        dueDate,
        labels,
      };
      const summary = buildSummary(input.type, payload, explicitFields);
      const confirmationToken = crypto.randomUUID().replaceAll("-", "") +
        crypto.randomUUID().replaceAll("-", "");
      const tokenHash = await sha256(confirmationToken);
      const { data: draft, error: draftError } = await admin.from("voice_task_drafts").insert({
        created_by_id: creator.id,
        payload,
        confirmation_summary: summary,
        confirmation_token_hash: tokenHash,
      }).select("id,expires_at").single();
      if (draftError) throw draftError;
      if (createImmediately) {
        const { data, error } = await admin.rpc("confirm_voice_task_draft", {
          selected_draft_id: draft.id,
          selected_token_hash: tokenHash,
        });
        if (error) throw error;
        const task = data?.[0];
        if (!task) throw new Error("Το Task δεν δημιουργήθηκε.");
        return json({
          created: true,
          taskId: task.task_id,
          taskKey: task.task_key,
          title: task.task_title,
          url: `https://mailo.shd.global/?task=${encodeURIComponent(task.task_key)}`,
          message: `${task.task_key} δημιουργήθηκε επιτυχώς.`,
        });
      }
      return json({
        ready: true,
        requiresConfirmation: true,
        draftId: draft.id,
        confirmationToken,
        expiresAt: draft.expires_at,
        summary,
      });
    }

    const confirmMatch = path.match(/^\/drafts\/([0-9a-f-]+)\/confirm$/i);
    if (request.method === "POST" && confirmMatch) {
      const body = await request.json() as { confirmationToken?: string };
      if (!body.confirmationToken) throw new Error("Λείπει η επιβεβαίωση.");
      const tokenHash = await sha256(body.confirmationToken);
      const { data, error } = await admin.rpc("confirm_voice_task_draft", {
        selected_draft_id: confirmMatch[1],
        selected_token_hash: tokenHash,
      });
      if (error) throw error;
      const task = data?.[0];
      if (!task) throw new Error("Το Task δεν δημιουργήθηκε.");
      return json({
        created: true,
        taskId: task.task_id,
        taskKey: task.task_key,
        title: task.task_title,
        url: `https://mailo.shd.global/?task=${encodeURIComponent(task.task_key)}`,
        message: `${task.task_key} δημιουργήθηκε επιτυχώς.`,
      });
    }

    const cancelMatch = path.match(/^\/drafts\/([0-9a-f-]+)\/cancel$/i);
    if (request.method === "POST" && cancelMatch) {
      const { error } = await admin.from("voice_task_drafts")
        .update({ expires_at: new Date().toISOString() })
        .eq("id", cancelMatch[1]).is("confirmed_at", null);
      if (error) throw error;
      return json({ cancelled: true, message: "Η δημιουργία ακυρώθηκε." });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error("voice-task-api", error);
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("εξουσιοδοτημένη") ? 401 : 400;
    return json({ error: message }, status);
  }
});

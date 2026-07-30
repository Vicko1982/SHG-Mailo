import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "type",
    "title",
    "description",
    "space",
    "assignee",
    "supervisor",
    "priority",
    "dueDate",
    "labels",
    "explicitFields",
  ],
  properties: {
    type: { type: "string", enum: ["task", "mini_task"] },
    title: { type: "string" },
    description: { type: ["string", "null"] },
    space: { type: ["string", "null"] },
    assignee: { type: ["string", "null"] },
    supervisor: { type: ["string", "null"] },
    priority: { type: ["string", "null"], enum: ["Highest", "High", "Medium", "Low", "Lowest", null] },
    dueDate: { type: ["string", "null"] },
    labels: { type: "array", items: { type: "string" } },
    explicitFields: {
      type: "array",
      items: {
        type: "string",
        enum: ["space", "assignee", "supervisor", "priority", "dueDate", "labels"],
      },
    },
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sha256(value: string) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    .then((buffer) =>
      [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    );
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `mailo_siri_${encoded}`;
}

function bearer(request: Request) {
  return (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
}

async function requireMainAdmin(
  request: Request,
  admin: ReturnType<typeof createClient>,
) {
  const token = bearer(request);
  if (!token) throw new Error("Απαιτείται σύνδεση ως Main Admin.");
  const { data: authData } = await admin.auth.getUser(token);
  if (!authData.user) throw new Error("Απαιτείται σύνδεση ως Main Admin.");
  const { data: roles } = await admin.from("user_roles").select("role")
    .eq("user_id", authData.user.id);
  if (!roles?.some((row) => row.role === "main_admin")) {
    throw new Error("Η σύνδεση Siri είναι διαθέσιμη μόνο στον Main Admin.");
  }
  return authData.user;
}

async function requireDevice(
  request: Request,
  admin: ReturnType<typeof createClient>,
) {
  const token = bearer(request);
  if (!token.startsWith("mailo_siri_")) throw new Error("Μη έγκυρη συσκευή Siri.");
  const tokenHash = await sha256(token);
  const { data: device } = await admin.from("voice_device_tokens")
    .select("id,user_id,expires_at,revoked_at")
    .eq("token_hash", tokenHash).maybeSingle();
  if (
    !device || device.revoked_at ||
    new Date(device.expires_at).getTime() <= Date.now()
  ) {
    throw new Error("Η σύνδεση Siri έχει λήξει ή ανακληθεί.");
  }
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await admin.from("voice_shortcut_requests")
    .select("id", { count: "exact", head: true })
    .eq("device_token_id", device.id).gte("created_at", since);
  if ((count ?? 0) >= 120) {
    throw new Error("Έγιναν πάρα πολλές φωνητικές εντολές. Δοκίμασε ξανά αργότερα.");
  }
  await admin.from("voice_device_tokens").update({ last_used_at: new Date().toISOString() })
    .eq("id", device.id);
  return device;
}

function outputText(payload: Record<string, unknown>) {
  const direct = typeof payload.output_text === "string" ? payload.output_text : "";
  if (direct) return direct;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .map((content: any) => content?.text ?? "").filter(Boolean).join("");
}

async function parseUtterance(
  utterance: string,
  profiles: Array<{ full_name: string; email: string | null }>,
  spaces: Array<{ key: string; name: string }>,
) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("Το OpenAI API δεν έχει ρυθμιστεί.");
  const today = new Date().toISOString().slice(0, 10);
  const instructions = `Μετέτρεψε την ελληνική φωνητική εντολή σε Task του Mailo.
Σήμερα είναι ${today}.
Κανόνες:
- "Task" σημαίνει type task και "Mini Task" σημαίνει mini_task.
- Ένα αναγνωρίσιμο όνομα μέσα στην πρόταση είναι ο Assignee.
- Για Mini Task ο Assignee είναι υποχρεωτικός.
- Φτιάξε σύντομο σαφή τίτλο. Βάλε τις υπόλοιπες πληροφορίες στο description.
- Μην επινοείς στοιχεία. Τα μη αναφερόμενα πεδία είναι null ή κενά.
- Βάλε στο explicitFields μόνο πεδία που ειπώθηκαν ρητά.
- Η default προτεραιότητα είναι Medium και το default Space Internal & Miscellaneous.
Ενεργοί χρήστες: ${profiles.map((profile) => `${profile.full_name} <${profile.email ?? ""}>`).join("; ")}
Spaces: ${spaces.map((space) => `${space.name} (${space.key})`).join("; ")}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      instructions,
      input: utterance,
      text: {
        format: {
          type: "json_schema",
          name: "mailo_voice_task",
          strict: true,
          schema: jsonSchema,
        },
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI error (${response.status})`);
  }
  const parsed = JSON.parse(outputText(data));
  if (!parsed.title?.trim()) throw new Error("Δεν κατάλαβα τον τίτλο του Task.");
  return parsed;
}

async function voiceApi(path: string, payload: unknown, serviceKey: string, supabaseUrl: string) {
  const response = await fetch(`${supabaseUrl}/functions/v1/voice-task-api${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.message || `Mailo error (${response.status})`);
  return data;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let deviceId: string | null = null;
  let action = "unknown";
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await request.json().catch(() => ({}));
    action = String(body.action ?? "");

    if (action === "issue") {
      const user = await requireMainAdmin(request, admin);
      const rawToken = randomToken();
      const deviceName = String(body.deviceName || "Victor iPhone").trim().slice(0, 80);
      await admin.from("voice_device_tokens").update({ revoked_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("device_name", deviceName).is("revoked_at", null);
      const { error } = await admin.from("voice_device_tokens").insert({
        user_id: user.id,
        device_name: deviceName,
        token_hash: await sha256(rawToken),
      });
      if (error) throw error;
      return json({
        token: rawToken,
        endpoint: `${supabaseUrl}/functions/v1/siri-voice-task`,
        expiresInDays: 180,
      });
    }

    if (action === "revoke") {
      const user = await requireMainAdmin(request, admin);
      await admin.from("voice_device_tokens").update({ revoked_at: new Date().toISOString() })
        .eq("user_id", user.id).is("revoked_at", null);
      return json({ revoked: true });
    }

    const device = await requireDevice(request, admin);
    deviceId = device.id;

    if (action === "prepare") {
      const utterance = String(body.utterance ?? "").trim().slice(0, 10_000);
      if (!utterance) throw new Error("Δεν άκουσα κάποια εντολή.");
      const [{ data: profiles, error: profilesError }, { data: spaces, error: spacesError }] =
        await Promise.all([
          admin.from("profiles").select("full_name,email").neq("is_active", false).order("full_name"),
          admin.from("spaces").select("key,name").order("name"),
        ]);
      if (profilesError) throw profilesError;
      if (spacesError) throw spacesError;
      const parsed = await parseUtterance(utterance, profiles ?? [], spaces ?? []);
      const draft = await voiceApi("/drafts", parsed, serviceKey, supabaseUrl);
      await admin.from("voice_shortcut_requests").insert({
        device_token_id: device.id,
        action,
        succeeded: true,
      });
      return json({
        ...draft,
        spokenResponse: draft.summary,
      });
    }

    if (action === "confirm") {
      const answer = String(body.answer ?? "").trim().toLocaleLowerCase("el");
      if (/^(όχι|οχι|άκυρο|ακυρο|cancel|no)\b/.test(answer)) {
        await admin.from("voice_shortcut_requests").insert({
          device_token_id: device.id,
          action: "cancel",
          succeeded: true,
        });
        return json({ cancelled: true, spokenResponse: "Η δημιουργία ακυρώθηκε." });
      }
      if (!/^(ναι|οκ|ok|προχώρα|προχωρα|δημιούργησέ το|δημιουργησε το|yes)\b/.test(answer)) {
        return json({
          needsConfirmation: true,
          spokenResponse: "Δεν κατάλαβα την απάντηση. Πες Ναι για δημιουργία ή Όχι για ακύρωση.",
        }, 422);
      }
      const result = await voiceApi(
        `/drafts/${encodeURIComponent(String(body.draftId ?? ""))}/confirm`,
        { confirmationToken: body.confirmationToken },
        serviceKey,
        supabaseUrl,
      );
      await admin.from("voice_shortcut_requests").insert({
        device_token_id: device.id,
        action,
        succeeded: true,
      });
      return json({
        ...result,
        spokenResponse: `Το ${result.taskKey} δημιουργήθηκε επιτυχώς.`,
      });
    }

    throw new Error("Άγνωστη ενέργεια Siri.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("siri-voice-task", message);
    if (deviceId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(supabaseUrl, serviceKey);
      await admin.from("voice_shortcut_requests").insert({
        device_token_id: deviceId,
        action,
        succeeded: false,
        error_message: message.slice(0, 2000),
      });
    }
    const status = message.includes("Main Admin") || message.includes("συσκευή") ||
        message.includes("λήξει")
      ? 401
      : message.includes("πάρα πολλές")
      ? 429
      : 400;
    return json({ error: message, spokenResponse: message }, status);
  }
});

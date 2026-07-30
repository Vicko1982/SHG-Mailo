import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const instructions = `
Είσαι ο φωνητικός βοηθός δημιουργίας Tasks του Mailo. Μιλάς πάντα ελληνικά, σύντομα και καθαρά.

Κανόνες:
- «Δημιούργησε Task» σημαίνει κανονικό Task. «Δημιούργησε Mini Task» σημαίνει Mini Task.
- Αναγνωρίσιμο όνομα στην εντολή είναι ο Assignee. Μετέτρεψε ελληνικά μικρά ονόματα στο πληρέστερο πιθανό όνομα, αλλά το εργαλείο θα κάνει τον οριστικό έλεγχο.
- Για Mini Task ο Assignee είναι υποχρεωτικός. Αν λείπει, ρώτησε μόνο ποιος είναι ο Assignee.
- Αν η εκφώνηση είναι μεγάλη, βάλε σύντομο, σαφή τίτλο και τις υπόλοιπες πληροφορίες στο description.
- Χρησιμοποίησε prepare_voice_task μόλις έχεις type, title και, για Mini Task, assignee.
- Μετά το αποτέλεσμα του prepare_voice_task διάβασε ακριβώς το summary και περίμενε ρητό «Ναι».
- Μην ξανακάνεις περίληψη και μη ζητάς δεύτερη επιβεβαίωση.
- Με «Ναι», «ΟΚ», «προχώρα» ή «δημιούργησέ το», κάλεσε confirm_voice_task.
- Με «Όχι» ή «άκυρο», κάλεσε cancel_voice_task.
- Μια διόρθωση ενημερώνει το υπάρχον draft: κάλεσε ξανά prepare_voice_task με όλα τα ενημερωμένα στοιχεία.
- Μην ισχυριστείς ποτέ ότι δημιουργήθηκε Task πριν επιστρέψει επιτυχώς το confirm_voice_task.
- Σε αποτυχία, πες το πραγματικό error του εργαλείου.
- Μην αναφέρεις πεδία Unassigned, None ή προεπιλεγμένες τιμές.
`;

const tools = [
  {
    type: "function",
    name: "prepare_voice_task",
    description: "Validate the requested Task against Mailo and create a temporary draft for confirmation.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["task", "mini_task"] },
        title: { type: "string" },
        description: { type: ["string", "null"] },
        space: { type: ["string", "null"] },
        assignee: { type: ["string", "null"] },
        supervisor: { type: ["string", "null"] },
        priority: { type: ["string", "null"], enum: ["Highest", "High", "Medium", "Low", "Lowest", null] },
        dueDate: { type: ["string", "null"], description: "YYYY-MM-DD, or null" },
        labels: { type: "array", items: { type: "string" } },
        explicitFields: {
          type: "array",
          items: { type: "string", enum: ["space", "assignee", "supervisor", "priority", "dueDate", "labels"] },
        },
      },
      required: ["type", "title", "description", "space", "assignee", "supervisor", "priority", "dueDate", "labels", "explicitFields"],
    },
  },
  {
    type: "function",
    name: "confirm_voice_task",
    description: "Create the currently prepared Mailo Task after the user explicitly confirms.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    type: "function",
    name: "cancel_voice_task",
    description: "Cancel the current draft when the user says no or cancel.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authenticatedMainAdmin(request: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Unauthorized");
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData.user) throw new Error("Unauthorized");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: roles } = await admin.from("user_roles").select("role")
    .eq("user_id", authData.user.id);
  if (!roles?.some((row) => row.role === "main_admin")) {
    throw new Error("Voice Task is available only to the Main Admin.");
  }
  return { user: authData.user, admin };
}

async function safetyIdentifier(userId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 64);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const { user, admin } = await authenticatedMainAdmin(request);
    const body = await request.json().catch(() => ({}));

    if (body.action === "log") {
      await admin.from("voice_realtime_usage").insert({
        user_id: user.id,
        session_id: String(body.sessionId || "").slice(0, 120) || null,
        duration_seconds: Math.max(0, Math.round(Number(body.durationSeconds) || 0)),
        usage: body.usage && typeof body.usage === "object" ? body.usage : {},
        error_message: body.error ? String(body.error).slice(0, 2000) : null,
      });
      return json({ logged: true });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("Το OPENAI_API_KEY δεν έχει ρυθμιστεί στο Supabase.");
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": await safetyIdentifier(user.id),
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime-2.1",
          instructions,
          reasoning: { effort: "low" },
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 650,
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice: "marin" },
          },
          tools,
          tool_choice: "auto",
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || `OpenAI Realtime error (${response.status})`);
    }
    return json(data);
  } catch (error) {
    console.error("voice-realtime-session", error);
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Unauthorized" ? 401 : message.includes("Main Admin") ? 403 : 400;
    return json({ error: message }, status);
  }
});

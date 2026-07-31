import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

async function requireMainAdmin(request: Request, admin: ReturnType<typeof createClient>) {
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Authentication is required.");
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new Error("Your session is no longer valid.");
  const { data: roles, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", authData.user.id);
  if (roleError) throw roleError;
  if (!roles?.some((row) => row.role === "main_admin")) {
    throw new Error("Import Voice Memos is available only to the Main Admin.");
  }
  return authData.user;
}

async function digest(file: File) {
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function resolveNamed<T extends { name: string; voiceNames?: string[]; aliases?: string[] }>(entries: T[], value: unknown) {
  const wanted = normalize(value);
  if (!wanted) return null;
  const names = (entry: T) => [entry.name, ...(entry.voiceNames ?? []), ...(entry.aliases ?? [])].map(normalize).filter(Boolean);
  const exactMatches = entries.filter((entry) => names(entry).includes(wanted));
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;
  const matches = entries.filter((entry) => {
    return names(entry).some(name => name.startsWith(wanted) || name.split(" ").includes(wanted));
  });
  return matches.length === 1 ? matches[0] : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) throw new Error("The OpenAI connection has not been configured.");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await requireMainAdmin(request, admin);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Select an audio file.");
    if (file.size > 25 * 1024 * 1024) {
      throw new Error(`${file.name} is larger than the 25 MB processing limit.`);
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["m4a", "mp3", "mp4", "mpeg", "mpga", "wav", "webm"].includes(extension ?? "")) {
      throw new Error(`${file.name} is not a supported audio file.`);
    }

    const [{ data: profileRows, error: profilesError }, { data: spaceRows, error: spacesError }] =
      await Promise.all([
        admin.from("profiles").select("id,full_name,email,is_active,voice_names,aliases").neq("is_active", false).order("full_name"),
        admin.from("spaces").select("id,key,name,type").order("name"),
      ]);
    if (profilesError) throw profilesError;
    if (spacesError) throw spacesError;
    const profiles = (profileRows ?? []).map((row) => ({
      id: row.id,
      name: row.full_name,
      email: row.email,
      voiceNames: row.voice_names ?? [],
      aliases: row.aliases ?? [],
    }));
    const spaces = (spaceRows ?? []).map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      type: row.type,
    }));

    const transcriptionForm = new FormData();
    transcriptionForm.set("file", file, file.name);
    transcriptionForm.set("model", "gpt-transcribe");
    transcriptionForm.set("languages[]", "el");
    transcriptionForm.set("languages[]", "en");
    transcriptionForm.set(
      "prompt",
      "Mailo task instruction in Greek or English. Preserve names, dates, Spaces, priorities and labels accurately.",
    );
    for (const profile of profiles) for (const name of [profile.name,...profile.voiceNames,...profile.aliases]) transcriptionForm.append("keywords[]", name);
    for (const space of spaces) transcriptionForm.append("keywords[]", space.name);
    const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: transcriptionForm,
    });
    const transcription = await transcriptionResponse.json();
    if (!transcriptionResponse.ok) {
      throw new Error(transcription?.error?.message || "The recording could not be transcribed.");
    }
    const transcript = String(transcription.text ?? "").trim();
    if (!transcript) throw new Error("No spoken instruction was detected.");

    const completionResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "mailo_voice_memo",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: [
                "type", "title", "description", "space", "assignee", "supervisor",
                "priority", "dueDate", "labels",
              ],
              properties: {
                type: { type: "string", enum: ["task", "mini_task"] },
                title: { type: "string" },
                description: { type: ["string", "null"] },
                space: { type: ["string", "null"] },
                assignee: { type: ["string", "null"] },
                supervisor: { type: ["string", "null"] },
                priority: {
                  type: ["string", "null"],
                  enum: ["Highest", "High", "Medium", "Low", "Lowest", null],
                },
                dueDate: { type: ["string", "null"] },
                labels: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        messages: [
          {
            role: "system",
            content: `Convert one spoken instruction into one Mailo Task draft.
Rules:
- "Task" means task; "Mini Task" means mini_task.
- Detect the language used in the transcript and write title and description in that same language.
- Never translate Greek speech into English or English speech into Greek unless the speaker explicitly asks for translation.
- Preserve the speaker's wording and proper names; only shorten a long instruction into a concise title and move the remaining detail into description.
- Title is required. Keep it concise (ideally under 90 characters). Put remaining useful detail in description.
- Default Space is Internal & Miscellaneous. Return null if no Space is explicitly stated.
- A person's name appearing in the work/title is NOT an Assignee.
- Set assignee only when assignment is explicit, for example "Assignee", "assign to", "ανάθεσε", "υπεύθυνος".
- Set supervisor only when explicitly stated.
- Mini Tasks require an explicit Assignee, but do not invent one.
- Default priority is Medium; return null when not explicitly stated.
- Return dueDate as YYYY-MM-DD only when explicitly stated; otherwise null.
- Do not invent labels.
Current date: ${new Date().toISOString().slice(0, 10)}
Users and voice aliases: ${profiles.map((profile) => `${profile.name} [${[...profile.voiceNames,...profile.aliases].join("; ")}]`).join(", ")}
Spaces: ${spaces.map((space) => `${space.key}: ${space.name}`).join(", ")}`,
          },
          { role: "user", content: transcript },
        ],
      }),
    });
    const completion = await completionResponse.json();
    if (!completionResponse.ok) {
      throw new Error(completion?.error?.message || "The Task details could not be extracted.");
    }
    const extracted = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    const defaultSpace = spaces.find((space) =>
      normalize(space.key) === "imi" || normalize(space.name) === "internal & miscellaneous"
    );
    const selectedSpace = extracted.space
      ? resolveNamed(spaces, extracted.space) ||
        spaces.find((space) => normalize(space.key) === normalize(extracted.space))
      : defaultSpace;
    if (!selectedSpace) throw new Error(`The Space “${extracted.space}” could not be matched.`);
    const assignee = resolveNamed(profiles, extracted.assignee);
    const supervisor = resolveNamed(profiles, extracted.supervisor);
    const title = String(extracted.title ?? "").trim();
    if (!title) throw new Error("The recording did not contain a usable Task title.");

    return json({
      fileName: file.name,
      sourceHash: await digest(file),
      transcript,
      draft: {
        type: extracted.type === "mini_task" ? "mini_task" : "task",
        title: title.slice(0, 180),
        description: String(extracted.description ?? "").trim(),
        project: selectedSpace.key,
        spaceName: selectedSpace.name,
        assignee: assignee?.name ?? "Unassigned",
        supervisor: supervisor?.name ?? "Unassigned",
        priority: extracted.priority ?? "Medium",
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(extracted.dueDate ?? ""))
          ? extracted.dueDate
          : null,
        labels: Array.isArray(extracted.labels)
          ? [...new Set(extracted.labels.map((label: unknown) => String(label).trim()).filter(Boolean))].slice(0, 20)
          : [],
      },
      warnings: [
        extracted.assignee && !assignee ? `Assignee “${extracted.assignee}” was not recognized.` : null,
        extracted.supervisor && !supervisor ? `Supervisor “${extracted.supervisor}” was not recognized.` : null,
        extracted.type === "mini_task" && !assignee ? "Mini Task requires an Assignee." : null,
      ].filter(Boolean),
    });
  } catch (error) {
    console.error("import-voice-memo", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

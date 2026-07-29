import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "npm:nodemailer@6.9.16";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HOURLY_LIMIT = 300;
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 4;
const RETRY_MINUTES = [5, 15, 30, 60];

type Payload = {
  processQueue?: boolean;
  notificationType?: "mention" | "comment" | "task_created";
  taskId?: string;
  commentId?: string;
  taskKey?: string;
  taskTitle?: string;
  comment?: string;
  authorName?: string;
  mentionedNames?: string[];
  recipientRoles?: Record<string, string[]>;
};

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean | null;
};

type QueueJob = {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  author_name: string;
  task_key: string;
  task_title: string;
  comment_text: string;
  task_url: string;
  attempt_count: number;
  notification_type?: string;
  recipient_context?: { roles?: string[] };
};

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function mentionsProfile(content: string, profileName: string): boolean {
  const escaped = profileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)@${escaped}(?=\\s|[.,!?;:]|$)`, "i").test(content);
}

function resolveRequestedProfiles(profiles: Profile[], names: string[]): Profile[] {
  const resolved = new Map<string, Profile>();
  for (const requestedName of names) {
    const wanted = normalize(requestedName);
    const exact = profiles.find((profile) => normalize(profile.full_name ?? "") === wanted);
    const prefixMatches = profiles.filter((profile) =>
      normalize(profile.full_name ?? "").startsWith(`${wanted} `)
    );
    const profile = exact ?? (prefixMatches.length === 1 ? prefixMatches[0] : undefined);
    if (profile?.email && profile.is_active !== false) resolved.set(profile.id, profile);
  }
  return [...resolved.values()];
}

function mailContent(job: QueueJob) {
  const roles = [...new Set(job.recipient_context?.roles ?? [])];
  const roleText = roles.length > 1
    ? `${roles.slice(0, -1).join(", ")} and ${roles.at(-1)}`
    : roles[0] ?? "participant";
  if (job.notification_type === "task_created") {
    const subject = `New task — you are ${roleText}: ${job.task_key}`;
    const text = [
      `${job.author_name} created a new task in SHG Task Manager.`,
      `You are the ${roleText} for this task.`,
      "",
      `Task: ${job.task_key} — ${job.task_title}`,
      "",
      `Open task: ${job.task_url}`,
    ].join("\n");
    const html = `
      <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55;max-width:640px">
        <h2 style="margin:0 0 18px">A new task was created</h2>
        <p><strong>${escapeHtml(job.author_name)}</strong> created this task and you are the <strong>${escapeHtml(roleText)}</strong>.</p>
        <div style="padding:16px;border:1px solid #dfe5ee;border-radius:10px;background:#f8fafc">
          <div style="font-size:12px;color:#667085;margin-bottom:5px">${escapeHtml(job.task_key)}</div>
          <div style="font-size:18px;font-weight:700">${escapeHtml(job.task_title)}</div>
        </div>
        <p style="margin:22px 0">
          <a href="${escapeHtml(job.task_url)}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#316ff6;color:white;text-decoration:none;font-weight:700">Open Task</a>
        </p>
      </div>`;
    return { subject, text, html };
  }
  if (job.notification_type === "comment") {
    const wasMentioned = roles.includes("Mention");
    const reason = wasMentioned
      ? `${job.author_name} mentioned you in this comment.`
      : `You received this email because you are the ${roleText} for this task.`;
    const subject = wasMentioned
      ? `${job.author_name} mentioned you in ${job.task_key}`
      : `New comment in ${job.task_key}`;
    const text = [
      reason,
      "",
      `Task: ${job.task_key} — ${job.task_title}`,
      `Comment: ${job.comment_text}`,
      "",
      `Open task: ${job.task_url}`,
    ].join("\n");
    const html = `
      <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55;max-width:640px">
        <h2 style="margin:0 0 18px">A new task comment was added</h2>
        <p>${escapeHtml(reason)}</p>
        <div style="padding:16px;border:1px solid #dfe5ee;border-radius:10px;background:#f8fafc">
          <div style="font-size:12px;color:#667085;margin-bottom:5px">${escapeHtml(job.task_key)}</div>
          <div style="font-size:18px;font-weight:700">${escapeHtml(job.task_title)}</div>
        </div>
        <p style="margin:18px 0 6px;font-weight:700">Comment</p>
        <div style="padding:14px 16px;border-left:4px solid #316ff6;background:#f4f7ff;white-space:pre-wrap">${escapeHtml(job.comment_text)}</div>
        <p style="margin:22px 0"><a href="${escapeHtml(job.task_url)}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#316ff6;color:white;text-decoration:none;font-weight:700">Open Task</a></p>
      </div>`;
    return { subject, text, html };
  }
  const subject = `${job.author_name} mentioned you in ${job.task_key}`;
  const text = [
    `${job.author_name} mentioned you in a comment.`,
    "",
    `Task: ${job.task_key} — ${job.task_title}`,
    `Comment: ${job.comment_text}`,
    "",
    `Open task: ${job.task_url}`,
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55;max-width:640px">
      <h2 style="margin:0 0 18px">You were mentioned in SHG Task Manager</h2>
      <p><strong>${escapeHtml(job.author_name)}</strong> mentioned you in a comment.</p>
      <div style="padding:16px;border:1px solid #dfe5ee;border-radius:10px;background:#f8fafc">
        <div style="font-size:12px;color:#667085;margin-bottom:5px">${escapeHtml(job.task_key)}</div>
        <div style="font-size:18px;font-weight:700">${escapeHtml(job.task_title)}</div>
      </div>
      <p style="margin:18px 0 6px;font-weight:700">Comment</p>
      <div style="padding:14px 16px;border-left:4px solid #316ff6;background:#f4f7ff;white-space:pre-wrap">${escapeHtml(job.comment_text)}</div>
      <p style="margin:22px 0">
        <a href="${escapeHtml(job.task_url)}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#316ff6;color:white;text-decoration:none;font-weight:700">Open Task</a>
      </p>
      <p style="font-size:12px;color:#667085">If sign-in is required, use the 8-digit code sent to your email. You will then return to this task.</p>
    </div>`;
  return { subject, text, html };
}

async function processQueue(admin: ReturnType<typeof createClient>) {
  const smtpPassword = Deno.env.get("ZOHO_SMTP_PASSWORD");
  if (!smtpPassword) throw new Error("Mention email SMTP is not configured");

  const { data, error } = await admin.rpc("claim_mention_email_jobs", {
    maximum_per_hour: HOURLY_LIMIT,
    maximum_batch_size: BATCH_SIZE,
  });
  if (error) throw error;
  const jobs = (data ?? []) as QueueJob[];
  if (!jobs.length) return { processed: 0, sent: 0, retrying: 0, failed: 0 };

  const smtpHost = Deno.env.get("ZOHO_SMTP_HOST") ?? "smtppro.zoho.eu";
  const smtpPort = Number(Deno.env.get("ZOHO_SMTP_PORT") ?? "465");
  const smtpUser = Deno.env.get("ZOHO_SMTP_USER") ?? "info@shd.global";
  const sender = Deno.env.get("MENTION_EMAIL_FROM") ?? "no-reply@shd.global";
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPassword },
  });

  let sent = 0;
  let retrying = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const content = mailContent(job);
      await transporter.sendMail({
        from: `"SHG Task Manager" <${sender}>`,
        to: job.recipient_email,
        ...content,
      });
      const { error: updateError } = await admin.from("mention_email_queue").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      if (updateError) throw updateError;
      sent += 1;
    } catch (sendError) {
      const finalFailure = job.attempt_count >= MAX_ATTEMPTS;
      const retryDelay = RETRY_MINUTES[Math.min(job.attempt_count - 1, RETRY_MINUTES.length - 1)];
      const nextAttempt = new Date(Date.now() + retryDelay * 60_000).toISOString();
      await admin.from("mention_email_queue").update({
        status: finalFailure ? "failed" : "retrying",
        next_attempt_at: nextAttempt,
        last_error: sendError instanceof Error ? sendError.message.slice(0, 1_000) : String(sendError).slice(0, 1_000),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      if (finalFailure) failed += 1;
      else retrying += 1;
    }
  }
  return { processed: jobs.length, sent, retrying, failed };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const payload = (await request.json()) as Payload;
    const notificationType = payload.notificationType === "task_created"
      ? "task_created"
      : payload.notificationType === "comment"
      ? "comment"
      : "mention";

    // The public cron wake-up can only process rows that already exist in the
    // protected queue. It cannot choose recipients or create email content.
    if (payload.processQueue) {
      const result = await processQueue(admin);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Authentication required");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) throw new Error("Invalid session");

    const { data: callerProfile } = await admin
      .from("profiles")
      .select("id, full_name, email, is_active")
      .eq("id", authData.user.id)
      .single();
    if (!callerProfile || callerProfile.is_active === false) throw new Error("Inactive user");

    let taskId: string | null = null;
    let taskKey = String(payload.taskKey ?? "").trim();
    let taskTitle = String(payload.taskTitle ?? "").trim();
    let comment = String(payload.comment ?? "").trim();
    let commentId = String(payload.commentId ?? "").trim();
    const authorName = String(callerProfile.full_name ?? payload.authorName ?? authData.user.email ?? "User");
    const requestedNames = Array.isArray(payload.mentionedNames)
      ? payload.mentionedNames.map(String)
      : [];

    if (payload.taskId && payload.commentId) {
      const [{ data: task, error: taskError }, { data: savedComment, error: commentError }] =
        await Promise.all([
          admin.from("tasks").select("id, task_key, title").eq("id", payload.taskId).single(),
          admin.from("task_comments").select("id, task_id, author_id, content")
            .eq("id", payload.commentId).eq("task_id", payload.taskId)
            .eq("author_id", authData.user.id).single(),
        ]);
      if (taskError || !task) throw new Error("Task not found");
      if (commentError || !savedComment) throw new Error("Comment not found");
      taskId = task.id;
      taskKey = task.task_key;
      taskTitle = task.title;
      comment = savedComment.content;
      commentId = savedComment.id;
    }

    if (notificationType === "task_created") {
      comment = "A new task was created.";
      commentId = `task-created:${taskKey}`;
    }
    if (!taskKey || !taskTitle || !comment || !commentId) {
      throw new Error("Missing task or comment details");
    }
    if (comment.length > 10_000 || taskTitle.length > 500 || taskKey.length > 100) {
      throw new Error("Notification content is too long");
    }

    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id, full_name, email, is_active");
    if (profilesError) throw profilesError;
    const activeProfiles = (profiles ?? []) as Profile[];
    let recipients = requestedNames.length
      ? resolveRequestedProfiles(activeProfiles, requestedNames)
      : activeProfiles.filter((profile) =>
        !!profile.full_name && !!profile.email && profile.is_active !== false &&
        mentionsProfile(comment, profile.full_name)
      );
    recipients = recipients.filter((profile) => profile.id !== authData.user.id);

    const appUrl = (Deno.env.get("SHG_APP_URL") ?? "https://mailo.shd.global").replace(/\/+$/, "");
    const taskUrl = `${appUrl}/?task=${encodeURIComponent(taskKey)}`;
    const queueRows = recipients.map((recipient) => ({
      dedupe_key: `${notificationType}:${commentId}:${recipient.id}`,
      notification_type: notificationType,
      recipient_profile_id: recipient.id,
      recipient_email: recipient.email!,
      recipient_name: recipient.full_name,
      author_id: authData.user.id,
      author_name: authorName,
      task_id: taskId,
      task_key: taskKey,
      task_title: taskTitle,
      comment_id: commentId,
      comment_text: comment,
      task_url: taskUrl,
      recipient_context: {
        roles: [...new Set(
          Object.entries(payload.recipientRoles ?? {})
            .find(([name]) => normalize(name) === normalize(recipient.full_name ?? ""))?.[1] ?? [],
        )],
      },
    }));
    if (queueRows.length) {
      const { error: queueError } = await admin.from("mention_email_queue")
        .upsert(queueRows, { onConflict: "dedupe_key", ignoreDuplicates: true });
      if (queueError) throw queueError;
    }

    let delivery = { processed: 0, sent: 0, retrying: 0, failed: 0 };
    let deliveryError: string | null = null;
    try {
      delivery = await processQueue(admin);
    } catch (error) {
      // The queue insert is the source of truth. A temporary SMTP failure must
      // never undo or hide a successfully saved mention notification.
      deliveryError = error instanceof Error ? error.message : String(error);
      console.error("Immediate mention delivery deferred", error);
    }
    await admin.from("activity_log").insert({
      user_id: authData.user.id,
      action: "mention_email_queued",
      task_id: taskId,
      task_title: taskTitle,
      metadata: {
        task_key: taskKey,
        comment_id: commentId,
        queued: queueRows.length,
        delivery_error: deliveryError,
        ...delivery,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      queued: queueRows.length,
      deliveryError,
      ...delivery,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-mention-email", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

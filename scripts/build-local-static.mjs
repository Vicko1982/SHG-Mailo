import { mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceDir = join(root, "legacy-app");
const publicDir = join(root, "dist", "public");
const serverDir = join(root, "dist", "server");
const hostingDir = join(root, "dist", ".openai");
const initialStateFile = join(sourceDir, "initial-state.json");
// The same validated release source can produce either the temporary upgrade
// screen or the normal production application.
const maintenanceBuild = process.env.MAILO_MAINTENANCE_BUILD === "1";

await rm(join(root, "dist"), { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await mkdir(serverDir, { recursive: true });
await mkdir(hostingDir, { recursive: true });
await copyFile(
  join(root, ".openai", "hosting.json"),
  join(hostingDir, "hosting.json"),
);

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(source)) {
    if (name === "initial-state.json") continue;
    const sourcePath = join(source, name);
    const destinationPath = join(destination, name);
    const entry = await stat(sourcePath);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else {
      await copyFile(sourcePath, destinationPath);
    }
  }
}

if (maintenanceBuild) {
  const maintenancePage = `<!doctype html>
<html lang="el">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MAILO · Αναβάθμιση</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0f2948;color:#172033;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(520px,100%);padding:42px 34px;border-radius:28px;background:#fff;box-shadow:0 28px 80px #07192d66;text-align:center}.mark{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 22px;border-radius:18px;background:#316ff6;color:#fff;font-size:25px;font-weight:900}.eyebrow{margin:0 0 10px;color:#72829a;font-size:12px;font-weight:800;letter-spacing:.14em}.card h1{margin:0 0 14px;font-size:clamp(28px,6vw,40px);line-height:1.08}.card p{margin:0;color:#52627a;font-size:18px;line-height:1.55}.loader{display:flex;justify-content:center;gap:8px;margin:26px 0 0}.loader i{width:10px;height:10px;border-radius:50%;background:#316ff6;animation:pulse 1.2s infinite}.loader i:nth-child(2){animation-delay:.18s}.loader i:nth-child(3){animation-delay:.36s}@keyframes pulse{0%,80%,100%{opacity:.28;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
  </style>
</head>
<body>
  <main class="card" role="status" aria-live="polite">
    <div class="mark">M</div>
    <p class="eyebrow">MAILO SYSTEM UPDATE</p>
    <h1>Γίνεται αναβάθμιση</h1>
    <p>Το MAILO είναι προσωρινά κλειδωμένο για την ασφαλή ολοκλήρωση της ενημέρωσης.<br><strong>Δοκιμάστε ξανά σε λίγα λεπτά.</strong></p>
    <div class="loader" aria-hidden="true"><i></i><i></i><i></i></div>
  </main>
</body>
</html>\n`;
  await writeFile(join(publicDir, "index.html"), maintenancePage);
} else {
  await copyDirectory(sourceDir, publicDir);
  await mkdir(join(publicDir, "vendor"), { recursive: true });
  await copyFile(
    join(root, "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js"),
    join(publicDir, "vendor", "supabase.js"),
  );

  const state = JSON.parse(await readFile(initialStateFile, "utf8"));
  const savedData = { ...(state.data ?? {}) };

  // v5 is the authoritative task store. Removing the old duplicate leaves more
  // browser storage available for comments and future changes.
  delete savedData["shg-tasks-v4"];

  const bootstrap = `(() => {
  const seed = ${JSON.stringify(savedData)};
  const taskKey = "shg-tasks-v5";
  if (localStorage.getItem(taskKey)) return;

  const orderedKeys = [taskKey, ...Object.keys(seed).filter((key) => key !== taskKey)];
  for (const key of orderedKeys) {
    try {
      localStorage.setItem(key, seed[key]);
    } catch (error) {
      console.warn("Could not restore local application data:", key, error);
    }
  }

  if (localStorage.getItem(taskKey)) {
    localStorage.setItem("shg-staging-seed-version", ${JSON.stringify(String(state.version ?? "current"))});
  }
})();\n`;

  await writeFile(join(publicDir, "bootstrap-data.js"), bootstrap);
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

async function listFiles(directory) {
  const files = [];
  for (const name of await readdir(directory)) {
    const fullPath = join(directory, name);
    const entry = await stat(fullPath);
    if (entry.isDirectory()) files.push(...(await listFiles(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

const assets = {};
for (const file of await listFiles(publicDir)) {
  const pathname = `/${relative(publicDir, file).split(sep).join("/")}`;
  assets[pathname] = {
    body: (await readFile(file)).toString("base64"),
    contentType: mimeTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
  };
}

const worker = `const assets = ${JSON.stringify(assets)};

function decode(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    let asset = assets[pathname];
    if (!asset && request.method === "GET" && (request.headers.get("accept") || "").includes("text/html")) {
      asset = assets["/index.html"];
    }

    if (!asset || !["GET", "HEAD"].includes(request.method)) {
      return new Response("Not found", { status: 404 });
    }

    const noCache = pathname.endsWith(".html") || pathname === "/bootstrap-data.js" || pathname === "/service-worker.js";
    return new Response(request.method === "HEAD" ? null : decode(asset.body), {
      headers: {
        "content-type": asset.contentType,
        "cache-control": noCache ? "no-cache, no-store, must-revalidate" : "public, max-age=300",
      },
    });
  },
};\n`;

await writeFile(join(serverDir, "index.js"), worker);

console.log(`Built ${maintenanceBuild ? "MAILO maintenance screen" : "local SHG application"} with ${Object.keys(assets).length} embedded assets.`);

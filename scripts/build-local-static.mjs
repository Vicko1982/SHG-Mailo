import { mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceDir = join(root, "legacy-app");
const publicDir = join(root, "dist", "public");
const serverDir = join(root, "dist", "server");
const initialStateFile = join(sourceDir, "initial-state.json");

await rm(join(root, "dist"), { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await mkdir(serverDir, { recursive: true });

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

await copyDirectory(sourceDir, publicDir);

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

console.log(`Built local SHG application with ${Object.keys(assets).length} embedded assets.`);

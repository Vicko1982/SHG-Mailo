import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const publicDir = join(root, "dist", "public");
const serverEntries = [
  join(root, "dist", "server", "index.js"),
  join(root, "dist", "server", "index.mjs"),
];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && entry.name !== "_headers") files.push(path);
  }

  return files;
}

const assets = {};
for (const file of await walk(publicDir)) {
  const pathname = `/${relative(publicDir, file).split("\\").join("/")}`;
  const contents = await readFile(file);
  assets[pathname] = {
    body: contents.toString("base64"),
    type: mimeTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
  };
}

const originalHandler = `var cloudflare_module_default = createHandler({ fetch(cfRequest, env, context, url) {
\tif (env.ASSETS && isPublicAssetURL(url.pathname)) return env.ASSETS.fetch(cfRequest);
} });`;

const inlineAssetSupport = `var __sites_inline_assets = ${JSON.stringify(assets)};
function __sites_inline_asset_response(request, url) {
\tconst asset = __sites_inline_assets[url.pathname];
\tif (!asset) return;
\tconst headers = new Headers({
\t\t"content-type": asset.type,
\t\t"cache-control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600"
\t});
\tif (request.method === "HEAD") return new Response(null, { status: 200, headers });
\tconst binary = atob(asset.body);
\tconst bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
\treturn new Response(bytes, { status: 200, headers });
}
var cloudflare_module_default = createHandler({ fetch(cfRequest, env, context, url) {
\tconst inlineAsset = __sites_inline_asset_response(cfRequest, url);
\tif (inlineAsset) return inlineAsset;
\tif (env.ASSETS && isPublicAssetURL(url.pathname)) return env.ASSETS.fetch(cfRequest);
} });`;

for (const entry of serverEntries) {
  const source = await readFile(entry, "utf8");
  if (!source.includes(originalHandler)) {
    throw new Error(`Could not find the Cloudflare asset handler in ${entry}`);
  }
  await writeFile(entry, source.replace(originalHandler, inlineAssetSupport));
}

console.log(`Embedded ${Object.keys(assets).length} static assets for Sites hosting.`);

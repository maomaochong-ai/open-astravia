/**
 * Bundle mcp/server.mjs for Astravia system-plugin install (read-only roots).
 * Sets COWART_ASTRAVIA paths at build time via env when running.
 */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "mcp", "server.mjs");
const outfile = path.join(root, "scripts", "cowart-mcp.bundle.mjs");

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile,
  packages: "bundle",
  // Force Astravia mode at bundle time so dead-code elimination drops tldraw/widget paths.
  define: {
    "process.env.COWART_ASTRAVIA": '"1"',
    "process.env.COWART_DISABLE_WIDGET": '"1"',
  },
  // Never pull optional canvas UI deps into the system-plugin MCP binary.
  external: [
    "tldraw",
    "@tldraw/*",
    "vite",
    "@vitejs/plugin-react",
    "./canvasSnapshot.js",
    "./lib/canvasSnapshot.js",
  ],
  banner: {
    js: [
      'import { createRequire as __cowartCreateRequire } from "node:module";',
      "const require = __cowartCreateRequire(import.meta.url);",
      'process.env.COWART_ASTRAVIA = process.env.COWART_ASTRAVIA || "1";',
      'process.env.COWART_DISABLE_WIDGET = process.env.COWART_DISABLE_WIDGET || "1";',
    ].join("\n"),
  },
  logLevel: "info",
});

console.log(`[cowart-astravia] wrote ${outfile}`);

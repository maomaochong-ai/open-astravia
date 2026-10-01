import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.COWART_ASTRAVIA = process.env.COWART_ASTRAVIA || "1";
process.env.COWART_PLUGIN_ROOT = process.env.COWART_PLUGIN_ROOT || ROOT_DIR;

const BUNDLE = path.join(ROOT_DIR, "scripts", "cowart-mcp.bundle.mjs");
const SERVER = path.join(ROOT_DIR, "mcp", "server.mjs");

const REQUIRED_DEPENDENCIES = [
  "@modelcontextprotocol/sdk",
  "fractional-indexing",
  "zod",
];

function dependencyDir(packageName) {
  return path.join(ROOT_DIR, "node_modules", ...packageName.split("/"));
}

function missingDependencies() {
  return REQUIRED_DEPENDENCIES.filter((packageName) => !existsSync(dependencyDir(packageName)));
}

function runNpmInstall() {
  const isWin = process.platform === "win32";
  const result = spawnSync(
    isWin ? "cmd.exe" : "npm",
    isWin ? ["/d", "/s", "/c", "npm", "install", "--omit=dev"] : ["install", "--omit=dev"],
    {
      cwd: ROOT_DIR,
      env: { ...process.env, FORCE_COLOR: "0" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm install failed while preparing Cowart MCP (exit ${result.status}).`);
  }
}

// Prefer prebuilt bundle (self-contained) for system plugin read-only roots.
// Do NOT process.exit after import: server.connect() resolves once the transport is
// ready, but the MCP process must keep running on stdio for the host client.
if (existsSync(BUNDLE)) {
  process.chdir(ROOT_DIR);
  await import(pathToFileURL(BUNDLE).href);
} else {
  if (missingDependencies().length > 0) {
    runNpmInstall();
  }
  process.chdir(ROOT_DIR);
  await import(pathToFileURL(SERVER).href);
}

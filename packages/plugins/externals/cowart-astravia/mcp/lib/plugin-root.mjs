import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// mcp/lib -> plugin root
const DEFAULT_PLUGIN_ROOT = path.resolve(MODULE_DIR, "..", "..");

export function pluginRoot() {
  return path.resolve(process.env.COWART_PLUGIN_ROOT || DEFAULT_PLUGIN_ROOT);
}

export function pluginPath(...parts) {
  return path.join(pluginRoot(), ...parts);
}

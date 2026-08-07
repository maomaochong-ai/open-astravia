import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.js";

/** Resolve the host-owned conversation directory shared by historical and native sessions. */
export function resolveCodingAgentSessionDir(cwd: string, sessionDir?: string): string {
	if (sessionDir) return sessionDir;
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const resolved = join(getAgentDir(), "sessions", safePath);
	if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true });
	return resolved;
}

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAstraviaHomePath } from "@astravia/action-rpc";

const CONFIG_PATH = join(getAstraviaHomePath(), "desktop-config.json");
const DEFAULT_WORKSPACE_PATH = join(getAstraviaHomePath(), "workspace");

function expandTilde(p: string): string {
	if (p.startsWith("~/") || p === "~") {
		return join(homedir(), p.slice(1));
	}
	return p;
}

export async function getWorkspacePath(): Promise<string> {
	try {
		const raw = await readFile(CONFIG_PATH, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (typeof parsed.workspacePath === "string") {
			return expandTilde(parsed.workspacePath);
		}
	} catch {
		// ignore
	}
	return DEFAULT_WORKSPACE_PATH;
}

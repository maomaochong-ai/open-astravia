import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@vetta/coding-agent/config";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import lockfile from "proper-lockfile";

function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

export function readAgentSettingsDocument(): Record<string, unknown> {
	const path = getSettingsPath();
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/** 与 Coding Agent 的 NodeScopedTextStorage 共用 `<path>.lock`，防止跨进程读改写覆盖。 */
export function updateAgentSettingsDocument(mutate: (settings: Record<string, unknown>) => void): void {
	const path = getSettingsPath();
	let release: (() => void) | undefined;
	try {
		if (existsSync(path)) release = lockfile.lockSync(path, { realpath: false });
		const settings = readAgentSettingsDocument();
		mutate(settings);
		atomicWriteJSON(path, settings);
	} finally {
		release?.();
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

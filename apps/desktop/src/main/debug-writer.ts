import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { RequestFileInfo } from "../preload/api.js";

const DEBUG_BASE = join(getVettaHomePath(), "debug");

export function getDebugBasePath(): string {
	return DEBUG_BASE;
}

export interface DebugRequestData {
	timestamp: number;
	sessionId: string;
	model: string;
	provider: string;
	api: string;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	};
	stopReason: string;
	durationMs: number;
	message: unknown;
}

export async function writeDebugRequest(
	projectName: string,
	sessionId: string,
	data: DebugRequestData,
	seq: number,
): Promise<string> {
	const dir = join(DEBUG_BASE, projectName, sessionId, "requests");
	await mkdir(dir, { recursive: true });
	const ts = data.timestamp;
	const filename = `${ts}_${String(seq).padStart(4, "0")}.json`;
	const filePath = join(dir, filename);
	await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
	return filePath;
}

export async function clearDebugDir(): Promise<void> {
	if (existsSync(DEBUG_BASE)) {
		await rm(DEBUG_BASE, { recursive: true, force: true });
	}
}

export function listRequestFiles(projectName: string, sessionId: string): RequestFileInfo[] {
	const dir = join(DEBUG_BASE, projectName, sessionId, "requests");
	if (!existsSync(dir)) return [];

	const files = readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.sort();
	const results: RequestFileInfo[] = [];

	for (const filename of files) {
		const filePath = join(dir, filename);
		try {
			const stat = statSync(filePath);
			const raw = readFileSync(filePath, "utf8");
			const data = JSON.parse(raw) as DebugRequestData;
			results.push({
				filename,
				path: filePath,
				model: data.model ?? "unknown",
				inputTokens: data.usage?.input ?? 0,
				outputTokens: data.usage?.output ?? 0,
				costTotal: data.usage?.cost?.total ?? 0,
				timestamp: data.timestamp ?? stat.mtimeMs,
				size: stat.size,
			});
		} catch {
			// skip corrupted files
		}
	}

	return results;
}

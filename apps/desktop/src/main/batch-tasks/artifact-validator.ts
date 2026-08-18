import { readdir } from "node:fs/promises";
import { minimatch } from "minimatch";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("batch-validator");

export interface ArtifactCheckResult {
	ok: boolean;
	missingPatterns: string[];
}

// 仅在子任务目录顶层匹配文件名，不递归子目录。
// 旨在"产物必须直接落在该任务目录里"——避免 LLM 把文件写进随机子目录后被误判通过。
export async function verifyArtifacts(cwd: string, patterns: string[] | undefined): Promise<ArtifactCheckResult> {
	if (!patterns || patterns.length === 0) {
		return { ok: true, missingPatterns: [] };
	}

	let topLevelFiles: string[] = [];
	try {
		const entries = await readdir(cwd, { withFileTypes: true });
		topLevelFiles = entries.filter((e) => e.isFile()).map((e) => e.name);
	} catch (err) {
		log.warn(`readdir(${cwd}) failed: ${err}`);
		return { ok: false, missingPatterns: [...patterns] };
	}

	const missing: string[] = [];
	for (const pattern of patterns) {
		const matched = topLevelFiles.some((name) => minimatch(name, pattern, { nocase: false, dot: true }));
		if (!matched) missing.push(pattern);
	}
	return { ok: missing.length === 0, missingPatterns: missing };
}

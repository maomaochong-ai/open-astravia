/**
 * Fast local gate for every file changed from a base ref, including committed,
 * staged, unstaged, and untracked files. Type checking remains in `bun run check`.
 *
 * Usage:
 *   bun run check:quick
 *   bun run check:quick --base origin/main
 *   bun run check:quick -- packages/ai/src/index.ts
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { changedFiles, isDirectRun, ok, parseFileSelectionArgs, repoRoot, runBun } from "./lib.mjs";

const MAX_BATCH_CHARS = 16_000;

export function isBiomeGlobalTrigger(file) {
	const normalized = file.replaceAll("\\", "/");
	return normalized === ".editorconfig" || /(?:^|\/)biome\.jsonc?$/.test(normalized);
}

export function batchPaths(paths, maxChars = MAX_BATCH_CHARS) {
	const batches = [];
	let batch = [];
	let batchChars = 0;
	for (const path of paths) {
		const nextChars = path.length + 3;
		if (batch.length > 0 && batchChars + nextChars > maxChars) {
			batches.push(batch);
			batch = [];
			batchChars = 0;
		}
		batch.push(path);
		batchChars += nextChars;
	}
	if (batch.length > 0) batches.push(batch);
	return batches;
}

export function createQuickCheckPlan(files, pathExists = (file) => existsSync(join(repoRoot, file))) {
	const normalizedFiles = [...new Set(files.map((file) => file.replaceAll("\\", "/")))].sort();
	const existingFiles = normalizedFiles.filter(pathExists);
	const fullBiome = normalizedFiles.some(isBiomeGlobalTrigger);
	return {
		biomeBatches: fullBiome ? [["."]] : batchPaths(existingFiles),
		existingFiles,
		fullBiome,
	};
}

function runBiome(plan) {
	if (plan.biomeBatches.length === 0) {
		ok("[check:quick] no existing changed files for Biome; skip lint");
		return 0;
	}

	let failed = 0;
	for (const batch of plan.biomeBatches) {
		const code = runBun([
			"x",
			"@biomejs/biome",
			"check",
			"--error-on-warnings",
			"--no-errors-on-unmatched",
			...batch,
		]);
		if (code !== 0) failed = code;
	}
	return failed;
}

export function main(args = process.argv.slice(2)) {
	try {
		const selection = parseFileSelectionArgs(args);
		const files = selection.files.length > 0 ? selection.files : changedFiles(selection.base);
		console.log(
			selection.files.length > 0
				? `[check:quick] scope=explicit files=${selection.files.length}`
				: `[check:quick] scope=git base=${selection.base}`,
		);
		console.log(`[check:quick] changed files: ${files.length}`);
		if (files.length === 0) {
			ok("[check:quick] no changed files; skip");
			return 0;
		}

		const plan = createQuickCheckPlan(files);
		if (plan.fullBiome) {
			console.log("[check:quick] Biome config changed; running full Biome check");
		} else {
			console.log(`[check:quick] Biome targets: ${plan.existingFiles.length}`);
		}

		const biomeCode = runBiome(plan);
		const guardCode = runBun(["run", "check:guards"]);
		return biomeCode || guardCode;
	} catch (error) {
		console.error(`[check:quick] ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}

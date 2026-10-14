/**
 * Check changed files by default. --full keeps the explicit source-root scan.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { changedFiles, isDirectRun, parseFileSelectionArgs, repoRoot, runBun } from "./lib.mjs";

const MAX_BATCH_CHARS = 16_000;

const PACKAGE_SUBDIRS = ["src", "test"];
const ROOT_TARGETS = [
	"package.json",
	"knip.config.ts",
	"scripts/quality",
	"packages/coding-agent/examples",
	"packages/runtime-core/examples",
];

export function collectBiomeTargets() {
	const targets = [...ROOT_TARGETS];
	for (const workspaceRoot of ["packages", "apps"]) {
		const workspaceDir = join(repoRoot, workspaceRoot);
		for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			for (const subdir of PACKAGE_SUBDIRS) {
				const target = join(workspaceDir, entry.name, subdir);
				if (existsSync(target)) targets.push(relative(repoRoot, target));
			}
		}
	}
	return targets.sort();
}

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

export function createLintPlan(files, pathExists = (file) => existsSync(join(repoRoot, file))) {
	const normalizedFiles = [...new Set(files.map((file) => file.replaceAll("\\", "/")))].sort();
	const existingFiles = normalizedFiles.filter(pathExists);
	const fullBiome = normalizedFiles.some(isBiomeGlobalTrigger);
	return {
		biomeBatches: fullBiome ? [["."]] : batchPaths(existingFiles),
		existingFiles,
		fullBiome,
	};
}

export function parseLintArgs(args) {
	const full = args.includes("--full");
	const write = args.includes("--write");
	const selectionArgs = args.filter((arg) => arg !== "--full" && arg !== "--write");
	const selection = parseFileSelectionArgs(selectionArgs);
	if (full && selectionArgs.some((arg) => arg !== "--")) {
		throw new Error("--full cannot be combined with file or base selection");
	}
	return { ...selection, full, write };
}

export function runLintPlan(plan, { write = false, run = runBun } = {}) {
	let failed = 0;
	for (const batch of plan.biomeBatches) {
		const code = run([
			"x",
			"@biomejs/biome",
			"check",
			"--error-on-warnings",
			"--no-errors-on-unmatched",
			...(write ? ["--write"] : []),
			...batch,
		]);
		if (code !== 0) failed = code;
	}
	return failed;
}

export function main(args = process.argv.slice(2), { getChangedFiles = changedFiles, pathExists, run = runBun } = {}) {
	const started = performance.now();
	try {
		const selection = parseLintArgs(args);
		if (selection.full) {
			console.log("[check:lint] scope=full");
			return runLintPlan({ biomeBatches: batchPaths(collectBiomeTargets()) }, { write: selection.write, run });
		}
		const files = selection.files.length > 0 ? selection.files : getChangedFiles(selection.base);
		const plan = createLintPlan(files, pathExists);
		console.log(
			selection.files.length > 0
				? `[check:lint] scope=explicit files=${selection.files.length}`
				: `[check:lint] scope=git base=${selection.base}`,
		);
		console.log(
			`[check:lint] Biome targets: ${plan.fullBiome ? "full (configuration changed)" : plan.existingFiles.length}`,
		);
		if (plan.biomeBatches.length === 0) console.log("[check:lint] no existing changed files; skip");
		return runLintPlan(plan, { write: selection.write, run });
	} catch (error) {
		console.error(`[check:lint] ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	} finally {
		console.log(`[check:lint] elapsed=${((performance.now() - started) / 1000).toFixed(3)}s`);
	}
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}

/**
 * Run vitest only for testable packages touched vs base ref (default origin/dev).
 *
 * Usage:
 *   bun run test:changed
 *   bun run test:changed --base origin/main
 *   bun run test:changed -- packages/runtime-core/src/index.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changedFiles, git, isDirectRun, parseFileSelectionArgs, repoRoot, WORKSPACE_PACKAGES } from "./lib.mjs";
import { changedLockfileWorkspaceImpacts } from "./lockfile-impact.mjs";
import { createImpactTestPlan, runImpactTestPlan } from "./test-impact.mjs";

export const parseArgs = parseFileSelectionArgs;

export function createChangedTestPlan(
	files,
	lockfileImpacts = [],
	pathExists = (file) => existsSync(join(repoRoot, file)),
) {
	return createImpactTestPlan(files, pathExists, { lockfileImpacts });
}

function lockfileImpact(base) {
	const mergeBase = git(["merge-base", "HEAD", base]);
	const before = git(["show", `${mergeBase}:bun.lock`]);
	const after = readFileSync(join(repoRoot, "bun.lock"), "utf8");
	return changedLockfileWorkspaceImpacts(before, after, WORKSPACE_PACKAGES);
}

export function main(args = process.argv.slice(2)) {
	try {
		const selection = parseArgs(args);
		const files = selection.files.length > 0 ? selection.files : changedFiles(selection.base);
		const hasLockfileChange = files.some((file) => file.replaceAll("\\", "/") === "bun.lock");
		const changedLockfileImpacts = hasLockfileChange ? lockfileImpact(selection.base) : [];
		const plan = createChangedTestPlan(files, changedLockfileImpacts);

		console.log(
			selection.files.length > 0
				? `[test:changed] scope=explicit files=${selection.files.length}`
				: `[test:changed] scope=git base=${selection.base}`,
		);
		console.log(`[test:changed] changed files: ${files.length}`);
		if (hasLockfileChange) {
			const impactSummary = plan.lockfileImpacts
				.map(({ key, dependencies }) => `${key}(${dependencies.join(", ") || "unknown"})`)
				.join(", ");
			console.log(`[test:changed] lockfile affected dependencies: ${impactSummary || "(none)"}`);
		}
		if (plan.runQuality) console.log(`[test:changed] quality tests: ${plan.qualityTests.join(", ")}`);
		for (const target of plan.targets) {
			const mode = `direct=${target.directTests.length}, related=${target.relatedSources.length}`;
			console.log(`[test:changed] ${target.key}: ${mode}`);
		}
		if (plan.selectionErrors.length > 0) {
			console.error(`[test:changed] cannot select tests: ${plan.selectionErrors.join("; ")}`);
		}
		return runImpactTestPlan(plan);
	} catch (error) {
		console.error(`[test:changed] ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}

/**
 * Fast local gate for every file changed from a base ref, including committed,
 * staged, unstaged, and untracked files. Type checking remains in `bun run check`.
 *
 * Usage:
 *   bun run check:quick
 *   bun run check:quick --base origin/main
 *   bun run check:quick -- packages/ai/src/index.ts
 */

import { createQuickGuardPlan, runGuardPlan } from "./check-guards.mjs";
import { createLintPlan, runLintPlan } from "./check-lint.mjs";
import { changedFiles, isDirectRun, ok, parseFileSelectionArgs } from "./lib.mjs";

export { batchPaths, createLintPlan as createQuickCheckPlan, isBiomeGlobalTrigger } from "./check-lint.mjs";

export async function main(args = process.argv.slice(2)) {
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

		const plan = createLintPlan(files);
		if (plan.fullBiome) {
			console.log("[check:quick] Biome config changed; running full Biome check");
		} else {
			console.log(`[check:quick] Biome targets: ${plan.existingFiles.length}`);
		}

		const biomeCode = runLintPlan(plan);
		const guardPlan = createQuickGuardPlan(files);
		console.log(`[check:quick] guards: ${guardPlan.map(([id]) => id).join(", ") || "(none)"}`);
		const guardCode = await runGuardPlan(guardPlan);
		return biomeCode || guardCode;
	} catch (error) {
		console.error(`[check:quick] ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

if (isDirectRun(import.meta.url)) {
	process.exit(await main());
}

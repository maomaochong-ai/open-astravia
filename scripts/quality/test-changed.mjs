/**
 * Run vitest only for testable packages touched vs base ref (default origin/dev).
 *
 * Usage:
 *   bun run test:changed
 *   bun run test:changed --base origin/main
 */

import {
	changedFiles,
	expandTestablePackages,
	isDirectRun,
	ok,
	packageHasTestScript,
	packagesFromPaths,
	parseBaseArgs,
	runBun,
	TESTABLE_PACKAGES,
} from "./lib.mjs";

const GLOBAL_TEST_FILES = new Set([
	"biome.json",
	"biome.jsonc",
	"bun.lock",
	"package.json",
	"turbo.json",
	"tsconfig.base.json",
	"tsconfig.json",
]);

export const parseArgs = parseBaseArgs;

export function isGlobalTestTrigger(file) {
	const normalized = file.replaceAll("\\", "/");
	return GLOBAL_TEST_FILES.has(normalized) || normalized.startsWith("scripts/quality/");
}

export function createChangedTestPlan(files) {
	const touched = packagesFromPaths(files);
	const globalTriggers = files.filter(isGlobalTestTrigger);
	const runQuality = files.some((file) => {
		const normalized = file.replaceAll("\\", "/");
		return normalized === "package.json" || normalized === "turbo.json" || normalized.startsWith("scripts/quality/");
	});
	const direct =
		globalTriggers.length > 0
			? Object.keys(TESTABLE_PACKAGES)
			: touched.filter((name) => {
					const dir = TESTABLE_PACKAGES[name];
					return dir && packageHasTestScript(dir);
				});
	return {
		direct,
		globalTriggers,
		runQuality,
		toTest: expandTestablePackages(direct),
		touched,
	};
}

export function main(args = process.argv.slice(2)) {
	try {
		const { base } = parseArgs(args);
		const files = changedFiles(base);
		const plan = createChangedTestPlan(files);

		console.log(`[test:changed] base=${base}`);
		console.log(`[test:changed] changed files: ${files.length}`);
		console.log(`[test:changed] touched packages: ${plan.touched.join(", ") || "(none)"}`);
		if (plan.globalTriggers.length > 0) {
			console.log(`[test:changed] global trigger: ${plan.globalTriggers.join(", ")}`);
		}

		if (plan.toTest.length === 0) {
			if (plan.runQuality) return runBun(["run", "test:quality"]);
			ok("[test:changed] no affected testable packages; skip");
			return 0;
		}

		if (plan.runQuality) {
			console.log("[test:changed] running quality script tests");
			const qualityCode = runBun(["run", "test:quality"]);
			if (qualityCode !== 0) return qualityCode;
		}
		console.log(`[test:changed] running: ${plan.toTest.join(", ")}`);
		return runBun(["run", "scripts/quality/test-pkg.mjs", ...plan.toTest]);
	} catch (error) {
		console.error(`[test:changed] ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}

/**
 * Fast, task-scoped test selection for local development and coding agents.
 * CI keeps using test:changed so cross-package and cross-platform coverage stays conservative.
 *
 * Usage:
 *   bun run test:impact
 *   bun run test:impact -- packages/ai/src/provider.ts packages/ai/test/provider.test.ts
 *   bun run test:impact --dry-run -- packages/ai/src/provider.ts
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	buildableTestDependencies,
	changedFiles,
	isDirectRun,
	ok,
	parseFileSelectionArgs,
	repoRoot,
	runBun,
	WORKSPACE_PACKAGES,
} from "./lib.mjs";

const ROOT_GLOBAL_TEST_FILES = new Set([
	"biome.json",
	"biome.jsonc",
	"bun.lock",
	"package.json",
	"turbo.json",
	"tsconfig.base.json",
	"tsconfig.json",
]);
const CODE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;
const TEST_FILE_PATTERN = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const PUBLIC_CONTRACT_PATTERN = /(?:^|\/)src\/(?:index\.[cm]?[jt]sx?|public-api\/)/i;
const CONTRACT_DIRECTORY_PATTERN = /(?:^|\/)(?:contracts?|runtime-contracts)(?:\/|$)/i;
const PACKAGE_CONFIG_PATTERN =
	/(?:^|\/)(?:package\.json|vitest\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|tsconfig(?:\.[^.]+)?\.json)$/i;

function workspaceForFile(file) {
	return [...WORKSPACE_PACKAGES]
		.sort((left, right) => right.dir.length - left.dir.length)
		.find((pkg) => file === pkg.dir || file.startsWith(`${pkg.dir}/`));
}

function supportsTargetedVitest(testScript) {
	return (
		typeof testScript === "string" &&
		!testScript.includes("&&") &&
		/^bun\s+\S*scripts\/quality\/run-vitest\.mjs(?:\s|$)/.test(testScript.replaceAll("\\", "/"))
	);
}

function staticVitestArgs(testScript) {
	const normalized = testScript.replaceAll("\\", "/");
	const match = normalized.match(/^bun\s+\S*scripts\/quality\/run-vitest\.mjs(?:\s+(.*))?$/);
	if (!match) return [];
	return (match[1] ?? "")
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.filter((arg) => arg !== "--run");
}

export function parseImpactArgs(args, root = repoRoot) {
	const dryRun = args.includes("--dry-run");
	const selection = parseFileSelectionArgs(
		args.filter((arg) => arg !== "--dry-run"),
		"origin/dev",
		root,
	);
	return { ...selection, dryRun };
}

export function createImpactTestPlan(files, pathExists = (file) => existsSync(join(repoRoot, file))) {
	const normalizedFiles = [...new Set(files.map((file) => file.replaceAll("\\", "/")))].sort();
	const runQuality = normalizedFiles.some((file) => file.startsWith("scripts/"));
	const fallbackReasons = [];
	if (normalizedFiles.some((file) => ROOT_GLOBAL_TEST_FILES.has(file))) {
		fallbackReasons.push("root test configuration changed");
	}

	const grouped = new Map();
	for (const file of normalizedFiles) {
		if (file.startsWith("scripts/") || ROOT_GLOBAL_TEST_FILES.has(file)) continue;
		const workspace = workspaceForFile(file);
		if (!workspace) continue;
		const relativeFile = file.slice(workspace.dir.length + 1);
		if (!workspace.scripts.test) {
			fallbackReasons.push(`${workspace.key} has no direct test entry point`);
			continue;
		}
		if (!pathExists(file)) {
			fallbackReasons.push(`${file} was deleted`);
			continue;
		}
		if (
			PUBLIC_CONTRACT_PATTERN.test(relativeFile) ||
			CONTRACT_DIRECTORY_PATTERN.test(relativeFile) ||
			PACKAGE_CONFIG_PATTERN.test(relativeFile)
		) {
			fallbackReasons.push(`${file} may affect package consumers or test configuration`);
			continue;
		}
		let target = grouped.get(workspace.key);
		if (!target) {
			target = {
				key: workspace.key,
				dir: workspace.dir,
				packageName: workspace.name,
				testScript: workspace.scripts.test,
				directTests: [],
				relatedSources: [],
				full: !supportsTargetedVitest(workspace.scripts.test),
			};
			grouped.set(workspace.key, target);
		}
		if (target.full) continue;
		if (!CODE_FILE_PATTERN.test(relativeFile)) {
			target.full = true;
			continue;
		}
		if (TEST_FILE_PATTERN.test(relativeFile)) target.directTests.push(relativeFile);
		else target.relatedSources.push(relativeFile);
	}

	return {
		files: normalizedFiles,
		fallbackChanged: fallbackReasons.length > 0,
		fallbackReasons,
		runQuality,
		targets: [...grouped.values()].sort((left, right) => left.key.localeCompare(right.key)),
	};
}

function runCapturedBun(args, cwd) {
	const result = spawnSync("bun", args, {
		cwd,
		encoding: "utf8",
		env: process.env,
		maxBuffer: 64 * 1024 * 1024,
		shell: false,
	});
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	if (result.error) console.error(result.error.message);
	return {
		code: result.status ?? 1,
		output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
	};
}

function runTargetedTests(target) {
	const cwd = join(repoRoot, target.dir);
	const runner = join(repoRoot, "scripts/quality/run-vitest.mjs");
	const sharedArgs = staticVitestArgs(target.testScript);
	if (target.directTests.length > 0) {
		ok(`[test:impact] ${target.key}: direct tests ${target.directTests.join(", ")}`);
		const directCode = runBun([runner, "--run", ...sharedArgs, ...target.directTests], { cwd });
		if (directCode !== 0) return directCode;
	}
	if (target.relatedSources.length === 0) return 0;

	ok(`[test:impact] ${target.key}: tests related to ${target.relatedSources.join(", ")}`);
	const related = runCapturedBun(
		[runner, "related", ...target.relatedSources, "--run", "--passWithNoTests=false", ...sharedArgs],
		cwd,
	);
	if (related.code === 0) return 0;
	if (!/No test files found|No test suite found/i.test(related.output)) return related.code;

	ok(`[test:impact] ${target.key}: no related tests found; falling back to the package test script`);
	return runBun(["run", "test"], { cwd });
}

function printPlan(plan, selection) {
	console.log(
		selection.files.length > 0
			? `[test:impact] scope=explicit files=${selection.files.length}`
			: `[test:impact] scope=git base=${selection.base}`,
	);
	console.log(`[test:impact] changed files: ${plan.files.length}`);
	if (plan.runQuality) console.log("[test:impact] quality script tests selected");
	for (const target of plan.targets) {
		const mode = target.full
			? "full package"
			: `direct=${target.directTests.length}, related=${target.relatedSources.length}`;
		console.log(`[test:impact] ${target.key}: ${mode}`);
	}
	if (plan.fallbackChanged) {
		console.log(`[test:impact] conservative fallback: ${plan.fallbackReasons.join("; ")}`);
	}
}

export function main(args = process.argv.slice(2)) {
	try {
		const selection = parseImpactArgs(args);
		const files = selection.files.length > 0 ? selection.files : changedFiles(selection.base);
		const plan = createImpactTestPlan(files);
		printPlan(plan, selection);
		if (files.length === 0 || selection.dryRun) return 0;
		if (plan.fallbackChanged) return runBun(["run", "test:changed", "--", ...files]);

		if (plan.runQuality) {
			const qualityCode = runBun(["run", "test:quality"]);
			if (qualityCode !== 0) return qualityCode;
		}
		if (plan.targets.length === 0) {
			ok("[test:impact] no affected testable code; skip");
			return 0;
		}

		const buildDependencies = buildableTestDependencies(plan.targets.map((target) => target.key));
		if (buildDependencies.length > 0) {
			ok(`[test:impact] building workspace dependencies: ${buildDependencies.join(", ")}`);
			const buildCode = runBun([
				"x",
				"turbo",
				"run",
				"build",
				"--summarize",
				...buildDependencies.map((packageName) => `--filter=${packageName}`),
			]);
			if (buildCode !== 0) return buildCode;
		}

		for (const target of plan.targets) {
			const code = target.full
				? runBun(["run", "test"], { cwd: join(repoRoot, target.dir) })
				: runTargetedTests(target);
			if (code !== 0) return code;
		}
		return 0;
	} catch (error) {
		console.error(`[test:impact] ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

if (isDirectRun(import.meta.url)) process.exit(main());

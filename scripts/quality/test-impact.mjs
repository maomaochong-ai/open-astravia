/**
 * Fast, task-scoped test selection for local development and coding agents.
 * CI uses the same file-level selection through test:changed on each supported platform.
 *
 * Usage:
 *   bun run test:impact
 *   bun run test:impact -- packages/ai/src/provider.ts packages/ai/test/provider.test.ts
 *   bun run test:impact --dry-run -- packages/ai/src/provider.ts
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import {
	buildableTestDependencies,
	changedFiles,
	isDirectRun,
	ok,
	parseFileSelectionArgs,
	repoRoot,
	runBun,
	WORKSPACE_PACKAGES,
	walkFiles,
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
const PACKAGE_CONFIG_PATTERN =
	/(?:^|\/)(?:package\.json|vitest\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|tsconfig(?:\.[^.]+)?\.json)$/i;
const RUNTIME_CONTRACT_PATTERN = /(?:^|\/)plugin\.json$/i;
const QUALITY_GATES_TEST = "scripts/quality/quality-gates.test.mjs";
const PLUGIN_MANIFESTS_TEST = "scripts/quality/plugin-manifests.test.mjs";
const WORKFLOW_CONTRACT_TESTS = new Map([
	[".github/workflows/desktop-packaged.yml", "scripts/quality/desktop-packaging-scope.test.mjs"],
	[".github/workflows/desktop-release.yml", "scripts/quality/desktop-release-workflow.test.mjs"],
	[".github/workflows/pr-quality.yml", "scripts/quality/pr-quality.test.mjs"],
	[".github/workflows/pr-automation.yml", "scripts/quality/pr-auto-merge.test.mjs"],
	[".github/workflows/promote-dev-to-main.yml", "scripts/quality/promote-dev-to-main.test.mjs"],
]);

/**
 * Keep narrowly reviewed source-to-test mappings here when Vitest's dependency
 * graph is unavailable or substantially broader than the component contract.
 * Every mapped test must directly render the source through a public host path.
 */
const MODEL_SELECTOR_VIEW_TEST = "src/renderer/domains/conversation/components/ModelSelectorView.test.tsx";
const TEAM_MODEL_SELECTOR_TEST = "src/renderer/domains/conversation/connectors/team/TeamModelSelector.test.tsx";
const desktopTests = (...tests) => ({ workspaceKey: "desktop", tests });
const EXPLICIT_SOURCE_TESTS = new Map([
	[
		"apps/desktop/src/renderer/domains/conversation/connectors/team/TeamModelSelector.tsx",
		desktopTests(TEAM_MODEL_SELECTOR_TEST),
	],
	[
		"packages/theme-ui/src/chat/ModelSelectorTrigger.tsx",
		desktopTests(MODEL_SELECTOR_VIEW_TEST, TEAM_MODEL_SELECTOR_TEST),
	],
	["packages/ui/src/dropdown-menu.tsx", desktopTests(MODEL_SELECTOR_VIEW_TEST)],
	["packages/theme-ui/src/chat/ModelSelectorView.tsx", desktopTests(MODEL_SELECTOR_VIEW_TEST)],
	["packages/theme-ui/src/chat/ModelConfiguration.tsx", desktopTests(TEAM_MODEL_SELECTOR_TEST)],
	["packages/theme-ui/src/chat/InlineModelPicker.tsx", desktopTests(TEAM_MODEL_SELECTOR_TEST)],
	["packages/theme-ui/src/chat/ReasoningStepSlider.tsx", desktopTests(TEAM_MODEL_SELECTOR_TEST)],
]);

function workspaceForFile(file) {
	return [...WORKSPACE_PACKAGES]
		.sort((left, right) => right.dir.length - left.dir.length)
		.find((pkg) => file === pkg.dir || file.startsWith(`${pkg.dir}/`));
}

function parseBunCommand(command) {
	const match = command.trim().match(/^bun\s+(.+)$/u);
	return match ? match[1].trim().split(/\s+/u).filter(Boolean) : null;
}

function staticVitestArgs(command) {
	const normalized = command.replaceAll("\\", "/");
	const match = normalized.match(/^bun\s+\S*scripts\/quality\/run-vitest\.mjs(?:\s+(.*))?$/);
	if (!match) return null;
	return (match[1] ?? "")
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.filter((arg) => arg !== "--run");
}

function targetedTestConfiguration(testScript) {
	if (typeof testScript !== "string") return null;
	const commands = testScript.split(/\s*&&\s*/u);
	const vitestArgs = staticVitestArgs(commands.at(-1) ?? "");
	if (!vitestArgs) return null;
	const prerequisites = commands.slice(0, -1).map(parseBunCommand);
	if (prerequisites.some((command) => !command)) return null;
	return { prerequisites, vitestArgs };
}

function targetForWorkspace(grouped, workspace, selectionErrors) {
	let target = grouped.get(workspace.key);
	if (target) return target;
	const configuration = targetedTestConfiguration(workspace.scripts.test);
	if (!configuration) {
		selectionErrors.push(`${workspace.key} has no targeted Vitest entry point`);
		return null;
	}
	target = {
		key: workspace.key,
		dir: workspace.dir,
		packageName: workspace.name,
		prerequisites: configuration.prerequisites,
		vitestArgs: configuration.vitestArgs,
		directTests: [],
		relatedSources: [],
	};
	grouped.set(workspace.key, target);
	return target;
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

function addTargetFile(grouped, workspace, relativeFile, selectionErrors) {
	if (!workspace.scripts.test) {
		selectionErrors.push(`${workspace.key} has no targeted test entry point for ${workspace.dir}/${relativeFile}`);
		return;
	}
	const target = targetForWorkspace(grouped, workspace, selectionErrors);
	if (!target) return;
	if (TEST_FILE_PATTERN.test(relativeFile)) target.directTests.push(relativeFile);
	else target.relatedSources.push(relativeFile);
}

function importedSpecifiers(file) {
	try {
		return ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles.map(({ fileName }) => fileName);
	} catch {
		return [];
	}
}

function dependencyImporterFiles(workspace, dependencies) {
	const packageRoot = join(repoRoot, workspace.dir);
	return walkFiles(packageRoot)
		.map((absolute) => ({
			absolute,
			relative: relative(packageRoot, absolute).replaceAll("\\", "/"),
		}))
		.filter(({ relative: relativeFile }) => /^(?:src|test|tests|scripts)\//u.test(relativeFile))
		.filter(({ absolute }) =>
			importedSpecifiers(absolute).some((specifier) =>
				dependencies.some((dependency) => specifier === dependency || specifier.startsWith(`${dependency}/`)),
			),
		)
		.map(({ relative: relativeFile }) => relativeFile)
		.sort();
}

function companionTest(file, pathExists) {
	if (TEST_FILE_PATTERN.test(file)) return file;
	const extension = file.match(/\.[^./]+$/u)?.[0];
	if (!extension) return null;
	const candidate = `${file.slice(0, -extension.length)}.test${extension}`;
	return pathExists(candidate) ? candidate : null;
}

function qualityTestsForFiles(files, pathExists) {
	const tests = [];
	for (const file of files) {
		if (RUNTIME_CONTRACT_PATTERN.test(file)) {
			tests.push(PLUGIN_MANIFESTS_TEST);
			continue;
		}
		if (file.startsWith(".github/workflows/")) {
			tests.push(WORKFLOW_CONTRACT_TESTS.get(file) ?? QUALITY_GATES_TEST);
			continue;
		}
		if (file.startsWith("scripts/")) {
			tests.push(companionTest(file, pathExists) ?? QUALITY_GATES_TEST);
			continue;
		}
		if (file === "package.json" || file === "turbo.json") tests.push(QUALITY_GATES_TEST);
	}
	return [...new Set(tests)].sort();
}

export function createImpactTestPlan(
	files,
	pathExists = (file) => existsSync(join(repoRoot, file)),
	{ lockfileImpacts = [] } = {},
) {
	const normalizedFiles = [...new Set(files.map((file) => file.replaceAll("\\", "/")))].sort();
	const qualityTests = qualityTestsForFiles(normalizedFiles, pathExists);
	const runQuality = qualityTests.length > 0;
	const selectionErrors = [];

	const grouped = new Map();
	for (const impact of lockfileImpacts) {
		const workspace = WORKSPACE_PACKAGES.find((candidate) => candidate.key === impact.key);
		if (!workspace) {
			selectionErrors.push(`bun.lock changed unknown workspace ${impact.key}`);
			continue;
		}
		if (impact.dependencies.length === 0) {
			selectionErrors.push(`bun.lock changed ${impact.key} without an identifiable direct dependency`);
			continue;
		}
		const importers = dependencyImporterFiles(workspace, impact.dependencies);
		if (importers.length === 0) {
			selectionErrors.push(
				`bun.lock changed ${impact.key} dependencies ${impact.dependencies.join(", ")} without importing source files`,
			);
			continue;
		}
		for (const relativeFile of importers) addTargetFile(grouped, workspace, relativeFile, selectionErrors);
	}
	for (const file of normalizedFiles) {
		if (file.startsWith("scripts/") || ROOT_GLOBAL_TEST_FILES.has(file)) continue;
		const workspace = workspaceForFile(file);
		if (!workspace) continue;
		const relativeFile = file.slice(workspace.dir.length + 1);
		if (!pathExists(file)) {
			selectionErrors.push(`${file} was deleted; add an explicit regression test or mapping`);
			continue;
		}
		if (RUNTIME_CONTRACT_PATTERN.test(relativeFile)) {
			continue;
		}
		if (PACKAGE_CONFIG_PATTERN.test(relativeFile)) {
			continue;
		}
		const mapped = EXPLICIT_SOURCE_TESTS.get(file);
		if (mapped) {
			const testWorkspace = WORKSPACE_PACKAGES.find((candidate) => candidate.key === mapped.workspaceKey);
			const missingTests = mapped.tests.filter((test) => !pathExists(`${testWorkspace?.dir ?? ""}/${test}`));
			if (!testWorkspace?.scripts.test || missingTests.length > 0) {
				selectionErrors.push(`${file} has an invalid explicit test mapping`);
				continue;
			}
			const target = targetForWorkspace(grouped, testWorkspace, selectionErrors);
			target?.directTests.push(...mapped.tests);
			continue;
		}
		if (!CODE_FILE_PATTERN.test(relativeFile)) continue;
		addTargetFile(grouped, workspace, relativeFile, selectionErrors);
	}

	return {
		files: normalizedFiles,
		lockfileImpacts,
		qualityTests,
		runQuality,
		selectionErrors: [...new Set(selectionErrors)].sort(),
		targets: [...grouped.values()]
			.map((target) => ({
				...target,
				directTests: [...new Set(target.directTests)].sort(),
				relatedSources: [...new Set(target.relatedSources)].sort(),
			}))
			.sort((left, right) => left.key.localeCompare(right.key)),
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
	for (const prerequisite of target.prerequisites) {
		ok(`[test:impact] ${target.key}: prerequisite bun ${prerequisite.join(" ")}`);
		const prerequisiteCode = runBun(prerequisite, { cwd });
		if (prerequisiteCode !== 0) return prerequisiteCode;
	}
	if (target.directTests.length > 0) {
		ok(`[test:impact] ${target.key}: direct tests ${target.directTests.join(", ")}`);
		const directCode = runBun([runner, "--run", ...target.vitestArgs, ...target.directTests], { cwd });
		if (directCode !== 0) return directCode;
	}
	if (target.relatedSources.length === 0) return 0;

	ok(`[test:impact] ${target.key}: tests related to ${target.relatedSources.join(", ")}`);
	const related = runCapturedBun(
		[
			runner,
			"related",
			...target.relatedSources,
			"--run",
			"--passWithNoTests=false",
			...target.vitestArgs,
			...target.directTests.map((test) => `--exclude=${test}`),
		],
		cwd,
	);
	if (related.code === 0) return 0;
	if (!/No test files found|No test suite found/i.test(related.output)) return related.code;

	console.error(`[test:impact] ${target.key}: no related tests found; add a regression test or explicit test mapping`);
	return 1;
}

function printPlan(plan, selection) {
	console.log(
		selection.files.length > 0
			? `[test:impact] scope=explicit files=${selection.files.length}`
			: `[test:impact] scope=git base=${selection.base}`,
	);
	console.log(`[test:impact] changed files: ${plan.files.length}`);
	if (plan.runQuality) console.log(`[test:impact] quality tests: ${plan.qualityTests.join(", ")}`);
	for (const target of plan.targets) {
		const mode = `direct=${target.directTests.length}, related=${target.relatedSources.length}`;
		console.log(`[test:impact] ${target.key}: ${mode}`);
	}
	if (plan.selectionErrors.length > 0) {
		console.log(`[test:impact] selection errors: ${plan.selectionErrors.join("; ")}`);
	}
}

export function runImpactTestPlan(plan) {
	if (plan.selectionErrors.length > 0) return 1;
	if (plan.runQuality) {
		const qualityCode = runBun([join(repoRoot, "scripts/quality/run-vitest.mjs"), "--run", ...plan.qualityTests]);
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
		const code = runTargetedTests(target);
		if (code !== 0) return code;
	}
	return 0;
}

export function main(args = process.argv.slice(2)) {
	try {
		const selection = parseImpactArgs(args);
		const files = selection.files.length > 0 ? selection.files : changedFiles(selection.base);
		if (files.some((file) => file.replaceAll("\\", "/") === "bun.lock")) {
			return runBun(["run", "test:changed", "--base", selection.base, "--", ...files]);
		}
		const plan = createImpactTestPlan(files);
		printPlan(plan, selection);
		if (files.length === 0 || selection.dryRun) return 0;
		return runImpactTestPlan(plan);
	} catch (error) {
		console.error(`[test:impact] ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

if (isDirectRun(import.meta.url)) process.exit(main());

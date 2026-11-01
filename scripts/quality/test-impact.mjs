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
	[".github/workflows/desktop-packaged.yml", ["scripts/quality/desktop-packaging-scope.test.mjs"]],
	// 桌面与手机各一条发布链路，各自的契约测试分开钉：改 desktop-release 不该把
	// 手机端一起拖进来跑，反之亦然。上传到 R2 的 workflow 两条链共用，两边都测。
	[".github/workflows/desktop-release.yml", ["scripts/quality/desktop-release-workflow.test.mjs"]],
	[".github/workflows/client-mobile-release.yml", ["scripts/quality/client-mobile-release-workflow.test.mjs"]],
	[
		".github/workflows/upload-release-to-r2.yml",
		["scripts/quality/desktop-release-workflow.test.mjs", "scripts/quality/client-mobile-release-workflow.test.mjs"],
	],
	[".github/workflows/deploy-website.yml", ["scripts/quality/desktop-release-workflow.test.mjs"]],
	[".github/workflows/pr-quality.yml", ["scripts/quality/pr-quality.test.mjs"]],
	[".github/workflows/pr-automation.yml", ["scripts/quality/pr-auto-merge.test.mjs"]],
	[".github/workflows/promote-dev-to-main.yml", ["scripts/quality/promote-dev-to-main.test.mjs"]],
]);

/**
 * Keep narrowly reviewed source-to-test mappings here when Vitest's dependency
 * graph is unavailable or substantially broader than the component contract.
 * Mapped tests must exercise the source through its production contract or public
 * host path. Unmapped sources and public exports retain dependency-based selection.
 */
const MODEL_SELECTOR_VIEW_TEST = "src/renderer/domains/conversation/components/ModelSelectorView.test.tsx";
const TEAM_MODEL_SELECTOR_TEST = "src/renderer/domains/conversation/connectors/team/TeamModelSelector.test.tsx";
const ACTIVITY_PANEL_TABS_TEST = "src/renderer/domains/activity-panel/components/ActivityPanel.live-tabs.test.tsx";
const FILE_TREE_CREATE_RENAME_TEST = "src/renderer/domains/file-explorer/components/file-tree-create-rename.test.tsx";
const desktopTests = (...tests) => ({ workspaceKey: "desktop", tests });
const goalTests = {
	workspaceKey: "coding-agent",
	tests: [
		"test/composition/continuation-orchestration.test.ts",
		"test/composition/goal-execution.test.ts",
		"test/features/goal/goal-session-extension.test.ts",
	],
};
const EXPLICIT_SOURCE_TESTS = new Map([
	["apps/desktop/src/renderer/remote-desktop-host.ts", desktopTests("src/renderer/remote-desktop-host.test.ts")],
	[
		"packages/ai/src/providers/google-stream/request.ts",
		{ workspaceKey: "ai", tests: ["test/google-native-adapters.test.ts"] },
	],
	["packages/coding-agent/src/features/goal/goal-feature.ts", goalTests],
	["packages/coding-agent/src/features/goal/goal-runtime.ts", goalTests],
	["packages/coding-agent/src/features/goal/goal-session-extension.ts", goalTests],
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
	[
		"packages/theme-ui/src/settings/ModelsFetchedModelsDrawerView.tsx",
		desktopTests("src/renderer/domains/settings/components/ModelsFetchedModelsDrawer.test.tsx"),
	],
	// 设置包 barrel 新增的导出由这个桌面测试从 `@astravia-org/theme-ui/settings` 消费。
	[
		"packages/theme-ui/src/settings/index.ts",
		desktopTests("src/renderer/domains/settings/components/ModelsFetchedModelsDrawer.test.tsx"),
	],
	// E2E 规格不是单元测试，改动它时由更新模块的单测顶上，不落空选。
	[
		"apps/desktop/e2e/updater.e2e.ts",
		desktopTests("src/main/updater-service.test.ts", "src/main/updater-engine.test.ts"),
	],
	// 待办活动页是纯展示组件，行为由桌面侧的 builtin tab 测试驱动（含清空入口）。
	[
		"packages/theme-ui/src/activity/TodoTabPanelView.tsx",
		desktopTests("src/renderer/domains/activity-panel/builtins/todo-tab.test.tsx"),
	],
	// 压缩摘要与队列卡片都是纯展示组件，排版、撤回入口由桌面侧消费方测试驱动；
	// 它们自身没有可单独装载的测试，不映射的话相关测试选择会落空。
	[
		"packages/theme-ui/src/chat/CompactionStepView.tsx",
		desktopTests("src/renderer/domains/conversation/components/blocks/CompactionBlock.test.tsx"),
	],
	[
		"packages/theme-ui/src/chat/QueueCardView.tsx",
		desktopTests("src/renderer/domains/conversation/components/command-panel/CommandPanelView.test.tsx"),
	],
	// 更新说明的两个视图与 barrel 导出各自有 SSR 契约测试；不映射的话，
	// 它们在 theme-ui 里的「相关测试」会被上方那批 direct 测试排空，选择直接落空。
	[
		"packages/theme-ui/src/overlays/release-note.ts",
		{ workspaceKey: "theme-ui", tests: ["src/overlays/release-note.test.ts"] },
	],
	[
		"packages/theme-ui/src/overlays/UpdateCheckerView.tsx",
		{ workspaceKey: "theme-ui", tests: ["src/overlays/UpdateCheckerView.test.tsx"] },
	],
	[
		"packages/theme-ui/src/overlays/UpdateRestartDialogView.tsx",
		{ workspaceKey: "theme-ui", tests: ["src/overlays/UpdateRestartDialogView.test.tsx"] },
	],
	[
		"packages/theme-ui/src/overlays/index.ts",
		{ workspaceKey: "theme-ui", tests: ["src/overlays/UpdateCheckerView.test.tsx"] },
	],
	// Markdown 组件只被桌面侧的渲染预算测试装载，theme-ui 内没有能选到的消费方测试。
	[
		"packages/theme-ui/src/markdown/MarkdownContent.tsx",
		desktopTests("src/renderer/domains/conversation/components/blocks/MarkdownRenderBudget.test.tsx"),
	],
	[
		"packages/theme-ui/src/markdown/streaming.ts",
		{ workspaceKey: "theme-ui", tests: ["src/markdown/streaming.test.ts"] },
	],
	// TabBar 的右键菜单与文件树新建/重命名的输入法保护都没有 theme-ui 内部测试，
	// 它们的行为由桌面侧穿过真实组件的集成测试钉住。
	["packages/theme-ui/src/shared/TabBar.tsx", desktopTests(ACTIVITY_PANEL_TABS_TEST)],
	["packages/theme-ui/src/shared/useImeCompositionGuard.ts", desktopTests(FILE_TREE_CREATE_RENAME_TEST)],
	["packages/theme-ui/src/file-explorer/FileTreeCreateRow.tsx", desktopTests(FILE_TREE_CREATE_RENAME_TEST)],
	["packages/theme-ui/src/file-explorer/FileTreeNodeView.tsx", desktopTests(FILE_TREE_CREATE_RENAME_TEST)],
	["packages/theme-ui/src/shared/index.ts", desktopTests(ACTIVITY_PANEL_TABS_TEST, FILE_TREE_CREATE_RENAME_TEST)],
	// 官方 API 与主题 SDK 是纯契约包（plugin-sdk 没有测试入口，theme-sdk 只有类型检查），
	// 它们的消费方测试在桌面与 theme-ui 侧：官方技能 API 的参数形状、侧栏导航项与页头标题键。
	[
		"packages/plugins/plugin-sdk/src/official.ts",
		desktopTests("src/renderer/domains/plugins/runtime/plugin-official-skills.test.ts"),
	],
	["packages/theme-sdk/src/sidebar/types.ts", desktopTests("src/renderer/root-layout/nav-route-prefetch.test.ts")],
	[
		"packages/theme-sdk/src/app-shell/types.ts",
		{ workspaceKey: "theme-ui", tests: ["src/app-shell/PageHeaderContent.test.tsx"] },
	],
]);

/**
 * 平台原生包由 `src/main/speech-input/supported-platforms.json` 按平台表动态选包，源码里没有
 * 静态 import，锁文件变动时上面那条 import 扫描找不到使用点。这里声明它们各自的契约测试：
 * 两份测试钉住「平台标签 → 原生包名」映射与打包 externals，删掉任何一侧都会失败。
 */
const PLATFORM_NATIVE_PACKAGE_TESTS = [
	"scripts/packaged-native-dependencies.test.mjs",
	"src/main/speech-input/platforms.test.ts",
];
const EXPLICIT_DEPENDENCY_SOURCES = new Map([
	["sherpa-onnx-win-x64", PLATFORM_NATIVE_PACKAGE_TESTS],
	["sherpa-onnx-darwin-arm64", PLATFORM_NATIVE_PACKAGE_TESTS],
	["sherpa-onnx-darwin-x64", PLATFORM_NATIVE_PACKAGE_TESTS],
]);

/**
 * 下线的源码在变更集里是删除状态，没有 import 图可分析。登记它留下的契约继续由哪些测试钉住，
 * 删除才可能通过选择阶段；没有登记的删除仍然直接失败。
 */
const RETIRED_SCENE_TESTS = desktopTests(
	"src/main/abilities/open-marketplace/marketplace-schema.test.ts",
	"src/renderer/domains/abilities/components/detail/AbilityDetailBlocks.test.tsx",
);
const RETIRED_SOURCE_TESTS = new Map([
	["apps/desktop/src/renderer/domains/skills/components/SceneCard.tsx", RETIRED_SCENE_TESTS],
	["apps/desktop/src/renderer/domains/skills/components/ScenesPage.tsx", RETIRED_SCENE_TESTS],
	["apps/desktop/src/renderer/domains/skills/components/SkillCard.tsx", RETIRED_SCENE_TESTS],
	["apps/desktop/src/renderer/domains/skills/components/SkillTagGroup.tsx", RETIRED_SCENE_TESTS],
	["apps/desktop/src/renderer/domains/skills/components/SkillToggleSwitch.tsx", RETIRED_SCENE_TESTS],
	["apps/desktop/src/renderer/domains/skills/components/SkillsPageView.tsx", RETIRED_SCENE_TESTS],
	["apps/desktop/src/renderer/domains/skills/hooks/useSkillsPageModel.ts", RETIRED_SCENE_TESTS],
	["apps/desktop/src/renderer/domains/skills/index.ts", RETIRED_SCENE_TESTS],
	["apps/desktop/src/renderer/domains/skills/lib/merge-scenes.test.ts", RETIRED_SCENE_TESTS],
	["apps/desktop/src/renderer/domains/skills/lib/merge-scenes.ts", RETIRED_SCENE_TESTS],
	["packages/theme-ui/src/chat/DefaultSceneCarousel.tsx", RETIRED_SCENE_TESTS],
	["packages/theme-ui/src/chat/SceneCard.tsx", RETIRED_SCENE_TESTS],
	["packages/theme-ui/src/skills/SceneCardView.tsx", RETIRED_SCENE_TESTS],
	["packages/theme-ui/src/skills/SkillCardView.tsx", RETIRED_SCENE_TESTS],
	["packages/theme-ui/src/skills/SkillDetailDialogView.tsx", RETIRED_SCENE_TESTS],
	["packages/theme-ui/src/skills/SkillTagGroupView.tsx", RETIRED_SCENE_TESTS],
	["packages/theme-ui/src/skills/SkillToggleSwitch.tsx", RETIRED_SCENE_TESTS],
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
			tests.push(...(WORKFLOW_CONTRACT_TESTS.get(file) ?? [QUALITY_GATES_TEST]));
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

	const applyMapping = (file, mapping, kind) => {
		const testWorkspace = WORKSPACE_PACKAGES.find((candidate) => candidate.key === mapping.workspaceKey);
		const missingTests = mapping.tests.filter((test) => !pathExists(`${testWorkspace?.dir ?? ""}/${test}`));
		if (!testWorkspace?.scripts.test || missingTests.length > 0) {
			selectionErrors.push(`${file} has an invalid ${kind} test mapping`);
			return;
		}
		const target = targetForWorkspace(grouped, testWorkspace, selectionErrors);
		target?.directTests.push(...mapping.tests);
	};
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
		const stillDeclared = impact.dependencies.filter((dependency) => dependency in workspace.dependencies);
		// 平台原生包只按平台表动态选包，源码里没有任何 import 可以匹配；已经声明归属测试时再扫一遍整个
		// 工作区（桌面侧三千多个文件）没有额外信息，只会把选择耗时推高十几秒。
		const mappedByDeclaration =
			stillDeclared.length > 0 && stillDeclared.every((dependency) => EXPLICIT_DEPENDENCY_SOURCES.has(dependency));
		const importers = mappedByDeclaration ? [] : dependencyImporterFiles(workspace, impact.dependencies);
		if (importers.length === 0) {
			// 依赖被整体删掉时源码里当然没有任何 import——这正是删除该达成的结果，不需要再选测试。
			// 只有仍然声明在 package.json 里却找不到使用点的依赖，才说明这里漏了影响面；
			// 平台原生包按平台表动态选包、没有静态 import，由 EXPLICIT_DEPENDENCY_SOURCES 声明归属。
			if (stillDeclared.length === 0) continue;
			const uncovered = stillDeclared.filter((dependency) => !EXPLICIT_DEPENDENCY_SOURCES.has(dependency));
			if (uncovered.length > 0) {
				selectionErrors.push(
					`bun.lock changed ${impact.key} dependencies ${uncovered.join(", ")} without importing source files`,
				);
				continue;
			}
			const mappedFiles = [
				...new Set(stillDeclared.flatMap((dependency) => EXPLICIT_DEPENDENCY_SOURCES.get(dependency))),
			].sort();
			const missingFiles = mappedFiles.filter((file) => !pathExists(`${workspace.dir}/${file}`));
			if (missingFiles.length > 0) {
				selectionErrors.push(
					`bun.lock changed ${impact.key} dependencies ${stillDeclared.join(", ")} are mapped to missing files ${missingFiles.join(", ")}`,
				);
				continue;
			}
			for (const relativeFile of mappedFiles) addTargetFile(grouped, workspace, relativeFile, selectionErrors);
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
			const retired = RETIRED_SOURCE_TESTS.get(file);
			if (!retired) {
				selectionErrors.push(`${file} was deleted; add an explicit regression test or mapping`);
				continue;
			}
			applyMapping(file, retired, "retired source");
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
			applyMapping(file, mapped, "explicit");
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

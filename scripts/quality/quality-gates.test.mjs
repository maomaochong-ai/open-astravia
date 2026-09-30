import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createQuickGuardPlan } from "./check-guards.mjs";
import {
	findDurablePackageBoundaryViolations,
	findDurablePackageManifestBoundaryViolations,
} from "./check-package-boundaries.mjs";
import { batchPaths, createQuickCheckPlan, isBiomeGlobalTrigger } from "./check-quick.mjs";
import { findSkillFrontmatterProblems } from "./check-skill-frontmatter.mjs";
import {
	collectTypeScriptExportEntries,
	findImportedSourcePathMapViolations,
	findSourcePathMapViolations,
	typesExportToSourceRel,
} from "./check-source-path-maps.mjs";
import { findStandaloneCliBuildViolations } from "./check-standalone-cli-build.mjs";
import { findTurboConfigurationProblems, readTurboConfiguration } from "./check-turbo-config.mjs";
import { findVitestRunnerViolations } from "./check-vitest-runner.mjs";
import {
	buildableTestDependencies,
	changedFiles,
	expandTestablePackages,
	formatElapsedTime,
	packagesFromPaths,
	parseBaseArgs,
	parseFileSelectionArgs,
	repoRoot,
	stagedFiles,
	TESTABLE_PACKAGES,
	WORKSPACE_PACKAGES,
} from "./lib.mjs";
import { changedLockfileWorkspaceImpacts, changedLockfileWorkspaceKeys } from "./lockfile-impact.mjs";
import { createChangedTestPlan, parseArgs } from "./test-changed.mjs";
import { createImpactTestPlan, parseImpactArgs } from "./test-impact.mjs";

describe("changed file selection", () => {
	it("combines committed, working tree, and untracked paths", () => {
		const outputs = new Map([
			[["merge-base", "HEAD", "origin/dev"].join("\0"), "base-sha"],
			[["diff", "--name-only", "-z", "base-sha...HEAD"].join("\0"), "packages/ai/src/a.ts\0"],
			[["diff", "--name-only", "-z", "HEAD"].join("\0"), "packages/agent/src/b.ts\0"],
			[
				["ls-files", "--others", "--exclude-standard", "-z"].join("\0"),
				"packages/ecosystem-adapter/src/new.ts\0packages/ai/src/a.ts\0",
			],
		]);
		const git = (args) => outputs.get(args.join("\0")) ?? "";

		expect(changedFiles("origin/dev", git)).toEqual(
			["packages/agent/src/b.ts", "packages/ai/src/a.ts", "packages/ecosystem-adapter/src/new.ts"].sort(),
		);
	});

	it("preserves unusual paths from NUL-delimited Git output", () => {
		const outputs = new Map([
			[["merge-base", "HEAD", "origin/dev"].join("\0"), "base-sha"],
			[["diff", "--name-only", "-z", "base-sha...HEAD"].join("\0"), "packages/ai/src/line\nbreak.ts\0"],
			[["diff", "--name-only", "-z", "HEAD"].join("\0"), "packages/ai/src/a & b.ts\0"],
			[["ls-files", "--others", "--exclude-standard", "-z"].join("\0"), ""],
		]);
		const git = (args) => outputs.get(args.join("\0")) ?? "";

		expect(changedFiles("origin/dev", git)).toEqual(
			["packages/ai/src/a & b.ts", "packages/ai/src/line\nbreak.ts"].sort(),
		);
	});

	it("preserves unusual staged paths", () => {
		const git = () => "packages/ai/src/a & b.ts\0packages/ai/src/line\nbreak.ts\0";
		expect(stagedFiles(git)).toEqual(["packages/ai/src/a & b.ts", "packages/ai/src/line\nbreak.ts"]);
	});

	it("does not hide an invalid base ref", () => {
		const git = () => {
			throw new Error("missing base");
		};
		expect(() => changedFiles("missing", git)).toThrow("missing base");
	});

	it("normalizes Windows package paths", () => {
		expect(packagesFromPaths(["packages\\ai\\src\\index.ts"])).toEqual(["ai"]);
	});

	it("validates base arguments shared by changed-file commands", () => {
		expect(parseBaseArgs(["--base", "origin/main"])).toEqual({ base: "origin/main" });
		expect(() => parseBaseArgs(["--base", "--unknown"])).toThrow("--base requires a git ref");
		expect(() => parseBaseArgs(["--unknown"])).toThrow("unknown argument");
	});

	it("accepts explicit task files and rejects paths outside the repository", () => {
		expect(parseFileSelectionArgs(["--base=origin/main", "packages\\ai\\src\\index.ts"])).toEqual({
			base: "origin/main",
			files: ["packages/ai/src/index.ts"],
		});
		expect(() => parseFileSelectionArgs(["../outside.ts"])).toThrow("inside the repository");
		expect(() => parseFileSelectionArgs(["..\\outside.ts"])).toThrow("inside the repository");
	});
});

describe("quality timing output", () => {
	it("keeps short timings readable and longer timings comparable", () => {
		expect(formatElapsedTime(412)).toBe("412ms");
		expect(formatElapsedTime(12_345)).toBe("12.3s");
		expect(() => formatElapsedTime(-1)).toThrow("non-negative finite number");
	});
});

describe("standalone CLI 编译入口守卫", () => {
	it("拒绝在 Desktop 生产代码中直接编译 CLI 源入口", () => {
		expect(
			findStandaloneCliBuildViolations(
				"apps/desktop/src/main/example.ts",
				`spawn("bun", ["build", join(cliAppRoot, "src", "cli.ts"), "--compile"]);`,
			),
		).toHaveLength(1);
	});

	it("允许调用统一编译器和编译其他入口", () => {
		expect(
			findStandaloneCliBuildViolations(
				"apps/desktop/src/main/example.ts",
				`spawn("bun", [join(cliAppRoot, "scripts", "compile-standalone.mjs")]);`,
			),
		).toEqual([]);
		expect(
			findStandaloneCliBuildViolations(
				"apps/desktop/src/main/dev-cli-shim.ts",
				`spawn("bun", ["build", launcherEntryPath, "--compile"]);`,
			),
		).toEqual([]);
	});
});

describe("vitest runner 守卫", () => {
	it("拒绝 bunx vitest 和直接 vitest", () => {
		expect(
			findVitestRunnerViolations("packages/foo/package.json", {
				scripts: { test: "bunx vitest --run", "test:unit": "vitest --run" },
			}),
		).toHaveLength(2);
	});

	it("允许统一 Node 包装器", () => {
		expect(
			findVitestRunnerViolations("packages/foo/package.json", {
				scripts: { test: "bun ../../scripts/quality/run-vitest.mjs --run --coverage" },
			}),
		).toEqual([]);
	});

	it("忽略不含 vitest 的脚本", () => {
		expect(
			findVitestRunnerViolations("packages/foo/package.json", {
				scripts: { build: "tsgo -p tsconfig.build.json", "test:e2e": "wdio run ./wdio.conf.ts" },
			}),
		).toEqual([]);
	});
});

describe("source path maps", () => {
	it("maps package.json types exports onto source files", () => {
		expect(typesExportToSourceRel("./dist/auth/index.d.ts")).toBe("src/auth/index.ts");
		expect(typesExportToSourceRel("./dist/npm-package.d.ts")).toBe("src/npm-package.ts");
		expect(typesExportToSourceRel("./src/tailwind-theme.css")).toBeNull();
	});

	it("ignores CSS and wildcard exports", () => {
		expect(
			collectTypeScriptExportEntries({
				name: "@vetta/example",
				exports: {
					".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
					"./theme.css": "./src/theme.css",
					"./*": "./dist/*",
				},
			}),
		).toEqual([{ specifier: "@vetta/example", sourceRel: "src/index.ts", types: "./dist/index.d.ts" }]);
	});

	it("requires an explicit root path map to the source file", () => {
		const packages = [
			{
				dir: "packages/runtime-mcp",
				manifest: {
					name: "@vetta/runtime-mcp",
					exports: {
						"./auth": { types: "./dist/auth/index.d.ts", import: "./dist/auth/index.js" },
					},
				},
			},
		];

		expect(findSourcePathMapViolations({ paths: {}, packages, fileExists: () => true })).toEqual([
			"@vetta/runtime-mcp/auth: root tsconfig.json is missing an explicit source path map to ./packages/runtime-mcp/src/auth/index.ts",
		]);
		expect(
			findSourcePathMapViolations({
				paths: { "@vetta/runtime-mcp/auth": ["./packages/runtime-mcp/src/auth/index.ts"] },
				packages,
				fileExists: () => true,
			}),
		).toEqual([]);
	});

	it("detects when an app wildcard alias misses an imported public export source", () => {
		const packages = [
			{
				dir: "packages/coding-agent",
				manifest: {
					name: "@vetta/coding-agent",
					exports: {
						"./plugin-runtime": {
							types: "./dist/public-api/plugin-runtime.d.ts",
							import: "./dist/public-api/plugin-runtime.js",
						},
					},
				},
			},
		];
		const importedSpecifiers = ["@vetta/coding-agent/plugin-runtime"];

		expect(
			findImportedSourcePathMapViolations({
				paths: { "@vetta/coding-agent/*": ["../../packages/coding-agent/src/*"] },
				importedSpecifiers,
				packages,
				configDir: "apps/desktop",
			}),
		).toEqual([
			"@vetta/coding-agent/plugin-runtime: apps/desktop/tsconfig.json maps to ../../packages/coding-agent/src/plugin-runtime, expected ../../packages/coding-agent/src/public-api/plugin-runtime.ts",
		]);
		expect(
			findImportedSourcePathMapViolations({
				paths: {
					"@vetta/coding-agent/plugin-runtime": ["../../packages/coding-agent/src/public-api/plugin-runtime.ts"],
				},
				importedSpecifiers,
				packages,
				configDir: "apps/desktop",
			}),
		).toEqual([]);
	});
});

describe("quick check selection", () => {
	it("checks every existing changed file and skips deleted files", () => {
		const existing = new Set(["package.json", "packages/ai/src/index.ts"]);
		const plan = createQuickCheckPlan(
			["packages\\ai\\src\\index.ts", "deleted.ts", "package.json", "package.json"],
			(file) => existing.has(file),
		);

		expect(plan.fullBiome).toBe(false);
		expect(plan.existingFiles).toEqual(["package.json", "packages/ai/src/index.ts"]);
		expect(plan.biomeBatches.flat()).toEqual(plan.existingFiles);
	});

	it("falls back to a full Biome check when any Biome config changes", () => {
		expect(isBiomeGlobalTrigger("config/biome.jsonc")).toBe(true);
		const plan = createQuickCheckPlan(["biome.json", "packages/ai/src/index.ts"], () => true);
		expect(plan.fullBiome).toBe(true);
		expect(plan.biomeBatches).toEqual([["."]]);
	});

	it("batches paths without dropping or reordering them", () => {
		const paths = ["first.ts", "second-long.ts", "third.ts"];
		const batches = batchPaths(paths, 20);
		expect(batches.length).toBeGreaterThan(1);
		expect(batches.flat()).toEqual(paths);
	});

	it("runs only guards affected by the selected files", () => {
		const docsPlan = createQuickGuardPlan(["docs/dev/quality-gates.md"]);
		expect(docsPlan.map(([id]) => id)).toEqual(["private-keys", "conflict-markers"]);

		const rendererPlan = createQuickGuardPlan([
			"apps/desktop/src/renderer/domains/conversation/ConversationView.tsx",
		]);
		expect(rendererPlan.map(([id]) => id)).toEqual([
			"private-keys",
			"conflict-markers",
			"package-boundaries",
			"conversation-architecture",
		]);
		expect(rendererPlan.find(([id]) => id === "package-boundaries")).toContain(
			"apps/desktop/src/renderer/domains/conversation/ConversationView.tsx",
		);
	});
});

describe("affected package selection", () => {
	it("discovers every workspace test script, including nested plugins and themes", () => {
		expect(Object.keys(TESTABLE_PACKAGES)).toEqual(
			WORKSPACE_PACKAGES.filter((pkg) => Boolean(pkg.scripts.test)).map((pkg) => pkg.key),
		);
		expect(Object.keys(TESTABLE_PACKAGES)).toEqual(
			expect.arrayContaining(["capability-sdk", "cli-host", "runtime-node", "presets/image-gen"]),
		);
	});

	it("includes transitive testable dependents", () => {
		expect(expandTestablePackages(["ai"])).toEqual(
			expect.arrayContaining(["ai", "agent", "runtime-core", "runtime-mcp", "coding-agent", "desktop"]),
		);
		expect(expandTestablePackages(["runtime-mcp"])).toEqual(
			expect.arrayContaining(["runtime-mcp", "coding-agent", "desktop"]),
		);
		expect(expandTestablePackages(["ecosystem-adapter"])).toEqual(
			expect.arrayContaining(["coding-agent", "ecosystem-adapter", "desktop"]),
		);
		expect(expandTestablePackages(["plugin-sdk"])).toEqual(
			expect.arrayContaining(["presets/image-gen", "presets/vetta-ui-design", "desktop"]),
		);
	});

	it("runs Runtime and Desktop tests when those packages change", () => {
		expect(createChangedTestPlan(["packages/runtime-core/src/index.ts"]).targets).toMatchObject([
			{ key: "runtime-core", relatedSources: ["src/index.ts"] },
		]);
		expect(createChangedTestPlan(["apps/desktop/src/main/window-manager.ts"]).targets).toMatchObject([
			{ key: "desktop", relatedSources: ["src/main/window-manager.ts"] },
		]);
	});

	it("keeps ordinary test:changed source edits on targeted Vitest instead of the whole package", () => {
		const plan = createChangedTestPlan(
			[
				"apps/desktop/src/renderer/domains/conversation/components/annotations/AnnotationMenus.tsx",
				"apps/desktop/src/renderer/domains/conversation/components/annotations/AnnotationScope.test.tsx",
				"apps/docs-site/content/docs/core/workspaces-and-sessions.mdx",
			],
			[],
			() => true,
		);

		expect(plan.targets).toMatchObject([
			{
				key: "desktop",
				directTests: ["src/renderer/domains/conversation/components/annotations/AnnotationScope.test.tsx"],
				relatedSources: ["src/renderer/domains/conversation/components/annotations/AnnotationMenus.tsx"],
			},
		]);
		expect(plan.targets).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: "docs-site" })]));
	});

	it("maps lockfile dependency changes back to importing source files without package tests", () => {
		const plan = createChangedTestPlan(
			["bun.lock", "package.json", "turbo.json"],
			[{ key: "externals/chinese-chess", dependencies: ["zh-chess"] }],
		);
		expect(plan.lockfileImpacts).toEqual([{ key: "externals/chinese-chess", dependencies: ["zh-chess"] }]);
		expect(plan.runQuality).toBe(true);
		expect(plan.targets).toMatchObject([
			{
				key: "externals/chinese-chess",
				directTests: [],
				relatedSources: ["src/game/engine.ts"],
			},
		]);
	});

	it("finds only workspaces whose resolved lockfile dependency closure changed", () => {
		const before = `{
			"lockfileVersion": 1,
			"workspaces": {
				"": { "name": "root", "devDependencies": { "vitest": "1.0.0" } },
				"packages/alpha": { "name": "@test/alpha", "dependencies": { "shared": "^1.0.0" } },
				"packages/beta": { "name": "@test/beta", "dependencies": { "other": "^1.0.0" } }
			},
			"packages": {
				"shared": ["shared@1.0.0", "shared.tgz", { "dependencies": { "leaf": "^1.0.0" } }, "hash-a"],
				"leaf": ["leaf@1.0.0", "leaf.tgz", {}, "hash-leaf"],
				"other": ["other@1.0.0", "other.tgz", {}, "hash-b"],
				"vitest": ["vitest@1.0.0", "vitest.tgz", {}, "hash-c"]
			}
		}`;
		const after = before.replaceAll("leaf@1.0.0", "leaf@1.1.0").replaceAll("hash-leaf", "hash-new");

		expect(
			changedLockfileWorkspaceKeys(before, after, [
				{ key: "alpha", dir: "packages/alpha", name: "@test/alpha" },
				{ key: "beta", dir: "packages/beta", name: "@test/beta" },
			]),
		).toEqual(["alpha"]);
		expect(
			changedLockfileWorkspaceImpacts(before, after, [
				{ key: "alpha", dir: "packages/alpha", name: "@test/alpha" },
				{ key: "beta", dir: "packages/beta", name: "@test/beta" },
			]),
		).toEqual([{ key: "alpha", dependencies: ["shared"] }]);
	});

	it("ignores formatting and root-only tool changes in lockfile package selection", () => {
		const before = `{
			"lockfileVersion": 1,
			"workspaces": {
				"": { "name": "root", "devDependencies": { "vitest": "1.0.0" } },
				"packages/alpha": { "name": "@test/alpha", "dependencies": { "shared": "^1.0.0" } }
			},
			"packages": {
				"shared": ["shared@1.0.0", "shared.tgz", {}, "hash-a"],
				"vitest": ["vitest@1.0.0", "vitest.tgz", {}, "hash-b"]
			}
		}`;
		const formattingOnly = before.replaceAll("  ", "    ");
		const rootToolOnly = before.replaceAll("vitest@1.0.0", "vitest@1.1.0").replaceAll("hash-b", "hash-new");
		const workspaces = [{ key: "alpha", dir: "packages/alpha", name: "@test/alpha" }];

		expect(changedLockfileWorkspaceKeys(before, formattingOnly, workspaces)).toEqual([]);
		expect(changedLockfileWorkspaceKeys(before, rootToolOnly, workspaces)).toEqual([]);
	});

	it("fails lockfile impact analysis instead of degrading to every package", () => {
		expect(() => changedLockfileWorkspaceKeys("not json", "{}", [])).toThrow("cannot parse bun.lock");
		expect(() =>
			changedLockfileWorkspaceKeys('{ "workspaces": {}, "packages": {} }', '{ "workspaces": {}, "packages": {} }', [
				{ key: "alpha", dir: "packages/alpha", name: "@test/alpha" },
			]),
		).toThrow("current lockfile is missing workspace packages/alpha");
	});

	it("runs quality tests when their implementation changes", () => {
		const plan = createChangedTestPlan(["scripts/quality/test-changed.mjs"]);
		expect(plan.runQuality).toBe(true);
		expect(plan.qualityTests).toEqual(["scripts/quality/quality-gates.test.mjs"]);
		expect(plan.lockfileImpacts).toEqual([]);
		expect(plan.targets).toEqual([]);
	});

	it("does not run product tests for lint-only configuration changes", () => {
		const plan = createChangedTestPlan(["biome.json"]);
		expect(plan.runQuality).toBe(false);
		expect(plan.lockfileImpacts).toEqual([]);
		expect(plan.targets).toEqual([]);
	});

	it("leaves package and test configuration validation to check without running package tests", () => {
		const plan = createChangedTestPlan([
			"packages/ai/package.json",
			"packages/ai/tsconfig.build.json",
			"packages/ai/vitest.config.ts",
		]);
		expect(plan.selectionErrors).toEqual([]);
		expect(plan.targets).toEqual([]);
	});

	it("accepts both base argument forms and rejects unknown arguments", () => {
		expect(parseArgs(["--base", "origin/main"])).toEqual({ base: "origin/main", files: [] });
		expect(parseArgs(["--base=origin/release"])).toEqual({ base: "origin/release", files: [] });
		expect(() => parseArgs(["--unknown"])).toThrow("unknown argument");
	});

	it("selects direct and related tests for ordinary task files", () => {
		const plan = createImpactTestPlan([
			"packages/ai/test/provider-retry-policy.test.ts",
			"packages/ai/src/providers/retry-policy.ts",
		]);
		expect(plan.selectionErrors).toEqual([]);
		expect(plan.targets).toMatchObject([
			{
				key: "ai",
				directTests: ["test/provider-retry-policy.test.ts"],
				relatedSources: ["src/providers/retry-policy.ts"],
			},
		]);
	});

	it("keeps public contracts on related tests and fails unselectable changes without a package-test fallback", () => {
		const publicContract = createImpactTestPlan(["packages/ai/src/index.ts"]);
		expect(publicContract.selectionErrors).toEqual([]);
		expect(publicContract.targets).toMatchObject([
			{
				key: "ai",
				directTests: [],
				relatedSources: ["src/index.ts"],
			},
		]);
		expect(publicContract.targets.every((target) => !("full" in target))).toBe(true);
		expect(createImpactTestPlan(["packages/ai/src/provider.ts"], () => false).selectionErrors).toEqual([
			"packages/ai/src/provider.ts was deleted; add an explicit regression test or mapping",
		]);
		expect(createImpactTestPlan(["packages/action-rpc/src/server.ts"]).selectionErrors).toEqual([
			"action-rpc has no targeted test entry point for packages/action-rpc/src/server.ts",
		]);
	});

	it("never exposes a package-test fallback from the changed-test runner", () => {
		const implementation = readFileSync(join(repoRoot, "scripts/quality/test-impact.mjs"), "utf8");
		expect(implementation).not.toContain("full package");
		expect(implementation).not.toContain("target.full");
		expect(implementation).not.toMatch(/runBun\(\["run",\s*"test"/u);
		expect(implementation).not.toContain('["run", "test:quality"]');
		expect(implementation).not.toContain("test-pkg.mjs");
	});

	it("uses explicit host component tests for shared model selector UI", () => {
		const plan = createImpactTestPlan([
			"apps/desktop/src/renderer/domains/conversation/connectors/team/TeamModelSelector.tsx",
			"packages/theme-ui/src/chat/ModelConfiguration.tsx",
			"packages/theme-ui/src/chat/ModelSelectorTrigger.tsx",
			"packages/theme-ui/src/chat/ModelSelectorView.tsx",
		]);
		expect(plan.selectionErrors).toEqual([]);
		expect(plan.targets).toMatchObject([
			{
				key: "desktop",
				directTests: [
					"src/renderer/domains/conversation/components/ModelSelectorView.test.tsx",
					"src/renderer/domains/conversation/connectors/team/TeamModelSelector.test.tsx",
				],
				relatedSources: [],
			},
		]);
	});

	it("keeps packages with test prerequisites on targeted tests", () => {
		const plan = createImpactTestPlan(["packages/plugins/presets/vetta-ui-design/src/vetd/tool-gate.ts"]);
		expect(plan.selectionErrors).toEqual([]);
		expect(plan.targets).toMatchObject([
			{
				key: "presets/vetta-ui-design",
				prerequisites: [["run", "build:runner"]],
				relatedSources: ["src/vetd/tool-gate.ts"],
			},
		]);
		expect(plan.targets.every((target) => !("full" in target))).toBe(true);
	});

	it("keeps unmapped source files inside workspaces with package tests on the targeted path", () => {
		const plan = createImpactTestPlan(["packages/theme-ui/src/chat/UnmappedView.tsx"], () => true);
		expect(plan.selectionErrors).toEqual([]);
		expect(plan.targets).toMatchObject([
			{
				key: "theme-ui",
				directTests: [],
				relatedSources: ["src/chat/UnmappedView.tsx"],
			},
		]);
	});

	it("runs quality tests for scripts while documentation-only changes need no package tests", () => {
		const quality = createImpactTestPlan(["scripts/quality/test-impact.mjs"]);
		expect(quality).toMatchObject({
			qualityTests: ["scripts/quality/quality-gates.test.mjs"],
			runQuality: true,
			selectionErrors: [],
			targets: [],
		});
		const workflow = createImpactTestPlan([".github/workflows/desktop-release.yml"]);
		expect(workflow).toMatchObject({
			qualityTests: ["scripts/quality/desktop-release-workflow.test.mjs"],
			runQuality: true,
			selectionErrors: [],
			targets: [],
		});
		const docs = createImpactTestPlan(["docs/dev/quality-gates.md"]);
		expect(docs).toMatchObject({ runQuality: false, selectionErrors: [], targets: [] });
		expect(parseImpactArgs(["--dry-run", "packages/ai/src/providers/retry-policy.ts"])).toMatchObject({
			dryRun: true,
			files: ["packages/ai/src/providers/retry-policy.ts"],
		});
	});

	it("routes changed plugin manifests to repository manifest contract tests", () => {
		const plan = createImpactTestPlan(["packages/plugins/externals/chinese-chess/plugin.json"]);
		expect(plan.targets).toEqual([]);
		expect(plan).toMatchObject({
			qualityTests: ["scripts/quality/plugin-manifests.test.mjs"],
			runQuality: true,
			selectionErrors: [],
		});
	});

	it("builds generated workspace exports required by tests without building leaf applications", () => {
		const dependencies = buildableTestDependencies(Object.keys(TESTABLE_PACKAGES));
		expect(dependencies).toEqual(
			expect.arrayContaining([
				"@vetta/action-rpc",
				"@vetta/runtime-storage",
				"@vetta-org/plugin-sdk",
				"@vetta/toolkit",
			]),
		);
		expect(dependencies).not.toEqual(
			expect.arrayContaining(["@vetta/desktop", "@vetta/docs-site", "@vetta/remote-relay"]),
		);
	});
});

describe("CI unit test coverage", () => {
	const workflow = readFileSync(join(repoRoot, ".github/workflows/quality.yml"), "utf8");
	const imGatewayWorkflow = readFileSync(join(repoRoot, ".github/workflows/im-gateway.yml"), "utf8");
	const kotlinWorkflow = readFileSync(join(repoRoot, ".github/workflows/kotlin.yml"), "utf8");
	const appleWorkflow = readFileSync(join(repoRoot, ".github/workflows/mobile-apple.yml"), "utf8");
	const docsWorkflow = readFileSync(join(repoRoot, ".github/workflows/docs-site.yml"), "utf8");
	const desktopPackagedWorkflow = readFileSync(join(repoRoot, ".github/workflows/desktop-packaged.yml"), "utf8");
	const precommit = readFileSync(join(repoRoot, "scripts/quality/precommit.mjs"), "utf8");
	const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

	it("runs portable tests on Linux and keeps Windows path/process coverage", () => {
		expect(workflow).toContain("os: [ubuntu-latest, windows-latest]");
		expect(workflow).toContain("fetch-depth: 0");
		expect(workflow).toContain("command -v rg >/dev/null || { sudo apt-get update");
		expect(workflow).toContain("Get-Command rg -ErrorAction SilentlyContinue");
		expect(workflow).toContain("bun run test:changed --base");
	});

	it("cancels stale runs, fails the platform matrix fast, and installs Bun packages without Actions caches", () => {
		expect(workflow).toContain("cancel-in-progress: true");
		expect(workflow).toContain("fail-fast: true");
		expect(workflow.match(/uses: actions\/checkout@v7/g)).toHaveLength(2);
		expect(workflow.match(/uses: \.\/\.github\/actions\/install-bun-dependencies/g)).toHaveLength(2);
		const installAction = readFileSync(join(repoRoot, ".github/actions/install-bun-dependencies/action.yml"), "utf8");
		expect(installAction).not.toContain("node_modules");
		expect(installAction).not.toContain("actions/cache");
	});

	it("keeps the local full-test entry point sequential and discovery-based", () => {
		expect(rootManifest.scripts["test:full"]).toBe("bun run scripts/quality/test-pkg.mjs --all");
		expect(rootManifest.scripts.test).toBe("bun run test:full");
		expect(rootManifest.scripts["test:unit"]).toBe("bun run test:full");
	});

	it("does not duplicate checks already owned by the repository quality workflow", () => {
		expect(rootManifest.scripts["check:types"]).not.toContain("apps/cli-host typecheck");
		expect(docsWorkflow).not.toContain("bun run --cwd apps/docs-site check");
		expect(docsWorkflow).not.toContain("bun run --cwd apps/docs-site test");
		expect(docsWorkflow).toContain("bun run build:docs");
		expect(desktopPackagedWorkflow).not.toContain("node apps/desktop/scripts/verify-packaging-contract.mjs");
	});

	it("keeps pre-commit read-only so partial staging is preserved", () => {
		expect(precommit).not.toContain('"--write"');
		expect(precommit).not.toContain('git(["add"');
		expect(precommit).toContain('"--staged"');
	});

	it("builds the Android app and runs host tests when Kotlin changes", () => {
		expect(kotlinWorkflow).toContain('      - "apps/mobile/client-android/**"');
		expect(kotlinWorkflow).toContain(":shared:testAndroidHostTest");
		expect(kotlinWorkflow).toContain(":androidApp:assembleDebug");
	});

	it("tests VettaKit, the desktop interop and the iOS build when the Apple client or the protocol changes", () => {
		expect(appleWorkflow).toContain('      - "apps/mobile/client-apple/**"');
		expect(appleWorkflow).toContain('      - "packages/remote-control/**"');
		expect(appleWorkflow).toContain("swift test --no-parallel");
		expect(appleWorkflow).toContain("scripts/interop.sh");
		expect(appleWorkflow).toContain("xcodebuild build");
	});

	it("limits path-filtered app checks to branch pushes", () => {
		for (const appWorkflow of [imGatewayWorkflow, kotlinWorkflow, appleWorkflow]) {
			expect(appWorkflow).toMatch(/push:\r?\n {4}branches:\r?\n {6}- "\*\*"\r?\n {4}paths:/);
		}
	});
});

describe("durable package boundaries", () => {
	const check = findDurablePackageBoundaryViolations;

	it("blocks application imports from reusable packages and ignores import-looking comments", () => {
		const file = "packages/ai/src/example.ts";
		expect(check(file, 'import "@vetta/desktop";')).toHaveLength(1);
		expect(check(file, 'const host = await import("@vetta/cli-host/runtime");')).toHaveLength(1);
		expect(check(file, '// import host from "@vetta/desktop";')).toEqual([]);
	});

	it("blocks production imports from test trees but allows tests to share fixtures", () => {
		const source = 'import { fixture } from "../../agent/test/fixture";';
		expect(check("packages/ai/src/example.ts", source)).toHaveLength(1);
		expect(check("packages/ai/src/example.test.ts", source)).toEqual([]);
	});

	it("keeps plugin code behind the public SDK and Desktop behind exported CLI contracts", () => {
		expect(check("packages/plugins/externals/example/src/index.ts", "window.vetta.fs.readFile(path);")).toHaveLength(
			1,
		);
		expect(check("apps/desktop/src/main/example.ts", 'import "../../../../cli-host/src/cli";')).toHaveLength(1);
	});

	it("keeps Desktop renderer MCP runtime values on the browser-safe entry", () => {
		const file = "apps/desktop/src/renderer/example.ts";
		expect(check(file, 'import { connect } from "@vetta/runtime-mcp";')).toHaveLength(1);
		expect(check(file, 'import { connect } from "@vetta/runtime-mcp/browser";')).toEqual([]);
		expect(check(file, 'import type { Config } from "@vetta/runtime-mcp";')).toEqual([]);
	});

	it("keeps capability identifiers and schemas owned by capability definitions", () => {
		expect(check("packages/ai/src/example.ts", 'const id = "cap.domain.vetta.example.read";')).toHaveLength(1);
		expect(
			check(
				"packages/capability-sdk/src/domain/example.ts",
				"const token = defineCapability<Input, Output>({ parseInput: parse, parseOutput: parse });",
			),
		).toHaveLength(2);
	});

	it("keeps runtime protocols and runtime-core platform neutral", () => {
		expect(check("packages/runtime-storage/src/index.ts", 'import { readFile } from "node:fs";')).toHaveLength(1);
		expect(check("packages/runtime-tools/src/index.ts", 'import "@vetta/runtime-node";')).toHaveLength(1);
		expect(check("packages/runtime-mcp/src/index.ts", 'import "@vetta/runtime-desktop";')).toHaveLength(1);
		expect(check("packages/runtime-core/src/index.ts", "const bytes = Buffer.from('x');")).toHaveLength(1);
	});

	it("keeps product semantics and Coding Agent dependencies above the generic runtimes", () => {
		expect(check("packages/runtime-core/src/index.ts", "const enableSubagents = true;")).toHaveLength(1);
		expect(check("packages/runtime-core/src/index.ts", 'import "@vetta/coding-agent/sdk";')).toHaveLength(1);
		expect(check("packages/agent/src/index.ts", 'import "@vetta/runtime-core";')).toHaveLength(1);
	});

	it("requires explicit Coding Agent subpaths and does not publish concrete tools", () => {
		expect(check("apps/desktop/src/main/example.ts", 'import "@vetta/coding-agent";')).toHaveLength(1);
		expect(
			check("packages/coding-agent/src/index.ts", 'export { createReadTool } from "@vetta/runtime-tools/coding";'),
		).not.toEqual([]);
	});

	it("requires selected workspace imports to be declared in their manifest", () => {
		const manifest = { name: "@vetta/runtime-storage", dependencies: {} };
		expect(check("packages/runtime-storage/src/index.ts", 'import "@vetta/action-rpc";', { manifest })).toHaveLength(
			1,
		);
		expect(
			check("packages/runtime-storage/src/index.ts", 'import "@vetta/action-rpc";', {
				manifest: { ...manifest, dependencies: { "@vetta/action-rpc": "workspace:*" } },
			}),
		).toEqual([]);
	});

	it("keeps agent-core manifests below runtime and product packages", () => {
		expect(
			findDurablePackageManifestBoundaryViolations({
				name: "@vetta/agent-core",
				dependencies: { "@vetta/runtime-core": "workspace:*" },
			}),
		).toHaveLength(1);
		expect(
			findDurablePackageManifestBoundaryViolations({
				name: "@vetta/agent-core",
				dependencies: { "@vetta/ai": "workspace:*" },
			}),
		).toEqual([]);
	});

	it("does not turn migration vocabulary into permanent architecture contracts", () => {
		expect(
			check(
				"packages/coding-agent/src/composition/runtime-composition.ts",
				"const childComposition = {}; const legacyAdapter = {};",
			),
		).toEqual([]);
	});
});

describe("Turborepo build orchestration", () => {
	const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
	const turboConfig = JSON.parse(readFileSync(join(repoRoot, "turbo.json"), "utf8"));

	it("derives build order from the workspace graph and caches declared artifacts", () => {
		expect(turboConfig.tasks.build.dependsOn).toEqual(["^build"]);
		expect(turboConfig.globalDependencies).toEqual(expect.arrayContaining(["tsconfig.base.json", ".env", ".env.*"]));
		expect(turboConfig.envMode).toBe("strict");
		expect(turboConfig.tasks.build.inputs).toEqual(
			expect.arrayContaining(["$TURBO_DEFAULT$", "!test/**", "!tests/**", "!README*", "!CHANGELOG*"]),
		);
		expect(turboConfig.tasks.build.outputs).toEqual(
			expect.arrayContaining(["dist/**", "release/**", ".next/**", "!.next/cache/**"]),
		);
		expect(turboConfig.tasks.build.env).toEqual(
			expect.arrayContaining(["NODE_ENV", "VETTA_PLUGIN_DEV_WATCH", "VETTA_PLUGIN_DOCS_SRC", "VETD_SRC"]),
		);
		const docsBuild = turboConfig.tasks["@vetta/docs-site#build"];
		expect(docsBuild.env).toEqual(["DOCS_SITE_URL", "NODE_ENV"]);
		expect(docsBuild.dependsOn).toContain("^build");
		expect(docsBuild.outputs).toContain(".next/**");
		const pluginWorkbenchBuild = turboConfig.tasks["@vetta/plugin-plugin-workbench#build"];
		expect(pluginWorkbenchBuild.inputs).toContain("$TURBO_ROOT$/docs/plugin/**");
		expect(pluginWorkbenchBuild.dependsOn).toContain("^build");
		expect(pluginWorkbenchBuild.outputs).toContain("release/**");
		expect(pluginWorkbenchBuild.env).toEqual(expect.arrayContaining(turboConfig.tasks.build.env));
	});

	it("keeps Desktop build and remote cache outside the initial cache boundary", () => {
		expect(turboConfig.tasks["@vetta/desktop#build"]).toMatchObject({
			cache: false,
		});
		expect(turboConfig.tasks["@vetta/desktop#build"].dependsOn).toEqual(
			expect.arrayContaining(["^build", "@vetta-org/plugin-vite#build"]),
		);
		expect(turboConfig.tasks["@vetta/desktop#build"].env).toEqual(
			expect.arrayContaining(["NODE_ENV", "VETTA_*", "VETD_*"]),
		);
		expect(turboConfig.remoteCache).toEqual({ enabled: false, signature: true });
	});

	it("routes root builds through Turbo while preserving preset orchestration", () => {
		expect(rootManifest.devDependencies.turbo).toMatch(/^\d+\.\d+\.\d+$/);
		expect(rootManifest.scripts.build).toContain("turbo run build");
		expect(rootManifest.scripts.build).toContain("--filter=@vetta-org/plugin-vite");
		expect(rootManifest.scripts.build).toContain("build:preset:prebuilt");
		expect(rootManifest.scripts["build:desktop"]).toContain("--filter=@vetta/desktop");
		expect(rootManifest.scripts["build:cli"]).toContain("--filter=@vetta/cli-host");
		expect(rootManifest.scripts["build:cli"]).toContain("--filter=@vetta-org/plugin-vite");
		expect(rootManifest.scripts["build:cli"]).toContain("build:preset:prebuilt");
		expect(rootManifest.scripts["build:docs"]).toContain("turbo run build");
		expect(rootManifest.scripts["build:preset"]).toBe("bun run --cwd apps/desktop build:presets");
		expect(rootManifest.scripts["build:preset:prebuilt"]).toBe("bun run --cwd apps/desktop build:presets:prebuilt");
		expect(Object.values(rootManifest.scripts).join("\n")).not.toContain("--env-mode=loose");
		expect(Object.values(rootManifest.scripts).join("\n")).not.toContain("scripts/build.sh");
	});

	it("keeps Vercel docs builds independent from excluded Git history", () => {
		const vercelConfig = JSON.parse(readFileSync(join(repoRoot, "apps/docs-site/vercel.json"), "utf8"));
		const vercelIgnore = readFileSync(join(repoRoot, ".vercelignore"), "utf8");
		const docsWorkflow = readFileSync(join(repoRoot, ".github/workflows/docs-site.yml"), "utf8");
		expect(vercelConfig.buildCommand).toContain("build:docs");
		expect(vercelConfig.ignoreCommand).toBeUndefined();
		expect(vercelIgnore).toContain("\n/docs\n");
		expect(vercelIgnore).not.toMatch(/\ndocs\r?\n/u);
		expect(docsWorkflow).toContain('"package.json"');
		expect(docsWorkflow).toContain('"turbo.json"');
		expect(docsWorkflow).toContain("bun run build:docs");
	});

	it("enforces cache safety as an always-on repository contract", () => {
		expect(findTurboConfigurationProblems(readTurboConfiguration())).toEqual([]);
		const configuration = readTurboConfiguration();
		configuration.turboConfig = {
			...configuration.turboConfig,
			globalDependencies: [".env", ".env.*"],
		};
		expect(findTurboConfigurationProblems(configuration)).toContain(
			"turbo globalDependencies 缺少 tsconfig.base.json",
		);
	});

	it("records Turbo summaries for test dependency builds and uploads them from CI", () => {
		const testPackageScript = readFileSync(join(repoRoot, "scripts/quality/test-pkg.mjs"), "utf8");
		const qualityWorkflow = readFileSync(join(repoRoot, ".github/workflows/quality.yml"), "utf8");
		expect(testPackageScript).toContain('"--summarize"');
		expect(qualityWorkflow).toContain("Upload Turbo run summaries");
		expect(qualityWorkflow).toContain(".turbo/runs/*.json");
		expect(qualityWorkflow).toContain("retention-days: 7");
	});

	it("removes superseded hand-written task graphs", () => {
		for (const path of [
			"scripts/build.sh",
			"scripts/build.ps1",
			"scripts/workspace-build-dependencies.mjs",
			"scripts/quality/check-build-order.mjs",
			"apps/desktop/scripts/build-workspace-prereqs.mjs",
		]) {
			expect(existsSync(join(repoRoot, path)), path).toBe(false);
		}
	});
});

describe("skill frontmatter analysis", () => {
	const wrap = (frontmatter) => `---\n${frontmatter}\n---\n\n# Skill body\n`;

	it("accepts a plain skill", () => {
		expect(findSkillFrontmatterProblems(wrap("name: demo\ndescription: Does a thing when asked."))).toEqual([]);
	});

	it("rejects an unquoted description containing a colon — it makes the skill vanish silently", () => {
		const problems = findSkillFrontmatterProblems(wrap("name: demo\ndescription: Use it: it does a thing."));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('contains ": "');
	});

	it("accepts the same description once quoted", () => {
		expect(findSkillFrontmatterProblems(wrap('name: demo\ndescription: "Use it: it does a thing."'))).toEqual([]);
	});

	it("accepts folded block scalars and measures their real length", () => {
		expect(findSkillFrontmatterProblems(wrap("name: demo\ndescription: >\n  Does a thing\n  when asked."))).toEqual(
			[],
		);
		const long = `name: demo\ndescription: >\n  ${"x".repeat(1100)}`;
		expect(findSkillFrontmatterProblems(wrap(long))).toHaveLength(1);
	});

	it("requires frontmatter and a description", () => {
		expect(findSkillFrontmatterProblems("# No frontmatter\n")).toHaveLength(1);
		expect(findSkillFrontmatterProblems(wrap("name: demo"))).toHaveLength(1);
	});
});

import { describe, expect, it } from "vitest";
import {
	findBuildOrderViolations,
	findLayeredBuildOrderViolations,
	parseBuildPackageOrder,
} from "./check-build-order.mjs";
import { findLegacySetupSeedViolations } from "./check-legacy-execution-retirement.mjs";
import { findPackageBoundaryViolations, findPackageManifestBoundaryViolations } from "./check-package-boundaries.mjs";
import { batchPaths, createQuickCheckPlan, isBiomeGlobalTrigger } from "./check-quick.mjs";
import { findSkillFrontmatterProblems } from "./check-skill-frontmatter.mjs";
import { findStandaloneCliBuildViolations } from "./check-standalone-cli-build.mjs";
import { changedFiles, expandTestablePackages, packagesFromPaths, parseBaseArgs, stagedFiles } from "./lib.mjs";
import { createChangedTestPlan, parseArgs } from "./test-changed.mjs";

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
});

describe("standalone CLI 编译入口守卫", () => {
	it("拒绝在 Desktop 生产代码中直接编译 CLI 源入口", () => {
		expect(
			findStandaloneCliBuildViolations(
				"packages/desktop-app/src/main/example.ts",
				`spawn("bun", ["build", join(cliAppRoot, "src", "cli.ts"), "--compile"]);`,
			),
		).toHaveLength(1);
	});

	it("允许调用统一编译器和编译其他入口", () => {
		expect(
			findStandaloneCliBuildViolations(
				"packages/desktop-app/src/main/example.ts",
				`spawn("bun", [join(cliAppRoot, "scripts", "compile-standalone.mjs")]);`,
			),
		).toEqual([]);
		expect(
			findStandaloneCliBuildViolations(
				"packages/desktop-app/src/main/dev-cli-shim.ts",
				`spawn("bun", ["build", launcherEntryPath, "--compile"]);`,
			),
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
});

describe("affected package selection", () => {
	it("includes transitive testable dependents", () => {
		expect(expandTestablePackages(["ai"])).toEqual(["ai", "agent", "coding-agent"]);
		expect(expandTestablePackages(["runtime-mcp"])).toEqual(["runtime-mcp", "coding-agent"]);
		expect(expandTestablePackages(["ecosystem-adapter"])).toEqual(["coding-agent", "ecosystem-adapter"]);
	});

	it("runs every core test package for global quality inputs", () => {
		const plan = createChangedTestPlan(["bun.lock"]);
		expect(plan.globalTriggers).toEqual(["bun.lock"]);
		expect(plan.toTest).toEqual(["ai", "agent", "runtime-mcp", "coding-agent", "ecosystem-adapter"]);
	});

	it("runs quality tests when their implementation changes", () => {
		const plan = createChangedTestPlan(["scripts/quality/test-changed.mjs"]);
		expect(plan.runQuality).toBe(true);
		expect(plan.toTest).toEqual(["ai", "agent", "runtime-mcp", "coding-agent", "ecosystem-adapter"]);
	});

	it("accepts both base argument forms and rejects unknown arguments", () => {
		expect(parseArgs(["--base", "origin/main"])).toEqual({ base: "origin/main" });
		expect(parseArgs(["--base=origin/release"])).toEqual({ base: "origin/release" });
		expect(() => parseArgs(["--unknown"])).toThrow("unknown argument");
	});
});

describe("package boundary analysis", () => {
	const libFile = "packages/ai/src/example.ts";

	it("detects side-effect and dynamic app imports", () => {
		expect(findPackageBoundaryViolations(libFile, 'import "@vetta/desktop-app";')).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(libFile, 'const app = await import("@vetta/cli-app/runtime");'),
		).toHaveLength(1);
	});

	it("ignores import-looking comments", () => {
		expect(findPackageBoundaryViolations(libFile, '// import app from "@vetta/desktop-app";')).toEqual([]);
	});

	it("blocks production imports from test trees but allows test files", () => {
		const source = 'import { fixture } from "../../agent/test/fixture";';
		expect(findPackageBoundaryViolations(libFile, source)).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/ai/src/example.test.ts", source)).toEqual([]);
	});

	it("allows raw capability ids only in capability definition modules", () => {
		const source = 'const id = "cap.domain.vetta.example.read";';
		expect(findPackageBoundaryViolations("packages/capability-sdk/src/domain/example.ts", source)).toEqual([]);
		expect(findPackageBoundaryViolations("packages/capability-sdk/src/adapters/example.ts", source)).toHaveLength(1);
	});

	it("requires schema-backed capability definitions with generated catalogs", () => {
		const source = `
			const TOKEN = defineCapability<Input, Output>({
				parseInput: parse,
				parseOutput: parse,
			});
		`;
		expect(findPackageBoundaryViolations("packages/capability-sdk/src/foundation/example.ts", source)).toHaveLength(
			2,
		);
	});

	it("blocks Desktop globals in ordinary plugins while preserving the built-in workbench exception", () => {
		const source = "window.vetta.fs.readFile(path);";
		expect(findPackageBoundaryViolations("packages/plugins/externals/example/src/index.ts", source)).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/plugins/presets/plugin-workbench/src/index.ts", source)).toEqual(
			[],
		);
	});

	it("blocks Desktop production imports from cli-app source paths", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/runtime.ts",
				'import { createRuntime } from "../../../../cli-app/src/runtime.js";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/runtime.ts",
				'import { createRuntime } from "@vetta/runtime-composition";',
			),
		).toHaveLength(1);
	});

	it("keeps the greenfield runtime kernel independent from coding-agent", () => {
		const source = 'import { createCodingAgentPromptRuntime } from "@vetta/coding-agent/runtime-host";';
		expect(findPackageBoundaryViolations("packages/runtime-core/src/kernel/example.ts", source)).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/runtime-storage/src/conversation/example.ts", source),
		).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/runtime-tools/src/coding/example.ts", source)).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/runtime-mcp/src/example.ts", source)).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-core/src/runtime-host/greenfield-session-projection.ts",
				source,
			),
		).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/runtime-core/src/runtime-host/example.ts", source)).toHaveLength(
			1,
		);
	});

	it("keeps every runtime-core production module independent from coding-agent", () => {
		const source = 'import { SessionManager } from "@vetta/coding-agent";';
		expect(
			findPackageBoundaryViolations("packages/runtime-core/src/runtime-host/runtime-host.ts", source),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/runtime-core/src/runtime-host/session-services.ts", source),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/runtime-core/src/runtime-host/legacy-session-services.ts", source),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/coding-agent/src/adapters/runtime-core/composition.ts", source),
		).toEqual([]);
	});

	it("keeps the retired Coding Agent Runtime Host public resolution deleted", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/test/example.test.ts",
				'import { createHost } from "@vetta/coding-agent/runtime-host/greenfield";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/vitest.config.ts",
				'const alias = { "@vetta/coding-agent/runtime-host": "../coding-agent/src/adapters/runtime-core" };',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/test/example.test.ts",
				'import { createCodingAgentTurnExecutor } from "@vetta/coding-agent/runtime";',
			),
		).toEqual([]);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/coding-agent",
				exports: { "./runtime-host": "./dist/adapters/runtime-core/index.js" },
			}),
		).toHaveLength(1);
	});

	it("keeps greenfield product modules independent from legacy startup symbols", () => {
		const source = "const startup = runLegacyAgentWithBootstrap;";
		expect(
			findPackageBoundaryViolations("packages/cli-app/src/rpc/greenfield-im-runtime-host.ts", source),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/runtime-composition/src/greenfield-runtime-composition.ts", source),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/coding-agent/src/composition/runtime-composition.ts", source),
		).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/cli-app/src/agent-runtime-selection.ts", source)).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/cli-app/src/legacy-runtime-gateway.ts", source)).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/runtime-composition.ts",
				"// runLegacyAgentWithBootstrap is a compatibility-only entry point.",
			),
		).toEqual([]);
	});

	it("keeps Extension Legacy policy out of Greenfield product modules", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/rpc/greenfield-im-runtime-host.ts",
				'const reason = "legacy-extension";',
			),
		).toHaveLength(2);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/rpc/greenfield-im-runtime-host.ts",
				'const kind = "extension-incompatible";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/agent-runtime-selection.ts",
				'const reason = "legacy-extension";',
			),
		).toHaveLength(1);
	});

	it("keeps automatic Legacy Session execution out of production hosts", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/agent-runtime-selection.ts",
				'const reason = "legacy-session";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/legacy-runtime-gateway.ts",
				'const cause = "session-migration-gap";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/agent-runtime-selection.ts",
				'const kind = "session-incompatible";',
			),
		).toEqual([]);
	});

	it("keeps the retired runtime-composition package and CLI forwarding layer deleted", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-composition/src/index.ts",
				'export * from "@vetta/coding-agent/composition";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations("packages/runtime-composition/src/new-runtime.ts", "export const runtime = {};"),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/greenfield-runtime-composition.ts",
				'export * from "@vetta/coding-agent/composition";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/index.ts",
				'export * from "@vetta/coding-agent/composition";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/runtime.ts",
				'import type { CodingAgentRuntimeCompositionOptions } from "@vetta/cli-app";',
			),
		).toHaveLength(1);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/desktop-app",
				dependencies: { "@vetta/runtime-composition": "workspace:*" },
			}),
		).toHaveLength(1);
	});

	it("requires all internal consumers to use explicit coding-agent subpaths", () => {
		const rootImport = 'import { getAgentDir } from "@vetta/coding-agent";';
		expect(findPackageBoundaryViolations("packages/desktop-app/src/main/new-consumer.ts", rootImport)).toHaveLength(
			1,
		);
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/new-consumer.ts",
				'import { getAgentDir } from "@vetta/coding-agent/config";',
			),
		).toEqual([]);
		expect(findPackageBoundaryViolations("packages/desktop-app/src/main/runtime.ts", rootImport)).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/desktop-app/src/main/runtime.test.ts", rootImport)).toHaveLength(
			1,
		);
		expect(findPackageBoundaryViolations("packages/runtime-core/test/runtime.test.ts", rootImport)).toHaveLength(1);
		expect(findPackageBoundaryViolations("packages/runtime-tools/src/index.ts", rootImport)).toHaveLength(1);
	});

	it("keeps the retired Coding Agent Knowledge surface deleted", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/knowledge/example.ts",
				'import { scanRaws } from "@vetta/coding-agent/knowledge";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/example.ts",
				'import { scanRaws } from "../core/knowledge/store.js";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/core/knowledge/new-store.ts",
				"export const store = {};",
			),
		).toHaveLength(1);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/coding-agent",
				exports: { "./knowledge": "./dist/core/knowledge/index.js" },
			}),
		).toHaveLength(1);
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/runtime-knowledge",
				exports: { ".": "./dist/index.js" },
			}),
		).toEqual([]);
	});

	it("keeps retired Coding Agent model-context core files and imports deleted", () => {
		for (const name of ["messages", "subconscious", "system-prompt"]) {
			expect(
				findPackageBoundaryViolations(`packages/coding-agent/src/core/${name}.ts`, "export const retired = true;"),
			).toHaveLength(1);
			expect(
				findPackageBoundaryViolations(
					"packages/coding-agent/src/composition/example.ts",
					`import { retired } from "../core/${name}.js";`,
				),
			).toHaveLength(1);
		}
		expect(
			findPackageManifestBoundaryViolations({
				name: "@vetta/coding-agent",
				exports: { "./core/system-prompt.js": "./dist/core/system-prompt.js" },
			}),
		).toHaveLength(1);
	});

	it("keeps Compaction in its package domain and independent from Session storage implementations", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/core/compaction/compaction.ts",
				"export const retired = true;",
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/example.ts",
				'import { compact } from "../core/compaction/index.js";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/compaction/compaction.ts",
				'import type { SessionEntry } from "../core/session-manager/index.js";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/compaction/compaction.ts",
				'import type { ConversationDocument } from "@vetta/runtime-core/conversation";',
			),
		).toHaveLength(1);
	});

	it("keeps production Legacy imports and Runtime adapters inside explicit compatibility boundaries", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/legacy-runtime-gateway.ts",
				'import { main } from "@vetta/coding-agent/legacy/cli";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/agent-runtime-selection.ts",
				'import { main } from "@vetta/coding-agent/legacy/cli";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/new-consumer.ts",
				'import { main } from "@vetta/coding-agent/legacy/cli";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/greenfield-runtime/desktop-legacy-execution-compatibility.ts",
				'import { LegacyCodingAgentSessionBackend } from "@vetta/coding-agent/runtime-host";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/test/support/legacy-runtime.ts",
				'import { main } from "@vetta/coding-agent/legacy/cli";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/greenfield-runtime/desktop-legacy-session-format-compatibility.ts",
				'import { createCodingAgentHistoricalSessionCatalog } from "@vetta/coding-agent/historical-sessions";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/rpc/cli-session-format-compatibility.ts",
				'import { createCodingAgentHistoricalSessionCatalog } from "@vetta/coding-agent/historical-sessions";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/new-consumer.ts",
				'import { createCodingAgentHistoricalSessionCatalog } from "@vetta/coding-agent/historical-sessions";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/new-consumer.ts",
				'import { LegacyCodingAgentSessionBackend } from "@vetta/coding-agent/runtime-host";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/greenfield-runtime/desktop-legacy-execution-compatibility.ts",
				'import { LegacyRuntimeSessionCatalog } from "@vetta/coding-agent/runtime-host";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/desktop-app/src/main/greenfield-runtime/desktop-legacy-session-format-compatibility.ts",
				'import { LegacyCodingAgentSessionBackend } from "@vetta/coding-agent/runtime-host";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/cli-app/src/rpc/cli-session-format-compatibility.ts",
				'import { LegacyCodingAgentSessionBackend } from "@vetta/coding-agent/runtime-host";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/adapters/runtime-core/index.ts",
				'export { LegacyRuntimeSessionCatalog } from "../../sessions/legacy/index.js";',
			),
		).toHaveLength(2);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/public-api/historical-sessions.ts",
				'import { LegacyRuntimeSessionCatalog } from "../sessions/legacy/catalog.js";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/sessions/legacy/catalog.ts",
				'import { createAgentSession } from "../../../core/sdk.js";',
			),
		).toHaveLength(2);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/sessions/legacy/catalog.ts",
				'import { SessionManager } from "../../../core/session-manager/index.js";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/adapters/runtime-core/composition.ts",
				"export function createLegacyRuntimeHostOptions() {}",
			),
		).toHaveLength(1);
	});

	it("keeps the Greenfield active-session transaction host independent from Legacy session construction", () => {
		const hostPath = "packages/coding-agent/src/composition/greenfield-active-session-transition-host.ts";
		expect(
			findPackageBoundaryViolations(hostPath, 'import { SessionManager } from "../core/session-manager/index.js";'),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				hostPath,
				'import { migrateLegacySessionToV2 } from "@vetta/runtime-storage/conversation";',
			),
		).not.toEqual([]);
		expect(findPackageBoundaryViolations(hostPath, "type Runtime = CodingAgentRuntimeComposition;")).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(hostPath, "type Runtime = CodingAgentGreenfieldSessionTransitionRuntimePort;"),
		).toEqual([]);
	});

	it("keeps Greenfield session action ports independent from the Extension command API", () => {
		const activeHostPath = "packages/coding-agent/src/composition/greenfield-active-session-transition-host.ts";
		expect(
			findPackageBoundaryViolations(
				activeHostPath,
				'import type { ExtensionCommandContextActions } from "../core/extensions/types.js";',
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/host/session-history/branch-navigation-host.ts",
				'type Options = Parameters<ExtensionCommandContextActions["navigateTree"]>[1];',
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/adapters/runtime-core/greenfield-extension-command-actions-adapter.ts",
				'import type { ExtensionCommandContextActions } from "../../core/extensions/index.js";',
			),
		).toEqual([]);
	});

	it("keeps Knowledge Processing contracts independent from backend implementations", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/knowledge-processing-session.ts",
				'import type { KnowledgeProcessingSession } from "./legacy-knowledge-processing-session.js";',
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/knowledge-processing-contract.ts",
				'import { SessionManager } from "../core/session-manager/index.js";',
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/composition/legacy-knowledge-processing-session.ts",
				'import { SessionManager } from "../core/session-manager/index.js";',
			),
		).toEqual([]);
	});

	it("keeps Subagent session assembly out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedAssembly = `
			const runtime = new CodingAgentSubagentRuntime({});
			createCodingAgentSubagentChildHandle({});
			hooks.runSubagentStart({});
			const directory = ".subagents";
			const observation = "subagents_update";
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedAssembly)).toHaveLength(5);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentSubagentSessionAssembly } from "./subagent/session-assembly.js";',
			),
		).toHaveLength(1);
	});

	it("keeps Turn Capability session assembly out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedAssembly = `
			const plugin = new CodingAgentPluginRunOrchestrator({});
			const prompt = new CodingAgentPromptRuntime({});
			const frame = new CodingAgentModelCallFrameComposer({});
			const capabilities = await RuntimeCapabilityComposition.create({});
			await frame.previewSystemPrompt({});
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedAssembly)).toHaveLength(5);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentTurnCapabilitySessionAssembly } from "./turn/capability-session-assembly.js";',
			),
		).toHaveLength(1);
	});

	it("keeps Session Resource Lifecycle assembly out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedAssembly = `
			const resources: CodingAgentSessionRuntimeResources = {};
			const sessionCleanup = new RetryableCleanup();
			const hookSessionController = {};
			const background = new CodingAgentBackgroundWorkController();
			resources.createSessionPeripherals = () => ({});
			resources.stateSource = {};
			resources.onConversationContinued = async () => {};
			readActiveToolNames();
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedAssembly)).toHaveLength(9);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentSessionResourceLifecycle } from "./session-lifecycle/resource-lifecycle.js";',
			),
		).toHaveLength(1);
	});

	it("keeps Composition resource registries and shutdown transactions out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedLifecycle = `
			const sessionValues = new InMemoryCodingAgentSessionValueIndex();
			const sessionMarkers = new InMemoryCodingAgentSessionMarkerIndex();
			const compositionCleanup = new RetryableCleanup();
			const contextRuntimes = new Set();
			const memoryRuntimes = new Set();
			const todoRuntimes = new Set();
			const turnCapabilityAssemblies = new Set();
			const hookSessionDisposers = new Set();
			const ownershipBindings = new Set();
			prepareCompositionCleanup();
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedLifecycle)).toHaveLength(11);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentCompositionShutdown } from "./session-lifecycle/composition-shutdown.js";',
			),
		).toEqual([]);
	});

	it("keeps MCP Session coordination out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedCoordinator = `
			const synchronizer: McpRuntimeToolSynchronizer = createMcpRuntimeToolSynchronizer(source, registry);
			const controller = createMcpDeferredToolController(options);
			mergeMcpSnapshots(base, overlay);
			mergeMcpToolViews(base, overlay);
			refreshAndMergeMcpViews(base, overlay);
			const start = "mcp.reload.start";
			const end = "mcp.reload.end";
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedCoordinator)).toHaveLength(8);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentMcpSessionCoordinator } from "./tool-surface/mcp-session-coordinator.js";',
			),
		).toHaveLength(1);
	});

	it("keeps Session initialization transactions out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedInitialization = `
			const rollback = new InitializationRollbackScope();
			const execution = new CodingAgentSessionExecutionRuntime({});
			const configuration = new CodingAgentSessionConfigurationState();
			createCodingAgentSessionResourceLifecycle({});
			createCodingAgentTurnCapabilitySessionAssembly({});
			rollback.defer({ id: "conversation-ownership" });
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedInitialization)).toHaveLength(6);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentSessionInitializationTransaction } from "./session-initialization/transaction.js";',
			),
		).toEqual([]);
	});

	it("projects public Composition options into a narrow Session initialization profile", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const transactionPath = "packages/coding-agent/src/composition/session-initialization/transaction.ts";

		expect(
			findPackageBoundaryViolations(
				compositionPath,
				"createCodingAgentSessionInitializationTransaction({ composition: options });",
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				transactionPath,
				`import type { CodingAgentRuntimeCompositionOptions } from "./contracts/index.js";
				const composition = options.composition;`,
			),
		).not.toEqual([]);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				"createCodingAgentSessionInitializationTransaction({ profile: sessionInitializationProfile });",
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				transactionPath,
				`import type { CodingAgentSessionInitializationProfile } from "./profile.js";
				const profile = options.profile;`,
			),
		).toEqual([]);
	});

	it("keeps peripheral and context construction out of the Session initialization transaction", () => {
		const transactionPath = "packages/coding-agent/src/composition/session-initialization/transaction.ts";
		const forbiddenConstructions = [
			"new CodingAgentSessionExecutionRuntime({});",
			"new CodingAgentMemoryRolloverOrchestrator({});",
			"new GreenfieldRuntimeModel({});",
			"new CodingAgentGreenfieldContextRuntime({});",
			"createEcosystemHookRuntime({});",
			"createCodingAgentSubagentSessionAssembly({});",
			"createCodingAgentProductToolRegistrations({});",
			"createSessionPluginRuntime(options);",
		];
		for (const source of forbiddenConstructions) {
			expect(findPackageBoundaryViolations(transactionPath, source)).toHaveLength(1);
		}
		expect(
			findPackageBoundaryViolations(
				transactionPath,
				`const peripherals = await createCodingAgentSessionPeripheralAssembly(options);
				const context = createCodingAgentSessionContextAssembly({ peripherals });`,
			),
		).toEqual([]);
	});

	it("keeps Runtime Tool Surface assembly out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedToolSurface = `
			const scopes = CODING_TOOL_SCOPES;
			const order = CODING_AGENT_MODEL_TOOL_ORDER;
			createCodingToolsRuntimeComposition({});
			createCodingAgentMcpSessionCoordinator({});
			adaptCodingAgentToolRegistration({});
			createKbListTagsTool();
			createKbFilterByTagsTool();
			resolveCodingAgentToolActivation({});
			const instruction = "knowledge_mode_instruction";
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedToolSurface)).toHaveLength(9);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentRuntimeToolSurface } from "./tool-surface/runtime-tool-surface.js";',
			),
		).toEqual([]);
	});

	it("exposes Coding Agent Runtime Tools through the abstract Registry port", () => {
		const contractPath = "packages/coding-agent/src/composition/contracts/runtime-composition-result.ts";
		const concreteContract = `
			type Tools = CodingToolsRuntimeComposition;
			type Registry = InMemoryCodingToolRegistry;
			type Compiler = FeatureCompiler;
		`;
		expect(findPackageBoundaryViolations(contractPath, concreteContract)).toHaveLength(3);
		expect(
			findPackageBoundaryViolations(
				contractPath,
				"interface CodingAgentRuntimeToolAccess { readonly registry: CodingToolRegistry; }",
			),
		).toEqual([]);

		const compositionPath = "packages/coding-agent/src/composition/tool-surface/runtime-tools-composition.ts";
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				"interface CodingToolsRuntimeComposition { readonly registry: InMemoryCodingToolRegistry; }",
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				"interface CodingToolsRuntimeComposition { readonly registry: CodingToolRegistry; }",
			),
		).toEqual([]);
	});

	it("keeps Tool policy declarations out of Adapters and Composition", () => {
		const adapterPath = "packages/coding-agent/src/adapters/runtime-core/model-tool-order.ts";
		const compositionPath = "packages/coding-agent/src/composition/tool-surface/activation-policy.ts";
		const policyPath = "packages/coding-agent/src/tool-policy/activation-policy.ts";
		const adapterPolicy = "export const CODING_AGENT_MODEL_TOOL_ORDER = {};";
		const compositionPolicy = `
			export interface CodingAgentToolAvailability {}
			export function resolveCodingAgentToolActivation() {}
		`;

		expect(findPackageBoundaryViolations(adapterPath, adapterPolicy)).toHaveLength(1);
		expect(findPackageBoundaryViolations(compositionPath, compositionPolicy)).toHaveLength(2);
		expect(findPackageBoundaryViolations(policyPath, compositionPolicy)).toEqual([]);
	});

	it("keeps Coding Agent product domains independent from concrete Adapters", () => {
		for (const path of [
			"packages/coding-agent/src/extensions/runtime/extension-tool-runtime.ts",
			"packages/coding-agent/src/memory/memory-controller.ts",
			"packages/coding-agent/src/mcp/runtime/tool-source.ts",
			"packages/coding-agent/src/model-context/model-call-frame-composer.ts",
			"packages/coding-agent/src/plugins/runtime/tool-runtime.ts",
			"packages/coding-agent/src/resources/prompt-resource-resolver.ts",
			"packages/coding-agent/src/sessions/projection/conversation-context-projector.ts",
			"packages/coding-agent/src/work-state/todo-continuation-source.ts",
		]) {
			expect(
				findPackageBoundaryViolations(path, 'import { Adapter } from "../adapters/runtime-core/example.js";'),
			).toHaveLength(1);
		}
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/model-context/model-call-frame-composer.ts",
				'import type { Port } from "../runtime-contracts/index.js";',
			),
		).toEqual([]);
	});

	it("rejects retired Greenfield identities in the Runtime Prompt contract", () => {
		const path = "packages/runtime-core/src/runtime-host/prompt-contract.ts";
		expect(findPackageBoundaryViolations(path, "export interface GreenfieldPromptAdapter {}")).toHaveLength(1);
		expect(findPackageBoundaryViolations(path, "export interface RuntimePromptAdapter {}")).toEqual([]);
	});

	it("keeps Child Composition isolation policy out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		expect(findPackageBoundaryViolations(compositionPath, "const childComposition = {};")).toHaveLength(1);
		expect(findPackageBoundaryViolations(compositionPath, "const childCompositionOptions = {};")).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				"const { mcpSource: _mcpSource, createPluginMcpRuntime: _createPluginMcpRuntime, extensionTools: _extensionTools } = options;",
			),
		).toHaveLength(3);
		expect(findPackageBoundaryViolations(compositionPath, "const child = { enableSubagents: false };")).toHaveLength(
			1,
		);
		expect(findPackageBoundaryViolations(compositionPath, "child.backend.create(options);")).toHaveLength(1);
		expect(findPackageBoundaryViolations(compositionPath, "child.backend.resume(options);")).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentChildCompositionFactory } from "./subagent/child-composition-policy.js";',
			),
		).toEqual([]);
	});

	it("keeps Runtime Host Controls out of the Coding Agent Composition Root", () => {
		const compositionPath = "packages/coding-agent/src/composition/runtime-composition.ts";
		const embeddedControls = `
			const sessionHooks = {};
			bindExtensionRunner();
			refreshExtensionTools();
			appendSessionContext();
			deliverSessionContext();
			quiesceSessionBackgroundCommands();
			preserveSessionExecutionContext();
			clearSessionExecutionContext();
			flushMemory();
			indexes.hookSessionControllers.get(id);
			indexes.extensionEventBridges.get(id);
			indexes.resourceContexts.get(id);
			indexes.executionRuntimes.get(id);
			indexes.memoryControllers.get(id);
		`;
		expect(findPackageBoundaryViolations(compositionPath, embeddedControls)).toHaveLength(14);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentRuntimeSessionControls } from "./session-lifecycle/session-controls.js";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				compositionPath,
				'import { createCodingAgentRuntimeExtensionControls } from "./session-lifecycle/extension-controls.js";',
			),
		).toEqual([]);
	});

	it("keeps Session Host capability declarations out of Composition", () => {
		const compositionPath = "packages/coding-agent/src/composition/session-initialization/peripheral-assembly.ts";
		const hostPath = "packages/coding-agent/src/host/session-execution/execution-runtime.ts";
		const hostCapabilities = `
			export class CodingAgentSessionExecutionRuntime {}
			export interface CodingAgentSubagentWorkRuntime {}
		`;

		expect(findPackageBoundaryViolations(compositionPath, hostCapabilities)).toHaveLength(2);
		expect(findPackageBoundaryViolations(hostPath, hostCapabilities)).toEqual([]);
	});

	it("requires scoped production packages to declare workspace imports", () => {
		const source = 'import { createRuntime } from "@vetta/runtime-tools/coding";';
		const path = "packages/coding-agent/src/composition/example.ts";
		expect(
			findPackageBoundaryViolations(path, source, {
				manifest: {
					name: "@vetta/coding-agent",
					dependencies: { "@vetta/runtime-tools": "workspace:*" },
				},
			}),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(path, source, {
				manifest: { name: "@vetta/coding-agent" },
			}),
		).toHaveLength(1);
	});

	it("keeps agent-core below runtime and product packages", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/agent/src/example.ts",
				'import { TurnPipeline } from "@vetta/runtime-core/kernel";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/agent/src/example.ts",
				'import { createCodingAgent } from "@vetta/coding-agent";',
			),
		).toHaveLength(1);
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-core/src/kernel/agent-core-turn-engine.ts",
				'import { agentLoopContinue } from "@vetta/agent-core";',
			),
		).toEqual([]);
	});
});

describe("Legacy Session setup seed retirement", () => {
	it("allows only the explicit historical migration adapter", () => {
		expect(
			findLegacySetupSeedViolations([
				{
					path: "packages/coding-agent/src/sessions/legacy/migration.ts",
					text: "return migrateLegacySessionToV2(options);",
				},
			]),
		).toEqual([]);
	});

	it("rejects generated Legacy setup writers and migration detours", () => {
		expect(
			findLegacySetupSeedViolations([
				{
					path: "packages/coding-agent/src/sessions/setup/reintroduced-writer.ts",
					text: "new LegacySessionSetupWriter();",
				},
				{
					path: "packages/coding-agent/src/sessions/setup/reintroduced-migration.ts",
					text: "await migrateLegacySessionToV2(options);",
				},
			]),
		).toHaveLength(2);
	});
});

describe("workspace build order", () => {
	it("parses package build calls once in declaration order", () => {
		expect(
			parseBuildPackageOrder(`
				build_pkg packages/runtime-core
				build_pkg packages/runtime-tools
				build_pkg packages/coding-agent
				build_pkg packages/coding-agent
			`),
		).toEqual(["packages/runtime-core", "packages/runtime-tools", "packages/coding-agent"]);
	});

	it("rejects a production dependency built after its consumer", () => {
		const manifests = [
			{
				dir: "packages/runtime-core",
				name: "@vetta/runtime-core",
			},
			{
				dir: "packages/coding-agent",
				name: "@vetta/coding-agent",
				dependencies: { "@vetta/runtime-core": "workspace:*" },
			},
		];

		expect(findBuildOrderViolations(["packages/coding-agent", "packages/runtime-core"], manifests)).toEqual([
			"packages/coding-agent is built before its workspace dependency packages/runtime-core",
		]);
		expect(findBuildOrderViolations(["packages/runtime-core", "packages/coding-agent"], manifests)).toEqual([]);
	});

	it("ignores test-only dependency edges", () => {
		const manifests = [
			{
				dir: "packages/runtime-core",
				name: "@vetta/runtime-core",
				devDependencies: { "@vetta/coding-agent": "workspace:*" },
			},
			{
				dir: "packages/coding-agent",
				name: "@vetta/coding-agent",
			},
		];

		expect(findBuildOrderViolations(["packages/runtime-core", "packages/coding-agent"], manifests)).toEqual([]);
	});

	it("does not treat peer dependencies as source build edges", () => {
		const manifests = [
			{
				dir: "packages/runtime-tools",
				name: "@vetta/runtime-tools",
				peerDependencies: { "@vetta/coding-agent": "workspace:*" },
			},
			{
				dir: "packages/coding-agent",
				name: "@vetta/coding-agent",
				dependencies: { "@vetta/runtime-tools": "workspace:*" },
			},
		];

		expect(findBuildOrderViolations(["packages/runtime-tools", "packages/coding-agent"], manifests)).toEqual([]);
	});

	it("rejects parallel or reversed desktop prerequisite layers", () => {
		const packageConfigs = {
			"runtime-core": { dir: "packages/runtime-core" },
			"coding-agent": { dir: "packages/coding-agent" },
		};
		const manifests = [
			{
				dir: "packages/runtime-core",
				name: "@vetta/runtime-core",
			},
			{
				dir: "packages/coding-agent",
				name: "@vetta/coding-agent",
				dependencies: { "@vetta/runtime-core": "workspace:*" },
			},
		];

		expect(findLayeredBuildOrderViolations(packageConfigs, [["coding-agent"], ["runtime-core"]], manifests)).toEqual([
			"coding-agent is not in a later build layer than its workspace dependency runtime-core",
		]);
		expect(findLayeredBuildOrderViolations(packageConfigs, [["runtime-core"], ["coding-agent"]], manifests)).toEqual(
			[],
		);
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

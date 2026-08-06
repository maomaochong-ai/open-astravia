import { describe, expect, it } from "vitest";
import {
	findCodingAgentImplementationLogViolations,
	REWRITE_CHARTER_END,
	REWRITE_CHARTER_START,
} from "./check-coding-agent-implementation-log.mjs";
import {
	collectCodingAgentRewriteState,
	findCodingAgentRewriteProgressViolations,
	summarizeCodingAgentRewriteState,
} from "./check-coding-agent-rewrite-progress.mjs";

describe("Coding Agent rewrite progress gate", () => {
	it("collects old implementation imports across ordinary hosts and Runtime packages", () => {
		const state = stateFrom([
			{
				path: "packages/coding-agent/src/host/session-host.ts",
				text: 'import { SettingsManager } from "../core/settings-manager.js";',
			},
			{
				path: "packages/runtime-storage/src/index.ts",
				text: 'export { SessionManager } from "@vetta/coding-agent/compat/runtime-storage";',
			},
		]);

		expect(state.oldImplementationEdges).toHaveLength(2);
		expect(state.runtimeBackedges).toHaveLength(1);
		expect(summarizeCodingAgentRewriteState(state).domains).toEqual({
			compatibility: 1,
			"settings-manager": 1,
		});
	});

	it("rejects a new Runtime package backedge even when it uses a stable public subpath", () => {
		const actual = stateFrom([
			{
				path: "packages/runtime-storage/src/index.ts",
				text: 'export { SettingsManager } from "@vetta/coding-agent/host-services";',
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(actual, emptyState())).toEqual([
			"packages/runtime-storage/src/index.ts: new Runtime package backedge (@vetta/coding-agent/host-services)",
		]);
	});

	it("rejects old implementation dependencies from the stable Extension contract domain even if baselined", () => {
		const actual = stateFrom([
			{
				path: "packages/coding-agent/src/extensions/contracts.ts",
				text: 'import type { SessionManager } from "../core/session-manager/index.js";',
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(actual, actual)).toEqual([
			"packages/coding-agent/src/extensions/contracts.ts: stable Extension contract depends on old implementation (../core/session-manager/index.js)",
		]);
	});

	it("rejects old implementation dependencies from the stable Resource domain even if baselined", () => {
		const actual = stateFrom([
			{
				path: "packages/coding-agent/src/resources/skills/index.ts",
				text: 'import type { SettingsManager } from "../../core/settings-manager.js";',
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(actual, actual)).toEqual([
			"packages/coding-agent/src/resources/skills/index.ts: stable Resource domain depends on old implementation (../../core/settings-manager.js)",
		]);
	});

	it("keeps the stable Extension aggregate thin and responsibility modules bounded", () => {
		const aggregate = stateFrom([
			{
				path: "packages/coding-agent/src/extensions/contracts.ts",
				text: Array.from({ length: 51 }, () => "export {};").join("\n"),
			},
		]);
		const module = stateFrom([
			{
				path: "packages/coding-agent/src/extensions/api-contracts.ts",
				text: Array.from({ length: 301 }, () => "export {};").join("\n"),
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(aggregate, aggregate)).toEqual([
			"packages/coding-agent/src/extensions/contracts.ts: stable Extension module has 51 lines (limit 50)",
		]);
		expect(findCodingAgentRewriteProgressViolations(module, module)).toEqual([
			"packages/coding-agent/src/extensions/api-contracts.ts: stable Extension module has 301 lines (limit 300)",
		]);
	});

	it("keeps the stable Resource aggregate thin and prevents unbounded modules", () => {
		const aggregate = stateFrom([
			{
				path: "packages/coding-agent/src/resources/index.ts",
				text: Array.from({ length: 51 }, () => "export {};").join("\n"),
			},
		]);
		const module = stateFrom([
			{
				path: "packages/coding-agent/src/resources/skills/discovery.ts",
				text: Array.from({ length: 601 }, () => "export {};").join("\n"),
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(aggregate, aggregate)).toEqual([
			"packages/coding-agent/src/resources/index.ts: stable Resource module has 51 lines (limit 50)",
		]);
		expect(findCodingAgentRewriteProgressViolations(module, module)).toEqual([
			"packages/coding-agent/src/resources/skills/discovery.ts: stable Resource module has 601 lines (limit 600)",
		]);
	});

	it("rejects removed Legacy HTML export paths and implicit asset installation", () => {
		const actual = stateFrom([
			{
				path: "packages/cli-app/src/standalone.ts",
				text: [
					'import template from "../../coding-agent/src/core/export-html/template.html";',
					"installExportTemplateAssets({ template });",
				].join("\n"),
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(actual, actual)).toEqual([
			"packages/cli-app/src/standalone.ts:1: forbidden Legacy HTML export reference (core/export-html)",
			"packages/cli-app/src/standalone.ts:2: forbidden Legacy HTML export reference (installExportTemplateAssets)",
		]);
		expect(summarizeCodingAgentRewriteState(actual).legacyHtmlExportReferences).toBe(2);
	});

	it("rejects removed Legacy Memory paths and adapter implementation even if baselined", () => {
		const actual = stateFrom([
			{
				path: "packages/coding-agent/src/host/memory-host.ts",
				text: [
					'import { readMemoryContent } from "../core/memory/memory-store.js";',
					'import { Runtime } from "../adapters/runtime-core/greenfield-memory-rollover-orchestrator.js";',
				].join("\n"),
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(actual, actual)).toEqual([
			"packages/coding-agent/src/host/memory-host.ts:1: forbidden Legacy Memory reference (core/memory/)",
			"packages/coding-agent/src/host/memory-host.ts:2: forbidden Legacy Memory reference (greenfield-memory-rollover-orchestrator)",
		]);
		expect(summarizeCodingAgentRewriteState(actual).legacyMemoryReferences).toBe(2);
	});

	it("rejects retired Tool paths and description generation even if baselined", () => {
		const actual = stateFrom([
			{
				path: "packages/coding-agent/src/host/tool-host.ts",
				text: [
					'import { createReadTool } from "../core/tools/read/index.js";',
					'const generator = "generate-tool-descriptions";',
				].join("\n"),
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(actual, actual)).toEqual([
			"packages/coding-agent/src/host/tool-host.ts:1: retired Tool implementation reference (core/tools/)",
			"packages/coding-agent/src/host/tool-host.ts:2: retired Tool implementation reference (generate-tool-descriptions)",
		]);
		expect(summarizeCodingAgentRewriteState(actual).retiredToolReferences).toBe(2);
	});

	it("keeps the retired composition package and forwarding dependency edges at zero", () => {
		const actual = stateFrom([
			{
				path: "packages/runtime-composition/src/index.ts",
				text: 'export * from "@vetta/coding-agent/composition";',
			},
			{
				path: "packages/cli-app/src/greenfield-runtime-composition.ts",
				text: 'export * from "@vetta/coding-agent/composition";',
			},
			{
				path: "packages/cli-app/src/index.ts",
				text: 'export { createGreenfieldRuntimeComposition } from "@vetta/coding-agent/composition";',
			},
			{
				path: "packages/desktop-app/src/main/runtime.ts",
				text: 'import type { CodingAgentRuntimeCompositionOptions } from "@vetta/cli-app";',
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(actual, actual)).toEqual([
			"packages/runtime-composition/src/index.ts: retired runtime-composition package file must stay deleted",
			"packages/cli-app/src/greenfield-runtime-composition.ts: retired CLI composition forwarding module must stay deleted",
			"packages/cli-app/src/index.ts: CLI public API must not re-export Coding Agent composition",
			"packages/desktop-app/src/main/runtime.ts: Desktop must import Coding Agent composition contracts from their owner",
		]);
		expect(summarizeCodingAgentRewriteState(actual)).toMatchObject({
			retiredRuntimeCompositionFiles: 1,
			cliCompositionForwarders: 1,
			cliCompositionPublicEdges: 1,
			desktopCliCompositionEdges: 1,
		});
	});

	it("rejects retired runtime-composition dependency references outside source files", () => {
		const actual = collectCodingAgentRewriteState({
			productionFiles: [],
			sdkExampleFiles: [],
			codingAgentPackageJson: { exports: {} },
			governedFiles: [
				{
					path: "packages/desktop-app/package.json",
					text: '"@vetta/runtime-composition": "workspace:*"',
				},
			],
		});

		expect(findCodingAgentRewriteProgressViolations(actual, actual)).toEqual([
			"packages/desktop-app/package.json:1: retired runtime-composition reference (@vetta/runtime-composition)",
		]);
	});

	it("keeps neutral Session Hosts out of CLI and free of protocol dependencies", () => {
		const actual = stateFrom([
			{
				path: "packages/cli-app/src/agent-runtime/greenfield-agent-session-host.ts",
				text: "export class GreenfieldAgentSessionHost {}",
			},
			{
				path: "packages/coding-agent/src/composition/session-host/process-session-host.ts",
				text: 'import type { RpcSessionCapabilities } from "@vetta/cli-app";',
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(actual, actual)).toEqual([
			"packages/cli-app/src/agent-runtime/greenfield-agent-session-host.ts: retired CLI Session Host file must stay deleted",
			"packages/cli-app/src/agent-runtime/greenfield-agent-session-host.ts:1: retired CLI Session Host reference (GreenfieldAgentSessionHost)",
			"packages/coding-agent/src/composition/session-host/process-session-host.ts:1: Coding Agent Session Host depends on CLI protocol (@vetta/cli-app)",
			"packages/coding-agent/src/composition/session-host/process-session-host.ts:1: Coding Agent Session Host depends on CLI protocol (RpcSessionCapabilities)",
		]);
		expect(summarizeCodingAgentRewriteState(actual)).toMatchObject({
			retiredCliSessionHostFiles: 1,
			retiredCliSessionHostReferences: 1,
			codingAgentSessionHostProtocolReferences: 2,
		});
	});

	it("keeps the CLI Runtime Host split into orchestration, assembly and protocol capabilities", () => {
		const actual = stateFrom([
			{
				path: "packages/cli-app/src/rpc/greenfield-im-runtime-host.ts",
				text: "export type GreenfieldImRuntimeHostReady = {};",
			},
			{
				path: "packages/cli-app/src/rpc/runtime-host/greenfield-runtime-host.ts",
				text: "const sessionHost = new CodingAgentProcessSessionHost({});",
			},
			{
				path: "packages/cli-app/src/rpc/runtime-host/greenfield-cli-session-assembly.ts",
				text: "const capabilities: RpcSessionCapabilities = session;",
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(actual, actual)).toEqual([
			"packages/cli-app/src/rpc/greenfield-im-runtime-host.ts: retired CLI Runtime Host file must stay deleted",
			"packages/cli-app/src/rpc/greenfield-im-runtime-host.ts:1: retired CLI Runtime Host reference (GreenfieldImRuntimeHostReady)",
			"packages/cli-app/src/rpc/runtime-host/greenfield-runtime-host.ts:1: CLI Runtime Host entry owns extracted runtime resources (new CodingAgentProcessSessionHost)",
			"packages/cli-app/src/rpc/runtime-host/greenfield-cli-session-assembly.ts:1: CLI Session assembly depends on protocol capabilities (RpcSessionCapabilities)",
		]);
		expect(summarizeCodingAgentRewriteState(actual)).toMatchObject({
			retiredCliRuntimeHostFiles: 1,
			retiredCliRuntimeHostReferences: 1,
			runtimeHostEntryOwnershipReferences: 1,
			cliSessionAssemblyProtocolReferences: 1,
		});
	});

	it("freezes the Composition public surface and rejects external deep imports", () => {
		const actual = stateFrom([
			{
				path: "packages/coding-agent/src/composition/index.ts",
				text: 'export { createCodingToolsRuntimeComposition } from "./runtime-tools-composition.js";',
			},
			{
				path: "packages/cli-app/src/runtime.ts",
				text: 'import { internalFactory } from "@vetta/coding-agent/composition/private";',
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(actual, actual)).toEqual([
			"packages/coding-agent/src/composition/index.ts: unapproved Composition public export (createCodingToolsRuntimeComposition)",
			"packages/cli-app/src/runtime.ts:1: external consumer deep-imports Coding Agent Composition (@vetta/coding-agent/composition/)",
		]);
		expect(summarizeCodingAgentRewriteState(actual)).toMatchObject({
			compositionPublicExports: 1,
			externalCompositionDeepImports: 1,
		});
	});

	it("governs the consumer-visible name of aliased Composition exports", () => {
		const actual = stateFrom([
			{
				path: "packages/coding-agent/src/composition/index.ts",
				text: 'export { GreenfieldRuntimeComposition as CodingAgentRuntimeComposition } from "./runtime.js";',
			},
		]);

		expect(actual.compositionPublicExports).toEqual(["CodingAgentRuntimeComposition"]);
		expect(findCodingAgentRewriteProgressViolations(actual, actual)).toEqual([]);
	});

	it("keeps the package root limited to the stable Extension facade", () => {
		const stable = stateFrom([
			{
				path: "packages/coding-agent/src/index.ts",
				text: 'export * from "./public-api/extensions.js";',
			},
		]);
		const expanded = stateFrom([
			{
				path: "packages/coding-agent/src/index.ts",
				text: [
					'export * from "./public-api/extensions.js";',
					'export { runRpcModeWithCapabilities } from "./modes/index.js";',
				].join("\n"),
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(stable, stable)).toEqual([]);
		expect(findCodingAgentRewriteProgressViolations(expanded, expanded)).toContain(
			"packages/coding-agent/src/index.ts: package root may only export the stable Extension facade (./modes/index.js)",
		);
		expect(summarizeCodingAgentRewriteState(expanded)).toMatchObject({
			codingAgentRootExportEdges: 2,
			codingAgentRootDisallowedExportEdges: 1,
		});
	});

	it("rejects new edges, accepts an exact baseline and reports stale entries after removal", () => {
		const baseline = stateFrom([
			{
				path: "packages/coding-agent/src/host/session-host.ts",
				text: 'import { SettingsManager } from "../core/settings-manager.js";',
			},
		]);
		const newEdge = stateFrom([
			...sourceFiles(baseline),
			{
				path: "packages/coding-agent/src/host/tool-host.ts",
				text: 'import { KeybindingsManager } from "../core/keybindings.js";',
			},
		]);

		expect(findCodingAgentRewriteProgressViolations(baseline, baseline)).toEqual([]);
		expect(findCodingAgentRewriteProgressViolations(newEdge, baseline)).toEqual([
			"packages/coding-agent/src/host/tool-host.ts: new old implementation dependency (../core/keybindings.js)",
		]);
		expect(findCodingAgentRewriteProgressViolations(emptyState(), baseline)).toContain(
			"packages/coding-agent/src/host/session-host.ts: stale old implementation dependency baseline (../core/settings-manager.js)",
		);
	});

	it("tracks old files, retired exports and legacy SDK examples independently", () => {
		const state = collectCodingAgentRewriteState({
			productionFiles: [
				{ path: "packages/coding-agent/src/core/agent-session.ts", text: "export class AgentSession {}" },
			],
			sdkExampleFiles: [
				{
					path: "packages/coding-agent/examples/sdk/12-full-control.ts",
					text: 'import { createAgentSession } from "@vetta/coding-agent";',
				},
			],
			codingAgentPackageJson: {
				exports: {
					"./compat/runtime-tools": "./dist/compat.js",
					"./core/private.js": "./dist/core/private.js",
					"./runtime-host": "./dist/adapters/runtime-core/index.js",
				},
			},
		});

		expect(state.oldImplementationFiles).toEqual(["packages/coding-agent/src/core/agent-session.ts"]);
		expect(state.compatibilityExports).toEqual(["./compat/runtime-tools"]);
		expect(state.legacyCoreExports).toEqual(["./core/private.js"]);
		expect(state.runtimeHostExports).toEqual(["./runtime-host"]);
		expect(state.legacyExampleImports).toHaveLength(1);
	});
});

describe("Coding Agent implementation record gate", () => {
	const fixedBlock = `${REWRITE_CHARTER_START}\n## 重写目标确认（固定）\n目标。\n${REWRITE_CHARTER_END}`;
	const validBody = `${fixedBlock}\n\n## 本阶段与最终目标的关系\n关系。\n\n## 旧实现依赖变化\n无。\n\n## 行为兼容性验证\n通过。\n\n## 尚未完成的替换\n仍有。`;

	it("accepts the exact fixed block and all required headings", () => {
		expect(
			findCodingAgentImplementationLogViolations({
				charterText: fixedBlock,
				logs: [{ path: "docs/225-valid.md", text: validBody }],
			}),
		).toEqual([]);
	});

	it("rejects a changed charter and missing stage evidence", () => {
		const violations = findCodingAgentImplementationLogViolations({
			charterText: fixedBlock,
			logs: [{ path: "docs/225-invalid.md", text: `${REWRITE_CHARTER_START}\n改变。\n${REWRITE_CHARTER_END}` }],
		});

		expect(violations).toHaveLength(5);
		expect(violations[0]).toContain("fixed rewrite charter block differs");
	});
});

function stateFrom(productionFiles) {
	return collectCodingAgentRewriteState({
		productionFiles: productionFiles.some((file) => file.path === "packages/coding-agent/src/index.ts")
			? productionFiles
			: [
					...productionFiles,
					{
						path: "packages/coding-agent/src/index.ts",
						text: 'export * from "./public-api/extensions.js";',
					},
				],
		sdkExampleFiles: [],
		codingAgentPackageJson: { exports: {} },
	});
}

function emptyState() {
	return stateFrom([]);
}

function sourceFiles(state) {
	return state.oldImplementationEdges.map((edge) => ({
		path: edge.path,
		text: `import { ${edge.names.join(", ")} } from "${edge.specifier}";`,
	}));
}

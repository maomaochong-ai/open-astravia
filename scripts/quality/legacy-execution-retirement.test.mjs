import { describe, expect, it } from "vitest";
import {
	collectExternalConcreteRuntimeAdapterImports,
	collectExternalRuntimeHostEdges,
	collectGreenfieldProductCoreEdges,
	collectGreenfieldSharedCoreImports,
	collectLegacySessionDataMutations,
	findCanonicalExecutableOwnershipViolations,
	findGreenfieldProductCoreBoundaryViolations,
	findGreenfieldSdkBoundaryViolations,
	findLegacyExecutionRetirementViolations,
	findLegacyFormatBoundaryClassificationViolations,
	findLegacySessionCompatibilityShimViolations,
	findRetiredLegacySessionTestImportViolations,
	findRetiredRuntimeSelectionViolations,
	findRuntimePublicBoundaryViolations,
	GREENFIELD_PRODUCT_CORE_EDGE_BUDGET,
	LEGACY_EXECUTION_EDGE_BASELINE,
	LEGACY_FORMAT_BOUNDARY_GROUPS,
	LEGACY_PACKAGE_EXPORT_BASELINE,
	LEGACY_SESSION_DATA_MUTATION_BASELINE,
	RETIRED_LEGACY_EXECUTION_FILES,
	RETIRED_LEGACY_SESSION_PREFIXES,
	RETIRED_LEGACY_SESSION_SUPPORT_FILES,
	RETIRED_RUNTIME_SELECTION_FILES,
	RETIRED_RUNTIME_SELECTION_MARKERS,
	summarizeGreenfieldProductCoreEdges,
} from "./check-legacy-execution-retirement.mjs";
import { findStandaloneCliBuildViolations } from "./check-standalone-cli-build.mjs";

describe("Legacy execution retirement gate", () => {
	it("rejects a new production Legacy execution consumer", () => {
		const violations = findLegacyExecutionRetirementViolations([
			{
				path: "packages/desktop-app/src/main/new-runtime.ts",
				text: 'import { LegacyCodingAgentSessionBackend } from "@vetta/coding-agent/runtime-host";',
			},
		]);

		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("outside the retirement baseline");
	});

	it("keeps host production activation outside the remaining implementation baseline", () => {
		expect(
			LEGACY_EXECUTION_EDGE_BASELINE.some(
				(edge) => edge.path.startsWith("packages/cli-app/") || edge.path.startsWith("packages/desktop-app/"),
			),
		).toBe(false);
		expect(LEGACY_EXECUTION_EDGE_BASELINE).toHaveLength(0);
		expect(LEGACY_EXECUTION_EDGE_BASELINE.some((edge) => edge.kind === "legacy-cli-public")).toBe(false);
		expect(LEGACY_PACKAGE_EXPORT_BASELINE).toEqual([]);
		expect(RETIRED_LEGACY_EXECUTION_FILES).toContain("packages/coding-agent/src/main.ts");
		expect(RETIRED_LEGACY_EXECUTION_FILES).toContain("packages/coding-agent/src/core/agent-session.ts");
		expect(RETIRED_LEGACY_SESSION_SUPPORT_FILES).toContain(
			"packages/coding-agent/src/core/session/system-prompt-builder.ts",
		);
		expect(RETIRED_LEGACY_SESSION_PREFIXES).toContain("packages/coding-agent/src/core/session-manager/");
		expect(RETIRED_RUNTIME_SELECTION_FILES).toContain(
			"packages/desktop-app/src/main/greenfield-runtime/desktop-runtime-selector.ts",
		);
		expect(RETIRED_RUNTIME_SELECTION_MARKERS).toContain("--agent-runtime");
	});

	it("rejects retired Runtime selection control-plane markers", () => {
		expect(
			findRetiredRuntimeSelectionViolations([
				{
					path: "packages/cli-app/src/example.ts",
					text: 'const args = ["--agent-runtime", "legacy"];',
				},
				{
					path: "packages/im-gateway/internal/example.go",
					text: 'const runtimeDecision = "greenfield"',
				},
			]),
		).toHaveLength(2);
		expect(
			findRetiredRuntimeSelectionViolations([{ path: "host.ts", text: "const runtime = createRuntime();" }]),
		).toEqual([]);
	});

	it("rejects tests coupled to the retired Legacy Session implementation", () => {
		expect(
			findRetiredLegacySessionTestImportViolations([
				{
					path: "packages/coding-agent/test/example.test.ts",
					text: 'import { SessionManager } from "../src/core/session-manager/index.js";',
				},
			]),
		).toEqual(["packages/coding-agent/test/example.test.ts: test imports a retired Legacy Session implementation"]);
	});

	it("keeps the remaining old Tool type shims free of Session runtime behavior", () => {
		expect(
			findLegacySessionCompatibilityShimViolations([
				{
					path: "packages/coding-agent/src/core/todo-store.ts",
					text: "export class TodoStore {}",
				},
				{
					path: "packages/coding-agent/src/core/session/tool-scope.ts",
					text: "export function resolveActiveToolNames() {}",
				},
			]),
		).toHaveLength(2);
	});

	it("requires cli-app to own the canonical Agent executable", () => {
		expect(
			findCanonicalExecutableOwnershipViolations({
				cliAppBin: { "vetta-agent": "dist/agent-cli.js" },
			}),
		).toEqual([]);
		expect(
			findCanonicalExecutableOwnershipViolations({
				cliAppBin: { "vetta-agent": "dist/legacy.js" },
				codingAgentBin: { "vetta-agent": "dist/cli.js" },
			}),
		).toHaveLength(2);
	});

	it("requires standalone Agent binaries to use the canonical compiler", () => {
		expect(
			findStandaloneCliBuildViolations(
				"scripts/example.mjs",
				'Bun.spawn(["bun", "build", "packages/cli-app/src/agent-cli.ts", "--compile"]);',
			),
		).toHaveLength(1);
		expect(
			findStandaloneCliBuildViolations(
				"scripts/example.mjs",
				'Bun.spawn(["bun", "packages/cli-app/scripts/compile-standalone.mjs", "--entry", "agent"]);',
			),
		).toEqual([]);
	});

	it("keeps external hosts on the stable Runtime public boundary", () => {
		const oldHostImport = {
			path: "packages/cli-app/src/example.ts",
			text: 'import { createHost } from "@vetta/coding-agent/runtime-host/greenfield";',
		};
		const concreteAdapterImport = {
			path: "packages/desktop-app/src/main/example.ts",
			text: 'import { CodingAgentGreenfieldTurnExecutor } from "@vetta/coding-agent/composition";',
		};
		const stableRuntimeImport = {
			path: "packages/cli-app/src/stable.ts",
			text: 'import { createCodingAgentTurnExecutor } from "@vetta/coding-agent/runtime";',
		};

		expect(collectExternalRuntimeHostEdges([oldHostImport])).toHaveLength(1);
		expect(collectExternalConcreteRuntimeAdapterImports([concreteAdapterImport])).toHaveLength(1);
		expect(findRuntimePublicBoundaryViolations([oldHostImport, concreteAdapterImport])).toHaveLength(2);
		expect(findRuntimePublicBoundaryViolations([stableRuntimeImport])).toEqual([]);
	});

	it("keeps retained Legacy format readers independent from execution", () => {
		const violations = findLegacyExecutionRetirementViolations([
			{
				path: "packages/coding-agent/src/sessions/legacy/catalog.ts",
				text: 'import { createAgentSession } from "../../../core/sdk.js";',
			},
		]);

		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("format boundary must not depend on Legacy execution");
	});

	it("classifies every historical format boundary and freezes data mutations", () => {
		expect(LEGACY_FORMAT_BOUNDARY_GROUPS).toMatchObject({
			readers: expect.any(Array),
			migrations: expect.any(Array),
			hostAdapters: expect.any(Array),
			moduleEntries: expect.any(Array),
			publicEntries: expect.any(Array),
		});
		expect(
			findLegacyFormatBoundaryClassificationViolations([
				{ path: "packages/coding-agent/src/sessions/legacy/unclassified.ts", text: "export {};" },
			]),
		).toEqual([
			"packages/coding-agent/src/sessions/legacy/unclassified.ts: Legacy format boundary has no compatibility classification",
		]);
		expect(
			collectLegacySessionDataMutations([
				{
					path: "packages/coding-agent/src/sessions/legacy/catalog.ts",
					text: "appendFile(path, value); rm(path); rm(lockPath);",
				},
			]),
		).toEqual(LEGACY_SESSION_DATA_MUTATION_BASELINE);
	});

	it("reports Greenfield imports of shared core capabilities separately", () => {
		const imports = collectGreenfieldSharedCoreImports([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-example.ts",
				text: 'import { createReadTool } from "../../core/tools/read/index.js";',
			},
			{
				path: "packages/coding-agent/src/adapters/runtime-core/legacy-example.ts",
				text: 'import { AgentSession } from "../../core/agent-session.js";',
			},
		]);

		expect(imports).toEqual([
			"packages/coding-agent/src/adapters/runtime-core/greenfield-example.ts -> ../../core/tools/read/index.js",
		]);
	});

	it("classifies product Adapter, Composition wiring and RPC Host Adapter edges", () => {
		const edges = collectGreenfieldProductCoreEdges([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-example.ts",
				text: 'import { createReadTool } from "../../core/tools/read/index.js";',
			},
			{
				path: "packages/coding-agent/src/composition/greenfield-example.ts",
				text: 'import { knowledgeRoot } from "../core/knowledge/store.js";',
			},
			{
				path: "packages/coding-agent/src/modes/rpc/greenfield-example.ts",
				text: 'import { convertToLlm } from "../../core/messages.js";',
			},
		]);

		expect(summarizeGreenfieldProductCoreEdges(edges)).toEqual({
			"product-adapter": 1,
			"composition-wiring": 1,
			"rpc-host-adapter": 1,
			"sdk-compatibility": 0,
			unclassified: 0,
		});
		expect(GREENFIELD_PRODUCT_CORE_EDGE_BUDGET).toEqual({
			"product-adapter": 12,
			"composition-wiring": 0,
			"rpc-host-adapter": 2,
			"sdk-compatibility": 0,
		});
	});

	it("rejects AgentSession execution imports and concrete Core types in Composition contracts", () => {
		const violations = findGreenfieldProductCoreBoundaryViolations([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-session.ts",
				text: 'import { AgentSession } from "../../core/agent-session.js";',
			},
			{
				path: "packages/coding-agent/src/composition/greenfield-example-contract.ts",
				text: 'import type { ExtensionRunner } from "../core/extensions/runner.js";',
			},
		]);

		expect(violations).toHaveLength(3);
		expect(violations).toEqual(
			expect.arrayContaining([
				expect.stringContaining("must not depend on retired AgentSession execution"),
				expect.stringContaining("Composition contract leaks a concrete product Core type"),
				expect.stringContaining("composition-wiring product Core dependency budget increased"),
			]),
		);
	});

	it("keeps the public SDK facade independent from migration names and retired execution", () => {
		expect(
			findGreenfieldSdkBoundaryViolations([
				{
					path: "packages/coding-agent/src/public-api/sdk/greenfield-sdk-session.ts",
					text: 'import { AgentSession } from "../../core/agent-session.js";',
				},
			]),
		).toEqual([
			"packages/coding-agent/src/public-api/sdk/greenfield-sdk-session.ts: public Coding Agent SDK contract must not depend on internal product source (../../core/agent-session.js)",
			"packages/coding-agent/src/public-api/sdk/greenfield-sdk-session.ts: public Coding Agent SDK must not depend on retired AgentSession execution (../../core/agent-session.js)",
		]);
		expect(
			findGreenfieldSdkBoundaryViolations([
				{
					path: "packages/coding-agent/src/public-api/sdk.ts",
					text: "export type CodingAgentSession = GreenfieldSdkSession;",
				},
			]),
		).toEqual([
			"packages/coding-agent/src/public-api/sdk.ts: public Coding Agent SDK leaks forbidden name (GreenfieldSdkSession)",
		]);
	});
});

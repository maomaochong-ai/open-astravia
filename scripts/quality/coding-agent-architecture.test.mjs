import { describe, expect, it } from "vitest";
import {
	collectCodingAgentArchitectureState,
	findCodingAgentArchitectureViolations,
} from "./check-coding-agent-architecture.mjs";

const SOURCE_ROOT = "packages/coding-agent/src";

function createState(extraFiles = [], overrides = {}) {
	return collectCodingAgentArchitectureState({
		files: [
			{
				path: `${SOURCE_ROOT}/index.ts`,
				text: 'export * from "./public-api/extensions.js";',
			},
			{
				path: `${SOURCE_ROOT}/composition/index.ts`,
				text: 'export type { CodingAgentRuntimeComposition } from "./contracts/index.js";',
			},
			...extraFiles,
		],
		packageJson: {
			exports: { ".": "./dist/index.js", "./composition": "./dist/composition/index.js" },
			...overrides,
		},
	});
}

describe("Coding Agent architecture gate", () => {
	it("accepts the current dependency direction and declared public surface", () => {
		const state = createState([
			{
				path: `${SOURCE_ROOT}/composition/contracts/sample.ts`,
				text: 'import type { RuntimeSession } from "@vetta/runtime-core";',
			},
			{
				path: `${SOURCE_ROOT}/memory/runtime.ts`,
				text: 'import type { CodingAgentRuntimeModelSource } from "../runtime-contracts/index.js";',
			},
			{
				path: `${SOURCE_ROOT}/composition/runtime.ts`,
				text: 'import { createAdapter } from "../adapters/runtime-core/adapter.js";',
			},
			{
				path: `${SOURCE_ROOT}/adapters/runtime-core/adapter.ts`,
				text: 'import type { RuntimeOptions } from "../../composition/contracts/index.js";',
			},
			{
				path: "packages/cli-app/src/runtime.ts",
				text: 'import { createCodingAgentRuntimeComposition } from "@vetta/coding-agent/composition";',
			},
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual([]);
	});

	it.each([
		[
			"contract to implementation",
			`${SOURCE_ROOT}/composition/contracts/sample.ts`,
			'import type { Value } from "../../adapters/runtime-core/adapter.js";',
			"contract depends on implementation",
		],
		[
			"domain to composition",
			`${SOURCE_ROOT}/memory/runtime.ts`,
			'import { createRuntime } from "../composition/runtime-composition.js";',
			"product domain depends on orchestration or implementation",
		],
		[
			"adapter to Composition implementation",
			`${SOURCE_ROOT}/adapters/runtime-core/adapter.ts`,
			'import { createRuntime } from "../../composition/runtime-composition.js";',
			"Adapter depends on Composition or a public facade",
		],
		[
			"historical format to host execution",
			`${SOURCE_ROOT}/sessions/legacy/reader.ts`,
			'import { execute } from "../../host/session-execution/executor.js";',
			"historical format boundary depends on Agent execution",
		],
		[
			"consumer deep import",
			"packages/cli-app/src/runtime.ts",
			'import { value } from "@vetta/coding-agent/src/private.js";',
			"consumer uses a non-public Coding Agent subpath",
		],
	])("rejects %s", (_name, path, text, expected) => {
		const violations = findCodingAgentArchitectureViolations(createState([{ path, text }]));

		expect(violations.some((violation) => violation.includes(expected))).toBe(true);
	});

	it("rejects retired implementation directories while allowing format-owned storage modules", () => {
		const state = createState([
			{ path: `${SOURCE_ROOT}/core/agent.ts`, text: "export const value = 1;" },
			{
				path: `${SOURCE_ROOT}/sessions/legacy/storage/atomic-writer.ts`,
				text: 'import { writeFile } from "node:fs/promises";',
			},
		]);
		const violations = findCodingAgentArchitectureViolations(state);

		expect(violations.some((violation) => violation.includes("retired implementation directory"))).toBe(true);
		expect(violations.some((violation) => violation.includes("historical file mutation"))).toBe(false);
	});

	it("keeps historical conversion in its explicit format adapter", () => {
		const allowed = createState([
			{
				path: `${SOURCE_ROOT}/sessions/legacy/converters/v2.ts`,
				text: 'import { migrateLegacySessionToV2 } from "@vetta/runtime-storage/conversation";',
			},
		]);
		const rejected = createState([
			{
				path: `${SOURCE_ROOT}/sessions/setup/migration.ts`,
				text: 'import { migrateLegacySessionToV2 } from "@vetta/runtime-storage/conversation";',
			},
		]);

		expect(findCodingAgentArchitectureViolations(allowed)).toEqual([]);
		expect(
			findCodingAgentArchitectureViolations(rejected).some((violation) =>
				violation.includes("historical conversion is outside its owner"),
			),
		).toBe(true);
	});

	it("allows manifest-declared package and root-level Composition extensions", () => {
		const state = createState(
			[
				{
					path: `${SOURCE_ROOT}/composition/index.ts`,
					text: 'export { createNewCapability } from "./new-capability.js";',
				},
				{
					path: "packages/cli-app/src/new-capability.ts",
					text: 'import { createNewCapability } from "@vetta/coding-agent/new-capability";',
				},
			],
			{ exports: { ".": "./dist/index.js", "./new-capability": "./dist/new-capability.js" } },
		);

		expect(findCodingAgentArchitectureViolations(state)).toEqual([]);
	});

	it("rejects Composition exports from internal implementation areas", () => {
		const state = createState([
			{
				path: `${SOURCE_ROOT}/composition/index.ts`,
				text: 'export { createInternalToolSurface } from "./tool-surface/runtime-tool-surface.js";',
			},
		]);

		expect(findCodingAgentArchitectureViolations(state)).toContain(
			`${SOURCE_ROOT}/composition/index.ts:1: Composition public entry exports an internal implementation (./tool-surface/runtime-tool-surface.js)`,
		);
	});

	it("supports manifest wildcard exports without allowing unrelated deep imports", () => {
		const state = createState(
			[
				{
					path: "packages/cli-app/src/plugins.ts",
					text: [
						'import { official } from "@vetta/coding-agent/plugins/official";',
						'import { privateValue } from "@vetta/coding-agent/private/value";',
					].join("\n"),
				},
			],
			{ exports: { ".": "./dist/index.js", "./plugins/*": "./dist/plugins/*.js" } },
		);
		const violations = findCodingAgentArchitectureViolations(state);

		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("@vetta/coding-agent/private/value");
	});

	it("uses syntax edges instead of matching imports in comments", () => {
		const state = createState([
			{
				path: `${SOURCE_ROOT}/memory/runtime.ts`,
				text: '// import { createRuntime } from "../composition/runtime-composition.js";',
			},
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual([]);
	});
});

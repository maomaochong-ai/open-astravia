import { describe, expect, it } from "vitest";
import {
	collectCodingAgentArchitectureState,
	findCodingAgentArchitectureViolations,
} from "./check-coding-agent-architecture.mjs";

const SOURCE_ROOT = "packages/coding-agent/src";

function createState(extraFiles = [], overrides = {}) {
	return collectCodingAgentArchitectureState({
		files: [
			{ path: `${SOURCE_ROOT}/index.ts`, text: 'export * from "./public-api/extensions.js";' },
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

describe("Coding Agent durable architecture rules", () => {
	it("accepts the current dependency direction and declared public surface", () => {
		const state = createState([
			{
				path: `${SOURCE_ROOT}/composition/contracts/sample.ts`,
				text: 'import type { RuntimeSession } from "@astravia/runtime-core";',
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
				path: "apps/cli-host/src/runtime.ts",
				text: 'import { createCodingAgentRuntimeComposition } from "@astravia/coding-agent/composition";',
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
			"Coding Agent domain depends on orchestration or implementation",
		],
		[
			"adapter to composition implementation",
			`${SOURCE_ROOT}/adapters/runtime-core/adapter.ts`,
			'import { createRuntime } from "../../composition/runtime-composition.js";',
			"Adapter depends on Composition or a public facade",
		],
		[
			"historical format to execution",
			`${SOURCE_ROOT}/sessions/legacy/reader.ts`,
			'import { execute } from "../../execution/turn/turn-executor.js";',
			"historical format boundary depends on Agent execution",
		],
	])("rejects %s", (_name, path, text, expected) => {
		const violations = findCodingAgentArchitectureViolations(createState([{ path, text }]));
		expect(violations.some((violation) => violation.includes(expected))).toBe(true);
	});

	it("keeps platform implementations out of adapters and historical format modules", () => {
		const state = createState([
			{
				path: `${SOURCE_ROOT}/adapters/runtime-core/adapter.ts`,
				text: 'import { readFile } from "node:fs/promises";',
			},
			{
				path: `${SOURCE_ROOT}/sessions/legacy/reader.ts`,
				text: 'import { readLegacy } from "@astravia/runtime-node/sessions";',
			},
		]);
		const violations = findCodingAgentArchitectureViolations(state);
		expect(violations).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Adapter must consume platform-neutral facts"),
				expect.stringContaining("historical format policy must consume host-provided file operations"),
			]),
		);
	});

	it("keeps the package root and composition entry as narrow facades", () => {
		const state = createState([
			{ path: `${SOURCE_ROOT}/index.ts`, text: 'export * from "./composition/index.js";' },
			{
				path: `${SOURCE_ROOT}/composition/index.ts`,
				text: 'export { createRuntime } from "./internal/runtime.js";',
			},
		]);
		const violations = findCodingAgentArchitectureViolations(state);
		expect(violations).toEqual(
			expect.arrayContaining([
				expect.stringContaining("package root may only export the Extension facade"),
				expect.stringContaining("Composition public entry exports an internal implementation"),
			]),
		);
	});

	it("allows only manifest-declared external subpaths, including wildcards", () => {
		const state = createState(
			[
				{
					path: "apps/cli-host/src/public.ts",
					text: 'import { value } from "@astravia/coding-agent/public/foo";',
				},
				{
					path: "apps/cli-host/src/private.ts",
					text: 'import { value } from "@astravia/coding-agent/src/private";',
				},
			],
			{
				exports: {
					".": "./dist/index.js",
					"./composition": "./dist/composition/index.js",
					"./public/*": "./dist/public/*.js",
				},
			},
		);
		const violations = findCodingAgentArchitectureViolations(state);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("non-public Coding Agent subpath");
	});

	it("uses syntax edges instead of matching import-like comments", () => {
		const state = createState([
			{
				path: `${SOURCE_ROOT}/memory/runtime.ts`,
				text: '// import { createRuntime } from "../composition/runtime-composition.js";',
			},
		]);
		expect(findCodingAgentArchitectureViolations(state)).toEqual([]);
	});
});

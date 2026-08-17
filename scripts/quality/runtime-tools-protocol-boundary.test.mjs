import { describe, expect, it } from "vitest";
import { findPackageBoundaryViolations } from "./check-package-boundaries.mjs";

describe("runtime-tools protocol boundary", () => {
	it("rejects Node environment imports", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-tools/src/coding/file-tool.ts",
				'import { readFile } from "node:fs/promises";',
			),
		).toContainEqual(expect.stringContaining("runtime-tools protocol must not import platform implementation"));
	});

	it("rejects platform runtime imports", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-tools/src/coding/default-tool.ts",
				'import { createReadTool } from "@vetta/runtime-node/coding";',
			),
		).toContainEqual(expect.stringContaining("runtime-tools protocol must not import platform implementation"));
	});

	it("allows platform-neutral kernel contracts", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-tools/src/coding/tool-registration.ts",
				'import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";',
			),
		).toEqual([]);
	});
});

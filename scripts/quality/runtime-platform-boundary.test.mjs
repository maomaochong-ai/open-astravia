import { describe, expect, it } from "vitest";
import { findPackageBoundaryViolations } from "./check-package-boundaries.mjs";

describe("platform Runtime package boundary", () => {
	it("rejects Node imports and globals in runtime-core", () => {
		const importFindings = findPackageBoundaryViolations(
			"packages/runtime-core/src/runtime-host/file-store.ts",
			'import { readFile } from "node:fs/promises";',
		);
		const globalFindings = findPackageBoundaryViolations(
			"packages/runtime-core/src/kernel/bytes.ts",
			'export const size = Buffer.byteLength("value");',
		);

		expect(importFindings).toContainEqual(expect.stringContaining("runtime-core must use host ports"));
		expect(globalFindings).toContainEqual(expect.stringContaining("runtime-core must not depend on platform global"));
	});

	it("allows runtime-core to use platform-neutral Web APIs", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-core/src/id-generator.ts",
				"export const id = globalThis.crypto.randomUUID();",
			),
		).toEqual([]);
	});

	it("allows runtime-desktop to consume stable product and protocol packages", () => {
		const findings = findPackageBoundaryViolations(
			"packages/runtime-desktop/src/composition.ts",
			[
				'import { createCodingAgentRuntimeComposition } from "@vetta/coding-agent/composition";',
				'import { RuntimeHost } from "@vetta/runtime-core";',
			].join("\n"),
		);

		expect(findings).toEqual([]);
	});

	it("rejects a runtime-desktop back edge into desktop-app", () => {
		const findings = findPackageBoundaryViolations(
			"packages/runtime-desktop/src/composition.ts",
			'import { getDesktopConfig } from "@vetta/desktop-app/config";',
		);

		expect(findings).toContain(
			"packages/runtime-desktop/src/composition.ts: libs/plugins must not import app package (@vetta/desktop-app)",
		);
	});
});

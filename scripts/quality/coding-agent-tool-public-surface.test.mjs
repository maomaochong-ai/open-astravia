import { describe, expect, it } from "vitest";
import { findPackageBoundaryViolations } from "./check-package-boundaries.mjs";

describe("coding-agent Tool public surface boundary", () => {
	it("rejects concrete Tool forwarding from the package root", () => {
		const findings = findPackageBoundaryViolations(
			"packages/coding-agent/src/index.ts",
			'export { createReadTool, readTool } from "@vetta/runtime-tools/coding";',
		);

		expect(findings).toEqual(
			expect.arrayContaining([
				expect.stringContaining("must not forward concrete Tool implementations"),
				expect.stringContaining("must not export concrete Tool symbol createReadTool"),
				expect.stringContaining("must not export concrete Tool symbol readTool"),
			]),
		);
	});

	it("rejects the retired RPC attachment Tool export", () => {
		const findings = findPackageBoundaryViolations(
			"packages/coding-agent/src/public-api/rpc.ts",
			'export { createImSendAttachmentTool } from "../core/tools/im-send-attachment/index.js";',
		);

		expect(findings.length).toBeGreaterThan(0);
	});

	it("allows orchestration factories and neutral RPC contracts", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/index.ts",
				'export { createAgentSession } from "./core/sdk.js";',
			),
		).toEqual([]);
		expect(
			findPackageBoundaryViolations(
				"packages/coding-agent/src/public-api/rpc.ts",
				'export type { ImHostBridge } from "../modes/index.js";',
			),
		).toEqual([]);
	});
});

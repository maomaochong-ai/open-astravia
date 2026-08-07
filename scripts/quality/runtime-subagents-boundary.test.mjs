import { describe, expect, it } from "vitest";
import { findRuntimeSubagentsBoundaryViolations } from "./check-runtime-subagents-boundary.mjs";

describe("Runtime Subagents boundary guard", () => {
	it("accepts a dependency-free scheduling kernel", () => {
		expect(
			findRuntimeSubagentsBoundaryViolations({
				manifest: {
					path: "packages/runtime-subagents/package.json",
					content: { devDependencies: { typescript: "^5.9.2" } },
				},
				files: [
					{
						path: "packages/runtime-subagents/src/coordinator.ts",
						text: 'import type { SubagentSnapshot } from "./contracts.js";',
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects workspace backedges and tool-facing protocol", () => {
		expect(
			findRuntimeSubagentsBoundaryViolations({
				manifest: {
					path: "packages/runtime-subagents/package.json",
					content: { dependencies: { "@vetta/runtime-tools": "workspace:*" } },
				},
				files: [
					{
						path: "packages/runtime-subagents/src/notifications.ts",
						text: "export const hint = 'use followup_task';",
					},
				],
			}),
		).toEqual([
			"packages/runtime-subagents/package.json: dependencies must not declare workspace dependency @vetta/runtime-tools",
			"packages/runtime-subagents/src/notifications.ts:1: forbidden subagent kernel token followup_task",
		]);
	});
});

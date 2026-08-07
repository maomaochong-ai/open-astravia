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
					...ownerFiles(),
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
					...ownerFiles(),
				],
			}),
		).toEqual([
			"packages/runtime-subagents/package.json: dependencies must not declare workspace dependency @vetta/runtime-tools",
			"packages/runtime-subagents/src/notifications.ts:1: forbidden subagent kernel token followup_task",
		]);
	});

	it("rejects coordinator state ownership and retired owner files", () => {
		expect(
			findRuntimeSubagentsBoundaryViolations({
				manifest: { path: "packages/runtime-subagents/package.json", content: {} },
				files: [
					{
						path: "packages/runtime-subagents/src/coordinator.ts",
						text: 'snapshot.status = "completed";',
					},
					...ownerFiles(),
					{ path: "packages/runtime-subagents/src/scheduler.ts", text: "export class Scheduler {}" },
				],
			}),
		).toEqual([
			"packages/runtime-subagents/src/coordinator.ts:1: coordinator must not own snapshot.status =",
			"packages/runtime-subagents/src/scheduler.ts: retired runtime-subagents owner file still exists",
		]);
	});
});

function ownerFiles() {
	return [
		{ path: "packages/runtime-subagents/src/subagent-dispatcher.ts", text: "" },
		{ path: "packages/runtime-subagents/src/subagent-pool.ts", text: "" },
		{ path: "packages/runtime-subagents/src/subagent-run.ts", text: "" },
		{ path: "packages/runtime-subagents/src/recovery.ts", text: "" },
	];
}

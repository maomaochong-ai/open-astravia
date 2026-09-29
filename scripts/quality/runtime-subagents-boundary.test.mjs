import { describe, expect, it } from "vitest";
import { findRuntimeSubagentsBoundaryViolations } from "./check-runtime-subagents-boundary.mjs";

describe("Runtime Subagents boundary guard", () => {
	it("accepts a dependency-free scheduling kernel regardless of internal file layout", () => {
		expect(
			findRuntimeSubagentsBoundaryViolations({
				manifest: {
					path: "packages/runtime-subagents/package.json",
					content: { devDependencies: { typescript: "^5.9.2" } },
				},
				files: [{ path: "packages/runtime-subagents/src/kernel.ts", text: "export class Kernel {}" }],
			}),
		).toEqual([]);
	});

	it("rejects workspace dependency backedges", () => {
		expect(
			findRuntimeSubagentsBoundaryViolations({
				manifest: {
					path: "packages/runtime-subagents/package.json",
					content: { dependencies: { "@vetta/runtime-tools": "workspace:*" } },
				},
				files: [],
			}),
		).toEqual([
			"packages/runtime-subagents/package.json: dependencies must not declare workspace dependency @vetta/runtime-tools",
		]);
	});
});

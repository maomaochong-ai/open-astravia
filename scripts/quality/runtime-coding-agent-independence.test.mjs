import { describe, expect, it } from "vitest";
import { findRuntimeCodingAgentIndependenceViolations } from "./check-runtime-coding-agent-independence.mjs";

describe("Runtime Coding Agent independence guard", () => {
	it("accepts Runtime packages that depend only on lower-level contracts", () => {
		expect(
			findRuntimeCodingAgentIndependenceViolations({
				manifests: [
					{
						path: "packages/runtime-tools/package.json",
						content: { dependencies: { "@vetta/runtime-core": "workspace:*" } },
					},
				],
				files: [
					{
						path: "packages/runtime-tools/test/tool.test.ts",
						text: 'import { createRuntime } from "@vetta/runtime-core";',
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects manifest, test, and configuration backedges", () => {
		expect(
			findRuntimeCodingAgentIndependenceViolations({
				manifests: [
					{
						path: "packages/runtime-tools/package.json",
						content: { devDependencies: { "@vetta/coding-agent": "workspace:*" } },
					},
				],
				files: [
					{
						path: "packages/runtime-tools/test/tool.test.ts",
						text: 'import { host } from "@vetta/coding-agent/host";',
					},
					{
						path: "packages/runtime-tools/vitest.config.ts",
						text: 'const alias = "@vetta/coding-agent/host";',
					},
				],
			}),
		).toEqual([
			"packages/runtime-tools/package.json: devDependencies must not declare @vetta/coding-agent",
			"packages/runtime-tools/test/tool.test.ts:1: Runtime package file depends on @vetta/coding-agent",
			"packages/runtime-tools/vitest.config.ts:1: Runtime package file depends on @vetta/coding-agent",
		]);
	});

	it("rejects Coding Agent product semantics in Runtime production sources", () => {
		expect(
			findRuntimeCodingAgentIndependenceViolations({
				manifests: [],
				files: [
					{
						path: "packages/runtime-knowledge/src/processing/prompt.ts",
						text: 'export const guide = `todo(action="list")`;',
					},
					{
						path: "packages/runtime-subagents/test/compatibility.test.ts",
						text: "expect(snapshot.todoProgress).toBeDefined();",
					},
				],
			}),
		).toEqual([
			"packages/runtime-knowledge/src/processing/prompt.ts:1: Runtime source hardcodes product token todo(action=",
		]);
	});

	it("rejects plugin, interaction, and product side-effect contracts in Runtime sources", () => {
		expect(
			findRuntimeCodingAgentIndependenceViolations({
				manifests: [],
				files: [
					{
						path: "packages/runtime-core/src/contracts.ts",
						text: "export interface AgentPluginTool {}\nexport interface HostInteraction {}",
					},
					{
						path: "packages/runtime-tools/src/tool.ts",
						text: 'const sideEffect = "heavy";\nconst handler = askUserQuestion;',
					},
				],
			}),
		).toEqual([
			"packages/runtime-core/src/contracts.ts:1: Runtime source hardcodes product token AgentPlugin",
			"packages/runtime-core/src/contracts.ts:2: Runtime source hardcodes product token HostInteraction",
			"packages/runtime-tools/src/tool.ts:1: Runtime source hardcodes product token sideEffect",
			"packages/runtime-tools/src/tool.ts:2: Runtime source hardcodes product token askUserQuestion",
		]);
	});
});

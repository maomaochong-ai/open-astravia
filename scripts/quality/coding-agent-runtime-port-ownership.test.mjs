import { describe, expect, it } from "vitest";
import {
	collectCodingAgentRuntimePortOwnershipState,
	findCodingAgentRuntimePortOwnershipViolations,
} from "./check-coding-agent-runtime-port-ownership.mjs";

const PLUGIN_MCP_RUNTIME_PATH = "packages/coding-agent/src/plugins/runtime/mcp-runtime.ts";
const TODO_RUNTIME_PATH = "packages/coding-agent/src/adapters/runtime-core/greenfield-todo-runtime.ts";

describe("Coding Agent Runtime Port ownership gate", () => {
	it("accepts stable imports, value Adapter imports and explicit implementation conformance", () => {
		const state = collectCodingAgentRuntimePortOwnershipState([
			{
				path: PLUGIN_MCP_RUNTIME_PATH,
				text: "export class CodingAgentPluginMcpRuntime implements CodingAgentPluginMcpRuntimePort {}",
			},
			{
				path: TODO_RUNTIME_PATH,
				text: "export class CodingAgentTodoRuntime implements CodingAgentTodoRuntimePort {}",
			},
			{
				path: "packages/coding-agent/src/composition/runtime.ts",
				text: 'import { CodingAgentTodoRuntime as DefaultTodo } from "../adapters/runtime-core/greenfield.js";',
			},
			{
				path: "packages/coding-agent/src/public-api/host-services.ts",
				text: 'import type { CodingAgentRuntimeModelSource } from "../runtime-contracts/index.js";',
			},
		]);

		expect(findCodingAgentRuntimePortOwnershipViolations(state)).toEqual([]);
	});

	it("rejects duplicate declarations, Adapter type imports and missing conformance", () => {
		const state = collectCodingAgentRuntimePortOwnershipState([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/model.ts",
				text: "export interface CodingAgentRuntimeModelSource {}",
			},
			{
				path: "packages/coding-agent/src/composition/runtime.ts",
				text: 'import type { CodingAgentRuntimeModelSource } from "../adapters/runtime-core/greenfield.js";',
			},
			{
				path: "packages/coding-agent/src/public-api/host-services.ts",
				text: 'import { type CodingAgentPluginRuntimeSource, createRuntime } from "../adapters/runtime-core/greenfield.js";',
			},
		]);

		const violations = findCodingAgentRuntimePortOwnershipViolations(state);
		expect(violations).toContain(
			"packages/coding-agent/src/adapters/runtime-core/model.ts: Adapter redeclares stable Runtime Port (CodingAgentRuntimeModelSource)",
		);
		expect(violations).toContain(
			"packages/coding-agent/src/composition/runtime.ts: stable Runtime Port is imported from Adapter (CodingAgentRuntimeModelSource from ../adapters/runtime-core/greenfield.js)",
		);
		expect(violations).toContain(
			"packages/coding-agent/src/public-api/host-services.ts: stable Runtime Port is imported from Adapter (CodingAgentPluginRuntimeSource from ../adapters/runtime-core/greenfield.js)",
		);
		expect(violations).toHaveLength(5);
	});
});

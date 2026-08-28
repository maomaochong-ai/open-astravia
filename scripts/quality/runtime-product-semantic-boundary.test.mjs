import { describe, expect, it } from "vitest";
import { findPackageBoundaryViolations } from "./check-package-boundaries.mjs";

describe("Runtime product semantic boundary", () => {
	it.each([
		["packages/runtime-core/src/contracts.ts", "export type ConversationScenario = 'chat';"],
		["packages/runtime-tools/src/coding/catalog.ts", "const category: CodingToolCategory = 'other';"],
		["packages/runtime-node/src/coding/tools/read.ts", "const guide = 'Read SKILL.md first';"],
		["packages/runtime-core/src/events.ts", "const event = 'mcp.reload.start';"],
	])("rejects product semantics in %s", (path, source) => {
		expect(findPackageBoundaryViolations(path, source)).toHaveLength(1);
	});

	it.each([
		["packages/runtime-core/src/contracts.ts", "export interface RuntimeExtensionObservation {}"],
		["packages/runtime-tools/src/coding/catalog.ts", "const registrationSelector = () => true;"],
		["packages/runtime-node/src/coding/tools/read.ts", "const hint = 'Binary content is not rendered';"],
		["packages/coding-agent/src/profiles/contracts.ts", "export type ConversationScenario = 'chat';"],
	])("allows generic Runtime contracts and product-owned semantics in %s", (path, source) => {
		expect(findPackageBoundaryViolations(path, source)).toEqual([]);
	});
});

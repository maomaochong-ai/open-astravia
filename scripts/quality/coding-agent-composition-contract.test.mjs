import { describe, expect, it } from "vitest";
import {
	collectCodingAgentCompositionContractState,
	findCodingAgentCompositionContractViolations,
	REQUIRED_COMPOSITION_OPTION_FACETS,
} from "./check-coding-agent-composition-contract.mjs";

describe("Coding Agent Composition contract gate", () => {
	it("accepts responsibility facets without Adapter dependencies", () => {
		const state = collectCodingAgentCompositionContractState([
			{
				path: "packages/coding-agent/src/composition/contracts/runtime-composition-options.ts",
				text: [
					...REQUIRED_COMPOSITION_OPTION_FACETS.map((facet) => `export interface ${facet} {}`),
					`export interface CodingAgentRuntimeCompositionOptions extends ${REQUIRED_COMPOSITION_OPTION_FACETS.join(", ")} {}`,
				].join("\n"),
			},
		]);

		expect(findCodingAgentCompositionContractViolations(state)).toEqual([]);
		expect(state.adapterDependencies).toHaveLength(0);
	});

	it("rejects Adapter imports, missing facets and oversized contract modules", () => {
		const state = collectCodingAgentCompositionContractState([
			{
				path: "packages/coding-agent/src/composition/contracts/runtime-composition-options.ts",
				text: [
					'import type { Runtime } from "../../adapters/runtime-core/runtime.js";',
					`export interface ${REQUIRED_COMPOSITION_OPTION_FACETS[0]} {}`,
					`export interface CodingAgentRuntimeCompositionOptions extends ${REQUIRED_COMPOSITION_OPTION_FACETS[0]} {}`,
				].join("\n"),
			},
			{
				path: "packages/coding-agent/src/composition/contracts/runtime-composition-result.ts",
				text: Array.from({ length: 181 }, () => "export {};").join("\n"),
			},
		]);

		const violations = findCodingAgentCompositionContractViolations(state);
		expect(violations).toContain(
			"packages/coding-agent/src/composition/contracts/runtime-composition-options.ts: public Composition contract depends on Adapter (../../adapters/runtime-core/runtime.js)",
		);
		expect(violations).toContain(
			"packages/coding-agent/src/composition/contracts/runtime-composition-result.ts: Composition contract module has 181 lines (limit 180)",
		);
		expect(violations).toHaveLength(11);
	});
});

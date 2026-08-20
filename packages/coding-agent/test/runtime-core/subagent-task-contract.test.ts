import { describe, expect, it } from "vitest";
import {
	renderSubagentTaskContract,
	resolveSubagentTaskMessage,
} from "../../src/composition/subagent/task-contract.js";

describe("subagent task contract", () => {
	const task = {
		history: "The root mapped the existing session lifecycle and accepted ADR-0076.",
		current_state: "The coordinator works, but child policy is still profile-specific.",
		objective: "Expose one general child definition with inherited capabilities.",
		scope: "Only composition/subagent definitions and their contract tests.",
		constraints: ["Preserve the existing coordinator state machine", "Do not modify unrelated files"],
		relevant_context: ["Use the current source as the fact source", "Custom registries remain compatible"],
		deliverables: ["General definition", "Policy tests"],
		validation: ["Run the targeted Vitest files", "Run check:quick"],
	};

	it("renders every completion-critical field into a deterministic child message", () => {
		const rendered = renderSubagentTaskContract(task);

		expect(rendered).toContain("<delegated_task_contract>");
		for (const value of [
			task.history,
			task.current_state,
			task.objective,
			task.scope,
			...task.constraints,
			...task.relevant_context,
			...task.deliverables,
			...task.validation,
		]) {
			expect(rendered).toContain(value);
		}
		expect(rendered).toContain("Completion is based on the validation results");
	});

	it("keeps legacy messages readable but fails closed when neither input is present", () => {
		expect(resolveSubagentTaskMessage({ message: "legacy task" })).toBe("legacy task");
		expect(() => resolveSubagentTaskMessage({})).toThrow("A detailed task contract is required");
	});
});

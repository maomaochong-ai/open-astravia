import { describe, expect, it } from "vitest";
import { runMcpCapabilityExample } from "../../examples/runtime-agents/01-mcp-capability.js";
import { runSkillCapabilityExample } from "../../examples/runtime-agents/02-skill-capability.js";
import { runSessionExtensionCapabilityExample } from "../../examples/runtime-agents/03-session-extension-capability.js";

describe("Runtime Agent capability examples", () => {
	it("pins MCP bindings for an in-flight Turn and refreshes the next Turn", async () => {
		const result = await runMcpCapabilityExample();

		expect(result.firstTurn.toolNames).toEqual(["mcp_catalog_search"]);
		expect(result.firstTurn.prompt).toContain("mcp_catalog_search");
		expect(result.firstTurn.execution).toBe("catalog-v1:leases");
		expect(result.inFlightAfterSourceUpdate).toEqual({
			toolNames: ["mcp_catalog_search"],
			execution: "catalog-v1:snapshots",
		});
		expect(result.nextTurn.toolNames).toEqual(["mcp_catalog_search", "mcp_changelog_read"]);
		expect(result.nextTurn.prompt).toContain("mcp_changelog_read");
		expect(result.nextTurn.execution).toBe("catalog-v2:rollout");
	});

	it("discovers and invokes Agent-local Skills without cross-Agent leakage", async () => {
		const result = await runSkillCapabilityExample();

		expect(result.researcher.diagnostics).toEqual([]);
		expect(result.researcher.toolNames).toEqual(["invoke_skill"]);
		expect(result.researcher.prompt).toContain("evidence-review");
		expect(result.researcher.prompt).not.toContain("release-checklist");
		expect(result.researcher.invocation).toContain("identify its supporting evidence");
		expect(result.researcher.invocation).toContain("User arguments: Check the rollout claim");

		expect(result.reviewer.diagnostics).toEqual([]);
		expect(result.reviewer.toolNames).toEqual(["invoke_skill"]);
		expect(result.reviewer.prompt).toContain("release-checklist");
		expect(result.reviewer.prompt).not.toContain("evidence-review");
		expect(result.reviewer.invocation).toContain("Report every unresolved release blocker");
	});

	it("shares Extension state across Tool, Service and Endpoint but isolates Sessions", async () => {
		const result = await runSessionExtensionCapabilityExample();

		expect(result.availableTools).toEqual(["review_note"]);
		expect(result.notes).toEqual(["Tool schemas remain stable within the Turn.", "Add a regression test."]);
		expect(result.signalSnapshots).toEqual([
			["Tool schemas remain stable within the Turn."],
			["Tool schemas remain stable within the Turn.", "Add a regression test."],
		]);
		expect(result.serviceCount).toBe(2);
		expect(result.initialObservationCount).toBe(1);
		expect(result.secondSessionNotes).toEqual([]);
	});
});

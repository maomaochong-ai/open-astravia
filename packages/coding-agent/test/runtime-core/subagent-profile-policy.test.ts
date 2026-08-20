import { describe, expect, it } from "vitest";
import { resolveCodingAgentSubagentProfile } from "../../src/composition/subagent/profile-policy.js";
import {
	CODING_AGENT_SUBAGENT_TYPE_EXPLORER,
	CODING_AGENT_SUBAGENT_TYPE_GENERAL,
	CODING_AGENT_SUBAGENT_TYPE_WORKFLOW,
	createDefaultCodingAgentSubagentTypeRegistry,
} from "../../src/composition/subagent/profiles.js";

describe("Coding Agent Subagent profile policy", () => {
	it("registers general-purpose inheritance before specialized built-ins", () => {
		const registry = createDefaultCodingAgentSubagentTypeRegistry();

		expect(registry.list().map(({ id }) => id)).toEqual([
			CODING_AGENT_SUBAGENT_TYPE_GENERAL,
			CODING_AGENT_SUBAGENT_TYPE_EXPLORER,
			CODING_AGENT_SUBAGENT_TYPE_WORKFLOW,
		]);
		const general = registry.get(CODING_AGENT_SUBAGENT_TYPE_GENERAL);
		expect(general?.profile).toMatchObject({
			toolPolicy: { mode: "inherit" },
			mcpPolicy: { mode: "inherit" },
			skillPolicy: { mode: "inherit" },
			contextPolicy: { mode: "full" },
			todoPolicy: { mode: "enabled" },
		});
		expect(general?.profile.systemPromptAddon).toContain("report only work and evidence you personally performed");
		expect(registry.get(CODING_AGENT_SUBAGENT_TYPE_WORKFLOW)?.profile.systemPromptAddon).toContain(
			"Never claim their work or status",
		);
	});

	it("inherits the exact parent activation and keeps explorer MCP fail-closed", () => {
		const registry = createDefaultCodingAgentSubagentTypeRegistry();
		const parentActivation = { mode: "explicit", toolNames: ["read", "write", "custom_parent_tool"] } as const;
		const general = registry.get(CODING_AGENT_SUBAGENT_TYPE_GENERAL);
		const explorer = registry.get(CODING_AGENT_SUBAGENT_TYPE_EXPLORER);
		if (!general || !explorer) throw new Error("Expected built-in subagent definitions");

		expect(resolveCodingAgentSubagentProfile(general.profile, "cli", parentActivation).activation).toBe(
			parentActivation,
		);
		expect(resolveCodingAgentSubagentProfile(explorer.profile, "cli", parentActivation)).toMatchObject({
			activation: { mode: "explicit", toolNames: ["read", "grep", "glob", "find", "ls", "dir_tree"] },
			mcpPolicy: { mode: "none" },
			contextPolicy: { mode: "fresh" },
		});
	});

	it("maps legacy custom profile fields at one compatibility boundary", () => {
		const resolved = resolveCodingAgentSubagentProfile(
			{
				systemPromptAddon: "Review only.",
				activation: { mode: "explicit", toolNames: ["read"] },
				inheritParentMcp: false,
				forkParentContext: false,
				includeTodo: true,
			},
			"project",
		);

		expect(resolved).toMatchObject({
			activation: { mode: "explicit", toolNames: ["read"] },
			mcpPolicy: { mode: "none" },
			skillPolicy: { mode: "inherit" },
			contextPolicy: { mode: "fresh" },
			todoPolicy: { mode: "enabled" },
		});
	});
});

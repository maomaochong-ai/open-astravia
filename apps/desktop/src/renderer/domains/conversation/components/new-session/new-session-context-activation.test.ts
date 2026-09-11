import type { RegisteredNewSessionContext } from "@shared/store/plugin-atoms";
import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";
import { pluginBlueprintId } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import { resolveNewSessionContexts } from "./new-session-context-activation";

function contribution(overrides: Partial<RegisteredNewSessionContext> = {}): RegisteredNewSessionContext {
	return {
		pluginId: "vetta-ui-design",
		pluginName: "Vetta 设计",
		contextId: "vetta-ui-design:design-resources",
		label: "设计资源",
		activateWhen: { agents: ["designer"] },
		width: "input",
		render: () => null,
		order: 0,
		canReadDraft: true,
		...overrides,
	};
}

function agent(blueprintId: string, id = "agent-1"): AgentProfile {
	return {
		id,
		revision: 1,
		name: "设计师",
		description: "",
		mentionHandle: "designer",
		blueprintId,
		abilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
		scope: { kind: "library" },
		createdAt: 0,
		updatedAt: 0,
	};
}

function team(memberProfileIds: readonly string[]): TeamDefinition {
	return {
		id: "team-1",
		revision: 1,
		name: "设计团队",
		description: "",
		leaderMemberId: "m0",
		members: memberProfileIds.map((agentProfileId, index) => ({
			id: `m${index}`,
			handle: `h${index}`,
			binding: { kind: "reference", agentProfileId },
		})),
		orchestrationPolicyId: "leader-delegates-v1",
		contextPolicyId: "public-results-v1",
		createdAt: 0,
		updatedAt: 0,
	};
}

const DESIGNER_BLUEPRINT = pluginBlueprintId("vetta-ui-design", "designer");

describe("new session context activation", () => {
	it("activates when the selected agent is one the plugin contributed", () => {
		const active = resolveNewSessionContexts({
			contributions: [contribution()],
			targetAgent: agent(DESIGNER_BLUEPRINT),
		});

		expect(active).toHaveLength(1);
		expect(active[0]?.strength).toBe("target");
		expect(active[0]?.targetContributedId).toBe("designer");
	});

	it("stays hidden for an unrelated agent", () => {
		expect(resolveNewSessionContexts({ contributions: [contribution()], targetAgent: agent("master") })).toEqual([]);
	});

	it("cannot be activated by another plugin's agent", () => {
		// 声明别人的 id 不该生效，否则插件能把别人的使用场景劫持过来。
		const hijacker = contribution({
			pluginId: "some-other-plugin",
			contextId: "some-other-plugin:hijack",
			activateWhen: { agents: ["designer"] },
		});

		expect(resolveNewSessionContexts({ contributions: [hijacker], targetAgent: agent(DESIGNER_BLUEPRINT) })).toEqual(
			[],
		);
	});

	it("activates for a team that contains one of the plugin's agents", () => {
		const designer = agent(DESIGNER_BLUEPRINT, "designer-profile");
		const master = agent("master", "master-profile");

		const active = resolveNewSessionContexts({
			contributions: [contribution()],
			targetTeam: team([master.id, designer.id]),
			agentsById: new Map([
				[master.id, master],
				[designer.id, designer],
			]),
		});

		expect(active).toHaveLength(1);
		expect(active[0]?.targetContributedId).toBe("designer");
	});

	it("stays hidden for a team with none of the plugin's agents", () => {
		const master = agent("master", "master-profile");

		expect(
			resolveNewSessionContexts({
				contributions: [contribution()],
				targetTeam: team([master.id]),
				agentsById: new Map([[master.id, master]]),
			}),
		).toEqual([]);
	});

	it("activates on a mentioned skill and reports which ones matched", () => {
		const active = resolveNewSessionContexts({
			contributions: [contribution({ activateWhen: { skills: ["vetta-ui-design"] } })],
			mentionedSkills: ["vetta-ui-design", "something-else"],
		});

		expect(active).toHaveLength(1);
		expect(active[0]?.strength).toBe("mention");
		expect(active[0]?.mentionedSkills).toEqual(["vetta-ui-design"]);
	});

	it("orders the selected target's plugin ahead of a merely mentioned one", () => {
		const byTarget = contribution();
		const byMention = contribution({
			pluginId: "another-plugin",
			contextId: "another-plugin:notes",
			activateWhen: { skills: ["notes"] },
		});

		const active = resolveNewSessionContexts({
			contributions: [byMention, byTarget],
			targetAgent: agent(DESIGNER_BLUEPRINT),
			mentionedSkills: ["notes"],
		});

		expect(active.map((entry) => entry.contribution.contextId)).toEqual([
			"vetta-ui-design:design-resources",
			"another-plugin:notes",
		]);
	});

	it("keeps one plugin's several tabs adjacent and in registration order", () => {
		const first = contribution({ contextId: "vetta-ui-design:a", order: 0 });
		const second = contribution({ contextId: "vetta-ui-design:b", order: 1 });

		const active = resolveNewSessionContexts({
			contributions: [second, first],
			targetAgent: agent(DESIGNER_BLUEPRINT),
		});

		expect(active.map((entry) => entry.contribution.contextId)).toEqual(["vetta-ui-design:a", "vetta-ui-design:b"]);
	});
});

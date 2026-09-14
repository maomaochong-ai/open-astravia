import type { AgentBlueprint, AgentTeamDocument } from "@vetta/agent-team";
import { createAgentTeamFixture, pluginBlueprintId } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import { backfillPluginAgentPresets, pluginAgentProfileId, pluginTeamId } from "./plugin-agent-preset-backfill.js";
import type { PluginAgentPreset, PluginTeamPreset } from "./plugin-agent-presets.js";

const PLUGIN_ID = "vetta-ui-design";
const BLUEPRINT_ID = pluginBlueprintId(PLUGIN_ID, "designer");

const blueprint: AgentBlueprint = {
	id: BLUEPRINT_ID,
	nameKey: "",
	descriptionKey: "",
	name: "%agent.designer.name%",
	systemPrompt: "You are the design specialist.",
	defaultAbilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	source: { kind: "plugin", pluginId: PLUGIN_ID },
	avatarUrl: "data:image/webp;base64,ZmFrZQ==",
	pinnedPlugins: [PLUGIN_ID],
};

const agentPreset: PluginAgentPreset = {
	pluginId: PLUGIN_ID,
	agentId: "designer",
	blueprint,
	profileName: "设计师",
	profileDescription: "画布设计",
	mentionHandle: "designer",
	legacyBlueprintIds: [],
	roles: ["designer"],
};

const teamPreset: PluginTeamPreset = {
	pluginId: PLUGIN_ID,
	teamId: "design-team",
	name: "设计团队",
	description: "把构想变成可评审的界面",
	members: [
		{
			slotKey: "designer",
			blueprintId: BLUEPRINT_ID,
			providerPluginId: PLUGIN_ID,
			responsibility: "Builds the frames.",
		},
	],
	workflow: "Run this team as a design loop.",
	legacyTeamIds: [],
};

function baseDocument(): AgentTeamDocument {
	return createAgentTeamFixture();
}

describe("plugin agent preset backfill", () => {
	it("installs a plugin agent and its team, stamped with the provider", () => {
		const result = backfillPluginAgentPresets({
			document: baseDocument(),
			agents: [agentPreset],
			teams: [teamPreset],
		});

		if (!result) throw new Error("expected a backfill result");
		const installed = result.document.agents.find((agent) => agent.blueprintId === BLUEPRINT_ID);
		expect(installed?.id).toBe(pluginAgentProfileId(PLUGIN_ID, "designer"));
		expect(installed?.name).toBe("设计师");
		expect(installed?.source).toEqual({ kind: "plugin", pluginId: PLUGIN_ID });
		// 头像不落档案：它是一条内联 data URL，既超出 avatar 字段的长度约定，也会让提供方换图之后
		// 所有存量用户停在旧图上。
		expect(installed?.avatar).toBeUndefined();
		// 人设同样留空，提供方升级提示词时没手改过的用户才跟得上。
		expect(installed?.systemPrompt).toBeUndefined();

		const team = result.document.teams.find((candidate) => candidate.id === pluginTeamId(PLUGIN_ID, "design-team"));
		expect(team?.source).toEqual({ kind: "plugin", pluginId: PLUGIN_ID });
		expect(team?.members).toHaveLength(1);
		expect(team?.members[0]?.assignment?.instructions).toBe(teamPreset.workflow);
	});

	it("does nothing on a second run", () => {
		const first = backfillPluginAgentPresets({
			document: baseDocument(),
			agents: [agentPreset],
			teams: [teamPreset],
		});
		if (!first) throw new Error("expected a backfill result");

		expect(
			backfillPluginAgentPresets({ document: first.document, agents: [agentPreset], teams: [teamPreset] }),
		).toBeUndefined();
	});

	it("puts a missing preset back, because the provider owns it", () => {
		const first = backfillPluginAgentPresets({ document: baseDocument(), agents: [agentPreset], teams: [] });
		if (!first) throw new Error("expected a backfill result");
		const withoutAgent = {
			...first.document,
			agents: first.document.agents.filter((agent) => agent.blueprintId !== BLUEPRINT_ID),
		};

		const second = backfillPluginAgentPresets({ document: withoutAgent, agents: [agentPreset], teams: [] });
		expect(second?.document.agents.some((agent) => agent.blueprintId === BLUEPRINT_ID)).toBe(true);
	});

	it("claims an existing profile by its legacy blueprint id instead of laying down a duplicate", () => {
		const document = baseDocument();
		// 夹具里的 Developer 仍写着历史 id `executor`，正是存量安装的形状。
		const legacy = document.agents.find((agent) => agent.blueprintId === "executor");
		expect(legacy).toBeDefined();

		const result = backfillPluginAgentPresets({
			document,
			agents: [{ ...agentPreset, legacyBlueprintIds: ["executor"] }],
			teams: [],
		});

		if (!result) throw new Error("expected a backfill result");
		expect(result.document.agents).toHaveLength(document.agents.length);
		const claimed = result.document.agents.find((agent) => agent.id === legacy?.id);
		expect(claimed?.blueprintId).toBe(BLUEPRINT_ID);
		expect(claimed?.source).toEqual({ kind: "plugin", pluginId: PLUGIN_ID });
		// 用户改过的名字与 @handle 不该被提供方盖掉。
		expect(claimed?.name).toBe(legacy?.name);
		expect(claimed?.mentionHandle).toBe(legacy?.mentionHandle);
	});

	it("claims an existing team by its legacy id without rewriting its roster", () => {
		const document = baseDocument();
		const existing = document.teams[0]!;
		const result = backfillPluginAgentPresets({
			document,
			agents: [agentPreset],
			teams: [{ ...teamPreset, legacyTeamIds: [existing.id] }],
		});

		if (!result) throw new Error("expected a backfill result");
		expect(result.document.teams).toHaveLength(document.teams.length);
		const claimed = result.document.teams.find((team) => team.id === existing.id);
		expect(claimed?.source).toEqual({ kind: "plugin", pluginId: PLUGIN_ID });
		expect(claimed?.members).toEqual(existing.members);
	});

	it("skips a team whose member profiles cannot be resolved", () => {
		const result = backfillPluginAgentPresets({ document: baseDocument(), agents: [], teams: [teamPreset] });
		expect(result).toBeUndefined();
	});

	describe("slots filled by another plugin", () => {
		const PROVIDER_ID = "preset-agent";
		const DEVELOPER_BLUEPRINT = pluginBlueprintId(PROVIDER_ID, "developer");

		const developerPreset: PluginAgentPreset = {
			pluginId: PROVIDER_ID,
			agentId: "developer",
			blueprint: { ...blueprint, id: DEVELOPER_BLUEPRINT, source: { kind: "plugin", pluginId: PROVIDER_ID } },
			profileName: "开发者",
			profileDescription: "写代码的",
			mentionHandle: "developer",
			legacyBlueprintIds: [],
			roles: ["developer"],
		};

		/** 设计团队补上一个由别的插件供货的开发位。 */
		const withDeveloper: PluginTeamPreset = {
			...teamPreset,
			members: [
				...teamPreset.members,
				{
					slotKey: "developer",
					blueprintId: DEVELOPER_BLUEPRINT,
					providerPluginId: PROVIDER_ID,
					role: "developer",
					responsibility: "Implements the frames.",
				},
			],
		};

		it("derives member ids from the slot, so an inserted member does not shift the others", () => {
			const shifted: PluginTeamPreset = {
				...teamPreset,
				members: [
					{
						slotKey: "researcher",
						blueprintId: pluginBlueprintId(PROVIDER_ID, "researcher"),
						providerPluginId: PROVIDER_ID,
						responsibility: "n/a",
					},
					...teamPreset.members,
				],
			};

			const before = backfillPluginAgentPresets({
				document: baseDocument(),
				agents: [agentPreset],
				teams: [teamPreset],
			});
			const designerMemberId = before?.document.teams.at(-1)?.members[0]?.id;

			// 同一个槽位换了个位置，id 不该跟着动——用户的 handle 和运行时状态都挂在它上面。
			const after = backfillPluginAgentPresets({
				document: baseDocument(),
				agents: [agentPreset],
				teams: [{ ...shifted, members: shifted.members.slice(1) }],
			});
			expect(after?.document.teams.at(-1)?.members[0]?.id).toBe(designerMemberId);
		});

		it("writes the member brief into the assignment, leaving the leader's workflow alone", () => {
			const briefed: PluginTeamPreset = {
				...withDeveloper,
				members: withDeveloper.members.map((member, index) =>
					index === 1 ? { ...member, instructions: "Ship behind a flag." } : member,
				),
			};

			const result = backfillPluginAgentPresets({
				document: baseDocument(),
				agents: [agentPreset, developerPreset],
				teams: [briefed],
			});

			if (!result) throw new Error("expected a backfill result");
			const team = result.document.teams.at(-1)!;
			expect(team.members[0]?.assignment?.instructions).toBe(briefed.workflow);
			expect(team.members[1]?.assignment?.instructions).toBe("Ship behind a flag.");
			expect(team.members[1]?.assignment?.responsibility).toBe("Implements the frames.");
		});

		it("grows the roster once the provider shows up", () => {
			const first = backfillPluginAgentPresets({
				document: baseDocument(),
				agents: [agentPreset],
				teams: [teamPreset],
			});
			if (!first) throw new Error("expected a backfill result");
			expect(first.document.teams.at(-1)?.members).toHaveLength(1);

			const second = backfillPluginAgentPresets({
				document: first.document,
				agents: [agentPreset, developerPreset],
				teams: [withDeveloper],
			});

			if (!second) throw new Error("expected the roster to grow");
			const team = second.document.teams.find(
				(candidate) => candidate.id === pluginTeamId(PLUGIN_ID, "design-team"),
			);
			expect(team?.members).toHaveLength(2);
			// 补进来的成员跟着它自己那份档案的 @handle 走（夹具里已经有人占了 `developer`）。
			const profile = second.document.agents.find((agent) => agent.blueprintId === DEVELOPER_BLUEPRINT);
			expect(team?.members[1]?.binding.agentProfileId).toBe(profile?.id);
			expect(team?.members[1]?.handle).toBe(profile?.mentionHandle);
			// 队长不动：补员只往后追加。
			expect(team?.leaderMemberId).toBe(team?.members[0]?.id);
		});

		it("leaves a roster the user has edited alone", () => {
			const first = backfillPluginAgentPresets({
				document: baseDocument(),
				agents: [agentPreset, developerPreset],
				teams: [teamPreset],
			});
			if (!first) throw new Error("expected a backfill result");

			const teams = first.document.teams.map((team) =>
				team.id === pluginTeamId(PLUGIN_ID, "design-team")
					? { ...team, members: [...team.members, { ...team.members[0]!, id: "hand-made", handle: "mine" }] }
					: team,
			);

			const second = backfillPluginAgentPresets({
				document: { ...first.document, teams },
				agents: [agentPreset, developerPreset],
				teams: [withDeveloper],
			});

			// 阵容里有一个本预设推导不出来的 id，就整支不动——宁可少补一个，也不往用户编辑过的
			// 阵容里插队。
			expect(second).toBeUndefined();
		});
	});
});

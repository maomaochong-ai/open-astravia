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
};

const teamPreset: PluginTeamPreset = {
	pluginId: PLUGIN_ID,
	teamId: "design-team",
	name: "设计团队",
	description: "把构想变成可评审的界面",
	members: [{ blueprintId: BLUEPRINT_ID, responsibility: "Builds the frames." }],
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
});

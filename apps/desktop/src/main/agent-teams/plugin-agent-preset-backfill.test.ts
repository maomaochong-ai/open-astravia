import type { AgentBlueprint, AgentTeamDocument } from "@vetta/agent-team";
import { BUILTIN_AGENT_PROFILE_IDS, createAgentTeamFixture, pluginBlueprintId } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import {
	backfillPluginAgentPresets,
	pluginAgentPresetKey,
	pluginAgentProfileId,
	pluginTeamPresetKey,
} from "./plugin-agent-preset-backfill.js";
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
	pinnedPlugins: [PLUGIN_ID],
};

const agentPreset: PluginAgentPreset = {
	pluginId: PLUGIN_ID,
	agentId: "designer",
	blueprint,
	profileName: "设计师",
	profileDescription: "画布设计",
	mentionHandle: "designer",
};

const teamPreset: PluginTeamPreset = {
	pluginId: PLUGIN_ID,
	teamId: "design-team",
	name: "设计团队",
	description: "把构想变成可评审的界面",
	members: [
		{ builtinKey: "master", responsibility: "Owns the brief." },
		{ blueprintId: BLUEPRINT_ID, responsibility: "Builds the frames." },
	],
	workflow: "Run this team as a design loop.",
};

function baseDocument(): AgentTeamDocument {
	return createAgentTeamFixture();
}

describe("plugin agent preset backfill", () => {
	it("installs a plugin agent and its team into the user's library", () => {
		const result = backfillPluginAgentPresets({
			document: baseDocument(),
			installedPresetIds: [],
			agents: [agentPreset],
			teams: [teamPreset],
		});

		if (!result) throw new Error("expected a backfill result");
		const installed = result.document.agents.find((agent) => agent.blueprintId === BLUEPRINT_ID);
		expect(installed?.name).toBe("设计师");
		expect(installed?.id).toBe(pluginAgentProfileId(PLUGIN_ID, "designer"));
		// 不落 systemPrompt，插件升级人设时没手改过的用户才会自动跟上。
		expect(installed?.systemPrompt).toBeUndefined();

		const team = result.document.teams.find((candidate) => candidate.name === "设计团队");
		expect(team?.members.map((member) => member.binding.agentProfileId)).toEqual([
			BUILTIN_AGENT_PROFILE_IDS.master,
			installed?.id,
		]);
		expect(team?.leaderMemberId).toBe(team?.members[0]?.id);
		expect(team?.members[0]?.assignment?.instructions).toBe("Run this team as a design loop.");
		expect(result.installedPresetIds).toContain(pluginAgentPresetKey(PLUGIN_ID, "designer"));
		expect(result.installedPresetIds).toContain(pluginTeamPresetKey(PLUGIN_ID, "design-team"));
	});

	it("derives the same ids on a reinstall so the user does not collect duplicates", () => {
		const first = backfillPluginAgentPresets({
			document: baseDocument(),
			installedPresetIds: [],
			agents: [agentPreset],
			teams: [teamPreset],
		});
		const second = backfillPluginAgentPresets({
			document: baseDocument(),
			installedPresetIds: [],
			agents: [agentPreset],
			teams: [teamPreset],
		});

		expect(first?.document.agents.map((agent) => agent.id)).toEqual(second?.document.agents.map((agent) => agent.id));
		expect(first?.document.teams.map((team) => team.id)).toEqual(second?.document.teams.map((team) => team.id));
	});

	it("does not resurrect a preset the user deleted after it was recorded", () => {
		const result = backfillPluginAgentPresets({
			document: baseDocument(),
			installedPresetIds: [
				pluginAgentPresetKey(PLUGIN_ID, "designer"),
				pluginTeamPresetKey(PLUGIN_ID, "design-team"),
			],
			agents: [agentPreset],
			teams: [teamPreset],
		});

		expect(result).toBeUndefined();
	});

	it("skips a team whose member profile is absent, and retries it on a later launch", () => {
		const document = baseDocument();
		// 用户删掉了 Master：补上团队会让整份配置在 assertTeamInvariants 处读废。
		const withoutMaster: AgentTeamDocument = {
			...document,
			agents: document.agents.filter((agent) => agent.id !== BUILTIN_AGENT_PROFILE_IDS.master),
			teams: [],
		};

		const result = backfillPluginAgentPresets({
			document: withoutMaster,
			installedPresetIds: [],
			agents: [agentPreset],
			teams: [teamPreset],
		});

		if (!result) throw new Error("expected a backfill result");
		expect(result.document.teams).toHaveLength(0);
		// 团队没记进已铺列表，用户把 Master 补回来后下次启动它还能到位。
		expect(result.installedPresetIds).not.toContain(pluginTeamPresetKey(PLUGIN_ID, "design-team"));
		expect(result.installedPresetIds).toContain(pluginAgentPresetKey(PLUGIN_ID, "designer"));
	});

	it("gives a colliding mention handle a distinct suffix", () => {
		const document = baseDocument();
		const collision: AgentTeamDocument = {
			...document,
			agents: [
				...document.agents,
				{
					...document.agents[0]!,
					id: "user-made-designer",
					mentionHandle: "designer",
					blueprintId: "master",
				},
			],
		};

		const result = backfillPluginAgentPresets({
			document: collision,
			installedPresetIds: [],
			agents: [agentPreset],
			teams: [],
		});

		const installed = result?.document.agents.find((agent) => agent.blueprintId === BLUEPRINT_ID);
		expect(installed?.mentionHandle).toBe("designer-2");
	});

	it("reports no change when there is nothing left to install", () => {
		expect(
			backfillPluginAgentPresets({ document: baseDocument(), installedPresetIds: [], agents: [], teams: [] }),
		).toBeUndefined();
	});
});

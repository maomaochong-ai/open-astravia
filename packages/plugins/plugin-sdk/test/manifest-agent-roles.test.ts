import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTIN_PLUGIN_AGENT_ROLES, parsePluginManifest, listPluginManifestResources } from "../src/manifest.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const baseManifest = {
	id: "agent-roles-test",
	name: "Agent roles test",
	version: "1.0.0",
	pluginApiVersion: "^2.0.0",
	entry: "dist/index.js",
	moduleFederation: { remoteName: "agent_roles_test", expose: "./plugin" },
};

function withTeam(members: readonly unknown[]) {
	return {
		...baseManifest,
		agent: {
			agents: [{ id: "lead", name: "Lead", systemPrompt: "You lead." }],
			teams: [{ id: "squad", name: "Squad", members }],
		},
	};
}

const leader = { agent: "lead", responsibility: "Owns the result." };

describe("plugin manifest agent roles", () => {
	it("carries the roles an agent offers to other plugins", () => {
		const manifest = parsePluginManifest({
			...baseManifest,
			agent: {
				agents: [{ id: "dev", name: "Dev", systemPrompt: "You build.", roles: ["developer", "developer"] }],
			},
		});

		// 重复的角色会让候选表里出现两份同一个人，归一化时去掉。
		expect(manifest.agent?.agents?.[0]?.roles).toEqual(["developer"]);
	});

	it("accepts both an entity reference and a role slot", () => {
		const manifest = parsePluginManifest(
			withTeam([leader, { role: "developer", responsibility: "Builds it." }, { agent: "preset-agent/auditor", responsibility: "Reviews it." }]),
		);

		const members = manifest.agent?.teams?.[0]?.members ?? [];
		expect(members[1]?.role).toBe("developer");
		expect(members[2]?.agent).toBe("preset-agent/auditor");
	});

	it("rejects a member that writes neither agent nor role", () => {
		expect(() => parsePluginManifest(withTeam([leader, { responsibility: "Does something." }]))).toThrow(
			/exactly one of "agent" or "role"/,
		);
	});

	it("rejects a member that writes both", () => {
		expect(() =>
			parsePluginManifest(withTeam([leader, { agent: "lead", role: "developer", responsibility: "Both." }])),
		).toThrow(/exactly one of "agent" or "role"/);
	});

	it("rejects a malformed cross-plugin reference", () => {
		expect(() =>
			parsePluginManifest(withTeam([leader, { agent: "a/b/c", responsibility: "Nested." }])),
		).toThrow(/<pluginId>\/<agentId>/);
	});

	it("refuses a leader that is not one of this plugin's own agents", () => {
		// 队长是用户唯一的对话入口，落在别的插件上会让这支团队随那个插件一起消失。
		expect(() =>
			parsePluginManifest(withTeam([{ agent: "preset-agent/master", responsibility: "Leads." }])),
		).toThrow(/team leader must be one of this plugin's own agents/);
		expect(() => parsePluginManifest(withTeam([{ role: "master", responsibility: "Leads." }]))).toThrow(
			/team leader must be one of this plugin's own agents/,
		);
	});

	it("carries a per-member brief and validates its path", () => {
		const manifest = parsePluginManifest(
			withTeam([leader, { role: "developer", responsibility: "Builds it.", instructionsPath: "agent/dev.md" }]),
		);

		expect(manifest.agent?.teams?.[0]?.members[1]?.instructionsPath).toBe("agent/dev.md");
		expect(() =>
			parsePluginManifest(
				withTeam([leader, { role: "developer", responsibility: "x", instructionsPath: "../../etc/passwd" }]),
			),
		).toThrow();
	});

	it("registers member briefs as packaged resources", () => {
		const manifest = parsePluginManifest(
			withTeam([leader, { role: "developer", responsibility: "Builds it.", instructionsPath: "agent/dev.md" }]),
		);

		// 不登记就不会被打进包，装到用户机器上时这名成员会悄悄退化成「只有职责摘要」。
		expect(listPluginManifestResources(manifest)).toContainEqual({
			field: "agent.teams.members.instructionsPath",
			path: "agent/dev.md",
			kind: "file",
		});
	});

	it("rejects a member that writes both brief forms", () => {
		expect(() =>
			parsePluginManifest(
				withTeam([leader, { role: "developer", responsibility: "x", instructions: "a", instructionsPath: "b.md" }]),
			),
		).toThrow(/at most one of "instructions" or "instructionsPath"/);
	});

	it("sends the leader's brief to the team workflow instead of the member", () => {
		// 两处都能写就没人说得清哪份生效。
		expect(() =>
			parsePluginManifest(withTeam([{ agent: "lead", responsibility: "Owns it.", instructions: "..." }])),
		).toThrow(/leader's brief belongs in the team's "workflow"/);
	});

	/**
	 * 词表里的每个角色都必须真有预置插件供货。
	 *
	 * 文档让第三方插件「放心引用」这些角色，凭据就是它们装机自带。哪天预置插件改名或者漏写
	 * `roles`，这条会在这里断掉，而不是等用户装上第三方插件后发现槽位空着。
	 */
	it("keeps every builtin role supplied by a preset plugin", () => {
		const supplied = new Set(
			["preset-agent", "vetta-ui-design"].flatMap((pluginId) => {
				const raw = readFileSync(join(repoRoot, "packages/plugins/presets", pluginId, "plugin.json"), "utf8");
				const manifest = parsePluginManifest(JSON.parse(raw));
				return (manifest.agent?.agents ?? []).flatMap((agent) => agent.roles ?? []);
			}),
		);

		expect([...BUILTIN_PLUGIN_AGENT_ROLES].filter((role) => !supplied.has(role))).toEqual([]);
	});
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginBlueprintId } from "@vetta/agent-team";
import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { buildPluginAgentPresets } from "./plugin-agent-presets.js";

function logger() {
	return { warn: vi.fn() };
}

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
	return {
		id: "vetta-ui-design",
		enabled: true,
		defaultLocale: "zh",
		locales: { zh: { "agent.designer.name": "设计师" }, en: { "agent.designer.name": "Designer" } },
		rootPath: "/plugins/vetta-ui-design",
		agent: {
			agents: [
				{
					id: "designer",
					name: "%agent.designer.name%",
					description: "画布设计",
					avatar: "agent/designer.webp",
					systemPromptPath: "agent/designer.md",
				},
			],
		},
		...overrides,
	} as unknown as InstalledPlugin;
}

const readResource = () => "You are the design specialist.";
const readBinaryResource = () => Buffer.from("fake-webp");

describe("plugin agent presets", () => {
	it("builds a blueprint whose id is namespaced by the plugin", () => {
		const { agents } = buildPluginAgentPresets({
			plugins: [plugin()],
			logger: logger(),
			readResource,
			readBinaryResource,
		});

		expect(agents).toHaveLength(1);
		const preset = agents[0]!;
		expect(preset.blueprint.id).toBe(pluginBlueprintId("vetta-ui-design", "designer"));
		expect(preset.blueprint.source).toEqual({ kind: "plugin", pluginId: "vetta-ui-design" });
		expect(preset.blueprint.systemPrompt).toBe("You are the design specialist.");
		expect(preset.blueprint.avatarUrl?.startsWith("data:image/webp;base64,")).toBe(true);
	});

	it("keeps the raw i18n placeholder on the blueprint so the renderer can follow the language", () => {
		const { agents } = buildPluginAgentPresets({
			plugins: [plugin()],
			logger: logger(),
			readResource,
			readBinaryResource,
		});

		// blueprint 上留 `%key%`，档案名落字面量——前者跟着切语言，后者是用户数据。
		expect(agents[0]?.blueprint.name).toBe("%agent.designer.name%");
		expect(agents[0]?.profileName).toBe("设计师");
	});

	it("pins its own plugin so the agent cannot be left without the ability it exists to drive", () => {
		const { agents } = buildPluginAgentPresets({
			plugins: [plugin()],
			logger: logger(),
			readResource,
			readBinaryResource,
		});

		expect(agents[0]?.blueprint.pinnedPlugins).toEqual(["vetta-ui-design"]);
	});

	it("restricts a plugin declaring `own` abilities to its own capabilities", () => {
		const source = plugin();
		const restricted = plugin({
			agent: { agents: [{ ...source.agent!.agents![0]!, abilities: "own" }] },
		} as Partial<InstalledPlugin>);

		const { agents } = buildPluginAgentPresets({
			plugins: [restricted],
			logger: logger(),
			readResource,
			readBinaryResource,
		});

		expect(agents[0]?.blueprint.defaultAbilities.selectionMode).toBe("custom");
		expect(agents[0]?.blueprint.defaultAbilities.plugins).toEqual(["vetta-ui-design"]);
	});

	it("ignores a disabled plugin so its blueprint disappears with it", () => {
		const { agents } = buildPluginAgentPresets({
			plugins: [plugin({ enabled: false })],
			logger: logger(),
			readResource,
			readBinaryResource,
		});

		expect(agents).toEqual([]);
	});

	it("skips an agent whose prompt cannot be read instead of failing the whole plugin", () => {
		const log = logger();
		const { agents } = buildPluginAgentPresets({
			plugins: [plugin()],
			logger: log,
			readResource: () => undefined,
			readBinaryResource,
		});

		expect(agents).toEqual([]);
		expect(log.warn).toHaveBeenCalled();
	});

	it("resolves builtin team members and rejects members from another plugin", () => {
		const withTeams = plugin({
			agent: {
				agents: plugin().agent!.agents,
				teams: [
					{
						id: "design-team",
						name: "设计团队",
						members: [{ agent: "designer", responsibility: "Builds the frames." }],
						workflow: "Run this team as a design loop.",
					},
					{
						id: "borrowed",
						name: "借来的团队",
						members: [{ agent: "someone-elses-agent", responsibility: "n/a" }],
					},
				],
			},
		} as Partial<InstalledPlugin>);
		const log = logger();

		const { teams } = buildPluginAgentPresets({
			plugins: [withTeams],
			logger: log,
			readResource,
			readBinaryResource,
		});

		expect(teams).toHaveLength(1);
		expect(teams[0]?.members[0]?.blueprintId).toBe(pluginBlueprintId("vetta-ui-design", "designer"));
		// 跨插件引用会让一个插件能否用取决于另一个插件装没装，直接拒掉；引用宿主角色同理，
		// 宿主压根没有内置人设。
		expect(log.warn).toHaveBeenCalled();
	});

	it("refuses an avatar path that escapes the plugin directory", () => {
		const escaping = plugin({
			agent: { agents: [{ ...plugin().agent!.agents![0]!, avatar: "../../../etc/passwd.png" }] },
		} as Partial<InstalledPlugin>);
		const log = logger();

		const { agents } = buildPluginAgentPresets({ plugins: [escaping], logger: log, readResource });

		expect(agents).toEqual([]);
		expect(log.warn).toHaveBeenCalled();
	});

	// 真实 manifest 的守卫：路径写错、提示词文件漏带、头像格式不对，都在这里断掉，
	// 而不是等用户装上插件后发现智能体压根没出现。
	describe("the shipped vetta-ui-design manifest", () => {
		const root = join(process.cwd(), "..", "..", "packages", "plugins", "presets", "vetta-ui-design");
		const manifest = JSON.parse(readFileSync(join(root, "plugin.json"), "utf-8")) as Record<string, unknown>;
		const locales = {
			zh: JSON.parse(readFileSync(join(root, "locales", "zh.json"), "utf-8")) as Record<string, string>,
			en: JSON.parse(readFileSync(join(root, "locales", "en.json"), "utf-8")) as Record<string, string>,
		};
		const installed = {
			id: "vetta-ui-design",
			enabled: true,
			defaultLocale: "zh",
			locales,
			rootPath: root,
			agent: manifest.agent,
		} as unknown as InstalledPlugin;

		it("contributes a designer backed by real files on disk", () => {
			const log = logger();
			const { agents, teams } = buildPluginAgentPresets({ plugins: [installed], logger: log });

			expect(log.warn).not.toHaveBeenCalled();
			expect(agents).toHaveLength(1);
			expect(agents[0]?.profileName).toBe("设计师");
			expect(agents[0]?.blueprint.systemPrompt).toContain("Vetta UI Design skill");
			expect(agents[0]?.blueprint.avatarUrl?.startsWith("data:image/webp;base64,")).toBe(true);

			// 宿主不再有内置角色可引用，这个插件也就不再发团队。
			expect(teams).toEqual([]);
		});
	});
});

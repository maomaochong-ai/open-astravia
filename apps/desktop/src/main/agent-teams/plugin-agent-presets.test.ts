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
		// 描述是字面量，没有 key 可存。
		expect(agents[0]?.profileTextKeys).toEqual({ nameKey: "agent.designer.name" });
	});

	it("carries the team's i18n keys alongside its default-locale literals", () => {
		const withTeam = plugin({
			locales: {
				zh: {
					"agent.designer.name": "设计师",
					"team.design.name": "设计团队",
					"team.design.description": "出界面",
				},
				en: { "agent.designer.name": "Designer", "team.design.name": "Design Team" },
			},
			agent: {
				agents: plugin().agent!.agents,
				teams: [
					{
						id: "design-team",
						name: "%team.design.name%",
						description: "%team.design.description%",
						members: [{ agent: "designer", responsibility: "Builds the frames." }],
						workflow: "Run this team as a design loop.",
					},
				],
			},
		} as Partial<InstalledPlugin>);

		const { teams } = buildPluginAgentPresets({
			plugins: [withTeam],
			logger: logger(),
			readResource,
			readBinaryResource,
		});

		expect(teams[0]?.name).toBe("设计团队");
		expect(teams[0]?.description).toBe("出界面");
		expect(teams[0]?.textKeys).toEqual({ nameKey: "team.design.name", descriptionKey: "team.design.description" });
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

	it("resolves a member of this plugin's own, and drops the team when that member is missing", () => {
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
						id: "typo",
						name: "写错了的团队",
						members: [{ agent: "desginer", responsibility: "n/a" }],
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
		// 自己插件里的实体引用解析不到就是配置写错了，整支作废才能让作者立刻发现。
		expect(log.warn).toHaveBeenCalled();
	});

	describe("cross-plugin references", () => {
		/** 供货方：只声明角色，不知道谁会引用它。 */
		function provider(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
			return {
				id: "preset-agent",
				enabled: true,
				defaultLocale: "zh",
				locales: {},
				rootPath: "/plugins/preset-agent",
				agent: {
					agents: [
						{
							id: "developer",
							name: "开发者",
							systemPrompt: "You implement the plan.",
							roles: ["developer"],
						},
					],
				},
				...overrides,
			} as unknown as InstalledPlugin;
		}

		/** 消费方：队长是自己的人，开发位是个角色槽。 */
		function consumer(member: Record<string, unknown>): InstalledPlugin {
			return plugin({
				agent: {
					agents: plugin().agent!.agents,
					teams: [
						{
							id: "design-team",
							name: "设计团队",
							members: [{ agent: "designer", responsibility: "Owns the visual result." }, member],
						},
					],
				},
			} as Partial<InstalledPlugin>);
		}

		it("fills a role slot from another plugin", () => {
			const { teams } = buildPluginAgentPresets({
				plugins: [consumer({ role: "developer", responsibility: "Implements it." }), provider()],
				logger: logger(),
				readResource,
				readBinaryResource,
			});

			expect(teams).toHaveLength(1);
			const filled = teams[0]!.members[1]!;
			expect(filled.blueprintId).toBe(pluginBlueprintId("preset-agent", "developer"));
			expect(filled.providerPluginId).toBe("preset-agent");
			expect(filled.role).toBe("developer");
			// 成员 id 由槽位推导，所以这里挂的是角色名而不是解析到的那个人。
			expect(filled.slotKey).toBe("developer");
		});

		it("resolves a provider declared after the consumer in the plugin list", () => {
			// 单趟循环时这一例会失败：消费方先解析，供货方还没进索引。
			const { teams } = buildPluginAgentPresets({
				plugins: [consumer({ agent: "preset-agent/developer", responsibility: "Implements it." }), provider()],
				logger: logger(),
				readResource,
				readBinaryResource,
			});

			expect(teams[0]?.members[1]?.blueprintId).toBe(pluginBlueprintId("preset-agent", "developer"));
		});

		it("keeps the team but drops the slot when the provider is not installed", () => {
			const log = logger();
			const { teams } = buildPluginAgentPresets({
				plugins: [consumer({ role: "developer", responsibility: "Implements it." })],
				logger: log,
				readResource,
				readBinaryResource,
			});

			// 引用别人不该拖垮自己：少一名队员，不是少一支团队。
			expect(teams).toHaveLength(1);
			expect(teams[0]?.members).toHaveLength(1);
			expect(log.warn).not.toHaveBeenCalled();
		});

		it("drops the whole team when a slot the consumer marked required is missing", () => {
			const log = logger();
			const { teams } = buildPluginAgentPresets({
				plugins: [consumer({ role: "developer", responsibility: "Implements it.", optional: false })],
				logger: log,
				readResource,
				readBinaryResource,
			});

			expect(teams).toEqual([]);
			expect(log.warn).toHaveBeenCalled();
		});

		it("loses the slot when the provider is disabled, and gets it back when re-enabled", () => {
			const args = { logger: logger(), readResource, readBinaryResource };
			const team = consumer({ role: "developer", responsibility: "Implements it." });

			const off = buildPluginAgentPresets({ plugins: [team, provider({ enabled: false })], ...args });
			expect(off.teams[0]?.members).toHaveLength(1);

			const on = buildPluginAgentPresets({ plugins: [team, provider()], ...args });
			expect(on.teams[0]?.members).toHaveLength(2);
		});

		it("picks the same provider regardless of plugin order when several offer the role", () => {
			const alt = provider({ id: "zz-other-agents", rootPath: "/plugins/zz-other-agents" });
			const team = consumer({ role: "developer", responsibility: "Implements it." });
			const args = { logger: logger(), readResource, readBinaryResource };

			// 候选按 pluginId 字典序，不按插件目录的枚举顺序——否则同一份配置在两台机器上
			// 会铺出不同的团队。
			const forward = buildPluginAgentPresets({ plugins: [team, provider(), alt], ...args });
			const reversed = buildPluginAgentPresets({ plugins: [alt, provider(), team], ...args });

			expect(forward.teams[0]?.members[1]?.providerPluginId).toBe("preset-agent");
			expect(reversed.teams[0]?.members[1]?.providerPluginId).toBe("preset-agent");
		});

		it("prefers its own agent over another plugin's for the same role", () => {
			const own = plugin({
				agent: {
					agents: [{ ...plugin().agent!.agents![0]!, roles: ["developer"] }],
					teams: [
						{
							id: "design-team",
							name: "设计团队",
							members: [
								{ agent: "designer", responsibility: "Owns the visual result." },
								{ role: "developer", responsibility: "Implements it." },
							],
						},
					],
				},
			} as Partial<InstalledPlugin>);

			const { teams } = buildPluginAgentPresets({
				plugins: [own, provider()],
				logger: logger(),
				readResource,
				readBinaryResource,
			});

			expect(teams[0]?.members[1]?.providerPluginId).toBe("vetta-ui-design");
		});

		it("gives a borrowed member a brief that lives on the consumer's team", () => {
			const { teams } = buildPluginAgentPresets({
				plugins: [
					consumer({
						role: "developer",
						responsibility: "Implements it.",
						instructions: "Ship behind a flag; never touch the router.",
					}),
					provider(),
				],
				logger: logger(),
				readResource,
				readBinaryResource,
			});

			const borrowed = teams[0]!.members[1]!;
			expect(borrowed.providerPluginId).toBe("preset-agent");
			// 任务书挂在消费方的团队上，被引用的那一方的人设一个字都没动。
			expect(borrowed.instructions).toBe("Ship behind a flag; never touch the router.");
		});

		it("reads a member brief from the consumer's own package", () => {
			const { teams } = buildPluginAgentPresets({
				plugins: [
					consumer({
						role: "developer",
						responsibility: "Implements it.",
						instructionsPath: "agent/dev-brief.md",
					}),
					provider(),
				],
				logger: logger(),
				// 任务书从声明团队的那个插件里读，不是从供货方。
				readResource: (plugin, path) =>
					plugin.id === "vetta-ui-design" && path === "agent/dev-brief.md"
						? "Follow the design tokens."
						: readResource(),
				readBinaryResource,
			});

			expect(teams[0]?.members[1]?.instructions).toBe("Follow the design tokens.");
		});

		it("drops a team whose member brief file is missing rather than shipping it silently truncated", () => {
			const log = logger();
			const { teams } = buildPluginAgentPresets({
				plugins: [
					consumer({ role: "developer", responsibility: "Implements it.", instructionsPath: "agent/gone.md" }),
					provider(),
				],
				logger: log,
				readResource: (_plugin, path) => (path === "agent/gone.md" ? undefined : "prompt"),
				readBinaryResource,
			});

			expect(teams).toEqual([]);
			expect(log.warn).toHaveBeenCalled();
		});

		it("refuses a team whose leader resolves to another plugin", () => {
			const headless = plugin({
				agent: {
					agents: plugin().agent!.agents,
					teams: [
						{
							id: "headless",
							name: "无头团队",
							members: [{ agent: "preset-agent/developer", responsibility: "Leads it." }],
						},
					],
				},
			} as Partial<InstalledPlugin>);
			const log = logger();

			const { teams } = buildPluginAgentPresets({
				plugins: [headless, provider()],
				logger: log,
				readResource,
				readBinaryResource,
			});

			// 队长是用户唯一的对话入口：让它落在别的插件上，那个插件一卸载团队就成了打不开的壳。
			expect(teams).toEqual([]);
			expect(log.warn).toHaveBeenCalled();
		});
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

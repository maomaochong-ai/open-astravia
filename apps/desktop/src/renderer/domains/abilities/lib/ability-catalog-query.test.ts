import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { PluginAbility, SkillAbility } from "../types";
import { queryAbilityCatalog } from "./ability-catalog-query";
import { buildMcpAbilities } from "./build-ability-items";

function ability(index: number, overrides: Partial<SkillAbility> = {}): SkillAbility {
	const slug = `ability-${String(index).padStart(3, "0")}`;
	return {
		id: `skill:${slug}`,
		slug,
		type: "skill",
		catalogSource: { kind: "server", id: "server" },
		title: `Ability ${String(index).padStart(3, "0")}`,
		description: "",
		category: "General",
		tags: [],
		author: "",
		license: "MIT",
		version: "1.0.0",
		installed: false,
		enabled: false,
		readonly: false,
		needsUpdate: false,
		setupRequired: false,
		busy: false,
		downloadCount: 0,
		isCustom: false,
		isBuiltin: false,
		fromMarket: true,
		searchTerms: [slug, `keyword-${index}`],
		...overrides,
	};
}

function pluginAbility(index: number, overrides: Partial<PluginAbility> = {}): PluginAbility {
	const slug = `plugin-${String(index).padStart(3, "0")}`;
	return {
		id: `plugin:${slug}`,
		slug,
		type: "plugin",
		catalogSource: { kind: "server", id: "server" },
		title: `Plugin ${String(index).padStart(3, "0")}`,
		description: "",
		category: "General",
		tags: [],
		author: "",
		license: "MIT",
		version: "1.0.0",
		installed: false,
		enabled: false,
		readonly: false,
		needsUpdate: false,
		setupRequired: false,
		busy: false,
		downloadCount: 0,
		isCustom: false,
		isBuiltin: false,
		fromMarket: true,
		searchTerms: [slug],
		plugin: null,
		permissions: [],
		grantedPermissions: [],
		commands: [],
		grantedCommands: [],
		...overrides,
	};
}

describe("queryAbilityCatalog", () => {
	it("paginates the in-memory catalog without changing the source", () => {
		const items = Array.from({ length: 125 }, (_, index) => ability(index));

		const page = queryAbilityCatalog(items, { scope: "discover", page: 2, pageSize: 60 });

		expect(page).toMatchObject({ total: 125, page: 2, pageSize: 60, pageCount: 3 });
		expect(page.items).toHaveLength(60);
		expect(page.items[0]?.slug).toBe("ability-060");
	});

	it("returns every builtin ability in discover regardless of the page window", () => {
		const market = Array.from({ length: 80 }, (_, index) =>
			ability(index, { downloadCount: 1000 - index, installed: true }),
		);
		const builtin = Array.from({ length: 12 }, (_, index) =>
			ability(500 + index, {
				category: "",
				catalogSource: { kind: "builtin", id: "builtin" },
				isBuiltin: true,
				fromMarket: false,
				installed: true,
			}),
		);

		const page = queryAbilityCatalog([...market, ...builtin], { scope: "discover", page: 1, pageSize: 60 });

		expect(page.total).toBe(92);
		expect(page.items.filter((item) => item.isBuiltin)).toHaveLength(12);
		expect(page.items.filter((item) => !item.isBuiltin)).toHaveLength(60);
	});

	it("limits personal scope to universal skills and manually installed abilities, excluding market abilities and builtins", () => {
		const installedMarket = ability(1, { installed: true, title: "A Installed Market", fromMarket: true });
		const uninstalledMarket = ability(2, { installed: false, title: "B Uninstalled Market", fromMarket: true });
		const genericAgentSkill = ability(3, {
			installed: true,
			isBuiltin: false,
			fromMarket: false,
			skillSource: "agents-user",
			catalogSource: { kind: "local", id: "local" },
			title: "C Generic Agent Skill",
		});
		const customImportedSkill = ability(4, {
			installed: true,
			isBuiltin: false,
			isCustom: true,
			fromMarket: false,
			catalogSource: { kind: "local", id: "local" },
			title: "D Custom Imported Skill",
		});
		const builtinSkill = ability(5, {
			installed: true,
			isBuiltin: true,
			fromMarket: false,
			catalogSource: { kind: "builtin", id: "builtin" },
			title: "E Builtin Skill",
		});
		const manualPlugin = pluginAbility(6, {
			title: "F Manual Plugin",
			fromMarket: false,
			installed: true,
			isCustom: true,
			isBuiltin: false,
			catalogSource: { kind: "server", id: "server" },
			plugin: {
				id: "manual-plugin",
				name: "Manual Plugin",
				version: "1.0.0",
				activeVersion: "1.0.0",
				source: "archive",
			} as unknown as PluginAbility["plugin"],
		});
		const marketPlugin = pluginAbility(7, {
			title: "G Market Plugin",
			fromMarket: true,
			installed: true,
			isCustom: false,
			isBuiltin: false,
			catalogSource: {
				kind: "github",
				id: "official",
				name: "Official",
				repository: "https://github.com/example/official",
			},
			plugin: {
				id: "market-plugin",
				name: "Market Plugin",
				version: "1.0.0",
				activeVersion: "1.0.0",
				source: "remote",
			} as unknown as PluginAbility["plugin"],
		});

		const allAbilities = [
			installedMarket,
			uninstalledMarket,
			genericAgentSkill,
			customImportedSkill,
			builtinSkill,
			manualPlugin,
			marketPlugin,
		];

		const personalPage = queryAbilityCatalog(allAbilities, { scope: "mine", page: 1, pageSize: 60 });

		// 个人：只展示通用 skill 和手动安装的能力（含本地插件、自定义 skill，排除市场能力与内置能力）
		expect(personalPage.items.map((item) => item.id)).toEqual([
			genericAgentSkill.id,
			customImportedSkill.id,
			manualPlugin.id,
		]);

		const publicPage = queryAbilityCatalog(allAbilities, { scope: "discover", page: 1, pageSize: 60 });

		// 公开：展示市场能力（不论是否已安装）与 Vetta 内置能力，排除本地未上架的个人技能与手动插件
		expect(publicPage.items.map((item) => item.id)).toEqual([
			installedMarket.id,
			uninstalledMarket.id,
			marketPlugin.id,
			builtinSkill.id,
		]);
	});

	it("filters locally by keyword, category, type and source", () => {
		const github = ability(1, {
			category: "Design",
			catalogSource: {
				kind: "github",
				id: "community",
				name: "Community",
				repository: "https://github.com/example/community",
			},
			origin: {
				kind: "github-marketplace",
				sourceId: "community",
				marketplace: "community",
				marketplaceVersion: "1.0.0",
				repository: "https://github.com/example/community",
			},
		});
		const server = ability(2, { category: "Design" });

		const page = queryAbilityCatalog([server, github], {
			scope: "discover",
			keyword: "keyword-1",
			category: "Design",
			types: ["skill"],
			sourceIds: ["community"],
			page: 1,
			pageSize: 60,
		});

		expect(page.items.map((item) => item.id)).toEqual([github.id]);
	});

	it("sorts deterministically and limits mine to installed personal abilities", () => {
		const second = ability(2, {
			installed: true,
			title: "Same",
			fromMarket: false,
			catalogSource: { kind: "local", id: "local" },
			isCustom: true,
		});
		const first = ability(1, {
			installed: true,
			title: "Same",
			fromMarket: false,
			catalogSource: { kind: "local", id: "local" },
			isCustom: true,
		});

		const page = queryAbilityCatalog([second, ability(3), first], {
			scope: "mine",
			page: 1,
			pageSize: 60,
		});

		expect(page.items.map((item) => item.id)).toEqual([first.id, second.id]);
	});

	it("does not synthesize retired built-in MCP entries in discover", () => {
		const t = ((key: string) => key) as unknown as TFunction<"settings">;
		const presets = buildMcpAbilities(
			[],
			{
				ledger: {},
				skillManifest: {},
				localSkills: [],
				plugins: [],
				mcpConfig: { mcpServers: {} },
				oauthAuthByName: {},
				mcpSetupStatus: {},
				busyIds: new Set<string>(),
			},
			t,
		);

		const page = queryAbilityCatalog(presets, { scope: "discover", page: 1, pageSize: 60 });

		expect(page.items).toEqual([]);
	});

	it("keeps discover ordering stable when installation state changes", () => {
		const popular = ability(1, { downloadCount: 100 });
		const other = ability(2, { downloadCount: 10, installed: true, needsUpdate: true, setupRequired: true });

		const before = queryAbilityCatalog([other, popular], { scope: "discover", page: 1, pageSize: 60 });
		const after = queryAbilityCatalog(
			[
				{ ...other, installed: false, needsUpdate: false, setupRequired: false },
				{ ...popular, installed: true },
			],
			{ scope: "discover", page: 1, pageSize: 60 },
		);

		expect(before.items.map((item) => item.id)).toEqual([popular.id, other.id]);
		expect(after.items.map((item) => item.id)).toEqual([popular.id, other.id]);
	});
});

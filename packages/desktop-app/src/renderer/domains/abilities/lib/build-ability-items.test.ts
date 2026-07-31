import type { InstalledPlugin } from "@preload/api";
import type { AbilityMember, MarketAbility } from "@shared/lib/api";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { buildBuiltinMcpServerConfig } from "../../settings/mcp/builtin-mcp-presets";
import type { AbilityItem, McpAbility } from "../types";
import {
	buildBundleAbilities,
	buildMcpAbilities,
	buildPluginAbilities,
	buildSkillAbilities,
	type LocalAbilityState,
	type PluginTextResolver,
} from "./build-ability-items";

const t = ((key: string) => key) as unknown as TFunction<"settings">;

function createState(overrides?: Partial<LocalAbilityState>): LocalAbilityState {
	return {
		ledger: {},
		skillManifest: {},
		localSkills: [],
		plugins: [],
		mcpConfig: { mcpServers: {} },
		oauthAuthByName: {},
		busyIds: new Set<string>(),
		...overrides,
	};
}

function createBundle(members: AbilityMember[]): MarketAbility {
	return {
		slug: "design-kit",
		type: "bundle",
		name: "Design Kit",
		description: "",
		license: "",
		version: "1.0.0",
		author: "",
		icon: "",
		category: "",
		tags: [],
		sha256: "",
		download_count: 0,
		config: { members },
		detail: {},
		updated_at: "",
	};
}

function member(overrides: Partial<AbilityMember> & Pick<AbilityMember, "type" | "slug">): AbilityMember {
	return { exists: true, name: "", icon: "", version: "", ...overrides };
}

/** id 必须与 buildMarketAbilityId 一致（`kind:sourceId:type:slug`），否则 bundle 成员认领不到。 */
function installedSkill(slug: string): AbilityItem {
	return {
		type: "skill",
		id: `server:server:skill:${slug}`,
		slug,
		catalogSource: { kind: "server", id: "server" },
		title: slug,
		description: "",
		category: "",
		tags: [],
		author: "",
		license: "",
		version: "1.0.0",
		installed: true,
		enabled: true,
		readonly: false,
		needsUpdate: false,
		setupRequired: false,
		busy: false,
		downloadCount: 0,
		isCustom: false,
		isBuiltin: false,
		fromMarket: true,
		searchTerms: [],
	};
}

/**
 * 复刻 usePluginTextResolver 的解析语义，且**注册表为空**——这正是插件已安装但尚未
 * 启用（或加载失败）时的真实状态：注册表只收录已加载的插件。
 */
const trPlugin: PluginTextResolver = (_pluginId, raw, catalog) => {
	if (raw == null) return "";
	const key = /^%(.+)%$/.exec(raw)?.[1];
	if (!key) return raw;
	const locales = catalog?.locales ?? {};
	return locales[catalog?.defaultLocale ?? "zh"]?.[key] ?? key;
};

function installedPlugin(overrides?: Partial<InstalledPlugin>): InstalledPlugin {
	return {
		id: "cowart-vetta",
		name: "%plugin.name%",
		description: "%plugin.description%",
		version: "0.1.7",
		activeVersion: "0.1.7",
		pluginApiVersion: "^1.0.0",
		runtime: "module-federation",
		entryUrl: "vetta-plugin://cowart-vetta/mf-manifest.json",
		styleUrls: [],
		permissions: [],
		grantedPermissions: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "zh",
		locales: { zh: { "plugin.name": "Cowart 画布", "plugin.description": "无限画布能力包" } },
		enabled: false,
		required: false,
		installedAt: "",
		updatedAt: "",
		source: "remote",
		trustLevel: "community",
		rootPath: "",
		...overrides,
	};
}

describe("buildPluginAbilities", () => {
	it("resolves manifest NLS placeholders from the plugin's own catalog when it is installed but not enabled", () => {
		const items = buildPluginAbilities([], createState({ plugins: [installedPlugin()] }), trPlugin);

		expect(items[0]?.title).toBe("Cowart 画布");
		expect(items[0]?.description).toBe("无限画布能力包");
	});

	it("preserves GitHub marketplace origin for open plugin installation", () => {
		const ability = {
			...createBundle([]),
			type: "plugin" as const,
			slug: "open-plugin",
			origin: {
				kind: "github-marketplace" as const,
				sourceId: "test-source",
				marketplace: "vetta-open-abilities",
				marketplaceVersion: "2026.07.3",
				repository: "https://github.com/example/vetta-abilities",
			},
		};

		const items = buildPluginAbilities([ability], createState(), trPlugin);

		expect(items[0]?.origin).toEqual(ability.origin);
	});
});

describe("buildSkillAbilities", () => {
	it("preserves GitHub marketplace origin for install routing", () => {
		const ability = {
			...createBundle([]),
			type: "skill" as const,
			slug: "open-skill",
			origin: {
				kind: "github-marketplace" as const,
				marketplace: "vetta-open-abilities",
				marketplaceVersion: "2026.07.1",
				repository: "https://github.com/example/vetta-abilities",
			},
		};

		const items = buildSkillAbilities([ability], createState());

		expect(items[0]?.origin).toEqual(ability.origin);
	});

	it("only marks app-shipped skills as builtin", () => {
		const items = buildSkillAbilities(
			[],
			createState({
				localSkills: [
					{ name: "pdf", description: "", source: "builtin", type: "skill" },
					{ name: "my-skill", description: "", source: "user", type: "skill" },
					{ name: "from-plugin", description: "", source: "plugin", type: "skill" },
				],
			}),
		);

		expect(items.map((item) => [item.slug, item.isBuiltin, item.catalogSource.kind])).toEqual([
			["pdf", true, "builtin"],
			["my-skill", false, "local"],
			["from-plugin", false, "local"],
		]);
	});

	it("gives app-shipped skills their bundled icon, and only them", () => {
		const items = buildSkillAbilities(
			[],
			createState({
				localSkills: [
					{ name: "create-skill", description: "", source: "builtin", type: "skill" },
					// 同名但用户来源：不能借用内置图标。
					{ name: "publish-ability", description: "", source: "user", type: "skill" },
					{ name: "pdf", description: "", source: "builtin", type: "skill" },
				],
			}),
		);

		expect(items.map((item) => item.icon)).toEqual(["./skills/create-skill.png", undefined, undefined]);
	});

	it("does not duplicate an installed skill that listSkills also reports", () => {
		const market = { ...createBundle([]), type: "skill" as const, slug: "translator" };
		const items = buildSkillAbilities(
			[market],
			createState({
				skillManifest: {
					translator: {
						name: "translator",
						source: "market",
						enabled: true,
						version: "1.0.0",
						type: "skill",
						installedAt: "2026-07-31T00:00:00.000Z",
					},
				},
				localSkills: [{ name: "translator", description: "", source: "market", type: "skill" }],
			}),
		);

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ slug: "translator", installed: true, isBuiltin: false });
	});
});

describe("buildMcpAbilities", () => {
	it("preserves GitHub marketplace origin for ledger recording", () => {
		const ability = {
			...createBundle([]),
			type: "mcp" as const,
			slug: "context7",
			name: "Context7",
			config: {
				mcp: { type: "http", url: "https://mcp.context7.com/mcp" },
				mcp_parameters: [
					{
						key: "CONTEXT7_API_KEY",
						label: "Context7 API Key",
						required: false,
						secret: true,
					},
				],
			},
			origin: {
				kind: "github-marketplace" as const,
				sourceId: "test-source",
				marketplace: "vetta-open-abilities",
				marketplaceVersion: "2026.07.3",
				repository: "https://github.com/example/vetta-abilities",
			},
		};

		const items = buildMcpAbilities([ability], createState(), t);

		const item = items.find((candidate) => candidate.slug === "context7");
		expect(item?.origin).toEqual(ability.origin);
		expect(item?.preset).toMatchObject({
			name: "context7",
			displayName: "Context7",
			secrets: [{ envKey: "CONTEXT7_API_KEY", label: "Context7 API Key", required: false, secret: true }],
		});
		if (!item?.preset) throw new Error("Marketplace MCP install preset is missing");
		expect(
			buildBuiltinMcpServerConfig(
				item.preset,
				{ displayName: item.title, description: item.description },
				{
					CONTEXT7_API_KEY: "demo-key",
				},
			),
		).toMatchObject({
			type: "http",
			headers: { CONTEXT7_API_KEY: "demo-key" },
		});
	});

	it("creates an OAuth preset for a parameterless marketplace MCP", () => {
		const ability = {
			...createBundle([]),
			type: "mcp" as const,
			slug: "notion",
			name: "Notion",
			config: {
				mcp: { type: "http", url: "https://mcp.notion.com/mcp" },
				mcp_browser_auth: true,
				mcp_parameters: [],
			},
		};

		// 同 slug 的内置预设也在列表里（且排在前面），必须按 catalogId 取市场那一条
		const item = buildMcpAbilities([ability], createState(), t).find(
			(candidate) => candidate.id === "server:server:mcp:notion",
		);

		// 与内置 notion 预设撞名，运行时 key 会被限定为 `notion--<hash>`
		expect(item?.serverName).toMatch(/^notion--[a-f0-9]{8}$/);
		expect(item?.preset).toMatchObject({
			name: item?.serverName,
			browserAuth: true,
			secrets: [],
		});
		expect(item?.setupRequired).toBe(false);
	});

	it("keeps a built-in MCP and a same-slug GitHub MCP as separate catalog entries", () => {
		const ability = {
			...createBundle([]),
			type: "mcp" as const,
			slug: "github",
			name: "GitHub",
			config: {
				mcp: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
			},
			origin: {
				kind: "github-marketplace" as const,
				sourceId: "test-source",
				marketplace: "vetta-open-abilities",
				marketplaceVersion: "2026.07.3",
				repository: "https://github.com/example/vetta-abilities",
			},
			catalogSource: {
				kind: "github" as const,
				id: "test-source",
				name: "Test source",
				repository: "https://github.com/example/vetta-abilities",
			},
		};
		const state = createState({
			mcpConfig: {
				mcpServers: {
					github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
				},
			},
		});

		const items = buildMcpAbilities([ability], state, t);
		const builtin = items.find((item) => item.id === "builtin:builtin:mcp:github");
		const github = items.find((item) => item.id === "github:test-source:mcp:github");

		expect(builtin).toMatchObject({ installed: true, serverName: "github" });
		expect(github).toMatchObject({ installed: false });
		expect(github?.serverName).toMatch(/^github--[a-f0-9]{8}$/);
		expect(github?.serverName).not.toContain("_");
	});
});

describe("buildBundleAbilities", () => {
	it("synthesizes an item for a private inline mcp member so it can be installed", () => {
		const members = [
			member({ type: "skill", slug: "figma-ui" }),
			member({
				type: "mcp",
				slug: "my-private-mcp",
				name: "Private MCP",
				exists: false,
				inline: { type: "http", url: "https://mcp.example.com" },
			}),
		];
		const bundles = buildBundleAbilities([createBundle(members)], [installedSkill("figma-ui")], createState(), t);

		const bundle = bundles[0];
		expect(bundle?.memberItems).toHaveLength(2);
		const inlineItem = bundle?.memberItems.find((item): item is McpAbility => item.type === "mcp");
		expect(inlineItem?.inlineConfig).toEqual({ type: "http", url: "https://mcp.example.com" });
		expect(inlineItem?.installed).toBe(false);
		// 内联成员未写入 mcp.json 前，整包不能显示为已安装
		expect(bundle?.installed).toBe(false);
	});

	it("treats an unresolvable member as unsatisfied instead of reporting the bundle installed", () => {
		const members = [member({ type: "skill", slug: "figma-ui" }), member({ type: "skill", slug: "delisted" })];
		const bundles = buildBundleAbilities([createBundle(members)], [installedSkill("figma-ui")], createState(), t);

		expect(bundles[0]?.memberItems).toHaveLength(1);
		expect(bundles[0]?.installed).toBe(false);
	});

	it("reports installed once every declared member is installed", () => {
		const members = [member({ type: "skill", slug: "figma-ui" })];
		const bundles = buildBundleAbilities([createBundle(members)], [installedSkill("figma-ui")], createState(), t);

		expect(bundles[0]?.installed).toBe(true);
		expect(bundles[0]?.enabled).toBe(true);
	});
});

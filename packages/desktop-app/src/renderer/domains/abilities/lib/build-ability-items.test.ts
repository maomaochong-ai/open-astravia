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

function installedSkill(slug: string): AbilityItem {
	return {
		type: "skill",
		id: `skill:${slug}`,
		slug,
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

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
		mcpSetupStatus: {},
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
		entryUrl: "vetta-plugin://cowart-vetta/mf-manifest.json",
		moduleFederation: { remoteName: "cowart_vetta", expose: "./plugin" },
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
		allowedNetworkHosts: overrides?.allowedNetworkHosts ?? [],
		allowedBrowserHosts: overrides?.allowedBrowserHosts ?? [],
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

	it("uses host plugin icon for plugin-contributed skills", () => {
		const pluginIcon = "vetta-plugin://vetta-ui-design/versions/0.1.0/icon.png?v=0.1.0";
		const items = buildSkillAbilities(
			[],
			createState({
				localSkills: [
					{
						name: "vetta-ui-design",
						description: "",
						source: "plugin",
						type: "skill",
						icon: pluginIcon,
					},
				],
			}),
		);

		expect(items[0]?.icon).toBe(pluginIcon);
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

		const item = buildMcpAbilities([ability], createState(), t).find(
			(candidate) => candidate.id === "server:server:mcp:notion",
		);

		expect(item?.serverName).toBe("notion");
		expect(item?.preset).toMatchObject({
			name: item?.serverName,
			browserAuth: true,
			secrets: [],
		});
		expect(item?.setupRequired).toBe(false);
	});

	it("keeps a declared post-install step pending until the marketplace reports it complete", () => {
		const ability = {
			...createBundle([]),
			type: "mcp" as const,
			slug: "xiaohongshu-mcp",
			name: "小红书",
			config: {
				mcp: { command: "/runtime/xhs", args: ["-transport=stdio"] },
				mcp_parameters: [{ key: "XHS_PROXY", label: "Proxy URL", required: false, secret: false }],
				mcp_setup: { kind: "http-qrcode" as const },
			},
			origin: {
				kind: "github-marketplace" as const,
				sourceId: "official",
				marketplace: "vetta-open-abilities",
				marketplaceVersion: "2026.09.1",
				repository: "https://github.com/example/vetta-abilities",
			},
			catalogSource: {
				kind: "github" as const,
				id: "official",
				name: "official",
				repository: "https://github.com/example/vetta-abilities",
			},
		} as unknown as MarketAbility;
		const installed = {
			mcpConfig: { mcpServers: { "xiaohongshu-mcp": { command: "/runtime/xhs" } } },
			ledger: {
				"mcp:xiaohongshu-mcp": {
					version: "2.5.0",
					installedAt: "2026-01-01T00:00:00.000Z",
					catalogId: "github:official:mcp:xiaohongshu-mcp",
					runtimeName: "xiaohongshu-mcp",
				},
			},
		} as unknown as Partial<LocalAbilityState>;

		const pending = buildMcpAbilities([ability], createState(installed), t)[0];
		expect(pending?.postInstallSetup).toEqual({ kind: "http-qrcode" });
		expect(pending?.setupRequired).toBe(true);

		const done = buildMcpAbilities(
			[ability],
			createState({ ...installed, mcpSetupStatus: { "official:xiaohongshu-mcp": true } }),
			t,
		)[0];
		expect(done?.setupRequired).toBe(false);
	});

	it("配置版本前进时即便能力版本不变也提示更新", () => {
		const ability = {
			...createBundle([]),
			type: "mcp" as const,
			slug: "demo-mcp",
			name: "Demo",
			version: "2.5.0",
			configVersion: 3,
			config: { mcp: { command: "/runtime/demo" }, mcp_parameters: [] },
			catalogSource: { kind: "github" as const, id: "official", name: "official" },
		} as unknown as MarketAbility;
		const state = (configVersion: number): LocalAbilityState =>
			createState({
				mcpConfig: { mcpServers: { "demo-mcp": { command: "/runtime/demo" } } },
				ledger: {
					"mcp:demo-mcp": {
						version: "2.5.0",
						installedAt: "2026-01-01T00:00:00.000Z",
						catalogId: "github:official:mcp:demo-mcp",
						runtimeName: "demo-mcp",
						configVersion,
					},
				} as unknown as LocalAbilityState["ledger"],
			});

		// 装的时候是 configVersion 2，市场已经是 3：命令行写法变了，必须重写
		expect(buildMcpAbilities([ability], state(2), t)[0]?.needsUpdate).toBe(true);
		expect(buildMcpAbilities([ability], state(3), t)[0]?.needsUpdate).toBe(false);
	});

	it("applies a valueTemplate to an HTTP header secret", () => {
		const preset = {
			id: "x-api-mcp",
			name: "x-api-mcp",
			displayName: "X API MCP",
			description: "",
			config: { type: "http" as const, url: "https://api.x.com/mcp" },
			secrets: [
				{
					envKey: "Authorization",
					label: "X App-only Bearer Token",
					required: true,
					secret: true,
					valueTemplate: "Bearer {value}",
				},
			],
		};

		expect(
			buildBuiltinMcpServerConfig(
				preset,
				{ displayName: "X API MCP", description: "" },
				{
					Authorization: "token",
				},
			),
		).toMatchObject({
			type: "http",
			headers: { Authorization: "Bearer token" },
		});
	});

	it("keeps a same-name custom MCP separate from a marketplace MCP", () => {
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
		const local = items.find((item) => item.id === "local:local:mcp:github");
		const github = items.find((item) => item.id === "github:test-source:mcp:github");

		expect(local).toMatchObject({ installed: true, serverName: "github" });
		expect(github).toMatchObject({ installed: false });
		expect(github?.serverName).toBe("github-2");
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

import { describe, expect, it } from "vitest";
import { buildAgentCapabilityOptions } from "./capability-options";

describe("agent capability options", () => {
	it("combines installed skills, MCP servers, and plugins without changing global state", () => {
		const options = buildAgentCapabilityOptions({
			skills: [
				{ name: "research", alias: "Research", description: "Find evidence", source: "builtin", type: "skill" },
			],
			skillManifest: {
				research: { name: "research", version: "1", installedAt: "2026-01-01", source: "market", enabled: false },
			},
			mcpConfig: {
				mcpServers: {
					notion: { type: "http", url: "https://example.test/mcp", disabled: true },
				},
			},
			plugins: [
				{
					id: "writer",
					name: "Writer",
					version: "1",
					activeVersion: "1",
					pluginApiVersion: "2.0.0",
					entryUrl: "",
					moduleFederation: { remoteName: "writer", expose: "./index" },
					styleUrls: [],
					permissions: [],
					grantedPermissions: [],
					allowedNetworkHosts: [],
					allowedBrowserHosts: [],
					declaredCommands: [],
					grantedCommandNames: [],
					locales: {},
					defaultLocale: "en",
					enabled: true,
					required: false,
					installedAt: "2026-01-01",
					updatedAt: "2026-01-01",
					source: "system",
					trustLevel: "official",
					rootPath: "C:/plugins/writer",
				},
			],
		});

		expect(options.map((option) => option.id)).toEqual(["notion", "research", "writer"]);
		expect(options.find((option) => option.id === "research")?.enabledGlobally).toBe(false);
		expect(options.find((option) => option.id === "notion")?.kind).toBe("mcp");
	});

	it("resolves plugin manifest placeholders and preserves skill provenance", () => {
		const options = buildAgentCapabilityOptions({
			skills: [
				{
					name: "create-content-campaign",
					description: "Campaign skill",
					source: "plugin",
					sourcePluginId: "content-creation",
					type: "skill",
				},
			],
			skillManifest: {
				"create-content-campaign": {
					name: "create-content-campaign",
					version: "1",
					installedAt: "2026-01-01",
					source: "market",
					enabled: false,
				},
			},
			mcpConfig: { mcpServers: {} },
			plugins: [
				{
					id: "content-creation",
					name: "%plugin.name%",
					version: "1",
					activeVersion: "1",
					pluginApiVersion: "2.0.0",
					entryUrl: "",
					moduleFederation: { remoteName: "content_creation", expose: "./plugin" },
					styleUrls: [],
					permissions: [],
					grantedPermissions: [],
					allowedNetworkHosts: [],
					allowedBrowserHosts: [],
					declaredCommands: [],
					grantedCommandNames: [],
					locales: { zh: { "plugin.name": "内容创作" } },
					defaultLocale: "zh",
					enabled: true,
					required: false,
					installedAt: "2026-01-01",
					updatedAt: "2026-01-01",
					source: "system",
					trustLevel: "official",
					rootPath: "C:/plugins/content-creation",
				},
			],
			locale: "zh",
		});
		expect(options.find((option) => option.kind === "plugin")?.title).toBe("内容创作");
		expect(options.find((option) => option.kind === "skill")?.sourcePluginId).toBe("content-creation");
		expect(options.find((option) => option.kind === "skill")?.sourceName).toBe("内容创作");
		expect(options.find((option) => option.kind === "skill")?.enabledGlobally).toBe(true);
		expect(options.find((option) => option.kind === "skill")?.visibleInAgentConfiguration).toBe(false);
	});

	it("uses a visible skill's product name without changing its stable id", () => {
		const [option] = buildAgentCapabilityOptions({
			skills: [
				{
					name: "vetta-ui-design",
					alias: "Internal alias",
					description: "Internal description",
					source: "plugin",
					type: "skill",
					presentation: {
						defaultVisibility: "visible",
						displayName: "Vetta 设计",
						displayDescription: "设计产品界面",
					},
				},
			],
			skillManifest: {},
			mcpConfig: { mcpServers: {} },
			plugins: [],
		});

		expect(option).toMatchObject({
			id: "vetta-ui-design",
			title: "Vetta 设计",
			description: "设计产品界面",
			visibleInAgentConfiguration: true,
		});
	});

	it("falls back to the plugin id when its name catalog is unavailable", () => {
		const plugin = {
			id: "missing-catalog",
			name: "%plugin.name%",
			version: "1",
			activeVersion: "1",
			pluginApiVersion: "2.0.0",
			entryUrl: "",
			moduleFederation: { remoteName: "missing_catalog", expose: "./plugin" },
			styleUrls: [],
			permissions: [],
			grantedPermissions: [],
			allowedNetworkHosts: [],
			allowedBrowserHosts: [],
			declaredCommands: [],
			grantedCommandNames: [],
			locales: {},
			defaultLocale: "zh",
			enabled: true,
			required: false,
			installedAt: "2026-01-01",
			updatedAt: "2026-01-01",
			source: "system" as const,
			trustLevel: "official" as const,
			rootPath: "C:/plugins/missing-catalog",
		};
		const options = buildAgentCapabilityOptions({
			skills: [],
			skillManifest: {},
			mcpConfig: { mcpServers: {} },
			plugins: [plugin],
			locale: "zh",
		});
		expect(options[0]?.title).toBe("missing-catalog");
	});
});

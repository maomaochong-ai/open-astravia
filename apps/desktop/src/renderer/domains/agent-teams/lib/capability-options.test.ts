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
					pluginApiVersion: "1",
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
});

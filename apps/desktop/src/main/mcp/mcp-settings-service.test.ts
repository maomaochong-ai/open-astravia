import { describe, expect, it, vi } from "vitest";
import type { McpConfigData } from "../../preload/api-types/mcp.js";
import { McpSettingsService } from "./mcp-settings-service.js";

function createConfig(): McpConfigData {
	return {
		mcpServers: {
			web: {
				type: "http",
				url: "https://mcp.example.com",
				headers: { Authorization: "Bearer secret", "X-Region": "us" },
				oauthClientId: "public-client",
			},
			local: {
				command: "node",
				args: ["server.js"],
				env: { API_KEY: "secret", REGION: "us" },
			},
		},
	};
}

describe("McpSettingsService", () => {
	it("returns redacted server details without exposing secrets", async () => {
		const service = new McpSettingsService({
			readConfig: async () => createConfig(),
			writeConfig: vi.fn(),
		});

		await expect(service.get("web")).resolves.toEqual({
			name: "web",
			type: "http",
			url: "https://mcp.example.com",
			headers: { Authorization: "***", "X-Region": "us" },
			disabled: false,
		});
		await expect(service.get("local")).resolves.toEqual({
			name: "local",
			type: "stdio",
			command: "node",
			args: ["server.js"],
			env: { API_KEY: "***", REGION: "us" },
			disabled: false,
		});
	});

	it("updates one server while preserving internal OAuth fields", async () => {
		let config = createConfig();
		const writeConfig = vi.fn<(next: McpConfigData) => Promise<void>>(async (next) => {
			config = next;
		});
		const service = new McpSettingsService({
			readConfig: async () => config,
			writeConfig,
		});

		await expect(
			service.upsert("web", {
				type: "http",
				headers: { Authorization: "Bearer next" },
				disabled: true,
			}),
		).resolves.toEqual({
			name: "web",
			type: "http",
			url: "https://mcp.example.com",
			headers: { Authorization: "***" },
			disabled: true,
		});
		expect(writeConfig).toHaveBeenCalledWith({
			mcpServers: {
				web: {
					type: "http",
					url: "https://mcp.example.com",
					headers: { Authorization: "Bearer next" },
					oauthClientId: "public-client",
					disabled: true,
				},
				local: {
					command: "node",
					args: ["server.js"],
					env: { API_KEY: "secret", REGION: "us" },
				},
			},
		});
	});

	it("serializes enabled-state changes and removal", async () => {
		let config = createConfig();
		const service = new McpSettingsService({
			readConfig: async () => config,
			writeConfig: async (next) => {
				config = next;
			},
		});

		await service.setEnabled("local", false);
		await service.remove("web");

		expect(config).toEqual({
			mcpServers: {
				local: {
					command: "node",
					args: ["server.js"],
					env: { API_KEY: "secret", REGION: "us" },
					disabled: true,
				},
			},
		});
	});
});

import { describe, expect, it } from "vitest";
import { validateMcpConfig } from "./mcp-config-validation";

describe("validateMcpConfig managed runtime environment", () => {
	it("accepts string overrides only for a managed HTTP runtime", () => {
		expect(
			validateMcpConfig({
				mcpServers: {
					xiaohongshu: {
						type: "http",
						url: "http://127.0.0.1/mcp",
						managedRuntimeId: "xiaohongshu-runtime",
						managedRuntimeEnv: { XHS_PROXY: "http://127.0.0.1:7890" },
					},
				},
			}),
		).toMatchObject({
			mcpServers: {
				xiaohongshu: { managedRuntimeEnv: { XHS_PROXY: "http://127.0.0.1:7890" } },
			},
		});
	});

	it("rejects runtime environment overrides on an ordinary remote HTTP server", () => {
		expect(() =>
			validateMcpConfig({
				mcpServers: {
					remote: {
						type: "http",
						url: "https://example.com/mcp",
						managedRuntimeEnv: { TOKEN: "secret" },
					},
				},
			}),
		).toThrow(/managedRuntimeEnv/);
	});
});

import type { McpServerConfig } from "@vetta/runtime-mcp";
import { describe, expect, it } from "vitest";
import { resolveDesktopMcpServerResourceScope } from "./mcp-resource-scope.js";

describe("resolveDesktopMcpServerResourceScope", () => {
	it("keeps project config workspace-scoped even when it asks for application scope", () => {
		const config = { command: "server", resourceScope: "application" } as McpServerConfig;
		expect(resolveDesktopMcpServerResourceScope("project", config)).toBe("workspace");
	});

	it("shares global config that has no project dependency", () => {
		expect(resolveDesktopMcpServerResourceScope("global", { command: "server" })).toBe("application");
		expect(resolveDesktopMcpServerResourceScope("global", { type: "http", url: "https://example.com/mcp" })).toBe(
			"application",
		);
	});

	it("keeps PROJECT_ROOT consumers workspace-scoped", () => {
		expect(
			resolveDesktopMcpServerResourceScope("global", {
				command: "server",
				args: ["--root", `\${PROJECT_ROOT}`],
				env: { ROOT: `\${PROJECT_ROOT}/nested` },
			}),
		).toBe("workspace");
	});

	it("honors an explicit global workspace scope", () => {
		const config = { command: "server", resourceScope: "workspace" } as McpServerConfig;
		expect(resolveDesktopMcpServerResourceScope("global", config)).toBe("workspace");
	});
});

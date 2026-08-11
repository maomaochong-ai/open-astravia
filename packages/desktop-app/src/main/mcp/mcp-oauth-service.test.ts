import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { runMcpBrowserOAuthFlow, runMcpDeviceAuthorizationFlow } from "@vetta/runtime-mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOAuthCallbackSession } from "./mcp-oauth-host-ui.js";
import { DesktopMcpOAuthService } from "./mcp-oauth-service.js";

vi.mock("../i18n/index.js", () => ({
	mainT: (key: string) => key,
}));

describe("DesktopMcpOAuthService", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	});

	it("delegates browser authorization to runtime-mcp with Desktop host callbacks", async () => {
		const authDirectory = await createTemporaryDirectory();
		const openUrl = vi.fn();
		const browserFlow = vi.fn<typeof runMcpBrowserOAuthFlow>(async (options) => {
			expect(options.serverName).toBe("remote");
			expect(options.serverUrl).toBe("https://example.test/mcp");
			expect(options.authTimeoutMs).toBe(5 * 60_000);
			expect(options.createCallbackSession).toBeTypeOf("function");
			expect(options.createOAuthSession).toBeTypeOf("function");
			expect(options.openUrl).toBe(openUrl);
			return { serverName: options.serverName, serverUrl: options.serverUrl };
		});
		const service = new DesktopMcpOAuthService({ authDirectory, openUrl, browserFlow });

		await service.loginBrowser({
			serverName: "remote",
			serverUrl: "https://example.test/mcp",
			oauthClientId: "client-id",
		});

		expect(browserFlow).toHaveBeenCalledOnce();
	});

	it("shares persisted device credentials with status and logout operations", async () => {
		const authDirectory = await createTemporaryDirectory();
		const deviceFlow = vi.fn<typeof runMcpDeviceAuthorizationFlow>(async (options) => {
			expect(options.fallbackIssuer).toBe("https://github.com/login/oauth");
			expect(options.createPresentation).toBeTypeOf("function");
			options.store.save(options.serverName, {
				serverUrl: options.serverUrl,
				redirectUri: "http://127.0.0.1/callback",
				tokens: { access_token: "token", token_type: "bearer" },
			});
			return { serverName: options.serverName, serverUrl: options.serverUrl };
		});
		const service = new DesktopMcpOAuthService({ authDirectory, openUrl: vi.fn(), deviceFlow });

		await service.loginDevice({
			serverName: "github",
			serverUrl: "https://api.githubcopilot.com/mcp/",
			clientId: "client-id",
			scopes: "repo",
		});

		expect(service.hasAuth("github")).toBe(true);
		service.logout("github");
		expect(service.hasAuth("github")).toBe(false);
	});

	it("receives a browser authorization code through the Desktop loopback callback", async () => {
		const callback = await createOAuthCallbackSession();
		try {
			const code = callback.waitForCode(1_000);
			const response = await fetch(`${callback.redirectUri}?code=authorization-code`);
			expect(response.status).toBe(200);
			await expect(code).resolves.toBe("authorization-code");
		} finally {
			await callback.close();
		}
	});

	async function createTemporaryDirectory(): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), "desktop-mcp-oauth-"));
		directories.push(directory);
		return directory;
	}
});

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
	connectMode: "authorized" as "authorized" | "authorization_required",
	connectCalls: 0,
	closeCalls: 0,
	finishCodes: [] as string[],
	transportOptions: [] as unknown[],
}));

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
	UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", async () => {
	const { UnauthorizedError } = await import("@modelcontextprotocol/sdk/client/auth.js");
	return {
		Client: class Client {
			async connect(): Promise<void> {
				sdk.connectCalls += 1;
				if (sdk.connectMode === "authorization_required" && sdk.connectCalls === 1) {
					throw new UnauthorizedError("authorization required");
				}
			}

			async close(): Promise<void> {
				sdk.closeCalls += 1;
			}
		},
	};
});

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: class StreamableHTTPClientTransport {
		constructor(_url: URL, options: unknown) {
			sdk.transportOptions.push(options);
		}

		async finishAuth(code: string): Promise<void> {
			sdk.finishCodes.push(code);
		}
	},
}));

import {
	createMcpBrowserOAuthSdkSession,
	createMcpOAuthDiagnosticFetch,
} from "../src/auth/browser-oauth-sdk-session.js";

describe("browser OAuth SDK session", () => {
	beforeEach(() => {
		sdk.connectMode = "authorized";
		sdk.connectCalls = 0;
		sdk.closeCalls = 0;
		sdk.finishCodes = [];
		sdk.transportOptions = [];
	});

	it("maps authorized and authorization-required branches to the SDK", async () => {
		const authProvider = {} as OAuthClientProvider;
		const authorized = createMcpBrowserOAuthSdkSession({
			url: new URL("https://example.test/mcp"),
			authProvider,
			clientInfo: { name: "client", version: "1.0.0" },
			timeout: 1234,
		});
		await expect(authorized.connect()).resolves.toBe("authorized");
		expect(sdk.closeCalls).toBe(1);

		sdk.connectMode = "authorization_required";
		sdk.connectCalls = 0;
		const interactive = createMcpBrowserOAuthSdkSession({
			url: new URL("https://example.test/mcp"),
			authProvider,
			clientInfo: { name: "client", version: "1.0.0" },
			timeout: 1234,
		});
		await expect(interactive.connect()).resolves.toBe("authorization_required");
		await interactive.finishAuthorization("callback-code");
		await interactive.verify();
		expect(sdk.finishCodes).toEqual(["callback-code"]);
		expect(sdk.connectCalls).toBe(2);
		expect(sdk.closeCalls).toBe(2);
		expect(sdk.transportOptions).toHaveLength(3);
	});

	it("surfaces JSON and form-encoded OAuth errors without changing valid responses", async () => {
		const jsonFetch = createMcpOAuthDiagnosticFetch(
			async () =>
				new Response(JSON.stringify({ error: "invalid_grant", error_description: "expired code" }), {
					status: 200,
				}),
		);
		await expect(jsonFetch("https://auth.test/token", { method: "POST" })).rejects.toThrow(
			"OAuth authorization failed: invalid_grant: expired code",
		);

		const formFetch = createMcpOAuthDiagnosticFetch(
			async () => new Response("error=access_denied&error_description=user+denied", { status: 200 }),
		);
		await expect(formFetch("https://auth.test/token", { method: "POST" })).rejects.toThrow(
			"OAuth authorization failed: access_denied: user denied",
		);

		const response = new Response(JSON.stringify({ access_token: "access", token_type: "Bearer" }), { status: 200 });
		const validFetch = createMcpOAuthDiagnosticFetch(async () => response);
		await expect(validFetch("https://auth.test/token", { method: "POST" })).resolves.toBe(response);
	});
});

import { describe, expect, it, vi } from "vitest";
import {
	type McpBrowserOAuthSession,
	type McpBrowserOAuthSessionContext,
	type McpDeviceAuthorizationScheduler,
	type McpOAuthStateStore,
	type McpOAuthStoredState,
	runMcpBrowserOAuthFlow,
	runMcpDeviceAuthorizationFlow,
} from "../src/index.js";

describe("browser OAuth flow", () => {
	it("returns without waiting when the SDK session is already authorized", async () => {
		const callback = new FakeCallbackSession();
		const session = new FakeBrowserOAuthSession("authorized");
		const openUrl = vi.fn();

		await expect(
			runMcpBrowserOAuthFlow({
				serverName: " remote ",
				serverUrl: " https://example.test/mcp ",
				authTimeoutMs: 5000,
				createCallbackSession: async () => callback,
				createOAuthSession: () => session,
				openUrl,
			}),
		).resolves.toEqual({ serverName: "remote", serverUrl: "https://example.test/mcp" });

		expect(callback.waitCalls).toBe(0);
		expect(callback.closeCalls).toBe(1);
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("opens authorization, consumes the callback code and verifies tokens", async () => {
		const callback = new FakeCallbackSession();
		let sessionContext: McpBrowserOAuthSessionContext | undefined;
		const session = new FakeBrowserOAuthSession("authorization_required", async () => {
			await sessionContext?.onRedirect(new URL("https://auth.test/authorize"));
		});
		const openedUrls: string[] = [];

		await runMcpBrowserOAuthFlow({
			serverName: "remote",
			serverUrl: "https://example.test/mcp",
			authTimeoutMs: 4321,
			createCallbackSession: async () => callback,
			createOAuthSession: (context) => {
				sessionContext = context;
				return session;
			},
			openUrl: (url) => {
				openedUrls.push(url);
			},
		});

		expect(sessionContext?.redirectUri).toBe(callback.redirectUri);
		expect(openedUrls).toEqual(["https://auth.test/authorize"]);
		expect(callback.waitTimeouts).toEqual([4321]);
		expect(session.finishCodes).toEqual(["callback-code"]);
		expect(session.verifyCalls).toBe(1);
		expect(callback.closeCalls).toBe(1);
	});

	it("always closes the callback session when connection fails", async () => {
		const callback = new FakeCallbackSession();
		const session: McpBrowserOAuthSession = {
			connect: async () => {
				throw new Error("connect failed");
			},
			finishAuthorization: async () => undefined,
			verify: async () => undefined,
		};

		await expect(
			runMcpBrowserOAuthFlow({
				serverName: "remote",
				serverUrl: "https://example.test/mcp",
				authTimeoutMs: 5000,
				createCallbackSession: async () => callback,
				createOAuthSession: () => session,
				openUrl: () => undefined,
			}),
		).rejects.toThrow("connect failed");
		expect(callback.closeCalls).toBe(1);
	});
});

describe("device authorization flow", () => {
	it("discovers endpoints, handles pending and slow-down, then persists the token", async () => {
		const store = new MemoryOAuthStateStore();
		const scheduler = new FakeScheduler();
		const waits: number[] = [];
		scheduler.onWait = (milliseconds) => waits.push(milliseconds);
		const tokenResponses = [
			{ error: "authorization_pending" },
			{ error: "slow_down" },
			{ access_token: "access", token_type: "Bearer", scope: "repo" },
		];
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const url = String(input);
			requests.push({ url, init });
			if (url.includes("oauth-protected-resource")) {
				return jsonResponse({ authorization_servers: ["https://issuer.test/oauth/"] });
			}
			if (url.endsWith("/device/code")) {
				return jsonResponse({
					device_code: "device-code",
					user_code: "USER-CODE",
					verification_uri: "https://issuer.test/verify",
					verification_uri_complete: "https://issuer.test/verify?code=USER-CODE",
					expires_in: 60,
					interval: 1,
				});
			}
			return jsonResponse(tokenResponses.shift());
		};
		let presentationClosed = 0;
		const presentedCodes: string[] = [];

		await expect(
			runMcpDeviceAuthorizationFlow({
				serverName: " remote ",
				serverUrl: " https://example.test/mcp ",
				clientId: " client-id ",
				scopes: " repo ",
				fallbackIssuer: "https://fallback.test/oauth",
				store,
				fetchFn,
				scheduler,
				onUserCode: ({ userCode }) => {
					presentedCodes.push(userCode);
				},
				createPresentation: async (info) => ({
					url: info.verificationUriComplete ?? info.verificationUri,
					close: async () => {
						presentationClosed += 1;
					},
				}),
				openUrl: () => undefined,
			}),
		).resolves.toEqual({ serverName: "remote", serverUrl: "https://example.test/mcp" });

		expect(requests.map(({ url }) => url)).toEqual([
			"https://example.test/.well-known/oauth-protected-resource/mcp",
			"https://issuer.test/oauth/device/code",
			"https://issuer.test/oauth/access_token",
			"https://issuer.test/oauth/access_token",
			"https://issuer.test/oauth/access_token",
		]);
		expect(String(requests[1]?.init?.body)).toBe("client_id=client-id&scope=repo");
		expect(waits).toEqual([1000, 1000, 6000]);
		expect(presentedCodes).toEqual(["USER-CODE"]);
		expect(presentationClosed).toBe(1);
		expect(store.load("remote")).toEqual({
			serverUrl: "https://example.test/mcp",
			redirectUri: "http://127.0.0.1/callback",
			clientInformation: { client_id: "client-id" },
			tokens: { access_token: "access", token_type: "Bearer", scope: "repo" },
		});
	});

	it("uses the injected fallback issuer and returns typed request errors", async () => {
		const store = new MemoryOAuthStateStore();
		const requests: string[] = [];
		const fetchFn = async (input: string | URL | Request): Promise<Response> => {
			const url = String(input);
			requests.push(url);
			if (url.includes("oauth-protected-resource")) return new Response("missing", { status: 404 });
			return new Response("unprocessable", { status: 422 });
		};

		await expect(
			runMcpDeviceAuthorizationFlow({
				serverName: "remote",
				serverUrl: "https://example.test/mcp",
				clientId: "client-id",
				fallbackIssuer: "https://fallback.test/oauth/",
				store,
				fetchFn,
				createPresentation: async () => {
					throw new Error("presentation must not be created");
				},
				openUrl: () => undefined,
			}),
		).rejects.toMatchObject({
			name: "McpDeviceCodeRequestError",
			status: 422,
			bodyPreview: "unprocessable",
		});
		expect(requests).toEqual([
			"https://example.test/.well-known/oauth-protected-resource/mcp",
			"https://fallback.test/oauth/device/code",
		]);
	});

	it("rejects invalid network JSON through TypeBox and closes presentations on polling errors", async () => {
		const store = new MemoryOAuthStateStore();
		const invalidCodeFetch = async (input: string | URL | Request): Promise<Response> => {
			const url = String(input);
			if (url.includes("oauth-protected-resource")) return new Response("missing", { status: 404 });
			return jsonResponse({ device_code: "device", user_code: "code" });
		};
		await expect(
			runMcpDeviceAuthorizationFlow({
				serverName: "remote",
				serverUrl: "https://example.test/mcp",
				clientId: "client-id",
				fallbackIssuer: "https://fallback.test/oauth",
				store,
				fetchFn: invalidCodeFetch,
				createPresentation: async () => ({ url: "unused", close: async () => undefined }),
				openUrl: () => undefined,
			}),
		).rejects.toThrow("Device code response missing required fields");

		let presentationClosed = 0;
		let request = 0;
		const deniedFetch = async (): Promise<Response> => {
			request += 1;
			if (request === 1) return new Response("missing", { status: 404 });
			if (request === 2) {
				return jsonResponse({
					device_code: "device",
					user_code: "code",
					verification_uri: "https://verify.test",
					interval: 1,
				});
			}
			return jsonResponse({ error: "access_denied" });
		};
		await expect(
			runMcpDeviceAuthorizationFlow({
				serverName: "remote",
				serverUrl: "https://example.test/mcp",
				clientId: "client-id",
				fallbackIssuer: "https://fallback.test/oauth",
				store,
				fetchFn: deniedFetch,
				scheduler: new FakeScheduler(),
				createPresentation: async () => ({
					url: "https://verify.test",
					close: async () => {
						presentationClosed += 1;
					},
				}),
				openUrl: () => undefined,
			}),
		).rejects.toThrow("Authorization was denied.");
		expect(presentationClosed).toBe(1);
	});
});

class FakeCallbackSession {
	readonly redirectUri = "http://127.0.0.1:4200/callback";
	readonly waitTimeouts: number[] = [];
	closeCalls = 0;

	get waitCalls(): number {
		return this.waitTimeouts.length;
	}

	async waitForCode(timeoutMs: number): Promise<string> {
		this.waitTimeouts.push(timeoutMs);
		return "callback-code";
	}

	async close(): Promise<void> {
		this.closeCalls += 1;
	}
}

class FakeBrowserOAuthSession implements McpBrowserOAuthSession {
	readonly finishCodes: string[] = [];
	verifyCalls = 0;

	constructor(
		private readonly status: "authorized" | "authorization_required",
		private readonly beforeConnect?: () => void | Promise<void>,
	) {}

	async connect(): Promise<"authorized" | "authorization_required"> {
		await this.beforeConnect?.();
		return this.status;
	}

	async finishAuthorization(code: string): Promise<void> {
		this.finishCodes.push(code);
	}

	async verify(): Promise<void> {
		this.verifyCalls += 1;
	}
}

class MemoryOAuthStateStore implements McpOAuthStateStore {
	private readonly states = new Map<string, McpOAuthStoredState>();

	load(serverName: string): McpOAuthStoredState | undefined {
		return this.states.get(serverName);
	}

	save(serverName: string, state: McpOAuthStoredState): void {
		this.states.set(serverName, structuredClone(state));
	}

	clear(serverName: string): void {
		this.states.delete(serverName);
	}

	hasTokens(serverName: string): boolean {
		const state = this.states.get(serverName);
		return Boolean(state?.tokens?.access_token || state?.tokens?.refresh_token);
	}
}

class FakeScheduler implements McpDeviceAuthorizationScheduler {
	currentTime = 0;
	onWait: (milliseconds: number) => void = () => undefined;

	now(): number {
		return this.currentTime;
	}

	async wait(milliseconds: number): Promise<void> {
		this.onWait(milliseconds);
		this.currentTime += milliseconds;
	}
}

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

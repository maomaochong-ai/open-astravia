import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	FileMcpOAuthStateStore,
	McpOAuthProvider,
	type McpOAuthStateStore,
	type McpOAuthStoredState,
} from "../src/index.js";

describe("FileMcpOAuthStateStore", () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("uses an explicit directory and preserves the legacy file contract", async () => {
		const authDirectory = await createAuthDirectory();
		const store = new FileMcpOAuthStateStore({ authDirectory });
		const path = store.getPath(" remote server/one ");
		expect(path).toBe(join(authDirectory, "remote_server_one.json"));

		store.save(" remote server/one ", {
			serverUrl: "https://example.test/mcp",
			tokens: { access_token: "access", token_type: "Bearer" },
		});
		expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
		expect(store.load(" remote server/one ")).toMatchObject({
			serverUrl: "https://example.test/mcp",
			updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
		});
		expect(store.hasTokens(" remote server/one ")).toBe(true);

		store.clear(" remote server/one ");
		expect(store.load(" remote server/one ")).toBeUndefined();
	});

	it("validates disk JSON while keeping tolerant reads and refresh-only compatibility", async () => {
		const authDirectory = await createAuthDirectory();
		const store = new FileMcpOAuthStateStore({ authDirectory });
		const path = store.getPath("remote");
		await writeJson(path, { serverUrl: "https://example.test/mcp", tokens: { refresh_token: "refresh" } });
		expect(store.hasTokens("remote")).toBe(true);

		await writeJson(path, { serverUrl: "https://example.test/mcp", tokens: "invalid" });
		expect(store.load("remote")).toBeUndefined();
		await writeJson(path, { redirectUri: "http://127.0.0.1/callback" });
		expect(store.load("remote")).toBeUndefined();
		await writeFile(path, "{broken", "utf8");
		expect(store.load("remote")).toBeUndefined();
	});

	async function createAuthDirectory(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), "runtime-mcp-oauth-"));
		temporaryDirectories.push(root);
		return join(root, "explicit-auth");
	}
});

describe("McpOAuthProvider", () => {
	it("depends only on the injected store and preserves redirect state", async () => {
		const store = new MemoryMcpOAuthStateStore({
			remote: {
				serverUrl: "https://example.test/mcp",
				redirectUri: "http://127.0.0.1:4100/callback",
				clientInformation: { client_id: "dynamic" },
				tokens: { access_token: "access", token_type: "Bearer" },
				discoveryState: { authorizationServerUrl: "https://auth.test" },
			},
		});
		const provider = createProvider(store);

		expect(provider.redirectUrl).toBe("http://127.0.0.1:4200/callback");
		expect(provider.clientInformation()).toBeUndefined();
		expect(provider.tokens()).toMatchObject({ access_token: "access" });
		expect(provider.discoveryState()).toBeUndefined();
		expect(store.saveCalls).toBe(1);
	});

	it("keeps a rotated refresh token and clears the one-shot verifier", async () => {
		const store = new MemoryMcpOAuthStateStore();
		const provider = createProvider(store);
		await provider.saveTokens({ access_token: "first", refresh_token: "refresh", token_type: "Bearer" });
		await provider.saveCodeVerifier("pkce");
		await provider.saveTokens({ access_token: "second", token_type: "Bearer" });

		expect(provider.tokens()).toEqual({ access_token: "second", refresh_token: "refresh", token_type: "Bearer" });
		await expect(provider.codeVerifier()).rejects.toThrow("No PKCE code verifier stored");
	});

	it("seeds stable clients and clears all state through the store port", async () => {
		const store = new MemoryMcpOAuthStateStore();
		const provider = createProvider(store, "stable");
		expect(provider.clientInformation()).toEqual({ client_id: "stable" });
		expect(store.saveCalls).toBe(1);

		await provider.invalidateCredentials("all");
		expect(store.clearCalls).toBe(1);
		expect(store.load("remote")).toBeUndefined();
		expect(provider.clientInformation()).toBeUndefined();
	});
});

class MemoryMcpOAuthStateStore implements McpOAuthStateStore {
	readonly values = new Map<string, McpOAuthStoredState>();
	saveCalls = 0;
	clearCalls = 0;

	constructor(initial: Readonly<Record<string, McpOAuthStoredState>> = {}) {
		for (const [name, state] of Object.entries(initial)) this.values.set(name, structuredClone(state));
	}

	load(serverName: string): McpOAuthStoredState | undefined {
		const state = this.values.get(serverName);
		return state ? structuredClone(state) : undefined;
	}

	save(serverName: string, state: McpOAuthStoredState): void {
		this.saveCalls += 1;
		this.values.set(serverName, structuredClone(state));
	}

	clear(serverName: string): void {
		this.clearCalls += 1;
		this.values.delete(serverName);
	}

	hasTokens(serverName: string): boolean {
		const state = this.values.get(serverName);
		return Boolean(state?.tokens?.access_token || state?.tokens?.refresh_token);
	}
}

function createProvider(store: McpOAuthStateStore, clientId?: string): McpOAuthProvider {
	return new McpOAuthProvider({
		serverName: "remote",
		serverUrl: "https://example.test/mcp",
		redirectUri: "http://127.0.0.1:4200/callback",
		store,
		clientName: "Test Client",
		clientId,
		onRedirect: () => undefined,
	});
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(value), "utf8");
}

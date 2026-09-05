import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMarketplaceManifest } from "./marketplace-schema";
import { validateOpenMarketplaceMcp } from "./open-marketplace-mcp";

const temporaryRoots: string[] = [];
const DEMO_API_KEY_PLACEHOLDER = `\${DEMO_API_KEY}`;
const PORT_TOKEN = `\${VETTA_MCP_PORT}`;
const URL_TOKEN = `\${VETTA_MCP_URL}`;

async function fixture(
	server: Record<string, unknown>,
	overrides?: {
		slug?: string;
		version?: string;
		parameters?: Array<Record<string, unknown>>;
		browserAuth?: boolean;
		schemaVersion?: 1 | 3;
		runtime?: Record<string, unknown>;
		setup?: Record<string, unknown>;
		args?: string[];
	},
) {
	const root = await mkdtemp(join(tmpdir(), "vetta-open-mcp-test-"));
	temporaryRoots.push(root);
	await mkdir(root, { recursive: true });
	await writeFile(
		join(root, "mcp.json"),
		JSON.stringify({
			schemaVersion: overrides?.schemaVersion ?? 1,
			slug: overrides?.slug ?? "demo-mcp",
			version: overrides?.version ?? "1.0.0",
			server,
			parameters: overrides?.parameters,
			browserAuth: overrides?.browserAuth,
			runtime: overrides?.runtime,
			setup: overrides?.setup,
		}),
		"utf-8",
	);
	const manifest = parseMarketplaceManifest({
		schemaVersion: 1,
		name: "test-market",
		marketplaceVersion: "2026.07.5",
		repository: "https://github.com/example/test-market",
		minAppVersion: "0.5.11",
		abilities: [
			{
				type: "mcp",
				slug: "demo-mcp",
				name: "Demo MCP",
				version: "1.0.0",
				source: { path: "abilities/mcp/demo-mcp" },
			},
		],
	});
	const ability = manifest.abilities[0];
	if (!ability || ability.type !== "mcp") throw new Error("MCP fixture is missing");
	return { root, ability };
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function managedRuntime(platformTag: string): Record<string, unknown> {
	return {
		kind: "managed-binary",
		process: { args: [`-port=:${PORT_TOKEN}`], env: {} },
		service: { kind: "http-mcp", path: "/mcp" },
		platforms: {
			[platformTag]: {
				url: "https://github.com/example/demo/releases/download/v1/demo.zip",
				sha256: "a".repeat(64),
				archive: "zip",
				executable: process.platform === "win32" ? "demo.exe" : "bin/demo",
			},
		},
	};
}

describe("validateOpenMarketplaceMcp", () => {
	it("loads HTTP configuration from the MCP package", async () => {
		const { root, ability } = await fixture({ type: "http", url: "https://mcp.example.com/mcp" });

		expect(validateOpenMarketplaceMcp(root, ability)).toEqual({
			mcp: { type: "http", url: "https://mcp.example.com/mcp" },
			mcp_browser_auth: false,
			mcp_parameters: [],
		});
	});

	it("preserves an explicit browser OAuth requirement", async () => {
		const { root, ability } = await fixture(
			{ type: "http", url: "https://mcp.example.com/mcp" },
			{ browserAuth: true },
		);

		expect(validateOpenMarketplaceMcp(root, ability).mcp_browser_auth).toBe(true);
	});

	it("supports stdio command arguments and environment placeholders", async () => {
		const { root, ability } = await fixture({
			command: "npx",
			args: ["-y", "@example/demo-mcp", "--stdio"],
			env: { DEMO_API_KEY: DEMO_API_KEY_PLACEHOLDER },
		});

		expect(validateOpenMarketplaceMcp(root, ability)).toEqual({
			mcp: {
				command: "npx",
				args: ["-y", "@example/demo-mcp", "--stdio"],
				env: { DEMO_API_KEY: DEMO_API_KEY_PLACEHOLDER },
			},
			mcp_browser_auth: false,
			mcp_parameters: [],
		});
	});

	it("loads user-provided installation parameter definitions without values", async () => {
		const { root, ability } = await fixture(
			{ type: "http", url: "https://mcp.example.com/mcp" },
			{
				parameters: [
					{
						key: "Authorization",
						label: "Access token",
						required: true,
						secret: true,
						valueTemplate: "Bearer {value}",
					},
				],
			},
		);

		expect(validateOpenMarketplaceMcp(root, ability).mcp_parameters).toEqual([
			{
				key: "Authorization",
				label: "Access token",
				required: true,
				secret: true,
				valueTemplate: "Bearer {value}",
			},
		]);
	});

	it("accepts a schema v3 direct HTTP managed binary and reports current-platform support", async () => {
		const platformTag = `${process.platform}-${process.arch}`;
		const { root, ability } = await fixture(
			{ type: "http", url: URL_TOKEN },
			{
				schemaVersion: 3,
				runtime: managedRuntime(platformTag),
			},
		);

		expect(validateOpenMarketplaceMcp(root, ability)).toMatchObject({
			mcp: { type: "http", url: URL_TOKEN },
			mcp_runtime: { kind: "managed-binary", supported: true },
		});
	});

	it("rejects unsafe managed runtime declarations", async () => {
		const insecureUrl = await fixture(
			{ type: "http", url: URL_TOKEN },
			{
				schemaVersion: 3,
				runtime: {
					kind: "managed-binary",
					process: { args: [`-port=:${PORT_TOKEN}`], env: {} },
					service: { kind: "http-mcp", path: "/mcp" },
					platforms: {
						"win32-x64": {
							url: "http://example.com/demo.exe",
							sha256: "a".repeat(64),
							archive: "file",
							executable: "demo.exe",
						},
					},
				},
			},
		);
		expect(() => validateOpenMarketplaceMcp(insecureUrl.root, insecureUrl.ability)).toThrow(
			"runtime URL must use HTTPS",
		);

		const wrongUrl = await fixture(
			{ type: "http", url: "http://127.0.0.1/mcp" },
			{
				schemaVersion: 3,
				runtime: {
					kind: "managed-binary",
					process: { args: [`-port=:${PORT_TOKEN}`], env: {} },
					service: { kind: "http-mcp", path: "/mcp" },
					platforms: {
						"win32-x64": {
							url: "https://example.com/demo.exe",
							sha256: "a".repeat(64),
							archive: "file",
							executable: "demo.exe",
						},
					},
				},
			},
		);
		expect(() => validateOpenMarketplaceMcp(wrongUrl.root, wrongUrl.ability)).toThrow(
			"Managed HTTP MCP runtime URL must be exactly",
		);
	});

	it("rejects package identity and server configuration mismatches", async () => {
		const slugMismatch = await fixture({ command: "demo" }, { slug: "other" });
		expect(() => validateOpenMarketplaceMcp(slugMismatch.root, slugMismatch.ability)).toThrow(
			"MCP package slug mismatch",
		);

		const invalidServer = await fixture({ type: "http" });
		expect(() => validateOpenMarketplaceMcp(invalidServer.root, invalidServer.ability)).toThrow(
			"Invalid MCP server 'demo-mcp'.url",
		);
	});

	it("exposes a declared post-install step to the client", async () => {
		const platformTag = `${process.platform}-${process.arch}`;
		const { root, ability } = await fixture(
			{ type: "http", url: URL_TOKEN },
			{
				schemaVersion: 3,
				runtime: managedRuntime(platformTag),
				setup: {
					kind: "http-qrcode",
					statusPath: "/api/v1/login/status",
					qrcodePath: "/api/v1/login/qrcode",
					logoutPath: "/api/v1/login/cookies",
				},
			},
		);

		expect(validateOpenMarketplaceMcp(root, ability)).toMatchObject({
			mcp_setup: { kind: "http-qrcode" },
		});
	});

	it("rejects a post-install step without a managed runtime", async () => {
		const { root, ability } = await fixture(
			{ type: "http", url: "https://mcp.example.com/mcp" },
			{
				schemaVersion: 3,
				setup: {
					kind: "http-qrcode",
					statusPath: "/api/v1/login/status",
					qrcodePath: "/api/v1/login/qrcode",
					logoutPath: "/api/v1/login/cookies",
				},
			},
		);

		expect(() => validateOpenMarketplaceMcp(root, ability)).toThrow(/managed MCP runtime/i);
	});

	it("rejects a post-install endpoint that is not an absolute path", async () => {
		const platformTag = `${process.platform}-${process.arch}`;
		const { root, ability } = await fixture(
			{ type: "http", url: URL_TOKEN },
			{
				schemaVersion: 3,
				runtime: managedRuntime(platformTag),
				setup: {
					kind: "http-qrcode",
					statusPath: "../../status",
					qrcodePath: "/api/v1/login/qrcode",
					logoutPath: "/api/v1/login/cookies",
				},
			},
		);

		expect(() => validateOpenMarketplaceMcp(root, ability)).toThrow();
	});

	it("accepts a managed local HTTP MCP service", async () => {
		const platformTag = `${process.platform}-${process.arch}`;
		const { root, ability } = await fixture(
			{ type: "http", url: URL_TOKEN },
			{
				schemaVersion: 3,
				runtime: managedRuntime(platformTag),
			},
		);

		expect(validateOpenMarketplaceMcp(root, ability)).toMatchObject({
			mcp_runtime: { kind: "managed-binary", supported: true },
		});
	});

	it("rejects a managed service that never receives the allocated port", async () => {
		const platformTag = `${process.platform}-${process.arch}`;
		const { root, ability } = await fixture(
			{ type: "http", url: URL_TOKEN },
			{
				schemaVersion: 3,
				runtime: { ...managedRuntime(platformTag), process: { args: ["--fixed-port"], env: {} } },
			},
		);

		expect(() => validateOpenMarketplaceMcp(root, ability)).toThrow(/VETTA_MCP_PORT/);
	});
});

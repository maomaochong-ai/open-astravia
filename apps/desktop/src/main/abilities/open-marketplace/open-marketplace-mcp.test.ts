import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMarketplaceManifest } from "./marketplace-schema";
import { validateOpenMarketplaceMcp } from "./open-marketplace-mcp";

const temporaryRoots: string[] = [];
const DEMO_API_KEY_PLACEHOLDER = `\${DEMO_API_KEY}`;
const RUNTIME_COMMAND = `\${VETTA_MCP_EXECUTABLE}`;
const PORT_TOKEN = `\${VETTA_MCP_PORT}`;

async function fixture(
	server: Record<string, unknown>,
	overrides?: {
		slug?: string;
		version?: string;
		parameters?: Array<Record<string, unknown>>;
		browserAuth?: boolean;
		schemaVersion?: 1 | 2;
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

	it("accepts a schema v2 managed binary and reports current-platform support", async () => {
		const platformTag = `${process.platform}-${process.arch}`;
		const { root, ability } = await fixture(
			{
				command: RUNTIME_COMMAND,
				args: ["--stdio"],
				env: { XHS_DATA_DIR: String.raw`\${VETTA_MCP_DATA_DIR}` },
			},
			{
				schemaVersion: 2,
				runtime: {
					kind: "managed-binary",
					platforms: {
						[platformTag]: {
							url: "https://github.com/example/demo/releases/download/v1/demo.zip",
							sha256: "a".repeat(64),
							archive: "zip",
							executable: process.platform === "win32" ? "demo.exe" : "bin/demo",
						},
					},
				},
			},
		);

		expect(validateOpenMarketplaceMcp(root, ability)).toMatchObject({
			mcp: { command: RUNTIME_COMMAND, args: ["--stdio"] },
			mcp_runtime: { kind: "managed-binary", supported: true },
		});
	});

	it("rejects unsafe managed runtime declarations", async () => {
		const insecureUrl = await fixture(
			{ command: RUNTIME_COMMAND },
			{
				schemaVersion: 2,
				runtime: {
					kind: "managed-binary",
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

		const wrongCommand = await fixture(
			{ command: "demo" },
			{
				schemaVersion: 2,
				runtime: {
					kind: "managed-binary",
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
		expect(() => validateOpenMarketplaceMcp(wrongCommand.root, wrongCommand.ability)).toThrow(
			"Managed MCP runtime command must be exactly",
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
			{ command: RUNTIME_COMMAND },
			{
				schemaVersion: 2,
				runtime: managedRuntime(platformTag),
				setup: {
					kind: "agent-tool",
					tool: "get_login_qrcode",
					completedWhen: { dataFile: "cookies.json" },
				},
			},
		);

		expect(validateOpenMarketplaceMcp(root, ability)).toMatchObject({
			mcp_setup: { kind: "agent-tool", tool: "get_login_qrcode" },
		});
	});

	it("rejects a post-install step without a managed runtime", async () => {
		const { root, ability } = await fixture(
			{ type: "http", url: "https://mcp.example.com/mcp" },
			{
				schemaVersion: 2,
				setup: {
					kind: "agent-tool",
					tool: "get_login_qrcode",
					completedWhen: { dataFile: "cookies.json" },
				},
			},
		);

		expect(() => validateOpenMarketplaceMcp(root, ability)).toThrow(/managed MCP runtime/i);
	});

	it("rejects a post-install completion marker that escapes the data directory", async () => {
		const platformTag = `${process.platform}-${process.arch}`;
		const { root, ability } = await fixture(
			{ command: RUNTIME_COMMAND },
			{
				schemaVersion: 2,
				runtime: managedRuntime(platformTag),
				setup: {
					kind: "agent-tool",
					tool: "get_login_qrcode",
					completedWhen: { dataFile: "../../cookies.json" },
				},
			},
		);

		expect(() => validateOpenMarketplaceMcp(root, ability)).toThrow();
	});

	it("accepts a managed local HTTP MCP service", async () => {
		const platformTag = `${process.platform}-${process.arch}`;
		const { root, ability } = await fixture(
			{ command: RUNTIME_COMMAND, args: [`-port=:${PORT_TOKEN}`] },
			{
				schemaVersion: 2,
				runtime: { ...managedRuntime(platformTag), service: { kind: "http-mcp", path: "/mcp" } },
			},
		);

		expect(validateOpenMarketplaceMcp(root, ability)).toMatchObject({
			mcp_runtime: { kind: "managed-binary", supported: true },
		});
	});

	it("rejects a managed service that never receives the allocated port", async () => {
		const platformTag = `${process.platform}-${process.arch}`;
		const { root, ability } = await fixture(
			{ command: RUNTIME_COMMAND, args: ["--stdio"] },
			{
				schemaVersion: 2,
				runtime: { ...managedRuntime(platformTag), service: { kind: "http-mcp", path: "/mcp" } },
			},
		);

		expect(() => validateOpenMarketplaceMcp(root, ability)).toThrow(/VETTA_MCP_PORT/);
	});
});

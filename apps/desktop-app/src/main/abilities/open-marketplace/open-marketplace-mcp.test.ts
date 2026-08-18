import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMarketplaceManifest } from "./marketplace-schema";
import { validateOpenMarketplaceMcp } from "./open-marketplace-mcp";

const temporaryRoots: string[] = [];
const DEMO_API_KEY_PLACEHOLDER = `\${DEMO_API_KEY}`;

async function fixture(
	server: Record<string, unknown>,
	overrides?: {
		slug?: string;
		version?: string;
		parameters?: Array<Record<string, unknown>>;
		browserAuth?: boolean;
	},
) {
	const root = await mkdtemp(join(tmpdir(), "vetta-open-mcp-test-"));
	temporaryRoots.push(root);
	await mkdir(root, { recursive: true });
	await writeFile(
		join(root, "mcp.json"),
		JSON.stringify({
			schemaVersion: 1,
			slug: overrides?.slug ?? "demo-mcp",
			version: overrides?.version ?? "1.0.0",
			server,
			parameters: overrides?.parameters,
			browserAuth: overrides?.browserAuth,
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
});

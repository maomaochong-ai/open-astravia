import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMarketplaceManifest } from "./marketplace-schema";

const mocks = vi.hoisted(() => ({
	installPluginFromArchive: vi.fn(
		async (_archive: Buffer, _options: { source: "remote"; enable: boolean; grantedPermissions: string[] }) => ({
			id: "demo-plugin",
			activeVersion: "1.0.0",
		}),
	),
	recordAbilityInstall: vi.fn(),
}));

vi.mock("../../plugins/plugin-store", () => ({
	installPluginFromArchive: mocks.installPluginFromArchive,
}));
vi.mock("../ability-ledger", () => ({
	recordAbilityInstall: mocks.recordAbilityInstall,
}));
vi.mock("../../skills/skill-service", () => ({
	getSkillBaseDir: vi.fn(),
	readSkillsManifest: vi.fn(() => ({})),
	recordSkillResourceEvent: vi.fn(),
	writeSkillsManifest: vi.fn(),
}));

import { installOpenMarketplaceAbilityInDesktop } from "./open-marketplace-production";

const temporaryRoots: string[] = [];

afterEach(async () => {
	mocks.installPluginFromArchive.mockClear();
	mocks.recordAbilityInstall.mockClear();
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("installOpenMarketplaceAbilityInDesktop", () => {
	it("does not route MCP configuration through the file installer", async () => {
		const manifest = parseMarketplaceManifest({
			schemaVersion: 1,
			name: "test-market",
			marketplaceVersion: "2026.07.3",
			repository: "https://github.com/example/test-market",
			minAppVersion: "0.5.11",
			abilities: [
				{
					type: "mcp",
					slug: "context7",
					name: "Context7",
					version: "1.0.0",
					source: { path: "abilities/mcp/context7" },
				},
			],
		});
		const ability = manifest.abilities[0];
		if (!ability || ability.type !== "mcp") throw new Error("MCP fixture is missing");

		await expect(
			installOpenMarketplaceAbilityInDesktop("unused", ability, {
				kind: "github-marketplace",
				marketplace: "test-market",
				marketplaceVersion: "2026.07.3",
				repository: "https://github.com/example/test-market",
			}),
		).rejects.toThrow("MCP abilities are installed through MCP settings");
	});

	it("installs an open plugin through the plugin store and records its GitHub origin", async () => {
		const snapshotRoot = await mkdtemp(join(tmpdir(), "vetta-open-production-test-"));
		temporaryRoots.push(snapshotRoot);
		const sourceDir = join(snapshotRoot, "abilities", "plugins", "demo-plugin");
		await mkdir(join(sourceDir, "dist"), { recursive: true });
		await writeFile(
			join(sourceDir, "plugin.json"),
			JSON.stringify({
				id: "demo-plugin",
				name: "Demo Plugin",
				version: "1.0.0",
				pluginApiVersion: "1.1.0",
				entry: "dist/index.js",
			}),
			"utf-8",
		);
		await writeFile(join(sourceDir, "dist", "index.js"), "export default {};\n", "utf-8");
		const manifest = parseMarketplaceManifest({
			schemaVersion: 1,
			name: "test-market",
			marketplaceVersion: "2026.07.3",
			repository: "https://github.com/example/test-market",
			minAppVersion: "0.5.11",
			abilities: [
				{
					type: "plugin",
					slug: "demo-plugin",
					name: "Demo Plugin",
					version: "1.0.0",
					configVersion: 2,
					source: { path: "abilities/plugins/demo-plugin" },
				},
			],
		});
		const ability = manifest.abilities[0];
		if (!ability || ability.type !== "plugin") throw new Error("Plugin fixture is missing");
		const origin = {
			kind: "github-marketplace" as const,
			sourceId: "test-source",
			marketplace: "test-market",
			marketplaceVersion: "2026.07.3",
			repository: "https://github.com/example/test-market",
		};

		await installOpenMarketplaceAbilityInDesktop(snapshotRoot, ability, origin);

		const archiveBuffer = mocks.installPluginFromArchive.mock.calls[0]?.[0];
		expect(Buffer.isBuffer(archiveBuffer)).toBe(true);
		expect(new AdmZip(archiveBuffer as Buffer).getEntry("plugin.json")).not.toBeNull();
		expect(mocks.installPluginFromArchive).toHaveBeenCalledWith(expect.any(Buffer), {
			source: "remote",
			enable: false,
			grantedPermissions: [],
		});
		expect(mocks.recordAbilityInstall).toHaveBeenCalledWith("plugin", "demo-plugin", "1.0.0", {
			origin,
			configVersion: 2,
			catalogId: "github:test-source:plugin:demo-plugin",
			slug: "demo-plugin",
		});
	});
});

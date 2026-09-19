import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePluginManifest } from "@vetta-org/plugin-sdk/manifest";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	InstalledPlugin,
	PluginInstallOptions,
	PluginManifest,
	PluginPermission,
} from "../../../preload/api-types/plugins.js";
import { createInstalledPluginFromManifest } from "../../plugins/plugin-package.js";
import { parseMarketplaceManifest } from "./marketplace-schema";

const mocks = vi.hoisted(() => ({
	installPluginFromArchive: vi.fn<(archive: Buffer, options?: PluginInstallOptions) => Promise<InstalledPlugin>>(),
	recordAbilityInstall: vi.fn(),
	recordAppMonitorEvent: vi.fn(),
}));

vi.mock("../../plugins/plugin-catalog", () => ({
	installPluginFromArchive: mocks.installPluginFromArchive,
}));
vi.mock("../ability-ledger", () => ({
	recordAbilityInstall: mocks.recordAbilityInstall,
}));
vi.mock("../../app-monitor/app-monitor-service", () => ({
	recordAppMonitorEvent: mocks.recordAppMonitorEvent,
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
	vi.unstubAllGlobals();
	mocks.installPluginFromArchive.mockReset();
	mocks.recordAbilityInstall.mockClear();
	mocks.recordAppMonitorEvent.mockClear();
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("installOpenMarketplaceAbilityInDesktop", () => {
	it("installs a verified remote release without a compiled plugin directory in the market archive", async () => {
		const pluginManifest: PluginManifest = {
			id: "demo-plugin",
			name: "Demo Plugin",
			version: "1.2.0",
			pluginApiVersion: "^2.5.0",
			entry: "dist/index.js",
			moduleFederation: { remoteName: "demo_plugin", expose: "./plugin" },
			permissions: ["storage.read"],
		};
		const zip = new AdmZip();
		zip.addFile("plugin.json", Buffer.from(JSON.stringify(pluginManifest)));
		zip.addFile("dist/index.js", Buffer.from("export default {};"));
		const bytes = zip.toBuffer();
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		vi.stubGlobal("fetch", async () => new Response(new Uint8Array(bytes), { status: 200 }));
		const manifest = parseMarketplaceManifest({
			schemaVersion: 3,
			name: "test-market",
			marketplaceVersion: "3",
			repository: "https://github.com/example/test-market",
			minAppVersion: "0.5.58",
			abilities: [
				{
					type: "plugin",
					slug: "demo-plugin",
					name: "Demo Plugin",
					version: "1.2.0",
					source: { path: "abilities/plugins/demo-plugin" },
					releases: [
						{
							version: "1.2.0",
							minAppVersion: "0.5.58",
							pluginApiVersion: "^2.5.0",
							permissions: ["storage.read"],
							artifact: { url: "https://example.com/demo-1.2.0.zip", sha256 },
						},
					],
				},
			],
		});
		const ability = manifest.abilities[0];
		if (!ability || ability.type !== "plugin") throw new Error("Plugin fixture is missing");
		mocks.installPluginFromArchive.mockImplementationOnce(async (archive, options) =>
			createInstalledPluginFromManifest({
				manifest: parsePluginManifest(JSON.parse(new AdmZip(archive).readAsText("plugin.json"))),
				options,
				locales: {},
				hostApiVersion: "2.5.0",
				rootPath: "unused",
				reloadToken: "1",
			}),
		);
		await installOpenMarketplaceAbilityInDesktop("unused", ability, {
			kind: "github-marketplace",
			sourceId: "test-source",
			marketplace: "test-market",
			marketplaceVersion: "3",
			repository: "https://github.com/example/test-market",
		});
		expect(mocks.installPluginFromArchive).toHaveBeenCalledWith(
			bytes,
			expect.objectContaining({
				expectedId: "demo-plugin",
				expectedVersion: "1.2.0",
				expectedSha256: sha256,
			}),
		);
		expect(mocks.recordAbilityInstall).toHaveBeenCalledWith("plugin", "demo-plugin", "1.2.0", expect.anything());
		expect(mocks.recordAppMonitorEvent).toHaveBeenCalledWith({
			type: "resource.lifecycle",
			resourceKind: "plugin",
			resourceId: "demo-plugin",
			operation: "installed",
			source: "remote",
		});
	});
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

	it.each<{ scenario: string; previousGrants?: PluginPermission[]; previousEnabled?: boolean }>([
		{ scenario: "fresh installation" },
		{ scenario: "update with existing consent", previousGrants: ["ui.slot.ability-detail"], previousEnabled: true },
		{ scenario: "update after permissions were revoked", previousGrants: [], previousEnabled: true },
		{ scenario: "update of a disabled plugin", previousGrants: ["ui.slot.ability-detail"], previousEnabled: false },
	])("preserves install consent and GitHub origin: $scenario", async ({ previousGrants, previousEnabled }) => {
		const snapshotRoot = await mkdtemp(join(tmpdir(), "vetta-open-production-test-"));
		temporaryRoots.push(snapshotRoot);
		const sourceDir = join(snapshotRoot, "abilities", "plugins", "demo-plugin");
		await mkdir(join(sourceDir, "dist"), { recursive: true });
		const pluginManifest: PluginManifest = {
			id: "demo-plugin",
			name: "Demo Plugin",
			version: "1.0.0",
			pluginApiVersion: "2.0.0",
			entry: "dist/index.js",
			moduleFederation: { remoteName: "demo_plugin", expose: "./plugin" },
			permissions: ["ui.slot.ability-detail", "network.fetch"],
			network: { allowedHosts: ["example.com"] },
		};
		await writeFile(join(sourceDir, "plugin.json"), JSON.stringify(pluginManifest), "utf-8");
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
		const packageInput = { locales: {}, hostApiVersion: "2.0.0", rootPath: sourceDir, reloadToken: "1" };
		const previous =
			previousGrants === undefined
				? undefined
				: createInstalledPluginFromManifest({
						...packageInput,
						manifest: { ...pluginManifest, version: "0.9.0" },
						options: { source: "remote", enable: previousEnabled, grantedPermissions: previousGrants },
					});
		mocks.installPluginFromArchive.mockImplementationOnce(async (archive, options) =>
			createInstalledPluginFromManifest({
				...packageInput,
				manifest: parsePluginManifest(JSON.parse(new AdmZip(archive).readAsText("plugin.json"))),
				previous,
				options,
			}),
		);

		await installOpenMarketplaceAbilityInDesktop(snapshotRoot, ability, origin);
		const installed = await mocks.installPluginFromArchive.mock.results[0]!.value;
		expect(installed.grantedPermissions).toEqual(previousGrants ?? []);
		expect(installed.grantedPermissions).not.toContain("network.fetch");
		expect(installed.enabled).toBe(previousEnabled ?? false);

		const archiveBuffer = mocks.installPluginFromArchive.mock.calls[0]?.[0];
		expect(Buffer.isBuffer(archiveBuffer)).toBe(true);
		expect(new AdmZip(archiveBuffer as Buffer).getEntry("plugin.json")).not.toBeNull();
		expect(installed.source).toBe("remote");
		// 安装即生效：台账记的是装完就在跑的版本，升级场景同样是新版本。
		expect(mocks.recordAbilityInstall).toHaveBeenCalledWith("plugin", "demo-plugin", "1.0.0", {
			origin,
			configVersion: 2,
			catalogId: "github:test-source:plugin:demo-plugin",
			slug: "demo-plugin",
		});
	});
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubMarketplaceOrigin } from "../../../preload/api-types/abilities";
import { OpenMarketplaceService } from "./open-marketplace-service";

const temporaryRoots: string[] = [];
const APP_VERSION = "0.5.11";
const originalRepository = process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY;
const originalRef = process.env.VETTA_OPEN_MARKETPLACE_REF;
const originalArchiveUrl = process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL;

function restoreEnvironment(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-open-marketplace-test-"));
	temporaryRoots.push(root);
	return root;
}

function archive(options?: {
	marketplaceVersion?: string;
	packageVersion?: string;
	description?: string;
	minAppVersion?: string;
}): Buffer {
	const marketplaceVersion = options?.marketplaceVersion ?? "2026.07.1";
	const packageVersion = options?.packageVersion ?? "1.0.0";
	const description = options?.description ?? "Demo ability";
	const manifest = {
		schemaVersion: 1,
		name: "vetta-open-abilities",
		marketplaceVersion,
		repository: "https://github.com/example/vetta-abilities",
		minAppVersion: options?.minAppVersion ?? APP_VERSION,
		abilities: [
			{
				type: "skill",
				slug: "demo-skill",
				name: "Demo Skill",
				description,
				version: "1.0.0",
				configVersion: 2,
				license: "MIT",
				source: { path: "abilities/skills/demo-skill" },
			},
		],
	};
	const zip = new AdmZip();
	zip.addFile("vetta-abilities-main/.vetta/marketplace.json", Buffer.from(JSON.stringify(manifest)));
	zip.addFile(
		"vetta-abilities-main/abilities/skills/demo-skill/SKILL.md",
		Buffer.from(`---\nname: demo-skill\ndescription: Demo ability\nversion: ${packageVersion}\n---\n\n# Demo\n`),
	);
	return zip.toBuffer();
}

function pluginBundleArchive(pluginId = "demo-plugin"): Buffer {
	const manifest = {
		schemaVersion: 1,
		name: "vetta-open-abilities",
		marketplaceVersion: "2026.07.3",
		repository: "https://github.com/example/vetta-abilities",
		minAppVersion: APP_VERSION,
		abilities: [
			{
				type: "plugin",
				slug: "demo-plugin",
				name: "Demo Plugin",
				description: "Open plugin",
				version: "1.0.0",
				configVersion: 2,
				source: { path: "abilities/plugins/demo-plugin" },
			},
			{
				type: "mcp",
				slug: "context7",
				name: "Context7",
				description: "Open MCP server",
				version: "1.0.0",
				configVersion: 3,
				source: { path: "abilities/mcp/context7" },
			},
			{
				type: "bundle",
				slug: "starter-bundle",
				name: "Starter Bundle",
				version: "1.0.0",
				config: {
					members: [
						{ type: "plugin", slug: "demo-plugin" },
						{ type: "mcp", slug: "context7" },
					],
				},
			},
		],
	};
	const pluginManifest = {
		id: pluginId,
		name: "Demo Plugin",
		version: "1.0.0",
		pluginApiVersion: "1.1.0",
		entry: "dist/index.js",
		permissions: ["storage.read"],
		commands: ["git"],
	};
	const zip = new AdmZip();
	zip.addFile("vetta-abilities-main/.vetta/marketplace.json", Buffer.from(JSON.stringify(manifest)));
	zip.addFile(
		"vetta-abilities-main/abilities/plugins/demo-plugin/plugin.json",
		Buffer.from(JSON.stringify(pluginManifest)),
	);
	zip.addFile("vetta-abilities-main/abilities/plugins/demo-plugin/dist/index.js", Buffer.from("export default {};\n"));
	zip.addFile(
		"vetta-abilities-main/abilities/mcp/context7/mcp.json",
		Buffer.from(
			JSON.stringify({
				schemaVersion: 1,
				slug: "context7",
				version: "1.0.0",
				server: { type: "http", url: "https://mcp.context7.com/mcp" },
			}),
		),
	);
	return zip.toBuffer();
}

function response(buffer: Buffer): Response {
	return new Response(new Uint8Array(buffer), {
		status: 200,
		headers: { "content-type": "application/zip", "content-length": String(buffer.byteLength) },
	});
}

function manifestResponse(buffer: Buffer): Response {
	const entry = new AdmZip(buffer).getEntry("vetta-abilities-main/.vetta/marketplace.json");
	if (!entry) throw new Error("Marketplace manifest fixture is missing");
	const body = entry.getData();
	return new Response(new Uint8Array(body), {
		status: 200,
		headers: { "content-type": "application/json", "content-length": String(body.byteLength) },
	});
}

beforeEach(() => {
	process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY = "https://github.com/example/vetta-abilities";
	process.env.VETTA_OPEN_MARKETPLACE_REF = "main";
	delete process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL;
});

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	restoreEnvironment("VETTA_OPEN_MARKETPLACE_REPOSITORY", originalRepository);
	restoreEnvironment("VETTA_OPEN_MARKETPLACE_REF", originalRef);
	restoreEnvironment("VETTA_OPEN_MARKETPLACE_ARCHIVE_URL", originalArchiveUrl);
});

describe("OpenMarketplaceService", () => {
	it("validates and activates a GitHub repository snapshot", async () => {
		const rootDir = await temporaryRoot();
		const service = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			fetchArchive: async () => response(archive()),
			now: () => new Date("2026-07-28T00:00:00.000Z"),
		});

		const snapshot = await service.refresh();

		expect(snapshot.error).toBeUndefined();
		expect(snapshot.sourceId).toBe("vetta-official");
		expect(snapshot.marketplaceVersion).toBe("2026.07.1");
		expect(snapshot.abilities[0]).toMatchObject({
			slug: "demo-skill",
			configVersion: 2,
			origin: { kind: "github-marketplace", marketplace: "vetta-open-abilities" },
		});
		const stored = await readFile(
			join(rootDir, "snapshots", "2026.07.1", "abilities", "skills", "demo-skill", "SKILL.md"),
			"utf-8",
		);
		expect(stored).toContain("name: demo-skill");
		const state: unknown = JSON.parse(await readFile(join(rootDir, "state.json"), "utf-8"));
		expect(state).toMatchObject({
			schemaVersion: 1,
			sourceId: "vetta-official",
			ref: "main",
			marketplaceVersion: "2026.07.1",
		});
	});

	it("does not reuse state after the configured source identity changes", async () => {
		const rootDir = await temporaryRoot();
		const first = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			sourceId: "source",
			sourceRef: "main",
			repository: "https://github.com/example/first",
			archiveUrl: "https://github.com/example/first/archive/refs/heads/main.zip",
			fetchArchive: async () => response(archive({ description: "First" })),
		});
		await first.refresh();
		const second = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			sourceId: "source",
			sourceRef: "next",
			repository: "https://github.com/example/second",
			archiveUrl: "https://github.com/example/second/archive/refs/heads/next.zip",
			fetchArchive: async () => response(archive({ description: "Second" })),
		});

		expect(await second.listCached()).toMatchObject({
			abilities: [],
			marketplaceVersion: null,
			stale: true,
		});
		const snapshot = await second.refresh();
		expect(snapshot.abilities[0]?.description).toBe("Second");
		const state: unknown = JSON.parse(await readFile(join(rootDir, "state.json"), "utf-8"));
		expect(state).toMatchObject({
			repository: "https://github.com/example/second",
			ref: "next",
		});
	});

	it("validates and lists MCP, plugin and bundle entries", async () => {
		const rootDir = await temporaryRoot();
		const installAbility = vi.fn(
			async (_snapshotRoot: string, _ability: object, _origin: GitHubMarketplaceOrigin) => undefined,
		);
		const service = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			fetchArchive: async () => response(pluginBundleArchive()),
			installAbility,
		});

		const snapshot = await service.refresh();
		const plugin = snapshot.abilities.find((ability) => ability.type === "plugin");
		const mcp = snapshot.abilities.find((ability) => ability.type === "mcp");
		const bundle = snapshot.abilities.find((ability) => ability.type === "bundle");
		expect(plugin?.config).toEqual({
			api_version: "1.1.0",
			permissions: ["storage.read"],
			commands: ["git"],
		});
		expect(mcp).toMatchObject({
			slug: "context7",
			configVersion: 3,
			config: { mcp: { type: "http", url: "https://mcp.context7.com/mcp" } },
			origin: { kind: "github-marketplace", sourceId: "vetta-official" },
		});
		expect(bundle?.config.members).toEqual([
			{
				type: "plugin",
				slug: "demo-plugin",
				exists: true,
				name: "Demo Plugin",
				icon: "",
				version: "1.0.0",
			},
			{
				type: "mcp",
				slug: "context7",
				exists: true,
				name: "Context7",
				icon: "",
				version: "1.0.0",
			},
		]);

		await service.install("plugin", "demo-plugin");
		expect(installAbility).toHaveBeenCalledOnce();
		expect(installAbility.mock.calls[0]?.[1]).toMatchObject({ type: "plugin", slug: "demo-plugin" });
	});

	it("rejects a plugin package whose manifest identity does not match", async () => {
		const service = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir: await temporaryRoot(),
			fetchArchive: async () => response(pluginBundleArchive("other-plugin")),
		});

		expect(await service.refresh()).toMatchObject({
			abilities: [],
			marketplaceVersion: null,
			error: "sync-failed",
		});
	});

	it("keeps the last usable snapshot when content changes without a marketplace version bump", async () => {
		const rootDir = await temporaryRoot();
		let body = archive({ description: "First" });
		const service = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			fetchArchive: async () => response(body),
		});
		await service.refresh();
		body = archive({ description: "Changed without version bump" });

		const fallback = await service.refresh();

		expect(fallback.error).toBe("sync-failed");
		expect(fallback.stale).toBe(true);
		expect(fallback.abilities[0]?.description).toBe("First");
	});

	it("activates a catalog when the desktop app meets minAppVersion", async () => {
		const service = new OpenMarketplaceService({
			rootDir: await temporaryRoot(),
			appVersion: APP_VERSION,
			fetchArchive: async () => response(archive({ minAppVersion: "0.5.11" })),
		});

		const snapshot = await service.refresh();

		expect(snapshot).toMatchObject({ marketplaceVersion: "2026.07.1", stale: false });
	});

	it("keeps the last compatible snapshot when a newer catalog requires a newer app", async () => {
		const rootDir = await temporaryRoot();
		let body = archive({ marketplaceVersion: "2026.07.1", description: "Compatible" });
		const service = new OpenMarketplaceService({
			rootDir,
			appVersion: APP_VERSION,
			fetchArchive: async () => response(body),
		});
		await service.refresh();
		body = archive({ marketplaceVersion: "2026.08.1", description: "Future", minAppVersion: "0.6.0" });

		const fallback = await service.refresh();

		expect(fallback).toMatchObject({ marketplaceVersion: "2026.07.1", stale: true, error: "sync-failed" });
		expect(fallback.abilities[0]?.description).toBe("Compatible");
	});

	it("rejects an incompatible catalog when no compatible snapshot exists", async () => {
		const service = new OpenMarketplaceService({
			rootDir: await temporaryRoot(),
			appVersion: APP_VERSION,
			fetchArchive: async () => response(archive({ minAppVersion: "0.6.0" })),
		});

		const snapshot = await service.refresh();

		expect(snapshot).toMatchObject({ abilities: [], marketplaceVersion: null, stale: true, error: "sync-failed" });
	});

	it("does not activate a catalog when SKILL.md version disagrees with the catalog", async () => {
		const rootDir = await temporaryRoot();
		const service = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			fetchArchive: async () => response(archive({ packageVersion: "2.0.0" })),
		});

		const snapshot = await service.refresh();

		expect(snapshot).toMatchObject({ abilities: [], marketplaceVersion: null, error: "sync-failed" });
	});

	it("returns cached data immediately and skips the archive when the remote version is unchanged", async () => {
		const rootDir = await temporaryRoot();
		const initial = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			fetchArchive: async () => response(archive()),
		});
		await initial.refresh();
		const fetchArchive = vi.fn(async () => response(archive()));
		const fetchManifest = vi.fn(async () => manifestResponse(archive()));
		const service = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			fetchArchive,
			fetchManifest,
		});

		const snapshot = await service.list();

		expect(snapshot.marketplaceVersion).toBe("2026.07.1");
		expect(snapshot.error).toBeUndefined();
		await vi.waitFor(() => expect(fetchManifest).toHaveBeenCalledOnce());
		expect(fetchManifest).toHaveBeenCalledWith(
			"https://github.com/example/vetta-abilities/raw/refs/heads/main/.vetta/marketplace.json",
			expect.objectContaining({ redirect: "follow" }),
		);
		expect(fetchArchive).not.toHaveBeenCalled();
	});

	it("updates the cache in the background and exposes it on the next list", async () => {
		const rootDir = await temporaryRoot();
		const initial = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			fetchArchive: async () => response(archive({ marketplaceVersion: "2026.07.1", description: "Old" })),
		});
		await initial.refresh();
		const updatedArchive = archive({ marketplaceVersion: "2026.07.2", description: "Updated" });
		const fetchArchive = vi.fn(async () => response(updatedArchive));
		const onBackgroundUpdate = vi.fn();
		const service = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			fetchArchive,
			fetchManifest: async () => manifestResponse(updatedArchive),
			onBackgroundUpdate,
		});

		const current = await service.list();

		expect(current).toMatchObject({ marketplaceVersion: "2026.07.1" });
		await vi.waitFor(async () => {
			const state: unknown = JSON.parse(await readFile(join(rootDir, "state.json"), "utf-8"));
			expect(state).toMatchObject({ marketplaceVersion: "2026.07.2" });
		});
		expect(fetchArchive).toHaveBeenCalledOnce();
		expect(onBackgroundUpdate).toHaveBeenCalledWith(expect.objectContaining({ marketplaceVersion: "2026.07.2" }));
		const next = await service.list();
		expect(next).toMatchObject({ marketplaceVersion: "2026.07.2" });
		expect(next.abilities[0]?.description).toBe("Updated");
	});

	it("keeps cached data without surfacing background update failures", async () => {
		const rootDir = await temporaryRoot();
		const initial = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			fetchArchive: async () => response(archive()),
		});
		await initial.refresh();
		const fetchManifest = vi.fn(async () => {
			throw new Error("offline");
		});
		const service = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			fetchManifest,
		});

		const snapshot = await service.list();

		expect(snapshot).toMatchObject({ marketplaceVersion: "2026.07.1", stale: false });
		expect(snapshot.error).toBeUndefined();
		await vi.waitFor(() => expect(fetchManifest).toHaveBeenCalledOnce());
	});

	it("can read cached data without triggering a download", async () => {
		const rootDir = await temporaryRoot();
		const fetchArchive = vi.fn(async () => response(archive()));
		const service = new OpenMarketplaceService({ appVersion: APP_VERSION, rootDir, fetchArchive });

		const empty = await service.listCached();

		expect(empty).toMatchObject({ sourceId: "vetta-official", abilities: [], stale: true });
		expect(fetchArchive).not.toHaveBeenCalled();
	});

	it("installs only from the active validated snapshot", async () => {
		const rootDir = await temporaryRoot();
		const installAbility = vi.fn(
			async (_snapshotRoot: string, _ability: object, _origin: GitHubMarketplaceOrigin) => undefined,
		);
		const service = new OpenMarketplaceService({
			appVersion: APP_VERSION,
			rootDir,
			fetchArchive: async () => response(archive()),
			installAbility,
		});
		await service.refresh();

		await service.install("skill", "demo-skill");

		expect(installAbility).toHaveBeenCalledOnce();
		expect(installAbility.mock.calls[0]?.[0]).toBe(join(rootDir, "snapshots", "2026.07.1"));
		expect(installAbility.mock.calls[0]?.[1]).toMatchObject({ slug: "demo-skill", configVersion: 2 });
		expect(installAbility.mock.calls[0]?.[2]).toMatchObject({
			kind: "github-marketplace",
			marketplaceVersion: "2026.07.1",
		});
	});
});

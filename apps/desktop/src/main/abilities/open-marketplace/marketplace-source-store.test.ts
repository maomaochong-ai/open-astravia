import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceSource } from "../../../preload/api-types/abilities";
import { MarketplaceSourceStore } from "./marketplace-source-store";

const temporaryRoots: string[] = [];
const originalRepository = process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY;
const originalRef = process.env.VETTA_OPEN_MARKETPLACE_REF;
const originalArchiveUrl = process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL;
const originalCloudEnabled = process.env.VETTA_CLOUD_ENABLED;

beforeEach(() => {
	vi.stubEnv("VETTA_BUILD_ENV", "development");
});

function restoreEnvironment(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

async function temporaryFile(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-marketplace-sources-test-"));
	temporaryRoots.push(root);
	return join(root, "sources.json");
}

function builtinSource(): MarketplaceSource {
	return {
		id: "official",
		name: "Official",
		type: "github",
		repository: "https://github.com/example/official",
		archiveUrl: "https://github.com/example/official/archive/refs/heads/main.zip",
		ref: "main",
		enabled: true,
		builtin: true,
		autoUpdate: true,
		priority: 100,
		createdAt: "2026-07-28T00:00:00.000Z",
		updatedAt: "2026-07-28T00:00:00.000Z",
	};
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	vi.unstubAllEnvs();
	restoreEnvironment("VETTA_OPEN_MARKETPLACE_REPOSITORY", originalRepository);
	restoreEnvironment("VETTA_OPEN_MARKETPLACE_REF", originalRef);
	restoreEnvironment("VETTA_OPEN_MARKETPLACE_ARCHIVE_URL", originalArchiveUrl);
	restoreEnvironment("VETTA_CLOUD_ENABLED", originalCloudEnabled);
});

describe("MarketplaceSourceStore", () => {
	it("creates a GitHub source in cloud builds without an extra flag", async () => {
		process.env.VETTA_CLOUD_ENABLED = "true";
		process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY = "https://github.com/example/environment-market";
		delete process.env.VETTA_OPEN_MARKETPLACE_REF;
		delete process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL;

		expect(new MarketplaceSourceStore({ filePath: await temporaryFile() }).list()).toMatchObject([
			{ repository: "https://github.com/example/environment-market" },
		]);
	});

	it("derives the GitHub archive URL in cloud development", async () => {
		process.env.VETTA_CLOUD_ENABLED = "true";
		process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY = "https://github.com/example/environment-market";
		process.env.VETTA_OPEN_MARKETPLACE_REF = "main";
		delete process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL;

		expect(new MarketplaceSourceStore({ filePath: await temporaryFile() }).list()).toMatchObject([
			{
				id: "vetta-official",
				repository: "https://github.com/example/environment-market",
				archiveUrl: "https://github.com/example/environment-market/archive/refs/heads/main.zip",
			},
		]);
	});

	it.each(["production", "test", "opensource"])("keeps GitHub sources independent in %s mode", async (mode) => {
		vi.stubEnv("VETTA_BUILD_ENV", mode);
		process.env.VETTA_CLOUD_ENABLED = "true";
		process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY = "example/environment-market";

		expect(new MarketplaceSourceStore({ filePath: await temporaryFile() }).list()).toHaveLength(1);
	});

	it("upgrades an empty cloud catalog and preserves user switches across editions", async () => {
		process.env.VETTA_CLOUD_ENABLED = "true";
		process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY = "example/environment-market";
		delete process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL;
		const filePath = await temporaryFile();
		await writeFile(filePath, JSON.stringify({ version: 1, sources: [] }));

		const enabled = new MarketplaceSourceStore({ filePath });
		expect(enabled.list()).toHaveLength(1);
		enabled.update("vetta-official", { enabled: false, autoUpdate: false });
		process.env.VETTA_CLOUD_ENABLED = "false";
		expect(new MarketplaceSourceStore({ filePath }).list()).toMatchObject([
			{ id: "vetta-official", enabled: false, autoUpdate: false },
		]);
	});

	it.each(["true", "false"])("does not register an unconfigured repository with cloud=%s", async (cloud) => {
		vi.stubEnv("VETTA_CLOUD_ENABLED", cloud);
		for (const repository of [undefined, "", "   "]) {
			vi.stubEnv("VETTA_OPEN_MARKETPLACE_REPOSITORY", repository);
			expect(new MarketplaceSourceStore({ filePath: await temporaryFile() }).list()).toEqual([]);
		}
	});

	it("preserves persisted sources when the distribution no longer configures a default", async () => {
		vi.stubEnv("VETTA_OPEN_MARKETPLACE_REPOSITORY", undefined);
		vi.stubEnv("VETTA_CLOUD_ENABLED", "true");
		const filePath = await temporaryFile();
		const previous = new MarketplaceSourceStore({ filePath, defaultSources: [builtinSource()] });
		previous.update("official", { enabled: false, autoUpdate: false });
		const custom = previous.add({ repository: "example/community", ref: "stable" });
		const sources = new MarketplaceSourceStore({ filePath }).list();
		expect(sources).toHaveLength(2);
		expect(sources[0]).toMatchObject({ id: "official", enabled: false, autoUpdate: false });
		expect(sources[1]).toEqual(custom);
	});

	it("creates the built-in source entirely from environment configuration", async () => {
		delete process.env.VETTA_CLOUD_ENABLED;
		process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY = "https://github.com/example/environment-market";
		process.env.VETTA_OPEN_MARKETPLACE_REF = "testing/v2";
		delete process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL;
		const store = new MarketplaceSourceStore({ filePath: await temporaryFile() });

		expect(store.list()).toMatchObject([
			{
				id: "vetta-official",
				repository: "https://github.com/example/environment-market",
				ref: "testing/v2",
				archiveUrl: "https://github.com/example/environment-market/archive/refs/heads/testing/v2.zip",
			},
		]);
	});

	it("persists the built-in source on first read", async () => {
		const filePath = await temporaryFile();
		const store = new MarketplaceSourceStore({ filePath, defaultSources: [builtinSource()] });

		expect(store.list()).toEqual([builtinSource()]);
		expect(JSON.parse(await readFile(filePath, "utf-8"))).toMatchObject({
			version: 1,
			sources: [{ id: "official" }],
		});
	});

	it("preserves a manually added default repository without duplicating or resurrecting it", async () => {
		const filePath = await temporaryFile();
		const legacy = new MarketplaceSourceStore({ filePath, defaultSources: [] });
		const custom = legacy.add({ repository: "EXAMPLE/official", name: "My source", ref: "stable" });
		const disabled = legacy.update(custom.id, { enabled: false, autoUpdate: false });
		const upgraded = new MarketplaceSourceStore({ filePath, defaultSources: [builtinSource()] });
		expect(upgraded.list()).toEqual([disabled]);
		upgraded.remove(custom.id);
		expect(new MarketplaceSourceStore({ filePath, defaultSources: [builtinSource()] }).list()).toEqual([]);
	});

	it("does not retarget a built-in to a repository already registered by the user", async () => {
		const filePath = await temporaryFile();
		const first = new MarketplaceSourceStore({ filePath, defaultSources: [builtinSource()] });
		const custom = first.add({ repository: "example/new-default" });
		const updatedDefault = { ...builtinSource(), repository: custom.repository, archiveUrl: custom.archiveUrl };
		const sources = new MarketplaceSourceStore({ filePath, defaultSources: [updatedDefault] }).list();
		expect(sources).toHaveLength(2);
		expect(sources.find((item) => item.id === custom.id)).toEqual(custom);
		expect(sources.find((item) => item.id === "official")).toMatchObject({ repository: builtinSource().repository });
	});

	it("normalizes, updates and removes a custom GitHub source", async () => {
		const filePath = await temporaryFile();
		let tick = 0;
		const store = new MarketplaceSourceStore({
			filePath,
			defaultSources: [builtinSource()],
			now: () => new Date(`2026-07-28T00:00:0${tick++}.000Z`),
		});

		const added = store.add({ repository: "Example/community.git", name: "Community", ref: "stable" });
		expect(added).toMatchObject({
			id: "github-example-community",
			repository: "https://github.com/Example/community",
			archiveUrl: "https://github.com/Example/community/archive/refs/heads/stable.zip",
		});

		const updated = store.update(added.id, { ref: "release/v2", enabled: false, autoUpdate: false });
		expect(updated).toMatchObject({
			ref: "release/v2",
			enabled: false,
			autoUpdate: false,
			archiveUrl: "https://github.com/Example/community/archive/refs/heads/release/v2.zip",
		});

		store.remove(added.id);
		expect(store.list().map((source) => source.id)).toEqual(["official"]);
	});

	it("applies built-in configuration updates while preserving user switches", async () => {
		const filePath = await temporaryFile();
		const first = new MarketplaceSourceStore({ filePath, defaultSources: [builtinSource()] });
		first.list();
		first.update("official", { enabled: false, autoUpdate: false });
		const updatedDefault: MarketplaceSource = {
			...builtinSource(),
			name: "Official v2",
			repository: "https://github.com/example/official-v2",
			archiveUrl: "https://github.com/example/official-v2/archive/refs/heads/stable.zip",
			ref: "stable",
		};

		const second = new MarketplaceSourceStore({ filePath, defaultSources: [updatedDefault] });

		expect(second.list()[0]).toMatchObject({
			name: "Official v2",
			repository: updatedDefault.repository,
			archiveUrl: updatedDefault.archiveUrl,
			ref: "stable",
			enabled: false,
			autoUpdate: false,
		});
	});

	it("rejects duplicates, invalid refs and removal of built-in sources", async () => {
		const store = new MarketplaceSourceStore({
			filePath: await temporaryFile(),
			defaultSources: [builtinSource()],
		});
		store.add({ repository: "example/community" });

		expect(() => store.add({ repository: "https://github.com/example/community" })).toThrow("already exists");
		expect(() => store.add({ repository: "example/another", ref: "../main" })).toThrow("ref is invalid");
		expect(() => store.update("official", { ref: "next" })).toThrow("configuration cannot be changed");
		expect(() => store.remove("official")).toThrow("cannot be removed");
	});
});

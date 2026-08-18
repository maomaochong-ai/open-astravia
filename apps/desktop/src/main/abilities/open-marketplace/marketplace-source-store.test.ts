import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketplaceSource } from "../../../preload/api-types/abilities";
import { MarketplaceSourceStore } from "./marketplace-source-store";

const temporaryRoots: string[] = [];
const originalRepository = process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY;
const originalRef = process.env.VETTA_OPEN_MARKETPLACE_REF;
const originalArchiveUrl = process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL;

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
	restoreEnvironment("VETTA_OPEN_MARKETPLACE_REPOSITORY", originalRepository);
	restoreEnvironment("VETTA_OPEN_MARKETPLACE_REF", originalRef);
	restoreEnvironment("VETTA_OPEN_MARKETPLACE_ARCHIVE_URL", originalArchiveUrl);
});

describe("MarketplaceSourceStore", () => {
	it("does not create a built-in source without an environment repository", async () => {
		delete process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY;
		delete process.env.VETTA_OPEN_MARKETPLACE_REF;
		delete process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL;
		const store = new MarketplaceSourceStore({ filePath: await temporaryFile() });

		expect(store.list()).toEqual([]);

		const persistedFile = await temporaryFile();
		new MarketplaceSourceStore({ filePath: persistedFile, defaultSources: [builtinSource()] }).list();
		expect(new MarketplaceSourceStore({ filePath: persistedFile }).list()).toEqual([]);
	});

	it("creates the built-in source entirely from environment configuration", async () => {
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

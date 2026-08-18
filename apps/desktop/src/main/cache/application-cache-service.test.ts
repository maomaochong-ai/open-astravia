import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationCacheService } from "./application-cache-service";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "vetta-application-cache-test-"));
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe("ApplicationCacheService", () => {
	it("isolates cache paths by namespace", () => {
		const cache = new ApplicationCacheService(rootDir);

		expect(cache.namespace("marketplace").path("catalogs", "source.json")).toBe(
			join(rootDir, "marketplace", "catalogs", "source.json"),
		);
		expect(cache.namespace("previews").rootDir).toBe(join(rootDir, "previews"));
	});

	it("rejects invalid namespaces and paths outside a namespace", () => {
		const cache = new ApplicationCacheService(rootDir);
		const marketplace = cache.namespace("marketplace");

		expect(() => cache.namespace("../marketplace")).toThrow("Invalid cache namespace");
		expect(() => marketplace.path("..", "state.json")).toThrow("escapes namespace");
		expect(() => marketplace.path(resolve(rootDir, "outside"))).toThrow("Invalid cache path part");
	});

	it("creates temporary directories and clears only the selected namespace", async () => {
		const cache = new ApplicationCacheService(rootDir);
		const marketplace = cache.namespace("marketplace");
		const previews = cache.namespace("previews");
		await marketplace.ensure();
		await previews.ensure();
		await writeFile(marketplace.path("catalog.json"), "{}", "utf-8");
		await writeFile(previews.path("preview.txt"), "preview", "utf-8");
		const temporaryDirectory = await marketplace.createTemporaryDirectory("sync");

		expect(temporaryDirectory.startsWith(join(rootDir, ".temp", "marketplace"))).toBe(true);
		await marketplace.clear();

		expect(existsSync(marketplace.rootDir)).toBe(false);
		expect(existsSync(marketplace.temporaryRootDir)).toBe(false);
		expect(existsSync(previews.path("preview.txt"))).toBe(true);
	});
});

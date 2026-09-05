import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({ home: "" }));
vi.mock("@vetta/action-rpc", () => ({ getVettaHomePath: () => mockState.home }));

import {
	commitPluginStorage,
	listPluginFiles,
	readPluginFile,
	readPluginStorageSnapshot,
} from "./plugin-storage-service.js";

describe("plugin storage commits", () => {
	beforeAll(async () => {
		mockState.home = await mkdtemp(join(tmpdir(), "vetta-plugin-storage-"));
	});

	afterAll(async () => {
		await rm(mockState.home, { recursive: true, force: true });
	});

	it("publishes multiple logical files through one revision", async () => {
		const committed = await commitPluginStorage("atomic-plugin", [
			{ type: "write", path: "city.json", data: '{"cities":[]}', encoding: "utf8" },
			{ type: "write", path: "project.json", data: "", encoding: "utf8" },
			{ type: "write", path: "manifest.json", data: '{"schemaVersion":1}', encoding: "utf8" },
		]);

		const snapshot = await readPluginStorageSnapshot(
			"atomic-plugin",
			["city.json", "project.json", "manifest.json"],
			"utf8",
		);

		expect(snapshot).toEqual({
			revision: committed.revision,
			files: {
				"city.json": '{"cities":[]}',
				"project.json": "",
				"manifest.json": '{"schemaVersion":1}',
			},
		});
		expect(await listPluginFiles("atomic-plugin")).toEqual(["city.json", "manifest.json", "project.json"]);
	});

	it("uses expectedRevision for optimistic concurrency and supports removal", async () => {
		const initial = await commitPluginStorage("conflict-plugin", [
			{ type: "write", path: "settings.json", data: "{}", encoding: "utf8" },
		]);
		const next = await commitPluginStorage(
			"conflict-plugin",
			[{ type: "remove", path: "settings.json" }],
			initial.revision,
		);

		await expect(
			commitPluginStorage(
				"conflict-plugin",
				[{ type: "write", path: "settings.json", data: "stale", encoding: "utf8" }],
				initial.revision,
			),
		).rejects.toThrow("revision conflict");
		expect(await readPluginFile("conflict-plugin", "settings.json", "utf8")).toBeNull();
		expect(next.revision).not.toBe(initial.revision);
	});

	it("ignores an unreferenced revision until HEAD is atomically switched", async () => {
		const committed = await commitPluginStorage("crash-plugin", [
			{ type: "write", path: "city.json", data: "old", encoding: "utf8" },
		]);
		const metadataRoot = join(mockState.home, "plugin-data", "crash-plugin", ".storage");
		await mkdir(join(metadataRoot, "objects"), { recursive: true });
		await mkdir(join(metadataRoot, "revisions"), { recursive: true });
		await writeFile(join(metadataRoot, "objects", "orphan.bin"), "new");
		await writeFile(
			join(metadataRoot, "revisions", "orphan.json"),
			JSON.stringify({
				schemaVersion: 1,
				revision: "orphan",
				files: { "city.json": { objectId: "orphan", sizeBytes: 3, modifiedAt: 0 } },
			}),
		);

		expect(await readFile(join(metadataRoot, "HEAD"), "utf8")).toBe(committed.revision);
		expect(await readPluginFile("crash-plugin", "city.json", "utf8")).toBe("old");
	});

	it("bootstraps existing direct files without treating blob internals as logical files", async () => {
		const root = join(mockState.home, "plugin-data", "legacy-plugin");
		await mkdir(join(root, "blobs"), { recursive: true });
		await writeFile(join(root, "settings"), '{"enabled":true}');
		await writeFile(join(root, "blobs", "image.blob"), "bytes");

		expect(await readPluginFile("legacy-plugin", "settings", "utf8")).toBe('{"enabled":true}');
		expect(await listPluginFiles("legacy-plugin")).toEqual(["settings"]);
	});

	it("rejects logical access to host metadata", async () => {
		await expect(
			commitPluginStorage("reserved-plugin", [
				{ type: "write", path: ".storage/HEAD", data: "forged", encoding: "utf8" },
			]),
		).rejects.toThrow("reserved");
		await expect(readPluginStorageSnapshot("reserved-plugin", [".storage/HEAD"], "utf8")).rejects.toThrow("reserved");
		await expect(
			commitPluginStorage("reserved-plugin", [
				{ type: "write", path: "C:/outside.json", data: "forged", encoding: "utf8" },
			]),
		).rejects.toThrow("Invalid plugin storage path");
	});

	it("rejects empty transactions instead of publishing no-op revisions", async () => {
		await expect(commitPluginStorage("empty-plugin", [])).rejects.toThrow("between 1 and 128");
	});
});

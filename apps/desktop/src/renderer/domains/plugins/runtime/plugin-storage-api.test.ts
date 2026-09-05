import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginStorageApi, type PluginStorageBridge } from "./plugin-storage-api";

const storageList = vi.fn(async () => ["city.json"]);
const storageReadFile = vi.fn(async () => "city");
const storageReadSnapshot = vi.fn(async () => ({
	revision: "revision-1",
	files: { "city.json": "city", "project.json": "project" },
}));
const storageCommit = vi.fn(async () => ({ revision: "revision-2", changedPaths: ["city.json"] }));

describe("plugin storage API", () => {
	const requireRead = vi.fn();
	const requireWrite = vi.fn();
	const bridge = {
		storageList,
		storageReadFile,
		storageReadSnapshot,
		storageCommit,
	} as unknown as PluginStorageBridge;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses an explicit encoding for file reads and maps single writes to commit", async () => {
		const storage = createPluginStorageApi("session-1", bridge, requireRead, requireWrite);

		await expect(storage.readFile("city.json", "utf8")).resolves.toBe("city");
		await expect(storage.writeFile("city.json", "", "utf8")).resolves.toMatchObject({ revision: "revision-2" });

		expect(storageReadFile).toHaveBeenCalledWith("session-1", "city.json", "utf8");
		expect(requireRead).toHaveBeenCalledOnce();
		expect(storageCommit).toHaveBeenCalledWith("session-1", [
			{ type: "write", path: "city.json", data: "", encoding: "utf8" },
		]);
		expect(requireWrite).toHaveBeenCalledOnce();
	});

	it("forwards multi-file commits, removals, snapshots, and expected revisions", async () => {
		const storage = createPluginStorageApi("session-1", bridge, requireRead, requireWrite);
		const changes = [
			{ type: "write", path: "city.json", data: "city", encoding: "utf8" },
			{ type: "remove", path: "old.json" },
		] as const;

		await storage.commit(changes, { expectedRevision: "revision-1" });
		await expect(storage.readSnapshot(["city.json", "project.json"], "utf8")).resolves.toMatchObject({
			revision: "revision-1",
		});

		expect(storageCommit).toHaveBeenCalledWith("session-1", changes, "revision-1");
		expect(storageReadSnapshot).toHaveBeenCalledWith("session-1", ["city.json", "project.json"], "utf8");
	});
});

import type { PluginFsApi, PluginStorageApi } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { createContentProject } from "../src/project/types";
import { PluginContentProjectRepository } from "../src/project/repository";

function createFsHarness() {
	const files = new Map<string, string>();
	const directories: string[] = [];
	const fs: PluginFsApi = {
		readDir: async () => [],
		readFile: async (path) => ({ content: files.get(path) ?? "", encoding: "utf8" }),
		readBinaryFile: async () => ({ data: "", mimeType: "application/octet-stream", size: 0 }),
		writeFile: async (path, content) => {
			files.set(path, content);
		},
		stat: async (path) => (files.has(path) ? { size: files.get(path)?.length ?? 0, modifiedAt: 0, createdAt: 0 } : null),
		rename: async () => undefined,
		delete: async () => undefined,
		move: async () => undefined,
		createDirectory: async (path) => {
			directories.push(path);
		},
		listFilesRecursive: async () => [],
		saveAs: async () => null,
		watchDirectory: () => ({ dispose: () => undefined }),
	};
	return { fs, files, directories };
}

function createStorage(): PluginStorageApi {
	const json = new Map<string, unknown>();
	return {
		readJson: async <T>(key: string) => (json.get(key) as T | undefined) ?? null,
		writeJson: async (key, value) => {
			json.set(key, structuredClone(value));
		},
		list: async () => [],
		readFile: async () => null,
		writeFile: async () => undefined,
		putBlob: async () => ({ id: "blob", url: "blob:test", mimeType: "application/octet-stream" }),
		readBlob: async () => null,
		getBlobRef: async () => null,
	};
}

describe("PluginContentProjectRepository", () => {
	it("stores a visible project document at the active Windows project root", async () => {
		const harness = createFsHarness();
		const repository = new PluginContentProjectRepository(harness.fs, createStorage());
		const project = createContentProject("C:\\project");

		await repository.write("C:\\project", project);

		expect(harness.directories).toEqual([]);
		expect(harness.files.has("C:\\project\\content-creation.json")).toBe(true);
		expect(await repository.read("C:\\project")).toMatchObject({ projectId: project.projectId, cwd: "C:\\project" });
	});

	it("copies a legacy hidden project document to the visible project path", async () => {
		const harness = createFsHarness();
		const repository = new PluginContentProjectRepository(harness.fs, createStorage());
		const project = createContentProject("C:\\project");
		harness.files.set("C:\\project\\.vetta\\content-creation\\project.json", JSON.stringify(project));

		expect(await repository.read("C:\\project")).toMatchObject({ projectId: project.projectId });
		expect(harness.files.has("C:\\project\\content-creation.json")).toBe(true);
	});

	it("uses plugin storage when no project directory exists", async () => {
		const harness = createFsHarness();
		const repository = new PluginContentProjectRepository(harness.fs, createStorage());
		const project = createContentProject(null);

		await repository.write(null, project);

		expect(harness.files.size).toBe(0);
		expect(await repository.read(null)).toMatchObject({ projectId: project.projectId, cwd: null });
	});
});

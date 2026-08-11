import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { ContentAssetImportService } from "../src/generation/asset-import-service";
import { ContentLocalAssetError, ContentLocalAssetService } from "../src/generation/local-asset-service";
import type { ContentArtifactStore } from "../src/generation/types";
import type { ContentProjectRepository } from "../src/project/repository";
import { ContentCreationWorkspace } from "../src/project/workspace";

function createFixture(overrides: Partial<PluginFsApi> = {}) {
	const fs = {
		stat: vi.fn(async () => ({ size: 4, modifiedAt: 0, createdAt: 0 })),
		readDir: vi.fn(async () => {
			throw new Error("ENOTDIR");
		}),
		listFilesRecursive: vi.fn(async () => []),
		readBinaryFile: vi.fn(async () => ({ data: "aW1hZ2U=", mimeType: "image/png", size: 5 })),
		...overrides,
	} as unknown as PluginFsApi;
	const repository: ContentProjectRepository = {
		read: vi.fn(async () => null),
		write: vi.fn(async () => undefined),
	};
	const workspace = new ContentCreationWorkspace(repository);
	const putImported = vi.fn<ContentArtifactStore["putImported"]>(async (id, content) => ({
		blobId: `blob-${id}`,
		mimeType: content.mimeType,
	}));
	const artifacts = {
		putImported,
		putGenerated: vi.fn(),
		releaseGenerated: vi.fn(),
		readReference: vi.fn(),
	} as unknown as ContentArtifactStore;
	const imports = new ContentAssetImportService(workspace, artifacts);
	return { fs, workspace, putImported, service: new ContentLocalAssetService(fs, imports) };
}

describe("ContentLocalAssetService", () => {
	it("imports an explicit desktop image through the host preview-readable boundary", async () => {
		const fixture = createFixture({
			stat: vi.fn(async () => {
				throw new Error("Path is outside any known project directory");
			}),
		});

		const result = await fixture.service.import({
			projectDir: "C:/project",
			paths: ["C:/Users/admin/Desktop/hero.png"],
			expectedRevision: 0,
			nodeName: "Product hero",
		});

		expect(result.project.revision).toBe(1);
		expect(result.project.graph.nodes).toEqual([
			expect.objectContaining({
				id: result.assetNodeId,
				kind: "asset",
				name: "Product hero",
				data: { assetIds: [result.assets[0]?.id] },
			}),
		]);
		expect(result.assets[0]).toMatchObject({
			name: "hero.png",
			kind: "image",
			mimeType: "image/png",
			blobId: expect.stringMatching(/^blob-/),
		});
		expect(fixture.putImported).toHaveBeenCalledOnce();
		expect(fixture.fs.readBinaryFile).toHaveBeenCalledOnce();
	});

	it("lists directory candidates without importing media bytes", async () => {
		const fixture = createFixture({
			readDir: vi.fn(async () => [
				{ name: "hero.png", path: "C:/media/hero.png", isDirectory: false, size: 10, modifiedAt: 0 },
				{ name: "notes.txt", path: "C:/media/notes.txt", isDirectory: false, size: 20, modifiedAt: 0 },
			]),
		});

		const candidates = await fixture.service.list(["C:/media"]);

		expect(candidates).toEqual([
			{ path: "C:/media/hero.png", name: "hero.png", size: 10, kind: "image", mimeType: "image/png" },
		]);
		expect(fixture.fs.readBinaryFile).not.toHaveBeenCalled();
	});

	it("requires an explicit choice before importing a multi-file directory", async () => {
		const fixture = createFixture({
			readDir: vi.fn(async () => [
				{ name: "first.png", path: "C:/media/first.png", isDirectory: false, size: 10, modifiedAt: 0 },
				{ name: "last.png", path: "C:/media/last.png", isDirectory: false, size: 10, modifiedAt: 0 },
			]),
		});

		await expect(fixture.service.import({ projectDir: "C:/project", paths: ["C:/media"] })).rejects.toMatchObject({
			code: "local-media-selection-required",
			details: { candidates: expect.arrayContaining([expect.objectContaining({ name: "first.png" })]) },
		} satisfies Partial<ContentLocalAssetError>);
		expect(fixture.putImported).not.toHaveBeenCalled();
	});

	it("imports all directory media only when directoryMode is explicit", async () => {
		const fixture = createFixture({
			readDir: vi.fn(async () => [
				{ name: "first.png", path: "C:/media/first.png", isDirectory: false, size: 10, modifiedAt: 0 },
				{ name: "last.png", path: "C:/media/last.png", isDirectory: false, size: 10, modifiedAt: 0 },
			]),
		});

		const result = await fixture.service.import({
			projectDir: "C:/project",
			paths: ["C:/media"],
			directoryMode: "all",
		});

		expect(result.assets).toHaveLength(2);
		expect(result.project.graph.nodes[0]?.data.assetIds).toEqual(result.assets.map(({ id }) => id));
		expect(fixture.putImported).toHaveBeenCalledTimes(2);
	});

	it("checks the expected revision before storing managed blobs", async () => {
		const fixture = createFixture();

		await expect(fixture.service.import({
			projectDir: "C:/project",
			paths: ["C:/media/hero.png"],
			expectedRevision: 4,
		})).rejects.toThrow("project revision conflict: expected 4, actual 0");
		expect(fixture.putImported).not.toHaveBeenCalled();
	});

	it("does not widen host filesystem authorization for arbitrary paths", async () => {
		const fixture = createFixture({
			stat: vi.fn(async () => {
				throw new Error("Path is outside any known project directory");
			}),
			readBinaryFile: vi.fn(async () => {
				throw new Error("Path is outside any previewable directory");
			}),
		});

		await expect(fixture.service.list(["D:/private/hero.png"])).rejects.toMatchObject({
			code: "local-media-path-not-authorized",
			retryable: false,
			details: {
				path: "D:/private/hero.png",
				recovery: expect.arrayContaining([expect.stringContaining("workspace")]),
			},
		} satisfies Partial<ContentLocalAssetError>);
	});
});

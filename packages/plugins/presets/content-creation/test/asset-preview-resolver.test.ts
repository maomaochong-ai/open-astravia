import type { PluginFsApi, PluginStorageApi } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { ContentAssetPreviewResolver } from "../src/generation/asset-preview-resolver";
import type { ContentAsset } from "../src/project/types";

const ASSET: ContentAsset = {
	id: "asset",
	blobId: "stored-blob",
	kind: "image",
	name: "Reference",
	mimeType: "image/png",
	createdAt: "2026-01-01T00:00:00.000Z",
};

describe("ContentAssetPreviewResolver", () => {
	it("resolves runtime URLs from blob IDs and caches the host reference", async () => {
		const getBlobRef = vi.fn<PluginStorageApi["getBlobRef"]>().mockResolvedValue({
			id: "stored-blob",
			url: "vetta-media://resolved",
			mimeType: "image/png",
		});
		const resolver = new ContentAssetPreviewResolver(createFs(), createStorage(getBlobRef));

		expect(await resolver.resolveAll(null, [ASSET])).toEqual(new Map([["asset", "vetta-media://resolved"]]));
		expect(await resolver.resolveAll(null, [ASSET])).toEqual(new Map([["asset", "vetta-media://resolved"]]));
		expect(getBlobRef).toHaveBeenCalledOnce();
	});

	it("limits concurrent host reference lookups", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		let releaseGate: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			releaseGate = resolve;
		});
		const getBlobRef = vi.fn<PluginStorageApi["getBlobRef"]>(async (id) => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await gate;
			inFlight -= 1;
			return { id, url: `vetta-media://${id}`, mimeType: "image/png" };
		});
		const resolver = new ContentAssetPreviewResolver(createFs(), createStorage(getBlobRef));
		const firstAssets = Array.from({ length: 20 }, (_, index) => createAsset(index));
		const secondAssets = Array.from({ length: 20 }, (_, index) => createAsset(index + 20));

		const resolving = Promise.all([resolver.resolveAll(null, firstAssets), resolver.resolveAll(null, secondAssets)]);
		try {
			await vi.waitFor(() => expect(getBlobRef).toHaveBeenCalledTimes(8));
			expect(maxInFlight).toBe(8);
		} finally {
			releaseGate?.();
		}

		expect((await resolving).map((result) => result.size)).toEqual([20, 20]);
		expect(getBlobRef).toHaveBeenCalledTimes(40);
	});

	it("evicts cached references that are no longer part of the current project", async () => {
		const getBlobRef = vi.fn<PluginStorageApi["getBlobRef"]>(async (id) => ({
			id,
			url: `vetta-media://${id}`,
			mimeType: "image/png",
		}));
		const resolver = new ContentAssetPreviewResolver(createFs(), createStorage(getBlobRef));
		const first = createAsset(1);
		const second = createAsset(2);

		await resolver.resolveAll(null, [first]);
		await resolver.resolveAll(null, [second]);
		await resolver.resolveAll(null, [first]);

		expect(getBlobRef).toHaveBeenCalledTimes(3);
		expect(getBlobRef.mock.calls.map(([id]) => id)).toEqual([first.blobId, second.blobId, first.blobId]);
	});

	it("does not retain queued lookups from a superseded project", async () => {
		let releaseGate: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			releaseGate = resolve;
		});
		const getBlobRef = vi.fn<PluginStorageApi["getBlobRef"]>(async (id) => {
			await gate;
			return { id, url: `vetta-media://${id}`, mimeType: "image/png" };
		});
		const resolver = new ContentAssetPreviewResolver(createFs(), createStorage(getBlobRef));
		const supersededAssets = Array.from({ length: 9 }, (_, index) => createAsset(index));
		const currentAsset = createAsset(100);

		const supersededResolution = resolver.resolveAll(null, supersededAssets);
		await vi.waitFor(() => expect(getBlobRef).toHaveBeenCalledTimes(8));
		const currentResolution = resolver.resolveAll(null, [currentAsset]);
		releaseGate?.();
		await Promise.all([supersededResolution, currentResolution]);

		await resolver.resolveAll(null, [currentAsset]);
		expect(getBlobRef.mock.calls.filter(([id]) => id === currentAsset.blobId)).toHaveLength(1);

		const queuedAsset = supersededAssets[8];
		expect(queuedAsset).toBeDefined();
		if (queuedAsset === undefined) return;
		await resolver.resolveAll(null, [queuedAsset]);
		expect(getBlobRef.mock.calls.filter(([id]) => id === queuedAsset.blobId)).toHaveLength(2);
	});

	it("resolves generated previews from workspace-relative files", async () => {
		const readBinaryFile = vi.fn<PluginFsApi["readBinaryFile"]>().mockResolvedValue({
			data: "aW1hZ2U=",
			mimeType: "image/png",
			size: 5,
		});
		const asset: ContentAsset = { ...ASSET, blobId: undefined, filePath: "output/result.png" };
		const resolver = new ContentAssetPreviewResolver(createFs(readBinaryFile), createStorage(async () => null));

		expect(await resolver.resolveAll("C:\\project", [asset])).toEqual(
			new Map([["asset", "data:image/png;base64,aW1hZ2U="]]),
		);
		expect(readBinaryFile).toHaveBeenCalledWith("C:\\project\\output\\result.png");
	});

	it("uses the persisted video MIME type when an older host reports generic binary data", async () => {
		const readBinaryFile = vi.fn<PluginFsApi["readBinaryFile"]>().mockResolvedValue({
			data: "AAAAGGZ0eXBpc29t",
			mimeType: "application/octet-stream",
			size: 12,
		});
		const asset: ContentAsset = {
			...ASSET,
			blobId: undefined,
			filePath: "output/result.mp4",
			kind: "video",
			mimeType: "video/mp4",
		};
		const resolver = new ContentAssetPreviewResolver(createFs(readBinaryFile), createStorage(async () => null));

		expect(await resolver.resolveAll("C:\\project", [asset])).toEqual(
			new Map([["asset", "data:video/mp4;base64,AAAAGGZ0eXBpc29t"]]),
		);
	});
});

function createAsset(index: number): ContentAsset {
	return {
		...ASSET,
		id: `asset-${index}`,
		blobId: `stored-blob-${index}`,
	};
}

function createStorage(getBlobRef: PluginStorageApi["getBlobRef"]): PluginStorageApi {
	return {
		readJson: async () => null,
		writeJson: async () => undefined,
		list: async () => [],
		readFile: async () => null,
		writeFile: async () => undefined,
		putBlob: async (input) => ({ id: input.id ?? "blob", url: "", mimeType: input.mimeType }),
		readBlob: async () => null,
		getBlobRef,
	};
}

function createFs(
	readBinaryFile: PluginFsApi["readBinaryFile"] = async () => ({
		data: "",
		mimeType: "application/octet-stream",
		size: 0,
	}),
): PluginFsApi {
	return {
		readDir: async () => [],
		readFile: async () => ({ content: "", encoding: "utf8" }),
		readBinaryFile,
		writeFile: async () => undefined,
		stat: async () => ({ size: 0, modifiedAt: 0, createdAt: 0 }),
		rename: async () => undefined,
		delete: async () => undefined,
		move: async () => undefined,
		createDirectory: async () => undefined,
		listFilesRecursive: async () => [],
		saveAs: async () => null,
		watchDirectory: () => ({ dispose: () => undefined }),
	};
}

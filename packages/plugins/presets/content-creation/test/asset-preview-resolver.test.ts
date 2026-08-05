import type { PluginStorageApi } from "@vetta-org/plugin-sdk";
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
		const resolver = new ContentAssetPreviewResolver(createStorage(getBlobRef));

		expect(await resolver.resolveAll([ASSET])).toEqual(new Map([["asset", "vetta-media://resolved"]]));
		expect(await resolver.resolveAll([ASSET])).toEqual(new Map([["asset", "vetta-media://resolved"]]));
		expect(getBlobRef).toHaveBeenCalledOnce();
	});
});

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

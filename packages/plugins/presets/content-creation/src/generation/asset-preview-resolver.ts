import type { PluginStorageApi } from "@vetta-org/plugin-sdk";
import type { ContentAsset } from "../project/types";

export class ContentAssetPreviewResolver {
	private readonly urlByBlobId = new Map<string, Promise<string | null>>();

	constructor(private readonly storage: PluginStorageApi) {}

	async resolveAll(assets: readonly ContentAsset[]): Promise<ReadonlyMap<string, string>> {
		const entries = await Promise.all(
			assets.map(async (asset) => {
				const url = await this.resolveBlobUrl(asset.blobId);
				return url ? ([asset.id, url] as const) : null;
			}),
		);
		return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null));
	}

	private resolveBlobUrl(blobId: string): Promise<string | null> {
		const cached = this.urlByBlobId.get(blobId);
		if (cached) return cached;
		const pending = this.storage.getBlobRef(blobId).then(
			(reference) => reference?.url ?? null,
			() => {
				this.urlByBlobId.delete(blobId);
				return null;
			},
		);
		this.urlByBlobId.set(blobId, pending);
		return pending;
	}
}

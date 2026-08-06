import type { PluginStorageApi } from "@vetta-org/plugin-sdk";
import type { ContentAsset } from "../project/types";

const MAX_CONCURRENT_PREVIEW_RESOLUTIONS = 8;

export class ContentAssetPreviewResolver {
	private activeLookups = 0;
	private currentBlobIds = new Set<string>();
	private readonly lookupWaiters: Array<() => void> = [];
	private readonly urlByBlobId = new Map<
		string,
		{ readonly promise: Promise<string | null>; readonly requestId: symbol }
	>();

	constructor(private readonly storage: PluginStorageApi) {}

	async resolveAll(assets: readonly ContentAsset[]): Promise<ReadonlyMap<string, string>> {
		const currentBlobIds = new Set(assets.map((asset) => asset.blobId));
		this.currentBlobIds = currentBlobIds;
		for (const blobId of this.urlByBlobId.keys()) {
			if (!currentBlobIds.has(blobId)) this.urlByBlobId.delete(blobId);
		}

		const entries: Array<readonly [string, string] | null> = Array.from({ length: assets.length }, () => null);
		let nextIndex = 0;
		const resolveNext = async (): Promise<void> => {
			while (nextIndex < assets.length) {
				const index = nextIndex;
				nextIndex += 1;
				const asset = assets[index];
				if (asset === undefined) continue;
				const url = await this.resolveBlobUrl(asset.blobId);
				entries[index] = url ? [asset.id, url] : null;
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(MAX_CONCURRENT_PREVIEW_RESOLUTIONS, assets.length) }, () => resolveNext()),
		);
		return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null));
	}

	private resolveBlobUrl(blobId: string): Promise<string | null> {
		const cached = this.urlByBlobId.get(blobId);
		if (cached) return cached.promise;
		const requestId = Symbol(blobId);
		const pending = this.loadBlobUrl(blobId).catch(() => {
			if (this.urlByBlobId.get(blobId)?.requestId === requestId) {
				this.urlByBlobId.delete(blobId);
			}
			return null;
		});
		if (this.currentBlobIds.has(blobId)) {
			this.urlByBlobId.set(blobId, { promise: pending, requestId });
		}
		return pending;
	}

	private async loadBlobUrl(blobId: string): Promise<string | null> {
		await this.acquireLookupSlot();
		try {
			const reference = await this.storage.getBlobRef(blobId);
			return reference?.url ?? null;
		} finally {
			this.releaseLookupSlot();
		}
	}

	private async acquireLookupSlot(): Promise<void> {
		if (this.activeLookups < MAX_CONCURRENT_PREVIEW_RESOLUTIONS) {
			this.activeLookups += 1;
			return;
		}
		await new Promise<void>((resolve) => {
			this.lookupWaiters.push(resolve);
		});
	}

	private releaseLookupSlot(): void {
		const next = this.lookupWaiters.shift();
		if (next) {
			next();
			return;
		}
		this.activeLookups -= 1;
	}
}

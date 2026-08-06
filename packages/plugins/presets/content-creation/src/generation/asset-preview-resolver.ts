import type { PluginFsApi, PluginStorageApi } from "@vetta-org/plugin-sdk";
import type { ContentAsset } from "../project/types";
import { joinContentPath } from "../shared/path";

const MAX_CONCURRENT_PREVIEW_RESOLUTIONS = 8;

export class ContentAssetPreviewResolver {
	private activeLookups = 0;
	private currentSourceKeys = new Set<string>();
	private readonly lookupWaiters: Array<() => void> = [];
	private readonly urlBySourceKey = new Map<
		string,
		{ readonly promise: Promise<string | null>; readonly requestId: symbol }
	>();

	constructor(
		private readonly fs: PluginFsApi,
		private readonly storage: PluginStorageApi,
	) {}

	async resolveAll(cwd: string | null, assets: readonly ContentAsset[]): Promise<ReadonlyMap<string, string>> {
		const currentSourceKeys = new Set(assets.map((asset) => sourceKey(cwd, asset)));
		this.currentSourceKeys = currentSourceKeys;
		for (const key of this.urlBySourceKey.keys()) {
			if (!currentSourceKeys.has(key)) this.urlBySourceKey.delete(key);
		}

		const entries: Array<readonly [string, string] | null> = Array.from({ length: assets.length }, () => null);
		let nextIndex = 0;
		const resolveNext = async (): Promise<void> => {
			while (nextIndex < assets.length) {
				const index = nextIndex;
				nextIndex += 1;
				const asset = assets[index];
				if (asset === undefined) continue;
				const url = await this.resolvePreviewUrl(cwd, asset);
				entries[index] = url ? [asset.id, url] : null;
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(MAX_CONCURRENT_PREVIEW_RESOLUTIONS, assets.length) }, () => resolveNext()),
		);
		return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null));
	}

	private resolvePreviewUrl(cwd: string | null, asset: ContentAsset): Promise<string | null> {
		const key = sourceKey(cwd, asset);
		const cached = this.urlBySourceKey.get(key);
		if (cached) return cached.promise;
		const requestId = Symbol(key);
		const pending = this.loadPreviewUrl(cwd, asset).catch(() => {
			if (this.urlBySourceKey.get(key)?.requestId === requestId) {
				this.urlBySourceKey.delete(key);
			}
			return null;
		});
		if (this.currentSourceKeys.has(key)) {
			this.urlBySourceKey.set(key, { promise: pending, requestId });
		}
		return pending;
	}

	private async loadPreviewUrl(cwd: string | null, asset: ContentAsset): Promise<string | null> {
		await this.acquireLookupSlot();
		try {
			if (asset.filePath) {
				if (!cwd) return null;
				const path = joinContentPath(cwd, asset.filePath);
				if (!(await this.fs.stat(path))) return null;
				const file = await this.fs.readBinaryFile(path);
				return `data:${file.mimeType};base64,${file.data}`;
			}
			if (!asset.blobId) return null;
			const reference = await this.storage.getBlobRef(asset.blobId);
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

function sourceKey(cwd: string | null, asset: ContentAsset): string {
	return asset.filePath ? `file:${cwd ?? ""}:${asset.filePath}` : `blob:${asset.blobId ?? asset.id}`;
}

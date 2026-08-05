import type { PluginStorageApi } from "@vetta-org/plugin-sdk";
import type { ContentArtifactStore, StoredContentData, StoredGeneratedContent } from "./types";

export class PluginContentArtifactStore implements ContentArtifactStore {
	constructor(private readonly storage: PluginStorageApi) {}

	async put(id: string, content: StoredContentData): Promise<StoredGeneratedContent> {
		const stored = await this.storage.putBlob({ id, data: content.data, mimeType: content.mimeType });
		return { id: stored.id, url: stored.url, mimeType: stored.mimeType };
	}

	read(id: string): Promise<StoredContentData | null> {
		return this.storage.readBlob(id);
	}
}

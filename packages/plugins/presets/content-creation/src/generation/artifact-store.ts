import type { PluginFsApi, PluginStorageApi } from "@vetta-org/plugin-sdk";
import { joinContentPath } from "../shared/path";
import type {
	ContentArtifactStore,
	StoredContentData,
	StoredGeneratedContent,
	StoredImportedContent,
} from "./types";

const OUTPUT_DIRECTORY = "output";

export class PluginContentArtifactStore implements ContentArtifactStore {
	constructor(
		private readonly fs: PluginFsApi,
		private readonly storage: PluginStorageApi,
	) {}

	async putImported(id: string, content: StoredContentData): Promise<StoredImportedContent> {
		const stored = await this.storage.putBlob({ id, data: content.data, mimeType: content.mimeType });
		return { blobId: stored.id, mimeType: stored.mimeType };
	}

	async putGenerated(cwd: string, fileName: string, content: StoredContentData): Promise<StoredGeneratedContent> {
		const relativePath = `${OUTPUT_DIRECTORY}/${fileName}`;
		await this.fs.createDirectory(joinContentPath(cwd, OUTPUT_DIRECTORY));
		await this.fs.writeFile(joinContentPath(cwd, relativePath), content.data, "base64");
		return { filePath: relativePath, mimeType: content.mimeType };
	}

	async read(
		cwd: string | null,
		location: { blobId?: string; filePath?: string },
	): Promise<StoredContentData | null> {
		if (location.filePath) {
			if (!cwd) return null;
			const path = joinContentPath(cwd, location.filePath);
			if (!(await this.fs.stat(path))) return null;
			const file = await this.fs.readBinaryFile(path);
			return { data: file.data, mimeType: file.mimeType };
		}
		return location.blobId ? this.storage.readBlob(location.blobId) : null;
	}
}

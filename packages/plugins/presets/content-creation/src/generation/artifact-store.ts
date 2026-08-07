import type { PluginFsApi, PluginMediaApi, PluginStorageApi } from "@vetta-org/plugin-sdk";
import { joinContentPath } from "../shared/path";
import type {
	ContentArtifactStore,
	ContentGenerationReference,
	GeneratedContent,
	ImportedContentAsset,
	StoredContentData,
	StoredGeneratedContent,
	StoredImportedContent,
} from "./types";

const OUTPUT_DIRECTORY = "output";

export class PluginContentArtifactStore implements ContentArtifactStore {
	constructor(
		private readonly fs: PluginFsApi,
		private readonly storage: PluginStorageApi,
		private readonly media: PluginMediaApi,
	) {}

	async putImported(id: string, content: ImportedContentAsset): Promise<StoredImportedContent> {
		const stored = content.file
			? await this.storage.putBlobFromFile({ id, file: content.file, mimeType: content.mimeType })
			: await this.storage.putBlob({ id, data: content.data, mimeType: content.mimeType });
		return { blobId: stored.id, mimeType: stored.mimeType };
	}

	async putGenerated(cwd: string, fileName: string, content: GeneratedContent): Promise<StoredGeneratedContent> {
		const relativePath = `${OUTPUT_DIRECTORY}/${fileName}`;
		const outputDirectory = joinContentPath(cwd, OUTPUT_DIRECTORY);
		const outputPath = joinContentPath(cwd, relativePath);
		await this.fs.createDirectory(outputDirectory);
		if (content.source.type === "inline") {
			await this.fs.writeFile(outputPath, content.source.data, "base64");
			return { filePath: relativePath, mimeType: content.mimeType };
		}
		try {
			const saved = await this.media.saveArtifact({
				artifactId: content.source.artifactId,
				destination: { type: "workspace-file", path: outputPath },
			});
			if (saved.type !== "workspace-file") throw new Error("Media artifact was not saved to the workspace");
			return { filePath: relativePath, mimeType: saved.mimeType };
		} finally {
			await this.media.releaseArtifact(content.source.artifactId).catch(() => undefined);
		}
	}

	async readReference(reference: ContentGenerationReference): Promise<StoredContentData | null> {
		if (reference.source.type === "workspace-file") {
			if (!(await this.fs.stat(reference.source.path))) return null;
			const file = await this.fs.readBinaryFile(reference.source.path);
			return { data: file.data, mimeType: file.mimeType };
		}
		return this.storage.readBlob(reference.source.blobId);
	}
}

import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { MediaArtifact, MediaInput, MediaKind } from "@vetta/capability-sdk";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { assertFilesystemPathWithinProject } from "../filesystem/filesystem-service.js";
import { getPluginBlobFile } from "../plugins/plugin-storage-service.js";

export interface MediaArtifactMetadata {
	kind: MediaKind;
	mimeType: string;
	name?: string;
	width?: number;
	height?: number;
	durationSeconds?: number;
}

export interface ResolvedMediaInput {
	data: Buffer;
	mimeType: string;
}

export interface ResolvedMediaInputFile {
	path: string;
	mimeType: string;
	sizeBytes: number;
}

function mimeTypeForPath(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		case ".mp4":
			return "video/mp4";
		case ".webm":
			return "video/webm";
		case ".wav":
			return "audio/wav";
		case ".mp3":
			return "audio/mpeg";
		case ".json":
			return "application/json";
		default:
			return "application/octet-stream";
	}
}

export class MediaArtifactStore {
	private readonly store: ArtifactStore;
	private readonly ownsStore: boolean;

	constructor(store?: ArtifactStore) {
		this.store = store ?? new ArtifactStore();
		this.ownsStore = store === undefined;
	}

	async putBase64(ownerId: string, data: string, metadata: MediaArtifactMetadata): Promise<MediaArtifact> {
		const ref = await this.store.putBase64(ownerId, data, metadata);
		return { ...ref, ...metadata };
	}

	async putFile(ownerId: string, sourcePath: string, metadata: MediaArtifactMetadata): Promise<MediaArtifact> {
		const ref = await this.store.putFile(ownerId, sourcePath, metadata);
		return { ...ref, ...metadata };
	}

	async putStream(
		ownerId: string,
		stream: ReadableStream<Uint8Array>,
		metadata: MediaArtifactMetadata,
	): Promise<MediaArtifact> {
		const ref = await this.store.putStream(ownerId, stream, metadata);
		return { ...ref, ...metadata };
	}

	async resolveInputFile(input: MediaInput): Promise<ResolvedMediaInputFile> {
		if (input.source.type === "plugin-blob") {
			const file = await getPluginBlobFile(input.source.namespace, input.source.blobId);
			if (!file) throw new Error(`Media input blob was not found: ${input.source.blobId}`);
			return {
				path: file.path,
				mimeType: input.mimeType ?? file.mimeType,
				sizeBytes: file.sizeBytes,
			};
		}
		assertFilesystemPathWithinProject(input.source.path);
		const file = await stat(input.source.path);
		return {
			path: input.source.path,
			mimeType: input.mimeType ?? mimeTypeForPath(input.source.path),
			sizeBytes: file.size,
		};
	}

	async resolveInput(input: MediaInput): Promise<ResolvedMediaInput> {
		const file = await this.resolveInputFile(input);
		return { data: await readFile(file.path), mimeType: file.mimeType };
	}

	async release(ownerId: string, artifactId: string): Promise<void> {
		await this.store.release(ownerId, artifactId);
	}

	dispose(): void {
		if (this.ownsStore) this.store.dispose();
	}
}

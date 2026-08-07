import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type {
	MediaArtifact,
	MediaArtifactDestination,
	MediaKind,
	MediaReference,
	MediaSavedArtifact,
} from "@vetta/capability-sdk";
import { getPluginBlobFile, putPluginBlobFromFile } from "../plugins/plugin-storage-service.js";

interface StoredMediaArtifact {
	artifact: MediaArtifact;
	path: string;
}

export interface MediaArtifactMetadata {
	kind: MediaKind;
	mimeType: string;
	width?: number;
	height?: number;
	durationSeconds?: number;
}

export interface ResolvedMediaReference {
	data: Buffer;
	mimeType: string;
}

export interface ResolvedMediaReferenceFile {
	path: string;
	mimeType: string;
	sizeBytes: number;
}

function extensionForMimeType(mimeType: string): string {
	if (mimeType === "image/jpeg") return ".jpg";
	if (mimeType === "image/webp") return ".webp";
	if (mimeType === "image/gif") return ".gif";
	if (mimeType === "video/webm") return ".webm";
	if (mimeType.startsWith("video/")) return ".mp4";
	if (mimeType === "audio/wav") return ".wav";
	if (mimeType.startsWith("audio/")) return ".mp3";
	return ".png";
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
		default:
			return "image/png";
	}
}

export class MediaArtifactStore {
	private readonly artifacts = new Map<string, StoredMediaArtifact>();
	private readonly root = join(tmpdir(), "vetta-media-artifacts", String(process.pid));

	async putBase64(data: string, metadata: MediaArtifactMetadata): Promise<MediaArtifact> {
		const bytes = Buffer.from(data, "base64");
		const id = randomUUID();
		const path = join(this.root, `${id}${extensionForMimeType(metadata.mimeType)}`);
		await mkdir(this.root, { recursive: true });
		await writeFile(path, bytes);
		const artifact: MediaArtifact = { id, sizeBytes: bytes.byteLength, ...metadata };
		this.artifacts.set(id, { artifact, path });
		return artifact;
	}

	async putFile(sourcePath: string, metadata: MediaArtifactMetadata): Promise<MediaArtifact> {
		const id = randomUUID();
		const path = join(this.root, `${id}${extensionForMimeType(metadata.mimeType)}`);
		await mkdir(this.root, { recursive: true });
		await copyFile(sourcePath, path);
		const file = await stat(path);
		const artifact: MediaArtifact = { id, sizeBytes: file.size, ...metadata };
		this.artifacts.set(id, { artifact, path });
		return artifact;
	}

	async putStream(stream: ReadableStream<Uint8Array>, metadata: MediaArtifactMetadata): Promise<MediaArtifact> {
		const id = randomUUID();
		const path = join(this.root, `${id}${extensionForMimeType(metadata.mimeType)}`);
		await mkdir(this.root, { recursive: true });
		try {
			await pipeline(Readable.fromWeb(stream as unknown as NodeReadableStream<Uint8Array>), createWriteStream(path));
			const file = await stat(path);
			const artifact: MediaArtifact = { id, sizeBytes: file.size, ...metadata };
			this.artifacts.set(id, { artifact, path });
			return artifact;
		} catch (error) {
			await unlink(path).catch(() => undefined);
			throw error;
		}
	}

	async resolveReferenceFile(reference: MediaReference): Promise<ResolvedMediaReferenceFile> {
		if (reference.source.type === "plugin-blob") {
			const file = await getPluginBlobFile(reference.source.namespace, reference.source.blobId);
			if (!file) throw new Error(`Media reference blob was not found: ${reference.source.blobId}`);
			return {
				path: file.path,
				mimeType: reference.mimeType ?? file.mimeType,
				sizeBytes: file.sizeBytes,
			};
		}
		const file = await stat(reference.source.path);
		return {
			path: reference.source.path,
			mimeType: reference.mimeType ?? mimeTypeForPath(reference.source.path),
			sizeBytes: file.size,
		};
	}

	async resolveReference(reference: MediaReference): Promise<ResolvedMediaReference> {
		const file = await this.resolveReferenceFile(reference);
		return { data: await readFile(file.path), mimeType: file.mimeType };
	}

	async save(artifactId: string, destination: MediaArtifactDestination): Promise<MediaSavedArtifact> {
		const stored = this.artifacts.get(artifactId);
		if (!stored) throw new Error(`Media artifact is unavailable: ${artifactId}`);
		if (destination.type === "plugin-blob") {
			const blob = await putPluginBlobFromFile(destination.namespace, {
				id: destination.blobId,
				path: stored.path,
				mimeType: stored.artifact.mimeType,
			});
			return {
				type: "plugin-blob",
				blobId: blob.id,
				url: blob.url,
				mimeType: blob.mimeType,
				sizeBytes: stored.artifact.sizeBytes,
			};
		}
		await mkdir(dirname(destination.path), { recursive: true });
		await copyFile(stored.path, destination.path);
		return {
			type: "workspace-file",
			path: destination.path,
			mimeType: stored.artifact.mimeType,
			sizeBytes: stored.artifact.sizeBytes,
		};
	}

	async release(artifactId: string): Promise<void> {
		const stored = this.artifacts.get(artifactId);
		if (!stored) return;
		this.artifacts.delete(artifactId);
		try {
			await unlink(stored.path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	dispose(): void {
		for (const artifactId of this.artifacts.keys()) {
			void this.release(artifactId).catch(() => undefined);
		}
	}
}

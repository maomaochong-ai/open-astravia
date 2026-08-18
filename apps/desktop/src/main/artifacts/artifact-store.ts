import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { ArtifactRef } from "@vetta/capability-sdk";

export interface ArtifactStoreOptions {
	root?: string;
}

export interface ArtifactWriteMetadata {
	mimeType: string;
	name?: string;
}

export interface StoredArtifact {
	ref: ArtifactRef;
	path: string;
}

interface ArtifactRecord extends StoredArtifact {
	ownerId: string;
}

function extensionForMimeType(mimeType: string, name?: string): string {
	const namedExtension = name ? extname(name) : "";
	if (namedExtension) return namedExtension;
	if (mimeType === "image/png") return ".png";
	if (mimeType === "image/jpeg") return ".jpg";
	if (mimeType === "image/webp") return ".webp";
	if (mimeType === "image/gif") return ".gif";
	if (mimeType === "video/webm") return ".webm";
	if (mimeType.startsWith("video/")) return ".mp4";
	if (mimeType === "audio/wav") return ".wav";
	if (mimeType.startsWith("audio/")) return ".mp3";
	if (mimeType === "application/json") return ".json";
	return ".bin";
}

export class ArtifactStore {
	private readonly artifacts = new Map<string, ArtifactRecord>();
	private readonly root: string;

	constructor(options: ArtifactStoreOptions = {}) {
		this.root = options.root ?? join(tmpdir(), "vetta-artifacts", String(process.pid));
	}

	async putBase64(ownerId: string, data: string, metadata: ArtifactWriteMetadata): Promise<ArtifactRef> {
		const bytes = Buffer.from(data, "base64");
		return this.putBytes(ownerId, bytes, metadata);
	}

	async putFile(ownerId: string, sourcePath: string, metadata: ArtifactWriteMetadata): Promise<ArtifactRef> {
		const record = await this.createRecord(ownerId, metadata);
		await copyFile(sourcePath, record.path);
		return this.commitRecord(record);
	}

	async putStream(
		ownerId: string,
		stream: ReadableStream<Uint8Array>,
		metadata: ArtifactWriteMetadata,
	): Promise<ArtifactRef> {
		const record = await this.createRecord(ownerId, metadata);
		try {
			await pipeline(
				Readable.fromWeb(stream as unknown as NodeReadableStream<Uint8Array>),
				createWriteStream(record.path),
			);
			return this.commitRecord(record);
		} catch (error) {
			await unlink(record.path).catch(() => undefined);
			throw error;
		}
	}

	get(ownerId: string, artifactId: string): StoredArtifact {
		const record = this.artifacts.get(artifactId);
		if (!record || record.ownerId !== ownerId) throw new Error(`Artifact is unavailable: ${artifactId}`);
		return { ref: { ...record.ref }, path: record.path };
	}

	async copyTo(ownerId: string, artifactId: string, destinationPath: string): Promise<ArtifactRef> {
		const stored = this.get(ownerId, artifactId);
		await copyFile(stored.path, destinationPath);
		return stored.ref;
	}

	async release(ownerId: string, artifactId: string): Promise<void> {
		const record = this.artifacts.get(artifactId);
		if (!record) return;
		if (record.ownerId !== ownerId) throw new Error(`Artifact is unavailable: ${artifactId}`);
		this.artifacts.delete(artifactId);
		try {
			await unlink(record.path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	disposeOwner(ownerId: string): void {
		for (const [artifactId, record] of this.artifacts) {
			if (record.ownerId === ownerId) void this.release(ownerId, artifactId).catch(() => undefined);
		}
	}

	dispose(): void {
		for (const record of [...this.artifacts.values()]) {
			void this.release(record.ownerId, record.ref.id).catch(() => undefined);
		}
	}

	private async putBytes(ownerId: string, bytes: Uint8Array, metadata: ArtifactWriteMetadata): Promise<ArtifactRef> {
		const record = await this.createRecord(ownerId, metadata);
		await writeFile(record.path, bytes);
		return this.commitRecord(record);
	}

	private async createRecord(ownerId: string, metadata: ArtifactWriteMetadata): Promise<ArtifactRecord> {
		if (!ownerId.trim()) throw new Error("Artifact owner is required");
		if (!metadata.mimeType.trim()) throw new Error("Artifact MIME type is required");
		const id = randomUUID();
		await mkdir(this.root, { recursive: true });
		return {
			ownerId,
			path: join(this.root, `${id}${extensionForMimeType(metadata.mimeType, metadata.name)}`),
			ref: {
				id,
				mimeType: metadata.mimeType,
				sizeBytes: 0,
				lifetime: "temporary",
				...(metadata.name ? { name: metadata.name } : {}),
			},
		};
	}

	private async commitRecord(record: ArtifactRecord): Promise<ArtifactRef> {
		const file = await stat(record.path);
		const committed: ArtifactRecord = {
			...record,
			ref: { ...record.ref, sizeBytes: file.size },
		};
		this.artifacts.set(committed.ref.id, committed);
		return { ...committed.ref };
	}
}

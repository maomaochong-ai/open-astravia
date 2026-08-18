import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArtifactPersistInput, PersistedArtifact } from "@vetta/capability-sdk";
import { assertFilesystemPathWithinProject } from "../filesystem/filesystem-service.js";
import { putPluginBlobFromFile } from "../plugins/plugin-storage-service.js";
import type { ArtifactStore } from "./artifact-store.js";

export async function persistArtifact(store: ArtifactStore, input: ArtifactPersistInput): Promise<PersistedArtifact> {
	const stored = store.get(input.ownerId, input.artifactId);
	if (input.destination.type === "storage-blob") {
		const blob = await putPluginBlobFromFile(input.destination.namespace, {
			id: input.destination.id,
			path: stored.path,
			mimeType: stored.ref.mimeType,
		});
		return {
			type: "storage-blob",
			id: blob.id,
			url: blob.url,
			mimeType: blob.mimeType,
			sizeBytes: stored.ref.sizeBytes,
		};
	}
	assertFilesystemPathWithinProject(input.destination.path);
	await mkdir(dirname(input.destination.path), { recursive: true });
	await copyFile(stored.path, input.destination.path);
	return {
		type: "filesystem",
		path: input.destination.path,
		mimeType: stored.ref.mimeType,
		sizeBytes: stored.ref.sizeBytes,
	};
}

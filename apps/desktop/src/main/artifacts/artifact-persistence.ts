import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isSshProjectUri } from "@vetta/ssh-transport";
import type { ArtifactPersistInput, PersistedArtifact } from "@vetta-org/capability-sdk";
import { assertFilesystemPathWithinProject, writeFilesystemFile } from "../filesystem/filesystem-service.js";
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
	if (isSshProjectUri(input.destination.path)) {
		// 产物本身是本机临时文件，目标在远端：读出来经文件服务送过去。插件生成的图片、
		// 视频要落进远程项目，这是唯一的路径——`copyFile` 只认本机两端。
		await writeFilesystemFile(input.destination.path, (await readFile(stored.path)).toString("base64"), "base64");
	} else {
		await mkdir(dirname(input.destination.path), { recursive: true });
		await copyFile(stored.path, input.destination.path);
	}
	return {
		type: "filesystem",
		path: input.destination.path,
		mimeType: stored.ref.mimeType,
		sizeBytes: stored.ref.sizeBytes,
	};
}

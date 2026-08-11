import type { PluginArtifactsApi, PluginFsApi, PluginStorageApi } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginContentArtifactStore } from "../src/generation/artifact-store";

describe("PluginContentArtifactStore", () => {
	const createDirectory = vi.fn<PluginFsApi["createDirectory"]>();
	const writeFile = vi.fn<PluginFsApi["writeFile"]>();
	const stat = vi.fn<PluginFsApi["stat"]>();
	const readBinaryFile = vi.fn<PluginFsApi["readBinaryFile"]>();
	const putBlob = vi.fn<PluginStorageApi["putBlob"]>();
	const readBlob = vi.fn<PluginStorageApi["readBlob"]>();
	const persistArtifact = vi.fn<PluginArtifactsApi["persist"]>();
	const releaseArtifact = vi.fn<PluginArtifactsApi["release"]>();
	const fs = { createDirectory, writeFile, stat, readBinaryFile } as unknown as PluginFsApi;
	const storage = { putBlob, readBlob } as unknown as PluginStorageApi;
	const artifactApi = { persist: persistArtifact, release: releaseArtifact } as unknown as PluginArtifactsApi;
	const artifacts = new PluginContentArtifactStore(fs, storage, artifactApi);

	beforeEach(() => {
		vi.clearAllMocks();
		createDirectory.mockResolvedValue();
		writeFile.mockResolvedValue();
		releaseArtifact.mockResolvedValue();
	});

	it("keeps a host artifact recoverable until the project commit succeeds", async () => {
		persistArtifact.mockResolvedValue({
			type: "workspace-file",
			path: "C:/project/output/generated.png",
			mimeType: "image/png",
			sizeBytes: 128,
		});

		await expect(
			artifacts.putGenerated("C:/project", "generated.png", {
				kind: "image",
				mimeType: "image/png",
				source: { type: "host-artifact", artifactId: "artifact-1" },
			}),
		).resolves.toEqual({ filePath: "output/generated.png", mimeType: "image/png" });
		expect(createDirectory).toHaveBeenCalledWith("C:/project/output");
		expect(persistArtifact).toHaveBeenCalledWith("artifact-1", {
			type: "workspace-file",
			path: "C:/project/output/generated.png",
		});
		expect(releaseArtifact).not.toHaveBeenCalled();
		await artifacts.releaseGenerated({
			kind: "image",
			mimeType: "image/png",
			source: { type: "host-artifact", artifactId: "artifact-1" },
		});
		expect(releaseArtifact).toHaveBeenCalledWith("artifact-1");
		expect(writeFile).not.toHaveBeenCalled();
	});

	it("retains a host artifact when persistence fails so a reload can retry", async () => {
		persistArtifact.mockRejectedValue(new Error("disk full"));

		await expect(
			artifacts.putGenerated("C:/project", "generated.mp4", {
				kind: "video",
				mimeType: "video/mp4",
				source: { type: "host-artifact", artifactId: "artifact-2" },
			}),
		).rejects.toThrow("disk full");
		expect(releaseArtifact).not.toHaveBeenCalled();
	});

	it("keeps inline data limited to direct provider output", async () => {
		await expect(
			artifacts.putGenerated("C:/project", "direct.png", {
				kind: "image",
				mimeType: "image/png",
				source: { type: "inline", data: "aW1hZ2U=" },
			}),
		).resolves.toEqual({ filePath: "output/direct.png", mimeType: "image/png" });
		expect(writeFile).toHaveBeenCalledWith("C:/project/output/direct.png", "aW1hZ2U=", "base64");
		expect(persistArtifact).not.toHaveBeenCalled();
		expect(releaseArtifact).not.toHaveBeenCalled();
	});

	it("loads reference bytes lazily from the source handle", async () => {
		readBlob.mockResolvedValue({ data: "YmxvYg==", mimeType: "image/webp" });
		stat.mockResolvedValue({ size: 4, modifiedAt: 1, createdAt: 1 });
		readBinaryFile.mockResolvedValue({ data: "ZmlsZQ==", mimeType: "audio/mpeg", size: 4 });

		await expect(
			artifacts.readReference({
				id: "blob-reference",
				slotId: "referenceImages",
				kind: "image",
				mimeType: "image/webp",
				source: { type: "plugin-blob", blobId: "blob-1" },
			}),
		).resolves.toEqual({ data: "YmxvYg==", mimeType: "image/webp" });
		expect(readBlob).toHaveBeenCalledWith("blob-1");

		await expect(
			artifacts.readReference({
				id: "file-reference",
				slotId: "referenceAudio",
				kind: "audio",
				mimeType: "audio/mpeg",
				source: { type: "workspace-file", path: "C:/project/voice.mp3" },
			}),
		).resolves.toEqual({ data: "ZmlsZQ==", mimeType: "audio/mpeg" });
		expect(stat).toHaveBeenCalledWith("C:/project/voice.mp3");
		expect(readBinaryFile).toHaveBeenCalledWith("C:/project/voice.mp3");
	});
});

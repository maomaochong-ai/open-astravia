import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowProjectRoot } from "../filesystem/filesystem-service.js";
import { MediaArtifactStore } from "./media-artifact-store.js";

const storageMocks = vi.hoisted(() => ({
	getPluginBlobFile:
		vi.fn<(pluginId: string, id: string) => Promise<{ path: string; mimeType: string; sizeBytes: number } | null>>(),
}));

vi.mock("../plugins/plugin-storage-service.js", () => storageMocks);

const ownerId = "media-consumer";
const artifactRoot = join(tmpdir(), "vetta-artifacts", String(process.pid));

describe("MediaArtifactStore", () => {
	let testRoot: string;
	const stores: MediaArtifactStore[] = [];

	beforeEach(async () => {
		testRoot = await mkdtemp(join(tmpdir(), "vetta-media-artifact-test-"));
		allowProjectRoot(testRoot);
		storageMocks.getPluginBlobFile.mockReset();
	});

	afterEach(async () => {
		for (const store of stores.splice(0)) store.dispose();
		await rm(testRoot, { recursive: true, force: true });
	});

	function createStore(): MediaArtifactStore {
		const store = new MediaArtifactStore();
		stores.push(store);
		return store;
	}

	it("creates owner-bound temporary artifacts", async () => {
		const store = createStore();
		const bytes = Buffer.from("generated image");
		const artifact = await store.putBase64(ownerId, bytes.toString("base64"), {
			kind: "image",
			mimeType: "image/png",
			width: 1024,
			height: 1024,
		});
		const artifactPath = join(artifactRoot, `${artifact.id}.png`);

		expect(artifact).toMatchObject({
			kind: "image",
			mimeType: "image/png",
			sizeBytes: bytes.byteLength,
			lifetime: "temporary",
			width: 1024,
			height: 1024,
		});
		await expect(readFile(artifactPath)).resolves.toEqual(bytes);
		await expect(store.release("another-owner", artifact.id)).rejects.toThrow(
			`Artifact is unavailable: ${artifact.id}`,
		);
		await store.release(ownerId, artifact.id);
		await expect(stat(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("resolves workspace and namespaced storage blob inputs only when requested", async () => {
		const store = createStore();
		const workspacePath = join(testRoot, "voice.mp3");
		const blobPath = join(testRoot, "blob.data");
		await Promise.all([
			writeFile(workspacePath, Buffer.from("workspace audio")),
			writeFile(blobPath, Buffer.from("plugin image")),
		]);
		storageMocks.getPluginBlobFile.mockResolvedValue({
			path: blobPath,
			mimeType: "image/webp",
			sizeBytes: 12,
		});

		await expect(
			store.resolveInput({ kind: "audio", source: { type: "workspace-file", path: workspacePath } }),
		).resolves.toEqual({ data: Buffer.from("workspace audio"), mimeType: "audio/mpeg" });
		await expect(
			store.resolveInput({
				kind: "image",
				source: { type: "storage-blob", namespace: "content-creation", id: "blob-1" },
			}),
		).resolves.toEqual({ data: Buffer.from("plugin image"), mimeType: "image/webp" });
		expect(storageMocks.getPluginBlobFile).toHaveBeenCalledWith("content-creation", "blob-1");
	});

	it("streams a remote media body into a host artifact", async () => {
		const store = createStore();
		const bytes = Buffer.from("streamed generated video");
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes.subarray(0, 8));
				controller.enqueue(bytes.subarray(8));
				controller.close();
			},
		});

		const artifact = await store.putStream(ownerId, stream, { kind: "video", mimeType: "video/mp4" });
		const artifactPath = join(artifactRoot, `${artifact.id}.mp4`);

		expect(artifact.sizeBytes).toBe(bytes.byteLength);
		await expect(readFile(artifactPath)).resolves.toEqual(bytes);
		await store.release(ownerId, artifact.id);
	});
});

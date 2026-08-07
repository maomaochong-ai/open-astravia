import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaArtifactStore } from "./media-artifact-store.js";

const storageMocks = vi.hoisted(() => ({
	getPluginBlobFile:
		vi.fn<(pluginId: string, id: string) => Promise<{ path: string; mimeType: string; sizeBytes: number } | null>>(),
	putPluginBlobFromFile:
		vi.fn<
			(
				pluginId: string,
				input: { id?: string; path: string; mimeType: string },
			) => Promise<{ id: string; url: string; mimeType: string }>
		>(),
}));

vi.mock("../plugins/plugin-storage-service.js", () => storageMocks);

const artifactRoot = join(tmpdir(), "vetta-media-artifacts", String(process.pid));

describe("MediaArtifactStore", () => {
	let testRoot: string;
	const stores: MediaArtifactStore[] = [];

	beforeEach(async () => {
		testRoot = await mkdtemp(join(tmpdir(), "vetta-media-artifact-test-"));
		storageMocks.getPluginBlobFile.mockReset();
		storageMocks.putPluginBlobFromFile.mockReset();
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

	it("persists a host artifact directly to a workspace file and removes it on release", async () => {
		const store = createStore();
		const bytes = Buffer.from("generated image");
		const artifact = await store.putBase64(bytes.toString("base64"), {
			kind: "image",
			mimeType: "image/png",
			width: 1024,
			height: 1024,
		});
		const artifactPath = join(artifactRoot, `${artifact.id}.png`);
		const outputPath = join(testRoot, "nested", "output.png");

		expect(artifact).toMatchObject({
			kind: "image",
			mimeType: "image/png",
			sizeBytes: bytes.byteLength,
			width: 1024,
			height: 1024,
		});
		await expect(readFile(artifactPath)).resolves.toEqual(bytes);
		await expect(store.save(artifact.id, { type: "workspace-file", path: outputPath })).resolves.toEqual({
			type: "workspace-file",
			path: outputPath,
			mimeType: "image/png",
			sizeBytes: bytes.byteLength,
		});
		await expect(readFile(outputPath)).resolves.toEqual(bytes);

		await store.release(artifact.id);
		await expect(stat(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(store.save(artifact.id, { type: "workspace-file", path: outputPath })).rejects.toThrow(
			`Media artifact is unavailable: ${artifact.id}`,
		);
	});

	it("resolves workspace and plugin blob references only when requested", async () => {
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
			store.resolveReference({ kind: "audio", source: { type: "workspace-file", path: workspacePath } }),
		).resolves.toEqual({ data: Buffer.from("workspace audio"), mimeType: "audio/mpeg" });
		await expect(
			store.resolveReference({
				kind: "image",
				source: { type: "plugin-blob", namespace: "content-creation", blobId: "blob-1" },
			}),
		).resolves.toEqual({ data: Buffer.from("plugin image"), mimeType: "image/webp" });
		expect(storageMocks.getPluginBlobFile).toHaveBeenCalledWith("content-creation", "blob-1");
	});

	it("copies an artifact into plugin storage without exposing its bytes", async () => {
		const store = createStore();
		const sourcePath = join(testRoot, "source.mp4");
		await mkdir(testRoot, { recursive: true });
		await writeFile(sourcePath, Buffer.from("generated video"));
		const artifact = await store.putFile(sourcePath, { kind: "video", mimeType: "video/mp4", durationSeconds: 4 });
		storageMocks.putPluginBlobFromFile.mockResolvedValue({
			id: "saved-video",
			url: "vetta-media://local/saved-video",
			mimeType: "video/mp4",
		});

		await expect(
			store.save(artifact.id, {
				type: "plugin-blob",
				namespace: "content-creation",
				blobId: "saved-video",
			}),
		).resolves.toEqual({
			type: "plugin-blob",
			blobId: "saved-video",
			url: "vetta-media://local/saved-video",
			mimeType: "video/mp4",
			sizeBytes: Buffer.byteLength("generated video"),
		});
		expect(storageMocks.putPluginBlobFromFile).toHaveBeenCalledWith("content-creation", {
			id: "saved-video",
			path: join(artifactRoot, `${artifact.id}.mp4`),
			mimeType: "video/mp4",
		});
		await store.release(artifact.id);
	});

	it("streams a remote media body into a host artifact without base64 conversion", async () => {
		const store = createStore();
		const bytes = Buffer.from("streamed generated video");
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes.subarray(0, 8));
				controller.enqueue(bytes.subarray(8));
				controller.close();
			},
		});

		const artifact = await store.putStream(stream, { kind: "video", mimeType: "video/mp4" });
		const artifactPath = join(artifactRoot, `${artifact.id}.mp4`);

		expect(artifact.sizeBytes).toBe(bytes.byteLength);
		await expect(readFile(artifactPath)).resolves.toEqual(bytes);
		await store.release(artifact.id);
	});

	it("invalidates all remaining handles when disposed", async () => {
		const store = createStore();
		const artifact = await store.putBase64(Buffer.from("temporary").toString("base64"), {
			kind: "image",
			mimeType: "image/png",
		});
		const artifactPath = join(artifactRoot, `${artifact.id}.png`);

		store.dispose();

		await expect(
			store.save(artifact.id, { type: "workspace-file", path: join(testRoot, "output.png") }),
		).rejects.toThrow(`Media artifact is unavailable: ${artifact.id}`);
		await vi.waitFor(async () => {
			await expect(stat(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
		});
	});
});

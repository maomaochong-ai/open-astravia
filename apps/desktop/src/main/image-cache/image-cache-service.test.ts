import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ImageCacheDependencies } from "./image-cache-service";
import {
	cleanupOldImageCaches,
	persistImageCache,
	persistImageFileCache,
	readImageDimensions,
} from "./image-cache-service";

function pngHeader(width: number, height: number): Buffer {
	const bytes = Buffer.alloc(24);
	Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

describe("image cache service", () => {
	it("reads dimensions from compressed headers without decoding image pixels", () => {
		expect(readImageDimensions(pngHeader(863, 862), "image/png")).toEqual({ width: 863, height: 862 });
	});

	it("persists bytes and returns monitor-ready metadata", async () => {
		const mkdir = vi.fn(async () => undefined);
		const writeFile = vi.fn(async () => undefined);
		const dependencies = {
			cacheRoot: "C:/cache",
			mkdir,
			readFile: vi.fn(),
			writeFile,
			readdir: vi.fn(),
			rm: vi.fn(),
			stat: vi.fn(),
		} as unknown as ImageCacheDependencies;
		const bytes = pngHeader(320, 200);

		const result = await persistImageCache(
			"session/one",
			[{ id: "image", data: bytes.toString("base64"), mimeType: "image/png" }],
			dependencies,
		);

		const directory = join("C:/cache", "session_one");
		const path = join(directory, "image.png");
		expect(mkdir).toHaveBeenCalledWith(directory, { recursive: true });
		expect(writeFile).toHaveBeenCalledWith(path, bytes);
		expect(result).toEqual([{ path, format: "png", sizeBytes: bytes.byteLength, width: 320, height: 200 }]);
	});

	it("persists real paths and virtual clipboard bytes without base64 conversion", async () => {
		const diskBytes = pngHeader(640, 480);
		const virtualBytes = pngHeader(320, 240);
		const readFile = vi.fn(async () => diskBytes);
		const writeFile = vi.fn(async () => undefined);
		const dependencies = {
			cacheRoot: "C:/cache",
			mkdir: vi.fn(async () => undefined),
			readFile,
			writeFile,
			readdir: vi.fn(),
			rm: vi.fn(),
			stat: vi.fn(),
		} as unknown as ImageCacheDependencies;

		const result = await persistImageFileCache(
			"session-1",
			[
				{
					id: "disk",
					mimeType: "image/png",
					source: { kind: "file-path", path: "C:/clipboard/disk.png" },
				},
				{
					id: "virtual",
					mimeType: "image/png",
					source: { kind: "bytes", data: Uint8Array.from(virtualBytes).buffer },
				},
			],
			dependencies,
		);

		expect(readFile).toHaveBeenCalledWith("C:/clipboard/disk.png");
		expect(writeFile).toHaveBeenNthCalledWith(1, join("C:/cache", "session-1", "disk.png"), diskBytes);
		expect(writeFile).toHaveBeenNthCalledWith(2, join("C:/cache", "session-1", "virtual.png"), virtualBytes);
		expect(result).toEqual([
			{
				path: join("C:/cache", "session-1", "disk.png"),
				format: "png",
				sizeBytes: diskBytes.byteLength,
				width: 640,
				height: 480,
			},
			{
				path: join("C:/cache", "session-1", "virtual.png"),
				format: "png",
				sizeBytes: virtualBytes.byteLength,
				width: 320,
				height: 240,
			},
		]);
	});

	it("keeps dot-only session ids inside the cache root", async () => {
		const mkdir = vi.fn(async () => undefined);
		const dependencies = {
			cacheRoot: "C:/cache",
			mkdir,
			readFile: vi.fn(),
			writeFile: vi.fn(async () => undefined),
			readdir: vi.fn(),
			rm: vi.fn(),
			stat: vi.fn(),
		} as unknown as ImageCacheDependencies;

		await persistImageCache(
			"..",
			[{ id: "image", data: pngHeader(1, 1).toString("base64"), mimeType: "image/png" }],
			dependencies,
		);

		expect(mkdir).toHaveBeenCalledWith(join("C:/cache", "_"), { recursive: true });
	});

	it("removes only expired cache directories", async () => {
		const rm = vi.fn(async () => undefined);
		const now = 10 * 24 * 60 * 60 * 1000;
		const dependencies = {
			cacheRoot: "C:/cache",
			mkdir: vi.fn(),
			readFile: vi.fn(),
			writeFile: vi.fn(),
			readdir: vi.fn(async () => ["expired", "active", "file"]),
			rm,
			stat: vi.fn(async (path: string) => ({
				isDirectory: () => !path.endsWith("file"),
				mtimeMs: path.endsWith("expired") ? 0 : now,
			})),
		} as unknown as ImageCacheDependencies;

		await cleanupOldImageCaches(now, dependencies);

		expect(rm).toHaveBeenCalledOnce();
		expect(rm).toHaveBeenCalledWith(join("C:/cache", "expired"), { recursive: true, force: true });
	});
});

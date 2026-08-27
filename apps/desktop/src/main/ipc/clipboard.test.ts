import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	removeHandler: vi.fn(),
	write: vi.fn(),
	writeImage: vi.fn(),
	readHTML: vi.fn(
		() => '<div data-vetta-user-message="1"><img data-vetta-clipboard-image src="data:image/png;base64,AQID"></div>',
	),
	readText: vi.fn(() => "hello"),
	persistImageCache: vi.fn(async () => [
		{ path: "C:/cache/copied.png", format: "png", sizeBytes: 3, width: 1, height: 1 },
	]),
}));

vi.mock("electron", () => ({
	clipboard: {
		write: mocks.write,
		writeImage: mocks.writeImage,
		readHTML: mocks.readHTML,
		readText: mocks.readText,
	},
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
		removeHandler: mocks.removeHandler,
	},
	nativeImage: {
		createFromDataURL: (dataUrl: string) => ({
			isEmpty: () => false,
			toDataURL: () => dataUrl,
		}),
	},
}));

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => Buffer.from([1, 2, 3])) }));
vi.mock("../image-cache/image-cache-service.js", () => ({
	persistImageCache: mocks.persistImageCache,
}));

const { registerClipboardIpc } = await import("./clipboard");

describe("clipboard IPC", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
		mocks.write.mockClear();
		mocks.writeImage.mockClear();
		mocks.persistImageCache.mockClear();
	});

	it("validates and forwards the rich user-message clipboard contract", async () => {
		const teardown = registerClipboardIpc();
		const handler = mocks.handlers.get("vetta:clipboard:write-user-message");
		expect(handler).toBeDefined();

		await expect(handler?.({}, { text: "hello", images: ["not-an-image"] })).rejects.toThrow(
			"Invalid user message clipboard request",
		);
		await handler?.({}, { text: "hello", images: [{ kind: "data-url", dataUrl: "data:image/png;base64,AQID" }] });
		expect(mocks.write).toHaveBeenCalledWith({
			text: "hello",
			html: expect.stringContaining('data-vetta-user-message="1"'),
			image: expect.objectContaining({ isEmpty: expect.any(Function) }),
		});
		await expect(mocks.handlers.get("vetta:clipboard:paste-user-message")?.({}, "session-1")).resolves.toEqual({
			text: "hello",
			images: [{ path: "C:/cache/copied.png", format: "png", sizeBytes: 3, width: 1, height: 1 }],
		});
		expect(mocks.persistImageCache).toHaveBeenCalledWith("session-1", [
			expect.objectContaining({ data: "AQID", mimeType: "image/png" }),
		]);
		await expect(mocks.handlers.get("vetta:clipboard:paste-user-message")?.({}, "")).rejects.toThrow(
			"Invalid clipboard image cache session",
		);

		teardown();
		expect(mocks.removeHandler).toHaveBeenCalledWith("vetta:clipboard:write-user-message");
		expect(mocks.removeHandler).toHaveBeenCalledWith("vetta:clipboard:paste-user-message");
	});
});

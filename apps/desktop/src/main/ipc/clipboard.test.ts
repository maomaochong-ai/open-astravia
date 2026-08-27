import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	removeHandler: vi.fn(),
	write: vi.fn(),
	writeImage: vi.fn(),
	readHTML: vi.fn(() => '<div data-vetta-user-message="1"></div>'),
	readText: vi.fn(() => "hello"),
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

const { registerClipboardIpc } = await import("./clipboard");

describe("clipboard IPC", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
		mocks.write.mockClear();
		mocks.writeImage.mockClear();
	});

	it("validates and forwards the rich user-message clipboard contract", async () => {
		const teardown = registerClipboardIpc();
		const handler = mocks.handlers.get("vetta:clipboard:write-user-message");
		expect(handler).toBeDefined();

		await expect(handler?.({}, { text: "hello", images: ["not-an-image"] })).rejects.toThrow(
			"Invalid user message clipboard request",
		);
		await handler?.({}, { text: "hello", images: ["data:image/png;base64,AQID"] });
		expect(mocks.write).toHaveBeenCalledWith({
			text: "hello",
			html: expect.stringContaining('data-vetta-user-message="1"'),
			image: expect.objectContaining({ isEmpty: expect.any(Function) }),
		});
		await expect(mocks.handlers.get("vetta:clipboard:read-user-message")?.({})).resolves.toEqual({
			text: "hello",
			html: '<div data-vetta-user-message="1"></div>',
		});

		teardown();
		expect(mocks.removeHandler).toHaveBeenCalledWith("vetta:clipboard:write-user-message");
		expect(mocks.removeHandler).toHaveBeenCalledWith("vetta:clipboard:read-user-message");
	});
});

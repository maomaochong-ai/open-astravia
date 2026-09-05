import type { IpcRenderer, WebUtils } from "electron";
import { describe, expect, it, vi } from "vitest";
import { PERSIST_IMAGE_FILES_CHANNEL } from "../../shared/image-cache";
import { FS_READ_TEXT_PREVIEW_CHANNEL } from "../fs-types";
import { createSystemApi } from "./system";

describe("createSystemApi fs preview contract", () => {
	it("invokes the shared text-preview channel with the selected path", async () => {
		const invoke = vi.fn(async () => ({ status: "text", content: "preview", size: 7 }));
		const api = createSystemApi({ invoke } as unknown as IpcRenderer, {} as WebUtils);

		await expect(api.fs.readTextPreviewFile("C:\\workspace\\notes.custom")).resolves.toEqual({
			status: "text",
			content: "preview",
			size: 7,
		});
		expect(invoke).toHaveBeenCalledWith(FS_READ_TEXT_PREVIEW_CHANNEL, "C:\\workspace\\notes.custom");
	});

	it("persists real File paths directly and sends virtual File contents as binary", async () => {
		const invoke = vi.fn(async () => []);
		const diskFile = { type: "image/png", arrayBuffer: vi.fn() } as unknown as File;
		const virtualData = Uint8Array.from([1, 2, 3]).buffer;
		const virtualFile = {
			type: "image/webp",
			arrayBuffer: vi.fn(async () => virtualData),
		} as unknown as File;
		const webUtils = {
			getPathForFile: vi.fn((file: File) => (file === diskFile ? "C:\\clipboard\\disk.png" : "")),
		} as unknown as WebUtils;
		const api = createSystemApi({ invoke } as unknown as IpcRenderer, webUtils);

		await api.dialog.persistImageFiles("session-1", [diskFile, virtualFile]);

		expect(diskFile.arrayBuffer).not.toHaveBeenCalled();
		expect(virtualFile.arrayBuffer).toHaveBeenCalledOnce();
		expect(invoke).toHaveBeenCalledWith(PERSIST_IMAGE_FILES_CHANNEL, "session-1", [
			{
				id: expect.any(String),
				mimeType: "image/png",
				source: { kind: "file-path", path: "C:\\clipboard\\disk.png" },
			},
			{
				id: expect.any(String),
				mimeType: "image/webp",
				source: { kind: "bytes", data: virtualData },
			},
		]);
	});

	it("forwards rich user-message clipboard payloads without reshaping them", async () => {
		const pasteResult = {
			text: "hello",
			images: [{ path: "C:\\cache\\one.png", format: "png", sizeBytes: 3 }],
		};
		const invoke = vi.fn(async (channel: string) =>
			channel === "vetta:clipboard:paste-user-message" ? pasteResult : undefined,
		);
		const api = createSystemApi({ invoke } as unknown as IpcRenderer, {} as WebUtils);
		const request = {
			text: "hello",
			images: [{ kind: "data-url" as const, dataUrl: "data:image/png;base64,AQID" }],
		};

		await api.clipboard.writeUserMessage(request);

		expect(invoke).toHaveBeenCalledWith("vetta:clipboard:write-user-message", request);
		await expect(api.clipboard.pasteUserMessage("session-1")).resolves.toEqual(pasteResult);
		expect(invoke).toHaveBeenCalledWith("vetta:clipboard:paste-user-message", "session-1");
	});
});

describe("createSystemApi MCP setup login contract", () => {
	it("forwards the QR request id through start and cancel", async () => {
		const invoke = vi.fn(async () => undefined);
		const api = createSystemApi({ invoke } as unknown as IpcRenderer, {} as WebUtils);

		await api.mcp.startSetupLogin("xiaohongshu-mcp", "qr-request-1");
		await api.mcp.cancelSetupLogin("qr-request-1");
		await api.mcp.clearSetupLogin("xiaohongshu-mcp");

		expect(invoke).toHaveBeenNthCalledWith(1, "vetta:mcp:start-setup-login", "xiaohongshu-mcp", "qr-request-1");
		expect(invoke).toHaveBeenNthCalledWith(2, "vetta:mcp:cancel-setup-login", "qr-request-1");
		expect(invoke).toHaveBeenNthCalledWith(3, "vetta:mcp:clear-setup-login", "xiaohongshu-mcp");
	});
});

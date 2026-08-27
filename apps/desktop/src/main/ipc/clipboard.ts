import { clipboard, ipcMain, nativeImage } from "electron";
import type { UserMessageClipboardWriteRequest } from "../../shared/clipboard.js";
import { pasteUserMessageClipboard, writeUserMessageClipboard } from "../clipboard/user-message-clipboard.js";

function isUserMessageClipboardWriteRequest(value: unknown): value is UserMessageClipboardWriteRequest {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { text?: unknown; images?: unknown };
	return (
		typeof candidate.text === "string" &&
		Array.isArray(candidate.images) &&
		candidate.images.every((image) => {
			if (typeof image !== "object" || image === null) return false;
			const source = image as { kind?: unknown; dataUrl?: unknown; path?: unknown };
			return (
				(source.kind === "data-url" &&
					typeof source.dataUrl === "string" &&
					source.dataUrl.startsWith("data:image/")) ||
				(source.kind === "file-path" && typeof source.path === "string" && source.path.trim().length > 0)
			);
		})
	);
}

/**
 * System clipboard writes that the renderer cannot do reliably. Text goes
 * through `navigator.clipboard.writeText` in the renderer; images need the
 * native clipboard because `ClipboardItem` support varies by platform.
 */
export function registerClipboardIpc(): () => void {
	ipcMain.handle("vetta:clipboard:write-image", async (_event, dataUrl: unknown): Promise<void> => {
		if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
			throw new Error("Invalid image data URL");
		}
		const image = nativeImage.createFromDataURL(dataUrl);
		if (image.isEmpty()) throw new Error("Image data URL decoded to an empty image");
		clipboard.writeImage(image);
	});
	ipcMain.handle("vetta:clipboard:write-user-message", async (_event, request: unknown): Promise<void> => {
		if (!isUserMessageClipboardWriteRequest(request)) {
			throw new Error("Invalid user message clipboard request");
		}
		await writeUserMessageClipboard(request);
	});
	ipcMain.handle("vetta:clipboard:paste-user-message", async (_event, sessionId: unknown) => {
		if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
			throw new Error("Invalid clipboard image cache session");
		}
		return pasteUserMessageClipboard(sessionId);
	});

	return () => {
		ipcMain.removeHandler("vetta:clipboard:write-image");
		ipcMain.removeHandler("vetta:clipboard:write-user-message");
		ipcMain.removeHandler("vetta:clipboard:paste-user-message");
	};
}

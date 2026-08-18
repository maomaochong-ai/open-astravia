import { clipboard, ipcMain, nativeImage } from "electron";

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

	return () => {
		ipcMain.removeHandler("vetta:clipboard:write-image");
	};
}

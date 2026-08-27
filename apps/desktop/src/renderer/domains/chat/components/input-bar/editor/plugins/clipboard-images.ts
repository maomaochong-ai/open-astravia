import {
	USER_MESSAGE_CLIPBOARD_ATTRIBUTE,
	USER_MESSAGE_CLIPBOARD_IMAGE_ATTRIBUTE,
	USER_MESSAGE_CLIPBOARD_VERSION,
} from "@/shared/clipboard";

interface ClipboardDataLike {
	readonly items: ArrayLike<DataTransferItem>;
	getData(format: string): string;
}

export interface ClipboardImages {
	files: File[];
	/** Present only for a Vetta rich-message clipboard entry. */
	messageText?: string;
}

function extensionForMimeType(mimeType: string): string {
	switch (mimeType.toLowerCase()) {
		case "image/jpeg":
			return "jpg";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		default:
			return "png";
	}
}

function dataUrlToFile(dataUrl: string, index: number): File | null {
	const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
	if (!match) return null;
	try {
		const mimeType = match[1];
		const decoded = atob(match[2].replace(/[\r\n]/g, ""));
		const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
		return new File([bytes], `copied-image-${index + 1}.${extensionForMimeType(mimeType)}`, {
			type: mimeType,
		});
	} catch {
		return null;
	}
}

export function readVettaMessageClipboardImages(html: string, text: string): ClipboardImages | null {
	if (!html) return null;
	const document = new DOMParser().parseFromString(html, "text/html");
	const root = document.querySelector(`[${USER_MESSAGE_CLIPBOARD_ATTRIBUTE}="${USER_MESSAGE_CLIPBOARD_VERSION}"]`);
	if (!root) return null;
	const files = Array.from(root.querySelectorAll(`img[${USER_MESSAGE_CLIPBOARD_IMAGE_ATTRIBUTE}]`))
		.map((image, index) => dataUrlToFile(image.getAttribute("src") ?? "", index))
		.filter((file): file is File => file !== null);
	return files.length > 0 ? { files, messageText: text } : null;
}

export function readClipboardImages(clipboardData: ClipboardDataLike): ClipboardImages {
	// The native clipboard also exposes the first image as a file. Prefer the marked
	// HTML entry so a multi-image message does not duplicate that first image.
	const richMessage = readVettaMessageClipboardImages(
		clipboardData.getData("text/html"),
		clipboardData.getData("text/plain"),
	);
	if (richMessage) return richMessage;
	const files = Array.from(clipboardData.items)
		.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null);
	return { files };
}

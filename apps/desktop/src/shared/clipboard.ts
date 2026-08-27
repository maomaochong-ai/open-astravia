import type { PersistedImageResult } from "./image-cache.js";

export const USER_MESSAGE_CLIPBOARD_VERSION = "1";
export const USER_MESSAGE_CLIPBOARD_ATTRIBUTE = "data-vetta-user-message";
export const USER_MESSAGE_CLIPBOARD_IMAGE_ATTRIBUTE = "data-vetta-clipboard-image";

export type UserMessageClipboardImageSource =
	| { kind: "data-url"; dataUrl: string }
	| { kind: "file-path"; path: string };

export interface UserMessageClipboardWriteRequest {
	text: string;
	/** Image sources in the same order as the message's image tokens. */
	images: UserMessageClipboardImageSource[];
}

export interface UserMessageClipboardReadResult {
	text: string;
	html: string;
}

export interface UserMessageClipboardEncodedImage {
	data: string;
	mimeType: string;
	name: string;
}

export interface UserMessageClipboardPasteResult {
	text: string;
	images: PersistedImageResult[];
}

export function isVettaUserMessageClipboardHtml(html: string): boolean {
	return html.includes(`${USER_MESSAGE_CLIPBOARD_ATTRIBUTE}="${USER_MESSAGE_CLIPBOARD_VERSION}"`);
}

function extensionForMimeType(mimeType: string): string {
	switch (mimeType.toLowerCase()) {
		case "image/jpeg":
			return "jpg";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		case "image/svg+xml":
			return "svg";
		case "image/bmp":
			return "bmp";
		case "image/x-icon":
			return "ico";
		default:
			return "png";
	}
}

export function extractVettaUserMessageClipboardImages(html: string): UserMessageClipboardEncodedImage[] {
	if (!isVettaUserMessageClipboardHtml(html)) return [];
	const imageAttributePattern = new RegExp(
		`\\b${USER_MESSAGE_CLIPBOARD_IMAGE_ATTRIBUTE}(?:\\s*=\\s*(?:""|'')\\s*)?(?=\\s|/?>)`,
		"i",
	);
	const images: UserMessageClipboardEncodedImage[] = [];
	for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
		if (!imageAttributePattern.test(match[0])) continue;
		const source = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[0]);
		const dataUrl = source?.[1] ?? source?.[2] ?? "";
		const dataUrlMatch = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
		if (!dataUrlMatch) continue;
		const mimeType = dataUrlMatch[1];
		images.push({
			data: dataUrlMatch[2].replace(/[\r\n]/g, ""),
			mimeType,
			name: `copied-image-${images.length + 1}.${extensionForMimeType(mimeType)}`,
		});
	}
	return images;
}

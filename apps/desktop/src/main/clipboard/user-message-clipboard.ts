import { type Clipboard, clipboard, type NativeImage, nativeImage } from "electron";
import {
	isVettaUserMessageClipboardHtml,
	USER_MESSAGE_CLIPBOARD_ATTRIBUTE,
	USER_MESSAGE_CLIPBOARD_IMAGE_ATTRIBUTE,
	USER_MESSAGE_CLIPBOARD_VERSION,
	type UserMessageClipboardReadResult,
	type UserMessageClipboardWriteRequest,
} from "@/shared/clipboard.js";

interface NativeImageFactory {
	createFromDataURL(dataUrl: string): NativeImage;
}

export interface UserMessageClipboardDependencies {
	clipboard: Pick<Clipboard, "write">;
	nativeImage: NativeImageFactory;
}

const DEFAULT_DEPENDENCIES: UserMessageClipboardDependencies = { clipboard, nativeImage };

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function createUserMessageClipboardHtml(text: string, imageDataUrls: readonly string[]): string {
	const images = imageDataUrls
		.map((dataUrl) => `<img ${USER_MESSAGE_CLIPBOARD_IMAGE_ATTRIBUTE}="" src="${escapeHtml(dataUrl)}" alt="">`)
		.join("");
	return `<div ${USER_MESSAGE_CLIPBOARD_ATTRIBUTE}="${USER_MESSAGE_CLIPBOARD_VERSION}"><pre>${escapeHtml(text)}</pre>${images}</div>`;
}

/** Write one atomic multi-format clipboard entry for Vetta and external rich-text editors. */
export function writeUserMessageClipboard(
	request: UserMessageClipboardWriteRequest,
	dependencies: UserMessageClipboardDependencies = DEFAULT_DEPENDENCIES,
): void {
	const decodedImages = request.images.map((dataUrl) => {
		if (!dataUrl.startsWith("data:image/")) throw new Error("Invalid image data URL");
		const image = dependencies.nativeImage.createFromDataURL(dataUrl);
		if (image.isEmpty()) throw new Error("Image data URL decoded to an empty image");
		return image;
	});
	// Normalize through NativeImage before embedding. This prevents arbitrary data-URL
	// markup from crossing into text/html and gives every platform the same PNG payload.
	const normalizedDataUrls = decodedImages.map((image) => image.toDataURL());
	dependencies.clipboard.write({
		text: request.text,
		html: createUserMessageClipboardHtml(request.text, normalizedDataUrls),
		...(decodedImages[0] ? { image: decodedImages[0] } : {}),
	});
}

/** Read only Vetta-authored rich messages; arbitrary clipboard HTML stays in main. */
export function readUserMessageClipboard(
	dependencies: Pick<Clipboard, "readHTML" | "readText"> = clipboard,
): UserMessageClipboardReadResult | null {
	const html = dependencies.readHTML();
	if (!isVettaUserMessageClipboardHtml(html)) return null;
	return { text: dependencies.readText(), html };
}

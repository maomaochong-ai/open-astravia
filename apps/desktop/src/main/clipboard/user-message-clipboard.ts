import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { type Clipboard, clipboard, type NativeImage, nativeImage } from "electron";
import {
	extractVettaUserMessageClipboardImages,
	isVettaUserMessageClipboardHtml,
	USER_MESSAGE_CLIPBOARD_ATTRIBUTE,
	USER_MESSAGE_CLIPBOARD_IMAGE_ATTRIBUTE,
	USER_MESSAGE_CLIPBOARD_VERSION,
	type UserMessageClipboardImageSource,
	type UserMessageClipboardPasteResult,
	type UserMessageClipboardReadResult,
	type UserMessageClipboardWriteRequest,
} from "../../shared/clipboard.js";
import { assertPathReadableForPreview } from "../filesystem/filesystem-service.js";
import { persistImageCache } from "../image-cache/image-cache-service.js";

interface NativeImageFactory {
	createFromDataURL(dataUrl: string): NativeImage;
}

export interface UserMessageClipboardDependencies {
	clipboard: Pick<Clipboard, "write">;
	nativeImage: NativeImageFactory;
	readFile(path: string): Promise<Buffer>;
	assertPathReadable(path: string): void;
}

const DEFAULT_DEPENDENCIES: UserMessageClipboardDependencies = {
	clipboard,
	nativeImage,
	readFile,
	assertPathReadable: assertPathReadableForPreview,
};

const MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
	".bmp": "image/bmp",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
};

const SAFE_RASTER_MIME_TYPES = new Set([
	"image/bmp",
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/x-icon",
]);

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

function decodeImageDataUrl(
	dataUrl: string,
	dependencies: UserMessageClipboardDependencies,
): { dataUrl: string; image: NativeImage } {
	const match = /^data:(image\/[a-z0-9.+-]+);base64,[a-z0-9+/=\r\n]+$/i.exec(dataUrl);
	if (!match) throw new Error("Invalid image data URL");
	const image = dependencies.nativeImage.createFromDataURL(dataUrl);
	if (image.isEmpty()) throw new Error("Image data URL decoded to an empty image");
	return {
		// Raster data is already safe inside an escaped src attribute. SVG and unknown
		// image formats still normalize through NativeImage so markup cannot cross IPC.
		dataUrl: SAFE_RASTER_MIME_TYPES.has(match[1].toLowerCase()) ? dataUrl : image.toDataURL(),
		image,
	};
}

async function resolveImageSource(
	source: UserMessageClipboardImageSource,
	dependencies: UserMessageClipboardDependencies,
): Promise<{ dataUrl: string; image: NativeImage }> {
	if (source.kind === "data-url") return decodeImageDataUrl(source.dataUrl, dependencies);
	dependencies.assertPathReadable(source.path);
	const mimeType = MIME_TYPE_BY_EXTENSION[extname(source.path).toLowerCase()];
	if (!mimeType) throw new Error("Unsupported clipboard image path");
	const bytes = await dependencies.readFile(source.path);
	return decodeImageDataUrl(`data:${mimeType};base64,${bytes.toString("base64")}`, dependencies);
}

/** Write one atomic multi-format clipboard entry for Vetta and external rich-text editors. */
export async function writeUserMessageClipboard(
	request: UserMessageClipboardWriteRequest,
	dependencies: UserMessageClipboardDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
	const decodedImages = await Promise.all(request.images.map((source) => resolveImageSource(source, dependencies)));
	dependencies.clipboard.write({
		text: request.text,
		html: createUserMessageClipboardHtml(
			request.text,
			decodedImages.map(({ dataUrl }) => dataUrl),
		),
		...(decodedImages[0] ? { image: decodedImages[0].image } : {}),
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

export interface UserMessageClipboardPasteDependencies {
	clipboard: Pick<Clipboard, "readHTML" | "readText">;
	persistImages: typeof persistImageCache;
	createId(): string;
}

const DEFAULT_PASTE_DEPENDENCIES: UserMessageClipboardPasteDependencies = {
	clipboard,
	persistImages: persistImageCache,
	createId: randomUUID,
};

export async function pasteUserMessageClipboard(
	sessionId: string,
	dependencies: UserMessageClipboardPasteDependencies = DEFAULT_PASTE_DEPENDENCIES,
): Promise<UserMessageClipboardPasteResult | null> {
	const richMessage = readUserMessageClipboard(dependencies.clipboard);
	if (!richMessage) return null;
	const encodedImages = extractVettaUserMessageClipboardImages(richMessage.html);
	if (encodedImages.length === 0) return null;
	const images = await dependencies.persistImages(
		sessionId,
		encodedImages.map((image) => ({ id: dependencies.createId(), data: image.data, mimeType: image.mimeType })),
	);
	return images.length > 0 ? { text: richMessage.text, images } : null;
}

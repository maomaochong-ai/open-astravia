import { extractAstraviaUserMessageClipboardImages } from "@/shared/clipboard";
import type { Base64Image } from "../persistImages";

interface ClipboardDataLike {
	readonly items: ArrayLike<DataTransferItem>;
	getData(format: string): string;
}

export interface AstraviaMessageClipboardImages {
	kind: "astravia-message";
	images: Base64Image[];
	messageText: string;
}

export type ClipboardImages = AstraviaMessageClipboardImages | { kind: "files"; files: File[] };

export function readAstraviaMessageClipboardImages(html: string, text: string): AstraviaMessageClipboardImages | null {
	const images = extractAstraviaUserMessageClipboardImages(html);
	return images.length > 0 ? { kind: "astravia-message", images, messageText: text } : null;
}

export function readClipboardImageFiles(clipboardData: Pick<ClipboardDataLike, "items">): File[] {
	return Array.from(clipboardData.items)
		.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null);
}

export function readClipboardImages(clipboardData: ClipboardDataLike): ClipboardImages {
	// The native clipboard also exposes the first image as a file. Prefer the marked
	// HTML entry so a multi-image message does not duplicate that first image.
	const richMessage = readAstraviaMessageClipboardImages(
		clipboardData.getData("text/html"),
		clipboardData.getData("text/plain"),
	);
	if (richMessage) return richMessage;
	return { kind: "files", files: readClipboardImageFiles(clipboardData) };
}

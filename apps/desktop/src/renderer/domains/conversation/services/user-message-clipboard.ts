import type { UserMessageClipboardImageSource } from "@/shared/clipboard";

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string" && reader.result.startsWith("data:image/")) {
				resolve(reader.result);
				return;
			}
			reject(new Error("Clipboard image did not encode as an image data URL"));
		};
		reader.onerror = () => reject(reader.error ?? new Error("Failed to read clipboard image"));
		reader.readAsDataURL(blob);
	});
}

function localPathFromVettaFileUrl(source: string): string | null {
	try {
		const url = new URL(source);
		if (url.protocol !== "vetta-file:") return null;
		let path = decodeURIComponent(url.pathname);
		if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
		return path || null;
	} catch {
		return null;
	}
}

async function resolveImageSource(source: string): Promise<UserMessageClipboardImageSource> {
	if (source.startsWith("data:image/")) return { kind: "data-url", dataUrl: source };
	const localPath = localPathFromVettaFileUrl(source);
	if (localPath) return { kind: "file-path", path: localPath };
	const response = await fetch(source);
	if (!response.ok) throw new Error(`Failed to load clipboard image (${response.status})`);
	const blob = await response.blob();
	if (!blob.type.startsWith("image/")) throw new Error("Clipboard source is not an image");
	return { kind: "data-url", dataUrl: await blobToDataUrl(blob) };
}

/** Copy text plus every message image without using local paths as image sources in the HTML payload. */
export async function copyUserMessageToClipboard(text: string, imageSources: readonly string[]): Promise<void> {
	if (imageSources.length === 0) {
		if (text) await navigator.clipboard.writeText(text);
		return;
	}
	const images = await Promise.all(imageSources.map(resolveImageSource));
	await window.vetta.clipboard.writeUserMessage({ text, images });
}

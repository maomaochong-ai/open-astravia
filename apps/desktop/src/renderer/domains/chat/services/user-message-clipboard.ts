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

async function resolveImageDataUrl(source: string): Promise<string> {
	if (source.startsWith("data:image/")) return source;
	const response = await fetch(source);
	if (!response.ok) throw new Error(`Failed to load clipboard image (${response.status})`);
	const blob = await response.blob();
	if (!blob.type.startsWith("image/")) throw new Error("Clipboard source is not an image");
	return blobToDataUrl(blob);
}

/** Copy text plus every message image without using local paths as image sources in the HTML payload. */
export async function copyUserMessageToClipboard(text: string, imageSources: readonly string[]): Promise<void> {
	if (imageSources.length === 0) {
		if (text) await navigator.clipboard.writeText(text);
		return;
	}
	const images = await Promise.all(imageSources.map(resolveImageDataUrl));
	await window.vetta.clipboard.writeUserMessage({ text, images });
}

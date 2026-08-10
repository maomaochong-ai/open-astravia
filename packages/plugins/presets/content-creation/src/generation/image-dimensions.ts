export interface ImageDimensions {
	width: number;
	height: number;
}

export async function inferImageDimensionsFromBase64(
	data: string,
	mimeType: string,
): Promise<ImageDimensions | undefined> {
	if (!mimeType.startsWith("image/") || typeof createImageBitmap !== "function") return undefined;
	try {
		const encoded = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
		const binary = atob(encoded);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
		const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
		try {
			return validImageDimensions(bitmap.width, bitmap.height);
		} finally {
			bitmap.close();
		}
	} catch {
		return undefined;
	}
}

export function inferImageDimensionsFromUrl(source: string): Promise<ImageDimensions | undefined> {
	if (!source || typeof Image === "undefined") return Promise.resolve(undefined);
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => resolve(validImageDimensions(image.naturalWidth, image.naturalHeight));
		image.onerror = () => resolve(undefined);
		image.src = source;
	});
}

function validImageDimensions(width: number, height: number): ImageDimensions | undefined {
	return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
		? { width, height }
		: undefined;
}

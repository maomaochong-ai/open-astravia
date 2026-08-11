import type { ImportedContentAsset } from "../generation/types";

export async function createImportedMediaFile(file: File, name = file.name): Promise<ImportedContentAsset> {
	const mimeType = importedMediaMimeType(file);
	const dimensions = mimeType.startsWith("image/") ? await readImageDimensions(file) : undefined;
	return { name, mimeType, file, ...dimensions };
}

export function isImportedMediaFile(file: File): boolean {
	const mimeType = importedMediaMimeType(file);
	return mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/");
}

function importedMediaMimeType(file: File): string {
	return file.type || inferMimeType(file.name);
}

function inferMimeType(fileName: string): string {
	const extension = fileName.split(".").at(-1)?.toLowerCase();
	if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
	if (extension === "png") return "image/png";
	if (extension === "webp") return "image/webp";
	if (extension === "mov") return "video/quicktime";
	if (extension === "webm") return "video/webm";
	if (extension === "mp4") return "video/mp4";
	if (extension === "mp3") return "audio/mpeg";
	if (extension === "wav") return "audio/wav";
	if (extension === "m4a") return "audio/mp4";
	if (extension === "ogg" || extension === "oga") return "audio/ogg";
	if (extension === "flac") return "audio/flac";
	return "application/octet-stream";
}

async function readImageDimensions(file: File): Promise<{ width: number; height: number } | undefined> {
	if (typeof globalThis.createImageBitmap !== "function") return undefined;
	try {
		const bitmap = await globalThis.createImageBitmap(file);
		try {
			return bitmap.width > 0 && bitmap.height > 0 ? { width: bitmap.width, height: bitmap.height } : undefined;
		} finally {
			bitmap.close();
		}
	} catch {
		return undefined;
	}
}

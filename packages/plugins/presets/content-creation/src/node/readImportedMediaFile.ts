import type { ImportedContentAsset } from "../generation/types";

export async function readImportedMediaFile(file: File): Promise<ImportedContentAsset> {
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.onerror = () => reject(reader.error ?? new Error("failed to read imported content asset"));
		reader.readAsDataURL(file);
	});
	const separator = dataUrl.indexOf(",");
	if (separator < 0) throw new Error("imported content asset is not a valid data URL");
	return { name: file.name, mimeType: importedMediaMimeType(file), data: dataUrl.slice(separator + 1) };
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

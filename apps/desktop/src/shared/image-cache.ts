export const PERSIST_IMAGE_FILES_CHANNEL = "vetta:dialog:persist-image-files";

export interface PersistImageInput {
	/** Stable id used as the on-disk file name. */
	id: string;
	/** Base64-encoded image data without a data URI prefix. */
	data: string;
	mimeType: string;
}

export interface PersistImageFileInput {
	id: string;
	mimeType: string;
	source: { kind: "file-path"; path: string } | { kind: "bytes"; data: ArrayBuffer };
}

export interface PersistedImageResult {
	path: string;
	format: string;
	sizeBytes: number;
	width?: number;
	height?: number;
}

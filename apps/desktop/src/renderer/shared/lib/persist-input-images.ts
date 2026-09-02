import type { AppMonitorInputAttachmentSource } from "@preload/api";
import { recordInputImagesAdded } from "@shared/lib/app-monitor-events";

const DRAFT_BUCKET = "draft";
let counter = 0;

function nextId(): string {
	return `img-${++counter}-${Date.now()}`;
}

export interface Base64Image {
	data: string;
	mimeType: string;
	name: string;
}

export async function persistBase64Images(
	images: readonly Base64Image[],
	sessionId: string | null,
	source: AppMonitorInputAttachmentSource,
): Promise<string[]> {
	if (images.length === 0) return [];
	try {
		const persisted = await window.vetta.dialog.persistImages(
			sessionId || DRAFT_BUCKET,
			images.map((image) => ({ id: nextId(), data: image.data, mimeType: image.mimeType })),
		);
		recordInputImagesAdded(source, persisted);
		return persisted.map((image) => image.path);
	} catch (error) {
		console.error("[input-editor] persist images failed:", error);
		return [];
	}
}

export async function persistImageFiles(
	files: readonly File[],
	sessionId: string | null,
	source: AppMonitorInputAttachmentSource,
): Promise<string[]> {
	if (files.length === 0) return [];
	try {
		const persisted = await window.vetta.dialog.persistImageFiles(sessionId || DRAFT_BUCKET, [...files]);
		recordInputImagesAdded(source, persisted);
		return persisted.map((image) => image.path);
	} catch (error) {
		console.error("[input-editor] persist image files failed:", error);
		return [];
	}
}

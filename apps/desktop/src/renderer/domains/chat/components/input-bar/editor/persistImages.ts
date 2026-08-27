import type { AppMonitorInputAttachmentSource } from "@preload/api";
import { recordInputImagesAdded } from "@shared/lib/app-monitor-events";

/** 无会话（新会话页草稿）时的落盘目录段；image-cache 下的路径本就被视作系统附件。 */
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

/**
 * 图片必须先落盘才能变成行内 token——token 的文本形式是 `@<路径>`，
 * 粘贴那一刻还只有 base64 就没有可写进文本的东西。
 * 返回落盘后的绝对路径；失败时返回空数组（调用方放弃插入，不留半个 token）。
 */
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

/** 剪贴板 / 拖拽来的 File 由 preload 以真实路径或二进制字节直接落盘。 */
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

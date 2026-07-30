import type { AppMonitorInputAttachmentSource } from "@preload/api";
import { recordInputImagesAdded } from "@shared/lib/app-monitor-events";

/** 无会话（新会话页草稿）时的落盘目录段；image-cache 下的路径本就被视作系统附件。 */
const DRAFT_BUCKET = "draft";

let counter = 0;

function nextId(): string {
	return `img-${++counter}-${Date.now()}`;
}

function readAsBase64(file: File): Promise<{ data: string; mimeType: string; name: string }> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			const commaIdx = result.indexOf(",");
			resolve({
				data: result.slice(commaIdx + 1),
				mimeType: file.type || "image/png",
				name: file.name || "Pasted image",
			});
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
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
		const paths = await window.vetta.dialog.persistImages(
			sessionId || DRAFT_BUCKET,
			images.map((image) => ({ id: nextId(), data: image.data, mimeType: image.mimeType })),
		);
		recordInputImagesAdded(source, [...images]);
		return paths;
	} catch (error) {
		console.error("[input-editor] persist images failed:", error);
		return [];
	}
}

/** 剪贴板 / 拖拽来的 File 先读成 base64 再落盘。 */
export async function persistImageFiles(
	files: readonly File[],
	sessionId: string | null,
	source: AppMonitorInputAttachmentSource,
): Promise<string[]> {
	if (files.length === 0) return [];
	try {
		const images = await Promise.all(files.map(readAsBase64));
		return await persistBase64Images(images, sessionId, source);
	} catch (error) {
		console.error("[input-editor] read images failed:", error);
		return [];
	}
}

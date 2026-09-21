import { open } from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
/** 识别图片类型需要的文件头长度。远端实现只取这么多，不必把整张图拖过网络。 */
export const IMAGE_SNIFF_BYTES = 4100;
const FILE_TYPE_SNIFF_BYTES = IMAGE_SNIFF_BYTES;

/** 按文件头判断是不是模型能直接看的图片；文件在哪台机器上由调用方负责取头。 */
export async function detectSupportedImageMimeTypeFromBuffer(head: Uint8Array): Promise<string | null> {
	if (head.byteLength === 0) return null;
	const fileType = await fileTypeFromBuffer(head);
	if (!fileType || !IMAGE_MIME_TYPES.has(fileType.mime)) return null;
	return fileType.mime;
}

export async function detectSupportedImageMimeTypeFromFile(filePath: string): Promise<string | null> {
	const fileHandle = await open(filePath, "r");
	try {
		const buffer = Buffer.alloc(FILE_TYPE_SNIFF_BYTES);
		const { bytesRead } = await fileHandle.read(buffer, 0, FILE_TYPE_SNIFF_BYTES, 0);
		return detectSupportedImageMimeTypeFromBuffer(buffer.subarray(0, bytesRead));
	} finally {
		await fileHandle.close();
	}
}

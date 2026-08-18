import { Buffer } from "node:buffer";
import { resizeImageBuffer } from "./tools/read/image-resize.js";

/** Node adapter for Coding Agent's structurally typed model-input image processor port. */
export const nodeModelInputImageProcessor = {
	async resize(data: string, mimeType: string, signal: AbortSignal) {
		signal.throwIfAborted();
		return resizeImageBuffer(Buffer.from(data, "base64"), mimeType, undefined, data);
	},
};

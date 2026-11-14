import { Buffer } from "node:buffer";
import { type ImageResizeOptions, type ImageResizeResult, resizeImageBuffer } from "./tools/read/image-resize.js";

type ResizeImageBuffer = (
	bytes: Buffer,
	mimeType: string,
	options: ImageResizeOptions | undefined,
	originalBase64: string,
) => Promise<ImageResizeResult>;

export interface NodeModelInputImageProcessorOptions {
	readonly resize?: ResizeImageBuffer;
	/** 最多记住的处理结果条数；同一张图在一轮的每次模型调用中都会重复出现。 */
	readonly maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 64;

/**
 * Node adapter for Coding Agent's structurally typed model-input image processor port.
 *
 * 结果按「原图 base64 + mimeType + 缩放参数」记忆：每次模型调用都会重新规范化整段历史里的图片，
 * 不记忆时超限图片每一步都要在主进程里同步重新缩放。base64 字符串本身作为键，相同消息对象复用
 * 同一字符串，比较开销很小。
 */
export function createNodeModelInputImageProcessor(options: NodeModelInputImageProcessorOptions = {}) {
	const resize = options.resize ?? resizeImageBuffer;
	const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const cache = new Map<string, Map<string, Promise<ImageResizeResult>>>();
	let size = 0;

	function remember(variant: string, data: string, result: Promise<ImageResizeResult>): void {
		let entries = cache.get(variant);
		if (!entries) {
			entries = new Map();
			cache.set(variant, entries);
		}
		entries.set(data, result);
		size += 1;
		while (size > maxEntries) {
			const [oldestVariant, oldestEntries] = cache.entries().next().value as [
				string,
				Map<string, Promise<ImageResizeResult>>,
			];
			const oldestData = oldestEntries.keys().next().value as string;
			oldestEntries.delete(oldestData);
			if (oldestEntries.size === 0) cache.delete(oldestVariant);
			size -= 1;
		}
	}

	function forget(variant: string, data: string, result: Promise<ImageResizeResult>): void {
		const entries = cache.get(variant);
		if (entries?.get(data) !== result) return;
		entries.delete(data);
		if (entries.size === 0) cache.delete(variant);
		size -= 1;
	}

	return {
		async resize(
			data: string,
			mimeType: string,
			signal: AbortSignal,
			resizeOptions?: ImageResizeOptions,
		): Promise<ImageResizeResult> {
			signal.throwIfAborted();
			const variant = `${mimeType}\n${JSON.stringify(resizeOptions ?? null)}`;
			const entries = cache.get(variant);
			const cached = entries?.get(data);
			if (entries && cached) {
				// 命中时移到队尾，保持最近使用的图片不被淘汰。
				entries.delete(data);
				entries.set(data, cached);
				return cached;
			}
			const result = resize(Buffer.from(data, "base64"), mimeType, resizeOptions, data);
			remember(variant, data, result);
			result.catch(() => forget(variant, data, result));
			return result;
		},
	};
}

export const nodeModelInputImageProcessor = createNodeModelInputImageProcessor();

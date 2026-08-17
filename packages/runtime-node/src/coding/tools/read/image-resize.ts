import { loadPhoton } from "./photon.js";

let warnedNoPhoton = false;
const DEBUG_RESIZE = process.env.DEBUG_IMAGE_RESIZE === "1" || process.env.DEBUG_IMAGE_RESIZE === "true";

export interface ImageResizeOptions {
	readonly maxWidth?: number;
	readonly maxHeight?: number;
	readonly maxInputPixels?: number;
	readonly maxInputEdge?: number;
	readonly maxBytes?: number;
	readonly jpegQuality?: number;
}

export interface ResizedImage {
	readonly data: string;
	readonly mimeType: string;
	readonly originalWidth: number;
	readonly originalHeight: number;
	readonly width: number;
	readonly height: number;
	readonly wasResized: boolean;
}

export interface ImageResizeFailure {
	readonly failed: true;
	readonly mimeType: string;
	readonly originalSizeBytes: number;
	readonly reason: "processor_unavailable" | "processing_failed" | "input_too_large";
	readonly message: string;
}

export type ImageResizeResult = ResizedImage | ImageResizeFailure;

const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
	maxWidth: 1280,
	maxHeight: 1280,
	maxInputPixels: 8000 * 8000,
	maxInputEdge: 12000,
	maxBytes: 2 * 1024 * 1024,
	jpegQuality: 70,
};

interface ImageDimensions {
	readonly width: number;
	readonly height: number;
}

interface InputDimensionLimitDetails extends ImageDimensions {
	readonly pixels: number;
	readonly maxInputPixels: number;
	readonly maxInputEdge: number;
}

function pickSmaller(
	first: { buffer: Uint8Array; mimeType: string },
	second: { buffer: Uint8Array; mimeType: string },
): { buffer: Uint8Array; mimeType: string } {
	return first.buffer.length <= second.buffer.length ? first : second;
}

function debugLog(result: ResizedImage, originalBytes: number): ResizedImage {
	if (DEBUG_RESIZE) {
		const finalBytes = Math.round((result.data.length * 3) / 4);
		console.warn(
			`[image-resize] ${result.originalWidth}x${result.originalHeight} (${originalBytes}B) → ${result.width}x${result.height} (~${finalBytes}B ${result.mimeType}) wasResized=${result.wasResized}`,
		);
	}
	return result;
}

export function isImageResizeFailure(result: ImageResizeResult): result is ImageResizeFailure {
	return "failed" in result;
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return "unknown size";
	}
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	return unitIndex === 0 ? `${bytes} ${units[unitIndex]}` : `${value.toFixed(1)} ${units[unitIndex]}`;
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		return [error.name, error.message, error.stack].filter(Boolean).join(": ");
	}
	return String(error);
}

function createFailure(
	inputBuffer: Buffer,
	mimeType: string,
	reason: ImageResizeFailure["reason"],
	message: string,
): ImageResizeFailure {
	return {
		failed: true,
		mimeType,
		originalSizeBytes: inputBuffer.length,
		reason,
		message,
	};
}

export function formatImageResizeFailureNote(result: ImageResizeFailure, label = "image"): string {
	return `[Image omitted: ${label} was not sent to the model. ${result.message} Original: ${result.mimeType}, ${formatBytes(result.originalSizeBytes)}.]`;
}

function createInputTooLargeMessage(details: InputDimensionLimitDetails): string {
	return `The image is ${details.width}x${details.height} (${details.pixels} pixels), which exceeds the safe local processing limit of ${details.maxInputPixels} pixels or ${details.maxInputEdge}px on either edge.`;
}

function readUint24LE(buffer: Buffer, offset: number): number {
	return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function getPngDimensions(buffer: Buffer): ImageDimensions | undefined {
	if (
		buffer.length < 24 ||
		buffer[0] !== 0x89 ||
		buffer[1] !== 0x50 ||
		buffer[2] !== 0x4e ||
		buffer[3] !== 0x47 ||
		buffer[12] !== 0x49 ||
		buffer[13] !== 0x48 ||
		buffer[14] !== 0x44 ||
		buffer[15] !== 0x52
	) {
		return undefined;
	}
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function getGifDimensions(buffer: Buffer): ImageDimensions | undefined {
	if (
		buffer.length < 10 ||
		buffer[0] !== 0x47 ||
		buffer[1] !== 0x49 ||
		buffer[2] !== 0x46 ||
		buffer[3] !== 0x38 ||
		(buffer[4] !== 0x37 && buffer[4] !== 0x39) ||
		buffer[5] !== 0x61
	) {
		return undefined;
	}
	return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function getJpegDimensions(buffer: Buffer): ImageDimensions | undefined {
	if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
		return undefined;
	}

	let offset = 2;
	while (offset + 3 < buffer.length) {
		if (buffer[offset] !== 0xff) {
			offset++;
			continue;
		}
		while (offset < buffer.length && buffer[offset] === 0xff) {
			offset++;
		}

		const marker = buffer[offset];
		offset++;
		if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
			continue;
		}
		if (offset + 1 >= buffer.length) {
			return undefined;
		}

		const segmentLength = buffer.readUInt16BE(offset);
		if (segmentLength < 2 || offset + segmentLength > buffer.length) {
			return undefined;
		}
		const isStartOfFrame =
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf);
		if (isStartOfFrame) {
			if (segmentLength < 7) {
				return undefined;
			}
			return {
				height: buffer.readUInt16BE(offset + 3),
				width: buffer.readUInt16BE(offset + 5),
			};
		}
		offset += segmentLength;
	}
	return undefined;
}

function getWebpDimensions(buffer: Buffer): ImageDimensions | undefined {
	if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
		return undefined;
	}

	let offset = 12;
	while (offset + 8 <= buffer.length) {
		const chunkType = buffer.toString("ascii", offset, offset + 4);
		const chunkSize = buffer.readUInt32LE(offset + 4);
		const dataOffset = offset + 8;
		if (dataOffset + chunkSize > buffer.length) {
			return undefined;
		}

		if (chunkType === "VP8X" && chunkSize >= 10) {
			return {
				width: readUint24LE(buffer, dataOffset + 4) + 1,
				height: readUint24LE(buffer, dataOffset + 7) + 1,
			};
		}
		if (chunkType === "VP8 " && chunkSize >= 10) {
			if (buffer[dataOffset + 3] !== 0x9d || buffer[dataOffset + 4] !== 0x01 || buffer[dataOffset + 5] !== 0x2a) {
				return undefined;
			}
			return {
				width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
				height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
			};
		}
		if (chunkType === "VP8L" && chunkSize >= 5) {
			if (buffer[dataOffset] !== 0x2f) {
				return undefined;
			}
			const byte1 = buffer[dataOffset + 1];
			const byte2 = buffer[dataOffset + 2];
			const byte3 = buffer[dataOffset + 3];
			const byte4 = buffer[dataOffset + 4];
			return {
				width: 1 + (((byte2 & 0x3f) << 8) | byte1),
				height: 1 + (((byte4 & 0x0f) << 10) | (byte3 << 2) | ((byte2 & 0xc0) >> 6)),
			};
		}
		offset = dataOffset + chunkSize + (chunkSize % 2);
	}
	return undefined;
}

function getImageDimensions(buffer: Buffer, mimeType: string): ImageDimensions | undefined {
	switch (mimeType) {
		case "image/png":
			return getPngDimensions(buffer);
		case "image/jpeg":
		case "image/jpg":
			return getJpegDimensions(buffer);
		case "image/gif":
			return getGifDimensions(buffer);
		case "image/webp":
			return getWebpDimensions(buffer);
		default:
			return undefined;
	}
}

function validateInputDimensions(
	inputBuffer: Buffer,
	mimeType: string,
	options: Required<ImageResizeOptions>,
): ImageResizeFailure | undefined {
	let dimensions: ImageDimensions | undefined;
	try {
		dimensions = getImageDimensions(inputBuffer, mimeType);
	} catch (error) {
		console.warn(
			`[image-resize] Failed to read image metadata before Photon decode (${inputBuffer.length} bytes, ${mimeType}); continuing with Photon decode. Error: ${describeError(error)}`,
		);
		return undefined;
	}
	if (!dimensions) {
		return undefined;
	}

	const { width, height } = dimensions;
	const pixels = width * height;
	const maxEdge = Math.max(width, height);
	if (pixels > options.maxInputPixels || maxEdge > options.maxInputEdge) {
		const details = {
			width,
			height,
			pixels,
			maxInputPixels: options.maxInputPixels,
			maxInputEdge: options.maxInputEdge,
		};
		console.warn(
			`[image-resize] Skipping image before Photon decode (${inputBuffer.length} bytes, ${mimeType}); ${createInputTooLargeMessage(details)}`,
		);
		return createFailure(inputBuffer, mimeType, "input_too_large", createInputTooLargeMessage(details));
	}
	return undefined;
}

function asBuffer(bytes: Buffer | Uint8Array): Buffer {
	if (Buffer.isBuffer(bytes)) {
		return bytes;
	}
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export async function resizeImageBuffer(
	bytes: Buffer | Uint8Array,
	mimeType: string,
	options?: ImageResizeOptions,
	originalBase64?: string,
): Promise<ImageResizeResult> {
	const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
	const inputBuffer = asBuffer(bytes);
	const inputDimensionFailure = validateInputDimensions(inputBuffer, mimeType, resolvedOptions);
	if (inputDimensionFailure) {
		return inputDimensionFailure;
	}

	const photon = await loadPhoton();
	if (!photon) {
		if (!warnedNoPhoton) {
			warnedNoPhoton = true;
			console.warn(
				`[image-resize] Skipping image: Photon unavailable. Image (${inputBuffer.length} bytes, ${mimeType}) will be omitted instead of being sent at original resolution.`,
			);
		}
		return createFailure(
			inputBuffer,
			mimeType,
			"processor_unavailable",
			"The image could not be prepared for model input because image processing is currently unavailable.",
		);
	}

	let image: ReturnType<typeof photon.PhotonImage.new_from_byteslice> | undefined;
	try {
		image = photon.PhotonImage.new_from_byteslice(new Uint8Array(inputBuffer));
		const originalWidth = image.get_width();
		const originalHeight = image.get_height();
		const format = mimeType.split("/")[1] ?? "png";

		if (
			originalWidth <= resolvedOptions.maxWidth &&
			originalHeight <= resolvedOptions.maxHeight &&
			inputBuffer.length <= resolvedOptions.maxBytes
		) {
			return debugLog(
				{
					data: originalBase64 ?? inputBuffer.toString("base64"),
					mimeType: mimeType || `image/${format}`,
					originalWidth,
					originalHeight,
					width: originalWidth,
					height: originalHeight,
					wasResized: false,
				},
				inputBuffer.length,
			);
		}

		let targetWidth = originalWidth;
		let targetHeight = originalHeight;
		if (targetWidth > resolvedOptions.maxWidth) {
			targetHeight = Math.round((targetHeight * resolvedOptions.maxWidth) / targetWidth);
			targetWidth = resolvedOptions.maxWidth;
		}
		if (targetHeight > resolvedOptions.maxHeight) {
			targetWidth = Math.round((targetWidth * resolvedOptions.maxHeight) / targetHeight);
			targetHeight = resolvedOptions.maxHeight;
		}

		function tryBothFormats(
			width: number,
			height: number,
			jpegQuality: number,
		): { buffer: Uint8Array; mimeType: string } {
			const resized = photon!.resize(image!, width, height, photon!.SamplingFilter.Lanczos3);
			try {
				return pickSmaller(
					{ buffer: resized.get_bytes(), mimeType: "image/png" },
					{ buffer: resized.get_bytes_jpeg(jpegQuality), mimeType: "image/jpeg" },
				);
			} finally {
				resized.free();
			}
		}

		const qualitySteps = [85, 70, 55, 40];
		const scaleSteps = [1, 0.75, 0.5, 0.35, 0.25];
		let best = tryBothFormats(targetWidth, targetHeight, resolvedOptions.jpegQuality);
		let finalWidth = targetWidth;
		let finalHeight = targetHeight;

		if (best.buffer.length <= resolvedOptions.maxBytes) {
			return debugLog(
				{
					data: Buffer.from(best.buffer).toString("base64"),
					mimeType: best.mimeType,
					originalWidth,
					originalHeight,
					width: finalWidth,
					height: finalHeight,
					wasResized: true,
				},
				inputBuffer.length,
			);
		}

		for (const quality of qualitySteps) {
			best = tryBothFormats(targetWidth, targetHeight, quality);
			if (best.buffer.length <= resolvedOptions.maxBytes) {
				return debugLog(
					{
						data: Buffer.from(best.buffer).toString("base64"),
						mimeType: best.mimeType,
						originalWidth,
						originalHeight,
						width: finalWidth,
						height: finalHeight,
						wasResized: true,
					},
					inputBuffer.length,
				);
			}
		}

		for (const scale of scaleSteps) {
			finalWidth = Math.round(targetWidth * scale);
			finalHeight = Math.round(targetHeight * scale);
			if (finalWidth < 100 || finalHeight < 100) {
				break;
			}
			for (const quality of qualitySteps) {
				best = tryBothFormats(finalWidth, finalHeight, quality);
				if (best.buffer.length <= resolvedOptions.maxBytes) {
					return debugLog(
						{
							data: Buffer.from(best.buffer).toString("base64"),
							mimeType: best.mimeType,
							originalWidth,
							originalHeight,
							width: finalWidth,
							height: finalHeight,
							wasResized: true,
						},
						inputBuffer.length,
					);
				}
			}
		}

		return debugLog(
			{
				data: Buffer.from(best.buffer).toString("base64"),
				mimeType: best.mimeType,
				originalWidth,
				originalHeight,
				width: finalWidth,
				height: finalHeight,
				wasResized: true,
			},
			inputBuffer.length,
		);
	} catch (error) {
		const detail = describeError(error);
		console.warn(
			`[image-resize] Resize failed (${inputBuffer.length} bytes, ${mimeType}); image omitted instead of passing through at ORIGINAL resolution. Error: ${detail}`,
		);
		return createFailure(
			inputBuffer,
			mimeType,
			"processing_failed",
			"The image could not be decoded or resized into a safe model-sized image.",
		);
	} finally {
		image?.free();
	}
}

export function formatDimensionNote(result: ResizedImage): string | undefined {
	if (!result.wasResized) {
		return undefined;
	}
	const scale = result.originalWidth / result.width;
	return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}

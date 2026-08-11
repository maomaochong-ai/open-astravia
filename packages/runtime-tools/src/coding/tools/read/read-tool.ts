import { constants } from "node:fs";
import { access as fsAccess, readFile as fsReadFile } from "node:fs/promises";
import { extname } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition, RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { renderAnchoredLines } from "../../shared/anchors.js";
import { resolveReadPath } from "../../shared/path-resolution.js";
import { decodeTextBuffer } from "../../shared/text-decoding.js";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "../../shared/truncation.js";
import { READ_TOOL_DESCRIPTION } from "./description.js";
import { detectSupportedImageMimeTypeFromFile } from "./image-mime.js";
import {
	formatDimensionNote,
	formatImageResizeFailureNote,
	type ImageResizeResult,
	isImageResizeFailure,
	resizeImageBuffer,
} from "./image-resize.js";

export const ReadToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	path: Type.String({
		description: "Path to the file to read (relative or absolute)",
	}),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export type ReadToolInput = Static<typeof ReadToolInputSchema>;

export interface ReadToolDetails {
	readonly truncation?: TruncationResult;
	readonly image?: {
		readonly originalPath: string;
		readonly originalMimeType: string;
		readonly originalSizeBytes: number;
		readonly originalWidth: number;
		readonly originalHeight: number;
		readonly processedMimeType: string;
		readonly processedSizeBytes: number;
		readonly processedWidth: number;
		readonly processedHeight: number;
		readonly wasResized: boolean;
	};
}

export interface ReadOperations {
	readFile(absolutePath: string): Promise<Buffer>;
	access(absolutePath: string): Promise<void>;
	detectImageMimeType?(absolutePath: string): Promise<string | null | undefined>;
}

export interface ReadImageProcessor {
	resize(buffer: Buffer, mimeType: string): Promise<ImageResizeResult>;
}

export interface ReadToolOptions {
	readonly autoResizeImages?: boolean;
	readonly operations?: ReadOperations;
	readonly imageProcessor?: ReadImageProcessor;
}

const defaultReadOperations: ReadOperations = {
	readFile: (path) => fsReadFile(path),
	access: (path) => fsAccess(path, constants.R_OK),
	detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

const defaultImageProcessor: ReadImageProcessor = {
	resize: (buffer, mimeType) => resizeImageBuffer(buffer, mimeType),
};

const KNOWN_BINARY_EXTENSIONS = new Set([
	".7z",
	".a",
	".bin",
	".class",
	".dat",
	".dll",
	".doc",
	".docx",
	".exe",
	".gz",
	".jar",
	".lib",
	".o",
	".obj",
	".odf",
	".odp",
	".ods",
	".odt",
	".pdf",
	".ppt",
	".pptx",
	".pyc",
	".pyo",
	".so",
	".tar",
	".war",
	".wasm",
	".xls",
	".xlsx",
	".zip",
]);

const EXTENSION_TO_SKILL: Readonly<Record<string, string>> = {
	".doc": "docx",
	".odt": "docx",
	".xls": "xlsx",
	".ods": "xlsx",
	".csv": "xlsx",
	".tsv": "xlsx",
	".ppt": "pptx",
	".odp": "pptx",
};

export function createReadTool(cwd: string, options: ReadToolOptions = {}): RuntimeToolDefinition<ReadToolInput> {
	const autoResizeImages = options.autoResizeImages ?? true;
	const operations = options.operations ?? defaultReadOperations;
	const imageProcessor = options.imageProcessor ?? defaultImageProcessor;

	return {
		name: "read",
		label: "read",
		description: READ_TOOL_DESCRIPTION,
		inputSchema: ReadToolInputSchema,
		execute(request) {
			const { path, offset, limit } = request.input;
			const absolutePath = resolveReadPath(path, cwd);

			return new Promise<RuntimeToolResult>((resolve, reject) => {
				if (request.signal.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}

				let aborted = false;
				const onAbort = () => {
					aborted = true;
					reject(new Error("Operation aborted"));
				};
				request.signal.addEventListener("abort", onAbort, { once: true });

				(async () => {
					try {
						await operations.access(absolutePath);
						if (aborted) {
							return;
						}

						const mimeType = operations.detectImageMimeType
							? await operations.detectImageMimeType(absolutePath)
							: undefined;
						let result: RuntimeToolResult;

						if (mimeType) {
							result = await readImage(absolutePath, mimeType, autoResizeImages, operations, imageProcessor);
						} else {
							result = await readText(absolutePath, path, offset, limit, operations);
						}

						if (aborted) {
							return;
						}
						request.signal.removeEventListener("abort", onAbort);
						resolve(result);
					} catch (error) {
						request.signal.removeEventListener("abort", onAbort);
						if (!aborted) {
							reject(error);
						}
					}
				})();
			});
		},
	};
}

async function readImage(
	absolutePath: string,
	mimeType: string,
	autoResizeImages: boolean,
	operations: ReadOperations,
	imageProcessor: ReadImageProcessor,
): Promise<RuntimeToolResult> {
	const buffer = await operations.readFile(absolutePath);
	if (!autoResizeImages) {
		return {
			content: [
				{ type: "text", text: `Read image file [${mimeType}]` },
				{ type: "image", data: buffer.toString("base64"), mimeType },
			],
			details: {
				image: {
					originalPath: absolutePath,
					originalMimeType: mimeType,
					originalSizeBytes: buffer.length,
					originalWidth: 0,
					originalHeight: 0,
					processedMimeType: mimeType,
					processedSizeBytes: buffer.length,
					processedWidth: 0,
					processedHeight: 0,
					wasResized: false,
				},
			} satisfies ReadToolDetails,
		};
	}

	const resized = await imageProcessor.resize(buffer, mimeType);
	if (isImageResizeFailure(resized)) {
		return {
			content: [{ type: "text", text: formatImageResizeFailureNote(resized, absolutePath) }],
			details: undefined,
		};
	}

	const dimensionNote = formatDimensionNote(resized);
	let textNote = `Read image file [${resized.mimeType}]`;
	if (dimensionNote) {
		textNote += `\n${dimensionNote}`;
	}
	return {
		content: [
			{ type: "text", text: textNote },
			{ type: "image", data: resized.data, mimeType: resized.mimeType },
		],
		details: {
			image: {
				originalPath: absolutePath,
				originalMimeType: mimeType,
				originalSizeBytes: buffer.length,
				originalWidth: resized.originalWidth,
				originalHeight: resized.originalHeight,
				processedMimeType: resized.mimeType,
				processedSizeBytes: Buffer.byteLength(resized.data, "base64"),
				processedWidth: resized.width,
				processedHeight: resized.height,
				wasResized: resized.wasResized,
			},
		} satisfies ReadToolDetails,
	};
}

async function readText(
	absolutePath: string,
	requestedPath: string,
	offset: number | undefined,
	limit: number | undefined,
	operations: ReadOperations,
): Promise<RuntimeToolResult> {
	const buffer = await operations.readFile(absolutePath);
	const extension = extname(absolutePath).toLowerCase();
	if (KNOWN_BINARY_EXTENSIONS.has(extension) || isLikelyBinaryContent(buffer)) {
		const extensionLabel = extension || "(no extension)";
		return {
			content: [
				{
					type: "text",
					text: `Binary file detected (${extensionLabel}, ${formatSize(buffer.length)}). Raw bytes are not shown to avoid context pollution.\n${getBinaryExtractionHint(extension)}`,
				},
			],
			details: undefined,
		};
	}

	const textContent = decodeTextBuffer(buffer);
	const allLines = textContent.split("\n");
	const startLine = offset ? Math.max(0, offset - 1) : 0;
	const startLineDisplay = startLine + 1;
	if (startLine >= allLines.length) {
		throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
	}

	let selectedContent: string;
	let userLimitedLines: number | undefined;
	if (limit !== undefined) {
		const endLine = Math.min(startLine + limit, allLines.length);
		selectedContent = allLines.slice(startLine, endLine).join("\n");
		userLimitedLines = endLine - startLine;
	} else {
		selectedContent = allLines.slice(startLine).join("\n");
	}

	const truncation = truncateHead(selectedContent);
	const anchorContent = (raw: string): string => renderAnchoredLines(raw.split("\n"), startLineDisplay).join("\n");
	let outputText: string;
	let details: ReadToolDetails | undefined;

	if (truncation.firstLineExceedsLimit) {
		const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
		outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${requestedPath} | head -c ${DEFAULT_MAX_BYTES}]`;
		details = { truncation };
	} else if (truncation.truncated) {
		const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
		const nextOffset = endLineDisplay + 1;
		outputText = anchorContent(truncation.content);
		if (truncation.truncatedBy === "lines") {
			outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${allLines.length}. Use offset=${nextOffset} to continue.]`;
		} else {
			outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${allLines.length} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
		}
		details = { truncation };
	} else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
		const remaining = allLines.length - (startLine + userLimitedLines);
		const nextOffset = startLine + userLimitedLines + 1;
		outputText = anchorContent(truncation.content);
		outputText += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
	} else {
		outputText = anchorContent(truncation.content);
	}

	return {
		content: [{ type: "text", text: outputText }],
		details,
	};
}

function isLikelyBinaryContent(buffer: Buffer): boolean {
	if (buffer.length === 0) {
		return false;
	}
	let nonPrintable = 0;
	for (const byte of buffer) {
		if (byte === 0) {
			return true;
		}
		if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) {
			nonPrintable++;
		}
	}
	return nonPrintable / buffer.length > 0.3;
}

function getBinaryExtractionHint(extension: string): string {
	const skillName = EXTENSION_TO_SKILL[extension] ?? extension.slice(1);
	if (skillName) {
		return `Load the "${skillName}" skill for instructions on how to handle this file.`;
	}
	return "No matching skill found. Try converting this file with bash before reading.";
}

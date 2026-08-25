import { constants } from "node:fs";
import { access as fsAccess, readFile as fsReadFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import {
	type RuntimeToolDefinition,
	RuntimeToolExecutionError,
	type RuntimeToolResult,
} from "@vetta/runtime-core/kernel";
import { renderAnchoredLines } from "../../shared/anchors.js";
import { resolveReadPath } from "../../shared/path-resolution.js";
import { decodeTextBuffer } from "../../shared/text-decoding.js";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "../../shared/truncation.js";
import { READ_TOOL_DESCRIPTION } from "./description.js";
import { detectSupportedImageMimeTypeFromFile } from "./image-mime.js";
import {
	formatDimensionNote,
	formatImageResizeFailureNote,
	type ImageResizeOptions,
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
	readonly totalLines?: number;
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
	resize(buffer: Buffer, mimeType: string, options?: ImageResizeOptions): Promise<ImageResizeResult>;
}

export interface ReadToolOptions {
	readonly autoResizeImages?: boolean;
	readonly operations?: ReadOperations;
	readonly imageProcessor?: ReadImageProcessor;
	readonly imageResizeOptions?: ImageResizeOptions;
}

const defaultReadOperations: ReadOperations = {
	readFile: (path) => fsReadFile(path),
	access: (path) => fsAccess(path, constants.R_OK),
	detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

const defaultImageProcessor: ReadImageProcessor = {
	resize: (buffer, mimeType, options) => resizeImageBuffer(buffer, mimeType, options),
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
	const imageResizeOptions = options.imageResizeOptions;

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
							result = await readImage(
								absolutePath,
								mimeType,
								autoResizeImages,
								operations,
								imageProcessor,
								imageResizeOptions,
							);
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
							reject(classifyReadError(error, path, absolutePath));
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
	imageResizeOptions: ImageResizeOptions | undefined,
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

	const resized = await imageProcessor.resize(buffer, mimeType, imageResizeOptions);
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
	const totalLines = allLines.length;
	const startLine = offset ? Math.max(0, offset - 1) : 0;
	const startLineDisplay = startLine + 1;
	if (startLine >= totalLines) {
		throw new RuntimeToolExecutionError(`Offset ${offset} is beyond end of file (${totalLines} lines total)`, {
			code: "read_offset_out_of_range",
			retryable: false,
			metadata: { path: absolutePath, offset, totalLines },
		});
	}

	let selectedContent: string;
	let userLimitedLines: number | undefined;
	if (limit !== undefined) {
		const endLine = Math.min(startLine + limit, totalLines);
		selectedContent = allLines.slice(startLine, endLine).join("\n");
		userLimitedLines = endLine - startLine;
	} else {
		selectedContent = allLines.slice(startLine).join("\n");
	}

	const anchorContent = (raw: string): string => renderAnchoredLines(raw.split("\n"), startLineDisplay).join("\n");
	const remainingNote = (): string => {
		if (userLimitedLines === undefined || startLine + userLimitedLines >= totalLines) {
			return "";
		}
		const remaining = totalLines - (startLine + userLimitedLines);
		const nextOffset = startLine + userLimitedLines + 1;
		return `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
	};

	// Skill instructions must never be silently halved: a truncated SKILL.md still reads
	// as a complete instruction set to the model, so it follows the surviving half.
	if (isSkillMarkdownPath(absolutePath)) {
		return {
			content: [{ type: "text", text: anchorContent(selectedContent) + remainingNote() }],
			details: { totalLines } satisfies ReadToolDetails,
		};
	}

	const truncation = truncateHead(selectedContent);
	let outputText: string;
	let details: ReadToolDetails;

	if (truncation.firstLineExceedsLimit) {
		const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
		outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${requestedPath} | head -c ${DEFAULT_MAX_BYTES}]`;
		details = { totalLines, truncation };
	} else if (truncation.truncated) {
		const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
		const nextOffset = endLineDisplay + 1;
		outputText = anchorContent(truncation.content);
		if (truncation.truncatedBy === "lines") {
			outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalLines}. Use offset=${nextOffset} to continue.]`;
		} else {
			outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
		}
		details = { totalLines, truncation };
	} else {
		outputText = anchorContent(truncation.content) + remainingNote();
		details = { totalLines };
	}

	return {
		content: [{ type: "text", text: outputText }],
		details,
	};
}

const SKILL_MARKDOWN_FILENAME = "SKILL.md";
const SKILL_DIRECTORY_SEGMENT = "skills";

/**
 * Matches `SKILL.md` anywhere, plus any Markdown file under a path segment named exactly
 * `skills`, so docs a skill references are covered too. `.`/`..` are folded lexically;
 * symlinks are not resolved. Near-misses such as `skills-preset` do not match.
 */
function isSkillMarkdownPath(absolutePath: string): boolean {
	if (basename(absolutePath) === SKILL_MARKDOWN_FILENAME) {
		return true;
	}
	if (extname(absolutePath).toLowerCase() !== ".md") {
		return false;
	}
	return foldPathSegments(absolutePath).includes(SKILL_DIRECTORY_SEGMENT);
}

function foldPathSegments(absolutePath: string): string[] {
	const segments: string[] = [];
	for (const segment of absolutePath.split(/[/\\]+/)) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments;
}

/**
 * Maps filesystem errno values onto distinct, actionable tool errors. Without this every
 * failure reaches the model as one undifferentiated error and it retries the same read.
 */
function classifyReadError(error: unknown, requestedPath: string, absolutePath: string): unknown {
	if (error instanceof RuntimeToolExecutionError) {
		return error;
	}
	const errno = errnoCode(error);
	if (!errno) {
		return error;
	}
	const location = requestedPath === absolutePath ? requestedPath : `${requestedPath} (${absolutePath})`;
	const metadata = { path: absolutePath };
	switch (errno) {
		case "ENOENT":
		case "ENOTDIR":
			return new RuntimeToolExecutionError(
				`File not found: ${location}`,
				{ code: "read_file_not_found", retryable: false, metadata },
				{ cause: error },
			);
		case "EISDIR":
			return new RuntimeToolExecutionError(
				`${location} is a directory, not a file. Use the \`ls\` tool to list its contents.`,
				{ code: "read_is_a_directory", retryable: false, metadata },
				{ cause: error },
			);
		case "EACCES":
		case "EPERM":
			return new RuntimeToolExecutionError(
				`Permission denied: ${location}`,
				{ code: "read_permission_denied", retryable: false, metadata },
				{ cause: error },
			);
		default:
			return error;
	}
}

function errnoCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}
	const code = (error as { readonly code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
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

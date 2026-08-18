import { access, readFile, stat } from "node:fs/promises";
import type { ImageContent } from "@vetta/ai";
import {
	detectSupportedImageMimeTypeFromFile,
	formatDimensionNote,
	formatImageResizeFailureNote,
	isImageResizeFailure,
	resizeImageBuffer,
	resolveExistingPath,
} from "@vetta/runtime-node/coding";
import chalk from "chalk";

export interface ProcessedCliFiles {
	readonly text: string;
	readonly images: ImageContent[];
}

export interface ProcessCliFileOptions {
	readonly autoResizeImages?: boolean;
	readonly cwd?: string;
}

/** Resolve CLI `@file` arguments into prompt text and image attachments. */
export async function processCliFileArguments(
	fileArgs: readonly string[],
	options: ProcessCliFileOptions = {},
): Promise<ProcessedCliFiles> {
	const autoResizeImages = options.autoResizeImages ?? true;
	const cwd = options.cwd ?? process.cwd();
	let text = "";
	const images: ImageContent[] = [];

	for (const fileArg of fileArgs) {
		const absolutePath = resolveExistingPath(fileArg, cwd);
		try {
			await access(absolutePath);
		} catch {
			throw new CliFileInputError(`File not found: ${absolutePath}`);
		}

		const stats = await stat(absolutePath);
		if (stats.size === 0) continue;

		const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);
		if (!mimeType) {
			try {
				const content = await readFile(absolutePath, "utf-8");
				text += `<file name="${absolutePath}">\n${content}\n</file>\n`;
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				throw new CliFileInputError(`Could not read file ${absolutePath}: ${message}`, { cause: error });
			}
			continue;
		}

		const content = await readFile(absolutePath);
		let attachment: ImageContent;
		let dimensionNote: string | undefined;
		if (autoResizeImages) {
			const resized = await resizeImageBuffer(content, mimeType);
			if (isImageResizeFailure(resized)) {
				text += `<file name="${absolutePath}">${formatImageResizeFailureNote(resized, absolutePath)}</file>\n`;
				continue;
			}
			dimensionNote = formatDimensionNote(resized);
			attachment = { type: "image", mimeType: resized.mimeType, data: resized.data };
		} else {
			attachment = { type: "image", mimeType, data: content.toString("base64") };
		}
		images.push(attachment);
		text += `<file name="${absolutePath}">${dimensionNote ?? ""}</file>\n`;
	}

	return { text, images };
}

export class CliFileInputError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(chalk.red(`Error: ${message}`), options);
		this.name = "CliFileInputError";
	}
}

import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import {
	type AsyncExecutionGate,
	DesktopCommandAbortedError,
	type DesktopCommandPort,
	type DesktopCommandResult,
} from "../../shared/desktop-command.js";
import { parseOcrDesktopResponse, parseOcrJsonDocument } from "../../shared/ocr-document.js";
import { resolveExistingPath, resolveToCwd } from "../../shared/path-resolution.js";
import { EXTRACT_TEXT_FROM_IMAGE_TOOL_DESCRIPTION } from "./description.js";

export const ExtractTextFromImageToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({ description: "Brief user-facing reason for this tool call (max 100 chars).", maxLength: 100 }),
	),
	input: Type.String({ description: "Path to the source image file (.png .jpg .jpeg .webp .bmp .gif)." }),
	output: Type.Optional(
		Type.String({ description: "Path to write the structured JSON. Default: <input>.ocr.json next to the source." }),
	),
	maxChars: Type.Optional(
		Type.Integer({
			description: "Cap on returned text length. Default 8000. Full text is still written to <output>.",
			minimum: 0,
		}),
	),
});

export type ExtractTextFromImageToolInput = Static<typeof ExtractTextFromImageToolInputSchema>;

export interface ExtractTextFromImageToolOptions {
	readonly desktop: DesktopCommandPort;
	readonly executionGate: AsyncExecutionGate;
	readonly modelOrder?: number;
}

const DEFAULT_MAX_CHARS = 8000;
const OCR_TIMEOUT_MS = 5 * 60 * 1000;
const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);

export function createExtractTextFromImageTool(
	cwd: string,
	options: ExtractTextFromImageToolOptions,
): RuntimeToolDefinition<ExtractTextFromImageToolInput> {
	return {
		name: "extract_text_from_img",
		label: "extract_text_from_img",
		description: EXTRACT_TEXT_FROM_IMAGE_TOOL_DESCRIPTION,
		inputSchema: ExtractTextFromImageToolInputSchema,
		modelOrder: options.modelOrder,
		async execute({ input, signal, reportPhase }) {
			if (signal.aborted) throw new Error("Operation aborted");
			reportPhase?.("locate");
			const inputPath = resolveExistingPath(input.input, cwd);
			const extension = nodePath.extname(inputPath).toLowerCase();
			if (!SUPPORTED_EXTENSIONS.has(extension)) {
				throw new Error(
					`Unsupported image extension "${extension || "<none>"}". Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`,
				);
			}
			const outputPath = resolveToCwd(input.output ?? `${inputPath}.ocr.json`, cwd);
			const desktop = await options.desktop.locate();
			reportPhase?.("ocr");
			let result: DesktopCommandResult;
			try {
				result = await options.executionGate.run(async () => {
					if (signal.aborted) throw new Error("Operation aborted");
					return options.desktop.run(desktop.path, ["--ocr-img", inputPath, "--output", outputPath], {
						signal,
						timeoutMs: OCR_TIMEOUT_MS,
						maxBufferBytes: 32 * 1024 * 1024,
					});
				});
			} catch (error) {
				if (error instanceof DesktopCommandAbortedError) throw new Error("Operation aborted");
				throw error;
			}
			if (signal.aborted) throw new Error("Operation aborted");
			const response = parseOcrDesktopResponse(result.stdout);
			if (!response.ok) {
				const message = response.error?.message ?? (result.stderr.trim() || "Unknown OCR error");
				throw new Error(`Vetta Desktop OCR failed: ${message}`);
			}
			if (!response.output) throw new Error("Vetta Desktop did not return an output path");
			reportPhase?.("read");
			const document = parseOcrJsonDocument(await readFile(response.output, "utf8"));
			const page = document.pages[0];
			const fullText = (page?.text ?? "").trim();
			const cap = input.maxChars ?? DEFAULT_MAX_CHARS;
			const body =
				cap > 0 && fullText.length > cap
					? `${fullText.slice(0, cap)}\n…[truncated ${fullText.length - cap} chars]`
					: fullText;
			const durationMs = typeof document.meta.durationMs === "number" ? document.meta.durationMs : "?";
			const engine = typeof document.meta.engine === "string" ? document.meta.engine : "?";
			const staleNote = desktop.staleConfiguredPath
				? `\nNote: configured vettaAppPath was stale and a fallback path was used: ${desktop.staleConfiguredPath}`
				: "";
			return {
				content: [
					{
						type: "text",
						text: `${body}\n---\nconfidence=${page?.confidence ?? "?"} duration_ms=${durationMs} engine=${engine}\noutput: ${response.output}${staleNote}`,
					},
				],
				details: undefined,
			};
		},
	};
}

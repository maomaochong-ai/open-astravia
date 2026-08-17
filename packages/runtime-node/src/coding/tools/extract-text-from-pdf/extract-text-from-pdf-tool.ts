import { readFile } from "node:fs/promises";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import {
	type AsyncExecutionGate,
	type CommandProcessPort,
	DesktopCommandAbortedError,
	type DesktopCommandPort,
	type DesktopCommandResult,
} from "../../shared/desktop-command.js";
import {
	type OcrJsonDocument,
	type OcrPageResult,
	parseOcrDesktopResponse,
	parseOcrJsonDocument,
} from "../../shared/ocr-document.js";
import { resolveExistingPath, resolveToCwd } from "../../shared/path-resolution.js";
import { EXTRACT_TEXT_FROM_PDF_TOOL_DESCRIPTION } from "./description.js";

export const ExtractTextFromPdfToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({ description: "Brief user-facing reason for this tool call (max 100 chars).", maxLength: 100 }),
	),
	input: Type.String({ description: "Path to the source PDF file." }),
	output: Type.Optional(
		Type.String({
			description: "Path to write the full structured JSON. Default: <input>.ocr.json next to the source.",
		}),
	),
	pages: Type.Optional(Type.String({ description: 'Pages to extract: "all" | "N" | "N-M". Default "all".' })),
	dpi: Type.Optional(
		Type.Integer({
			description:
				"Render DPI for OCR fallback. 36-600. Default 150. If OCR hits OOM, retry with a smaller DPI. When omitted, the tool may automatically lower DPI for oversized PDF pages.",
			minimum: 36,
			maximum: 600,
		}),
	),
	maxChars: Type.Optional(
		Type.Integer({
			description: "Cap on returned text length. Default 8000. Full text is still written to <output>.",
			minimum: 0,
		}),
	),
	preferTextLayer: Type.Optional(
		Type.Boolean({ description: "Try the embedded text layer before falling back to OCR. Default true." }),
	),
});

export type ExtractTextFromPdfToolInput = Static<typeof ExtractTextFromPdfToolInputSchema>;

export interface ExtractTextFromPdfToolOptions {
	readonly desktop: DesktopCommandPort;
	readonly process: CommandProcessPort;
	readonly executionGate: AsyncExecutionGate;
	readonly modelOrder?: number;
}

const DEFAULT_MAX_CHARS = 8000;
const DEFAULT_RENDER_DPI = 150;
const MIN_RENDER_DPI = 36;
const MAX_RENDER_DPI = 600;
const MAX_RENDERED_PAGE_EDGE_PX = 10000;
const OCR_TIMEOUT_MS = 30 * 60 * 1000;

interface PdfPageRange {
	readonly first?: number;
	readonly last?: number;
}

function parsePageRange(pages: string | undefined): PdfPageRange {
	if (!pages || pages === "all") return {};
	const single = /^(\d+)$/.exec(pages);
	if (single) {
		const page = Number(single[1]);
		return { first: page, last: page };
	}
	const range = /^(\d+)-(\d+)$/.exec(pages);
	if (!range) return {};
	const first = Number(range[1]);
	const last = Number(range[2]);
	return first <= last ? { first, last } : {};
}

function parsePdfInfoPageSizes(stdout: string): readonly number[] {
	const edges: number[] = [];
	const pattern = /Page(?:\s+\d+)?\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/gi;
	for (const match of stdout.matchAll(pattern)) {
		const width = Number(match[1]);
		const height = Number(match[2]);
		if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
			edges.push(Math.max(width, height));
		}
	}
	return edges;
}

function clampDpi(dpi: number): number {
	return Math.min(MAX_RENDER_DPI, Math.max(MIN_RENDER_DPI, Math.floor(dpi)));
}

async function resolveRenderDpi(
	inputPath: string,
	pages: string | undefined,
	requestedDpi: number | undefined,
	process: CommandProcessPort,
	signal: AbortSignal,
): Promise<number> {
	if (requestedDpi !== undefined) return clampDpi(requestedDpi);
	const range = parsePageRange(pages);
	const args = ["-box"];
	if (range.first !== undefined) args.push("-f", String(range.first));
	if (range.last !== undefined) args.push("-l", String(range.last));
	args.push(inputPath);
	let edges: readonly number[] = [];
	try {
		const result = await process.run("pdfinfo", args, {
			signal,
			timeoutMs: 30 * 1000,
			maxBufferBytes: 4 * 1024 * 1024,
		});
		edges = parsePdfInfoPageSizes(result.stdout);
	} catch {
		return DEFAULT_RENDER_DPI;
	}
	const maxPageEdgePoints = Math.max(0, ...edges);
	if (maxPageEdgePoints <= 0) return DEFAULT_RENDER_DPI;
	const maxSafeDpi = Math.floor((MAX_RENDERED_PAGE_EDGE_PX * 72) / maxPageEdgePoints);
	return clampDpi(Math.min(DEFAULT_RENDER_DPI, maxSafeDpi));
}

function formatPageBlock(page: OcrPageResult): string {
	return `=== Page ${page.page} (${page.source}${page.confidence !== undefined ? `, conf ${page.confidence}` : ""}) ===\n${page.text}`;
}

function metaNumber(document: OcrJsonDocument, key: string, fallback: number | string): number | string {
	const value = document.meta[key];
	return typeof value === "number" ? value : fallback;
}

function metaString(document: OcrJsonDocument, key: string): string {
	const value = document.meta[key];
	return typeof value === "string" ? value : "?";
}

function buildAgentText(document: OcrJsonDocument, maxChars: number, outputPath: string): string {
	const fullText = document.pages.map(formatPageBlock).join("\n\n");
	const body =
		maxChars > 0 && fullText.length > maxChars
			? `${fullText.slice(0, maxChars)}\n…[truncated ${fullText.length - maxChars} chars]`
			: fullText;
	return `${body}\n---\ntotal_pages=${metaNumber(document, "totalPages", "?")} processed=${metaNumber(document, "processedPages", "?")} text_layer=${metaNumber(document, "textLayerPages", 0)} ocr=${metaNumber(document, "ocrPages", 0)} duration_ms=${metaNumber(document, "durationMs", "?")} engine=${metaString(document, "engine")}\noutput: ${outputPath}`;
}

export function createExtractTextFromPdfTool(
	cwd: string,
	options: ExtractTextFromPdfToolOptions,
): RuntimeToolDefinition<ExtractTextFromPdfToolInput> {
	return {
		name: "extract_text_from_pdf",
		label: "extract_text_from_pdf",
		description: EXTRACT_TEXT_FROM_PDF_TOOL_DESCRIPTION,
		inputSchema: ExtractTextFromPdfToolInputSchema,
		modelOrder: options.modelOrder,
		async execute({ input, signal, reportPhase }) {
			if (signal.aborted) throw new Error("Operation aborted");
			reportPhase?.("locate");
			const inputPath = resolveExistingPath(input.input, cwd);
			const outputPath = resolveToCwd(input.output ?? `${inputPath}.ocr.json`, cwd);
			const desktop = await options.desktop.locate();
			const renderDpi = await resolveRenderDpi(inputPath, input.pages, input.dpi, options.process, signal);
			const args = ["--ocr-pdf", inputPath, "--output", outputPath];
			if (input.pages) args.push("--pages", input.pages);
			args.push("--dpi", String(renderDpi));
			if (input.preferTextLayer === false) args.push("--no-text-layer");
			reportPhase?.("ocr");
			let result: DesktopCommandResult;
			try {
				result = await options.executionGate.run(async () => {
					if (signal.aborted) throw new Error("Operation aborted");
					return options.desktop.run(desktop.path, args, {
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
			const staleNote = desktop.staleConfiguredPath
				? `\nNote: configured vettaAppPath was stale and a fallback path was used: ${desktop.staleConfiguredPath}`
				: "";
			return {
				content: [
					{
						type: "text",
						text: `${buildAgentText(document, input.maxChars ?? DEFAULT_MAX_CHARS, response.output)}${staleNote}`,
					},
				],
				details: undefined,
			};
		},
	};
}

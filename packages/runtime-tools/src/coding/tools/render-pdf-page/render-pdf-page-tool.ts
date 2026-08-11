import { mkdir, stat, unlink } from "node:fs/promises";
import nodePath from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { resolveExistingPath, resolveToCwd } from "../../shared/path-resolution.js";
import { RENDER_PDF_PAGE_TOOL_DESCRIPTION } from "./description.js";

export const RenderPdfPageToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	input: Type.String({ description: "Path to the source PDF file." }),
	page: Type.Integer({ description: "1-based page number to render. Single page only.", minimum: 1 }),
	output: Type.Optional(
		Type.String({ description: "Path to write the PNG. Default: <input>.p<page>.png next to the source." }),
	),
	dpi: Type.Optional(Type.Integer({ description: "Render DPI. 72-600. Default 200.", minimum: 72, maximum: 600 })),
});

export type RenderPdfPageToolInput = Static<typeof RenderPdfPageToolInputSchema>;

export interface RenderPdfPageProcessResult {
	readonly code: number | null;
	readonly stderr: string;
}

export interface RenderPdfPageProcessPort {
	run(args: readonly string[], signal: AbortSignal): Promise<RenderPdfPageProcessResult>;
}

export class RenderPdfPageProcessAbortedError extends Error {
	constructor() {
		super("Render PDF page process aborted");
		this.name = "RenderPdfPageProcessAbortedError";
	}
}

export interface RenderPdfPageToolOptions {
	readonly process: RenderPdfPageProcessPort;
	readonly now?: () => number;
	readonly modelOrder?: number;
}

const DEFAULT_DPI = 200;

export function createRenderPdfPageTool(
	cwd: string,
	options: RenderPdfPageToolOptions,
): RuntimeToolDefinition<RenderPdfPageToolInput> {
	const now = options.now ?? Date.now;
	return {
		name: "render_pdf_page",
		label: "render_pdf_page",
		description: RENDER_PDF_PAGE_TOOL_DESCRIPTION,
		inputSchema: RenderPdfPageToolInputSchema,
		modelOrder: options.modelOrder,
		async execute({ input: { input, page, output, dpi }, signal, reportPhase }) {
			if (signal.aborted) throw new Error("Operation aborted");
			reportPhase?.("locate");
			const inputPath = resolveExistingPath(input, cwd);
			const outputPath = resolveToCwd(output ?? `${inputPath}.p${page}.png`, cwd);
			if (!outputPath.toLowerCase().endsWith(".png")) {
				throw new Error(`output must end in .png (got "${outputPath}")`);
			}
			await mkdir(nodePath.dirname(outputPath), { recursive: true });
			const renderDpi = dpi ?? DEFAULT_DPI;
			const prefix = outputPath.toLowerCase().endsWith(".png") ? outputPath.slice(0, -4) : outputPath;
			reportPhase?.("render");
			const startedAt = now();
			let render: RenderPdfPageProcessResult;
			try {
				render = await options.process.run(
					[
						"-png",
						"-r",
						String(renderDpi),
						"-f",
						String(page),
						"-l",
						String(page),
						"-singlefile",
						inputPath,
						prefix,
					],
					signal,
				);
			} catch (error) {
				if (error instanceof RenderPdfPageProcessAbortedError) {
					await unlink(outputPath).catch(() => {});
					throw new Error("Operation aborted");
				}
				const processError = error as NodeJS.ErrnoException;
				const hint =
					processError.code === "ENOENT" || processError.message.includes("ENOENT")
						? " (pdftoppm not found — install poppler: `brew install poppler` on macOS)"
						: "";
				throw new Error(`pdftoppm failed: ${processError.message}${hint}`);
			}
			if (render.code !== 0) {
				throw new Error(`pdftoppm failed: ${render.stderr.trim() || `exited with code ${render.code}`}`);
			}
			if (signal.aborted) {
				await unlink(outputPath).catch(() => {});
				throw new Error("Operation aborted");
			}
			let sizeBytes: number;
			try {
				sizeBytes = (await stat(outputPath)).size;
			} catch {
				throw new Error(`pdftoppm did not produce expected output at ${outputPath}`);
			}
			const text = [
				`Rendered page ${page} of ${inputPath} at ${renderDpi} dpi.`,
				`Next step: call read("${outputPath}") to load the image for visual analysis.`,
				"---",
				`dpi=${renderDpi} size_bytes=${sizeBytes} duration_ms=${now() - startedAt}`,
				`output: ${outputPath}`,
			].join("\n");
			return { content: [{ type: "text", text }], details: undefined };
		},
	};
}

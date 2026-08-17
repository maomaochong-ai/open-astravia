import nodePath from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { resolveExistingPath, resolveToCwd } from "../../shared/path-resolution.js";
import { DOC_TO_PDF_TOOL_DESCRIPTION } from "./description.js";

export const DocToPdfToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	path: Type.String({
		description: "Path to the .doc or .docx file to convert (relative/absolute)",
	}),
	output: Type.Optional(
		Type.String({
			description: "Output PDF path. Defaults to same directory and name with .pdf extension",
		}),
	),
});

export type DocToPdfToolInput = Static<typeof DocToPdfToolInputSchema>;
export type DocToPdfOfficeBackend = "msoffice" | "wps";

export interface DocToPdfDetectedBackend {
	readonly type: DocToPdfOfficeBackend;
	readonly label: string;
}

export interface DocToPdfOperations {
	detect(): Promise<DocToPdfDetectedBackend | null>;
	convert(inputPath: string, outputPath: string, backend: DocToPdfDetectedBackend): Promise<string>;
}

export interface DocToPdfToolOptions {
	readonly operations: DocToPdfOperations;
	readonly modelOrder?: number;
}

const SUPPORTED_EXTENSIONS = new Set([".doc", ".docx"]);

export function createDocToPdfTool(
	cwd: string,
	options: DocToPdfToolOptions,
): RuntimeToolDefinition<DocToPdfToolInput> {
	return {
		name: "doc_to_pdf",
		label: "doc_to_pdf",
		description: DOC_TO_PDF_TOOL_DESCRIPTION,
		inputSchema: DocToPdfToolInputSchema,
		modelOrder: options.modelOrder,
		async execute({ input: { path, output }, signal, reportPhase }) {
			return new Promise((resolve, reject) => {
				if (signal.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}
				let aborted = false;
				const onAbort = () => {
					aborted = true;
					reject(new Error("Operation aborted"));
				};
				signal.addEventListener("abort", onAbort, { once: true });
				void (async () => {
					try {
						reportPhase?.("locate");
						const inputPath = resolveExistingPath(path, cwd);
						const extension = nodePath.extname(inputPath).toLowerCase();
						if (!SUPPORTED_EXTENSIONS.has(extension)) {
							resolve({
								content: [
									{
										type: "text",
										text: `Unsupported file type: ${extension}. Only .doc and .docx files are supported.`,
									},
								],
								details: undefined,
							});
							return;
						}
						const outputPath = output ? resolveToCwd(output, cwd) : inputPath.replace(/\.[^.]+$/, ".pdf");
						if (aborted) return;
						reportPhase?.("detect");
						const backend = await options.operations.detect();
						if (!backend) {
							resolve({
								content: [
									{
										type: "text",
										text: "Dependency missing: no Microsoft Office or WPS Office installation detected. Cannot convert document to PDF. Please try other methods.",
									},
								],
								details: undefined,
							});
							return;
						}
						if (aborted) return;
						reportPhase?.("convert");
						const resultPath = await options.operations.convert(inputPath, outputPath, backend);
						if (aborted) return;
						signal.removeEventListener("abort", onAbort);
						resolve({
							content: [
								{
									type: "text",
									text: `Successfully converted to PDF using ${backend.label}.\nOutput: ${resultPath}`,
								},
							],
							details: undefined,
						});
					} catch (error) {
						signal.removeEventListener("abort", onAbort);
						if (!aborted) {
							const message = error instanceof Error ? error.message : String(error);
							reject(new Error(`Document to PDF conversion failed: ${message}`));
						}
					}
				})();
			});
		},
	};
}

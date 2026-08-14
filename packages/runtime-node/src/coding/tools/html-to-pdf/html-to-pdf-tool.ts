import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import {
	DesktopCommandAbortedError,
	type DesktopCommandPort,
	type DesktopCommandResult,
} from "../../shared/desktop-command.js";
import { resolveExistingPath, resolveToCwd } from "../../shared/path-resolution.js";
import { HTML_TO_PDF_TOOL_DESCRIPTION } from "./description.js";

export const HtmlToPdfToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({ description: "Brief user-facing reason for this tool call (max 100 chars).", maxLength: 100 }),
	),
	input: Type.String({ description: "Path to the source HTML file" }),
	output: Type.String({ description: "Required output PDF path", minLength: 1 }),
	pageSize: Type.Optional(Type.Union([Type.Literal("A4")], { description: "PDF page size. Defaults to A4" })),
	marginTop: Type.Optional(Type.Number({ description: "Top margin in inches" })),
	marginRight: Type.Optional(Type.Number({ description: "Right margin in inches" })),
	marginBottom: Type.Optional(Type.Number({ description: "Bottom margin in inches" })),
	marginLeft: Type.Optional(Type.Number({ description: "Left margin in inches" })),
});

const DesktopPdfResponseSchema = Type.Object(
	{
		ok: Type.Boolean(),
		output: Type.Optional(Type.String()),
		renderer: Type.Optional(Type.String()),
		error: Type.Optional(Type.Object({ code: Type.String(), message: Type.String() })),
	},
	{ additionalProperties: true },
);

export type HtmlToPdfToolInput = Static<typeof HtmlToPdfToolInputSchema>;

export interface HtmlToPdfToolOptions {
	readonly desktop: DesktopCommandPort;
	readonly modelOrder?: number;
}

export function createHtmlToPdfTool(
	cwd: string,
	options: HtmlToPdfToolOptions,
): RuntimeToolDefinition<HtmlToPdfToolInput> {
	return {
		name: "html_to_pdf",
		label: "html_to_pdf",
		description: HTML_TO_PDF_TOOL_DESCRIPTION,
		inputSchema: HtmlToPdfToolInputSchema,
		modelOrder: options.modelOrder,
		async execute({ input, signal, reportPhase }) {
			if (signal.aborted) throw new Error("Operation aborted");
			reportPhase?.("locate");
			const inputPath = resolveExistingPath(input.input, cwd);
			const outputPath = resolveToCwd(input.output, cwd);
			const desktop = await options.desktop.locate();
			const args = ["--html-to-pdf", inputPath, "--output", outputPath];
			if (input.pageSize) args.push("--page-size", input.pageSize);
			if (input.marginTop !== undefined) args.push("--margin-top", String(input.marginTop));
			if (input.marginRight !== undefined) args.push("--margin-right", String(input.marginRight));
			if (input.marginBottom !== undefined) args.push("--margin-bottom", String(input.marginBottom));
			if (input.marginLeft !== undefined) args.push("--margin-left", String(input.marginLeft));
			reportPhase?.("render");
			let result: DesktopCommandResult;
			try {
				result = await options.desktop.run(desktop.path, args, { signal, timeoutMs: 120_000 });
			} catch (error) {
				if (error instanceof DesktopCommandAbortedError) throw new Error("Operation aborted");
				throw error;
			}
			if (signal.aborted) throw new Error("Operation aborted");
			const trimmed = result.stdout.trim();
			if (!trimmed) throw new Error("Vetta Desktop returned empty stdout");
			const response: unknown = JSON.parse(trimmed);
			if (!Value.Check(DesktopPdfResponseSchema, response)) {
				throw new Error("Vetta Desktop returned invalid JSON response");
			}
			if (!response.ok) {
				const message = response.error?.message ?? (result.stderr.trim() || "Unknown PDF generation error");
				throw new Error(`Vetta Desktop PDF generation failed: ${message}`);
			}
			if (!response.output) throw new Error("Vetta Desktop did not return an output path");
			const staleNote = desktop.staleConfiguredPath
				? `\nNote: configured vettaAppPath was stale and fallback path was used: ${desktop.staleConfiguredPath}`
				: "";
			return {
				content: [
					{
						type: "text",
						text: `Successfully converted HTML to PDF.\nOutput: ${response.output}\nRenderer: ${response.renderer ?? "electron"}${staleNote}`,
					},
				],
				details: undefined,
			};
		},
	};
}

import { constants, writeSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { renderHtmlFileToPdf } from "../pdf/html-to-pdf.js";

export type PdfCliCommand =
	| { type: "help" }
	| { type: "error"; code: string; exitCode: number; message: string }
	| {
			type: "html-to-pdf";
			input: string;
			output: string;
			pageSize?: "A4";
			margins?: {
				top: number;
				right: number;
				bottom: number;
				left: number;
			};
	  };

export interface PdfCliResponse {
	ok: boolean;
	output?: string;
	renderer?: "electron";
	error?: {
		code: string;
		message: string;
	};
}

const HELP_TEXT = `Vetta PDF command line interface

Usage:
  Vetta.exe --html-to-pdf <input.html> --output <output.pdf> [options]
  Vetta.exe pdf html-to-pdf <input.html> --output <output.pdf> [options]
  Vetta.exe pdf -h
  Vetta.exe pdf --help

Description:
  Convert an HTML file to PDF using Vetta Desktop's bundled Electron Chromium
  renderer. This does not require Google Chrome or Microsoft Edge to be
  installed on the user machine.

Options:
  --output <path>       Required output PDF path.
  --page-size <size>    PDF page size. Supported: A4. Defaults to A4.
  --margin-top <n>      Top margin in inches.
  --margin-right <n>    Right margin in inches.
  --margin-bottom <n>   Bottom margin in inches.
  --margin-left <n>     Left margin in inches.
  -h, --help            Show this help text.

Output:
  On success, stdout contains JSON:
    {"ok":true,"output":"C:\\\\path\\\\report.pdf","renderer":"electron"}

  On failure, stdout contains JSON:
    {"ok":false,"error":{"code":"ARGUMENT_ERROR","message":"..."}}

Exit codes:
  0  Success or help displayed.
  2  Invalid command line arguments.
  3  HTML input or output path error.
  4  PDF rendering error.
`;

class PdfCliError extends Error {
	constructor(
		readonly code: string,
		readonly exitCode: number,
		message: string,
	) {
		super(message);
		this.name = "PdfCliError";
	}
}

function findCommandStart(argv: string[]): number {
	return argv.findIndex((arg) => arg === "--html-to-pdf" || arg === "pdf");
}

function parseNumberOption(name: string, value: string | undefined): number {
	if (!value) throw new PdfCliError("ARGUMENT_ERROR", 2, `${name} requires a number`);
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new PdfCliError("ARGUMENT_ERROR", 2, `${name} must be a non-negative number`);
	}
	return parsed;
}

function parseHtmlToPdfOptions(args: string[]): Omit<Extract<PdfCliCommand, { type: "html-to-pdf" }>, "type"> {
	let input: string | undefined;
	let output: string | undefined;
	let pageSize: "A4" | undefined;
	let marginTop: number | undefined;
	let marginRight: number | undefined;
	let marginBottom: number | undefined;
	let marginLeft: number | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-h" || arg === "--help") {
			throw new PdfCliError("HELP_REQUESTED", 0, HELP_TEXT);
		}
		if (arg === "--output") {
			const value = args[++i];
			if (!value) throw new PdfCliError("ARGUMENT_ERROR", 2, "--output requires a path");
			output = value;
			continue;
		}
		if (arg === "--page-size") {
			const value = args[++i];
			if (value !== "A4") throw new PdfCliError("ARGUMENT_ERROR", 2, "--page-size only supports A4");
			pageSize = value;
			continue;
		}
		if (arg === "--margin-top") {
			marginTop = parseNumberOption("--margin-top", args[++i]);
			continue;
		}
		if (arg === "--margin-right") {
			marginRight = parseNumberOption("--margin-right", args[++i]);
			continue;
		}
		if (arg === "--margin-bottom") {
			marginBottom = parseNumberOption("--margin-bottom", args[++i]);
			continue;
		}
		if (arg === "--margin-left") {
			marginLeft = parseNumberOption("--margin-left", args[++i]);
			continue;
		}
		if (arg.startsWith("-")) {
			throw new PdfCliError("ARGUMENT_ERROR", 2, `Unknown option: ${arg}`);
		}
		if (input) {
			throw new PdfCliError("ARGUMENT_ERROR", 2, `Unexpected argument: ${arg}`);
		}
		input = arg;
	}

	if (!input) {
		throw new PdfCliError("ARGUMENT_ERROR", 2, "Missing <input.html> path");
	}
	if (!output) {
		throw new PdfCliError("ARGUMENT_ERROR", 2, "Missing required --output <output.pdf>");
	}

	const hasAnyMargin =
		marginTop !== undefined || marginRight !== undefined || marginBottom !== undefined || marginLeft !== undefined;
	const margins = hasAnyMargin
		? {
				top: marginTop ?? 0,
				right: marginRight ?? 0,
				bottom: marginBottom ?? 0,
				left: marginLeft ?? 0,
			}
		: undefined;

	return { input, output, pageSize, margins };
}

export function parsePdfCliCommand(argv: string[]): PdfCliCommand | null {
	const start = findCommandStart(argv);
	if (start < 0) return null;
	const args = argv.slice(start);
	const command = args[0];

	try {
		if (command === "-h" || command === "--help") {
			return { type: "help" };
		}
		if (command === "--html-to-pdf") {
			return { type: "html-to-pdf", ...parseHtmlToPdfOptions(args.slice(1)) };
		}
		if (command === "pdf") {
			const subcommand = args[1];
			if (subcommand === "-h" || subcommand === "--help") {
				return { type: "help" };
			}
			if (subcommand !== "html-to-pdf") {
				throw new PdfCliError("ARGUMENT_ERROR", 2, `Unknown pdf subcommand: ${subcommand ?? ""}`);
			}
			return { type: "html-to-pdf", ...parseHtmlToPdfOptions(args.slice(2)) };
		}
		return null;
	} catch (error) {
		if (error instanceof PdfCliError && error.code === "HELP_REQUESTED") {
			return { type: "help" };
		}
		if (error instanceof PdfCliError) {
			return { type: "error", code: error.code, exitCode: error.exitCode, message: error.message };
		}
		const message = error instanceof Error ? error.message : String(error);
		return { type: "error", code: "ARGUMENT_ERROR", exitCode: 2, message };
	}
}

function writeJson(response: PdfCliResponse): void {
	writeSync(1, `${JSON.stringify(response)}\n`);
}

async function ensureReadableFile(filePath: string): Promise<void> {
	try {
		await access(filePath, constants.R_OK);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new PdfCliError("INPUT_ERROR", 3, `Cannot read HTML input: ${message}`);
	}
}

export async function runPdfCliCommand(command: PdfCliCommand): Promise<number> {
	if (command.type === "help") {
		writeSync(1, HELP_TEXT);
		return 0;
	}
	if (command.type === "error") {
		writeJson({ ok: false, error: { code: command.code, message: command.message } });
		return command.exitCode;
	}

	try {
		const input = resolve(command.input);
		const output = resolve(command.output);
		await ensureReadableFile(input);
		await mkdir(dirname(output), { recursive: true });
		await renderHtmlFileToPdf({
			htmlPath: input,
			outputPath: output,
			pageSize: command.pageSize,
			margins: command.margins,
		});
		writeJson({ ok: true, output, renderer: "electron" });
		return 0;
	} catch (error) {
		if (error instanceof PdfCliError) {
			writeJson({ ok: false, error: { code: error.code, message: error.message } });
			return error.exitCode;
		}
		const message = error instanceof Error ? error.message : String(error);
		writeJson({ ok: false, error: { code: "RENDER_ERROR", message } });
		return 4;
	}
}

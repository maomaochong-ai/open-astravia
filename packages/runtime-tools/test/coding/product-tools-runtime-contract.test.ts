import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AsyncExecutionGate,
	type CommandProcessPort,
	createDocToPdfToolRegistration,
	createExtractTextFromImageToolRegistration,
	createExtractTextFromPdfToolRegistration,
	createHtmlToPdfToolRegistration,
	createProgressToolRegistration,
	createRenderPdfPageToolRegistration,
	type DesktopCommandPort,
	type DocToPdfOperations,
	type RenderPdfPageProcessPort,
} from "../../src/coding/index.js";

const temporaryDirectories: string[] = [];
const signal = new AbortController().signal;
const immediateGate: AsyncExecutionGate = { run: (operation) => operation() };

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe("runtime product tool contracts", () => {
	it("keeps product registrations in work mode with their legacy scopes and categories", () => {
		const cwd = process.cwd();
		const desktop = successfulDesktop("C:output.json");
		const registrations = [
			createDocToPdfToolRegistration(cwd, { operations: successfulDocOperations() }),
			createHtmlToPdfToolRegistration(cwd, { desktop }),
			createExtractTextFromPdfToolRegistration(cwd, {
				desktop,
				process: desktop,
				executionGate: immediateGate,
			}),
			createExtractTextFromImageToolRegistration(cwd, { desktop, executionGate: immediateGate }),
			createRenderPdfPageToolRegistration(cwd, { process: successfulRenderProcess() }),
			createProgressToolRegistration(),
		];

		expect(registrations.map(({ tool }) => tool.name)).toEqual([
			"doc_to_pdf",
			"html_to_pdf",
			"extract_text_from_pdf",
			"extract_text_from_img",
			"render_pdf_page",
			"progress",
		]);
		for (const registration of registrations) {
			expect(registration.agentModes).toEqual(["work"]);
			expect(registration.category).toBe(registration.tool.name === "progress" ? "agent-control" : "doc");
			expect(registration.scopeUse).toEqual([
				"im-claw",
				"conversation",
				"project",
				"batch",
				"automation",
				"kb-processing",
				"cli",
			]);
		}
	});

	it("resolves document conversion paths from the session cwd and preserves phases and output", async () => {
		const cwd = await temporaryDirectory("doc");
		await writeFile(join(cwd, "source.docx"), "document", "utf8");
		const calls: string[][] = [];
		const operations: DocToPdfOperations = {
			detect: async () => ({ type: "msoffice", label: "Microsoft Office" }),
			convert: async (input, output) => {
				calls.push([input, output]);
				return output;
			},
		};
		const phases: string[] = [];
		const tool = createDocToPdfToolRegistration(cwd, { operations }).tool;
		const result = await tool.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: { path: "source.docx", output: "result.pdf" },
			signal,
			reportPhase: (phase) => phases.push(phase),
		});

		expect(calls).toEqual([[join(cwd, "source.docx"), join(cwd, "result.pdf")]]);
		expect(phases).toEqual(["locate", "detect", "convert"]);
		expect(result).toEqual({
			content: [
				{
					type: "text",
					text: `Successfully converted to PDF using Microsoft Office.\nOutput: ${join(cwd, "result.pdf")}`,
				},
			],
			details: undefined,
		});
	});

	it("passes session-local HTML paths and renderer options through the desktop port", async () => {
		const cwd = await temporaryDirectory("html");
		await writeFile(join(cwd, "source.html"), "<p>test</p>", "utf8");
		const calls: Array<{ executable: string; args: readonly string[] }> = [];
		const desktop: DesktopCommandPort = {
			locate: async () => ({ path: "Vetta.exe" }),
			async run(executable, args) {
				calls.push({ executable, args });
				return {
					code: 0,
					stdout: JSON.stringify({ ok: true, output: join(cwd, "result.pdf"), renderer: "electron" }),
					stderr: "",
				};
			},
		};
		const tool = createHtmlToPdfToolRegistration(cwd, { desktop }).tool;
		const result = await tool.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: { input: "source.html", output: "result.pdf", marginTop: 0.5 },
			signal,
		});

		expect(calls).toEqual([
			{
				executable: "Vetta.exe",
				args: [
					"--html-to-pdf",
					join(cwd, "source.html"),
					"--output",
					join(cwd, "result.pdf"),
					"--margin-top",
					"0.5",
				],
			},
		]);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining(`Output: ${join(cwd, "result.pdf")}`) });
	});

	it("runs image OCR through the shared gate and validates the structured document", async () => {
		const cwd = await temporaryDirectory("image-ocr");
		const imagePath = join(cwd, "scan.png");
		const outputPath = `${imagePath}.ocr.json`;
		await writeFile(imagePath, "image", "utf8");
		await writeFile(
			outputPath,
			JSON.stringify({
				version: 1,
				meta: { durationMs: 12, engine: "PP-OCRv5" },
				pages: [{ page: 1, text: "recognized text", source: "ocr", width: 10, height: 20, confidence: 98 }],
			}),
			"utf8",
		);
		let gateCalls = 0;
		const gate: AsyncExecutionGate = {
			async run(operation) {
				gateCalls += 1;
				return operation();
			},
		};
		const desktop = successfulDesktop(outputPath, "desktop warning\n");
		const tool = createExtractTextFromImageToolRegistration(cwd, { desktop, executionGate: gate }).tool;
		const result = await tool.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: { input: "scan.png", maxChars: 10 },
			signal,
		});

		expect(gateCalls).toBe(1);
		expect(result.content[0]).toMatchObject({
			text: expect.stringContaining(
				"recognized\n…[truncated 5 chars]\n---\nconfidence=98 duration_ms=12 engine=PP-OCRv5",
			),
		});
	});

	it("auto-lowers PDF OCR dpi from pdfinfo and preserves page formatting", async () => {
		const cwd = await temporaryDirectory("pdf-ocr");
		const inputPath = join(cwd, "scan.pdf");
		const outputPath = `${inputPath}.ocr.json`;
		await writeFile(inputPath, "pdf", "utf8");
		await writeFile(
			outputPath,
			JSON.stringify({
				version: 1,
				meta: {
					totalPages: 1,
					processedPages: 1,
					textLayerPages: 0,
					ocrPages: 1,
					durationMs: 20,
					engine: "PP-OCRv5",
				},
				pages: [{ page: 1, text: "page text", source: "ocr", width: 10, height: 20 }],
			}),
			"utf8",
		);
		const desktopCalls: readonly string[][] = [];
		const mutableDesktopCalls = desktopCalls as string[][];
		const desktop: DesktopCommandPort = {
			locate: async () => ({ path: "Vetta.exe" }),
			async run(_executable, args) {
				mutableDesktopCalls.push([...args]);
				return { code: 0, stdout: JSON.stringify({ ok: true, output: outputPath }), stderr: "" };
			},
		};
		const process: CommandProcessPort = {
			async run(executable, args) {
				expect(executable).toBe("pdfinfo");
				expect(args).toEqual(["-box", "-f", "1", "-l", "1", inputPath]);
				return { code: 0, stdout: "Page 1 size: 6000 x 4000 pts", stderr: "" };
			},
		};
		const tool = createExtractTextFromPdfToolRegistration(cwd, {
			desktop,
			process,
			executionGate: immediateGate,
		}).tool;
		const result = await tool.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: { input: "scan.pdf", pages: "1" },
			signal,
		});

		expect(desktopCalls).toEqual([["--ocr-pdf", inputPath, "--output", outputPath, "--pages", "1", "--dpi", "120"]]);
		expect(result.content[0]).toMatchObject({
			text: expect.stringContaining("=== Page 1 (ocr) ===\npage text\n---\ntotal_pages=1 processed=1"),
		});
	});

	it("renders a PDF page through the injected process and reports the generated PNG", async () => {
		const cwd = await temporaryDirectory("render");
		const inputPath = join(cwd, "source.pdf");
		const outputPath = join(cwd, "page.png");
		await writeFile(inputPath, "pdf", "utf8");
		const calls: readonly string[][] = [];
		const mutableCalls = calls as string[][];
		const process: RenderPdfPageProcessPort = {
			async run(args) {
				mutableCalls.push([...args]);
				await writeFile(outputPath, "png", "utf8");
				return { code: 0, stderr: "" };
			},
		};
		const tool = createRenderPdfPageToolRegistration(cwd, { process, now: () => 100 }).tool;
		const result = await tool.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: { input: "source.pdf", page: 2, output: "page.png", dpi: 144 },
			signal,
		});

		expect(calls).toEqual([
			["-png", "-r", "144", "-f", "2", "-l", "2", "-singlefile", inputPath, outputPath.slice(0, -4)],
		]);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining(`output: ${outputPath}`) });
	});

	it("preserves progress result details and validation text", async () => {
		const tool = createProgressToolRegistration().tool;
		const success = await tool.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: { summary: "done", label: "next" },
			signal,
		});
		const invalid = await tool.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: {},
			signal,
		});

		expect(success).toEqual({ content: [{ type: "text", text: "OK" }], details: { summary: "done", label: "next" } });
		expect(invalid.content[0]).toMatchObject({ text: expect.stringContaining("requires at least one") });
	});
});

async function temporaryDirectory(label: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), `vetta-product-tools-${label}-`));
	temporaryDirectories.push(directory);
	return directory;
}

function successfulDesktop(outputPath: string, prefix = ""): DesktopCommandPort {
	return {
		locate: async () => ({ path: "Vetta.exe" }),
		run: async () => ({
			code: 0,
			stdout: `${prefix}${JSON.stringify({ ok: true, output: outputPath })}`,
			stderr: "",
		}),
	};
}

function successfulDocOperations(): DocToPdfOperations {
	return {
		detect: async () => ({ type: "msoffice", label: "Microsoft Office" }),
		convert: async (_input, output) => output,
	};
}

function successfulRenderProcess(): RenderPdfPageProcessPort {
	return { run: async () => ({ code: 0, stderr: "" }) };
}

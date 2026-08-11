import type { CommandProcessPort, DesktopCommandResult } from "@vetta/runtime-tools/coding";
import { describe, expect, it } from "vitest";
import { createCodingAgentDocToPdfOperations } from "../../src/adapters/runtime-tools/doc-to-pdf-operations.js";

describe("Coding Agent doc-to-pdf host operations", () => {
	it("detects macOS Office installations through the file-system port", async () => {
		const operations = createCodingAgentDocToPdfOperations({
			platform: "darwin",
			commandProcess: processFixture([]).port,
			fileExists: async (filePath) => filePath === "/Applications/Microsoft Word.app",
		});

		await expect(operations.detect()).resolves.toEqual({
			type: "msoffice",
			label: "Microsoft Office (macOS)",
		});
	});

	it("preserves Windows registry and PATH fallback order", async () => {
		const fixture = processFixture([result(1, "", "missing registry"), result(0)]);
		const operations = createCodingAgentDocToPdfOperations({
			platform: "win32",
			commandProcess: fixture.port,
		});

		await expect(operations.detect()).resolves.toEqual({
			type: "msoffice",
			label: "Microsoft Office (Windows)",
		});
		expect(fixture.calls.map(({ executable, args }) => ({ executable, args }))).toEqual([
			{
				executable: "powershell",
				args: ["-Command", "Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Office\\*\\Word -ErrorAction Stop"],
			},
			{ executable: "which", args: ["winword"] },
		]);
	});

	it("detects and invokes Linux WPS with the existing output contract", async () => {
		const fixture = processFixture([result(0), result(0)]);
		const operations = createCodingAgentDocToPdfOperations({
			platform: "linux",
			commandProcess: fixture.port,
		});
		const backend = await operations.detect();
		if (!backend) throw new Error("Expected Linux WPS backend");

		await expect(operations.convert("/work/input.docx", "/work/output.pdf", backend)).resolves.toBe(
			"/work/output.pdf",
		);
		expect(fixture.calls[1]).toMatchObject({
			executable: "wps",
			args: ["--headless", "--convert-to", "pdf", "--outdir", "/work", "/work/input.docx"],
			options: { timeoutMs: 60_000, maxBufferBytes: 1024 * 1024 },
		});
	});

	it("builds platform conversion commands and reports unsupported combinations", async () => {
		const macFixture = processFixture([result(0)]);
		const macOperations = createCodingAgentDocToPdfOperations({
			platform: "darwin",
			commandProcess: macFixture.port,
		});
		await macOperations.convert("/work/input.docx", "/work/output.pdf", {
			type: "msoffice",
			label: "Microsoft Office (macOS)",
		});
		expect(macFixture.calls[0]?.executable).toBe("osascript");
		expect(macFixture.calls[0]?.args[1]).toContain(
			'save as theDoc file format format PDF file name POSIX file "/work/output.pdf"',
		);

		const unsupported = createCodingAgentDocToPdfOperations({
			platform: "freebsd",
			commandProcess: processFixture([]).port,
		});
		await expect(unsupported.detect()).resolves.toBeNull();
		await expect(
			unsupported.convert("input.docx", "output.pdf", { type: "msoffice", label: "Office" }),
		).rejects.toThrow("Microsoft Office conversion is not supported on freebsd");
	});

	it("rejects failed conversion commands with their stderr", async () => {
		const operations = createCodingAgentDocToPdfOperations({
			platform: "linux",
			commandProcess: processFixture([result(2, "", "conversion failed")]).port,
		});

		await expect(operations.convert("input.docx", "output.pdf", { type: "wps", label: "WPS" })).rejects.toThrow(
			"conversion failed",
		);
	});
});

interface ProcessCall {
	readonly executable: string;
	readonly args: readonly string[];
	readonly options: Parameters<CommandProcessPort["run"]>[2];
}

function processFixture(results: readonly DesktopCommandResult[]): {
	readonly port: CommandProcessPort;
	readonly calls: ProcessCall[];
} {
	const calls: ProcessCall[] = [];
	let index = 0;
	return {
		calls,
		port: {
			async run(executable, args, options) {
				calls.push({ executable, args, options });
				const next = results[index];
				index += 1;
				if (!next) throw new Error(`Missing process fixture result for ${executable}`);
				return next;
			},
		},
	};
}

function result(code: number | null, stdout = "", stderr = ""): DesktopCommandResult {
	return { code, stdout, stderr };
}

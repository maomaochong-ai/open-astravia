import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolCompatibilityDefinition } from "../compatibility/tool-compatibility-contract.js";

const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

export interface ReadBehaviorInput {
	readonly description?: string;
	readonly path: string;
	readonly offset?: number;
	readonly limit?: number;
}

export interface ReadBehaviorOperations {
	readFile(absolutePath: string): Promise<Buffer>;
	access(absolutePath: string): Promise<void>;
	detectImageMimeType?(absolutePath: string): Promise<string | null | undefined>;
}

export interface ReadBehaviorSubjectOptions {
	readonly autoResizeImages?: boolean;
	readonly operations?: ReadBehaviorOperations;
}

export interface ReadBehaviorSubject {
	readonly definition: ToolCompatibilityDefinition;
	execute(input: ReadBehaviorInput, signal?: AbortSignal): Promise<RuntimeToolResult>;
}

export type CreateReadBehaviorSubject = (cwd: string, options?: ReadBehaviorSubjectOptions) => ReadBehaviorSubject;

export function defineReadBehaviorContract(subjectName: string, createSubject: CreateReadBehaviorSubject): void {
	describe(`${subjectName} read behavior contract`, () => {
		let testDirectory: string;

		beforeEach(() => {
			testDirectory = mkdtempSync(join(tmpdir(), "runtime-tools-read-contract-"));
		});

		afterEach(() => {
			rmSync(testDirectory, { recursive: true, force: true });
		});

		it("preserves the model-visible definition and registration baseline", () => {
			const subject = createSubject(testDirectory);

			expect(subject.definition).toMatchObject({
				name: "read",
				label: "read",
				scopeUse: ["im-claw", "conversation", "project", "batch", "automation", "kb-processing", "cli"],
				category: "core",
				schema: {
					type: "object",
					required: ["path"],
					properties: {
						description: {
							type: "string",
							maxLength: 100,
						},
						path: {
							type: "string",
							description: "Path to the file to read (relative or absolute)",
						},
						offset: {
							type: "number",
							description: "Line number to start reading from (1-indexed)",
						},
						limit: {
							type: "number",
							description: "Maximum number of lines to read",
						},
					},
				},
			});
			expect(subject.definition.schema).not.toHaveProperty("additionalProperties");
			expect(subject.definition.description).toContain("line:hash→content");
			expect(subject.definition.description).toContain("extract_text_from_pdf");
		});

		it("reads UTF-8 text with edit-compatible line anchors", async () => {
			const path = join(testDirectory, "hello.txt");
			writeFileSync(path, "first line\nsecond line");

			const result = await createSubject(testDirectory).execute({ path: "hello.txt" });

			expect(textOutput(result)).toMatch(/^1:[0-9a-z]{4}→first line\n2:[0-9a-z]{4}→second line$/);
			expect(result.details).toBeUndefined();
		});

		it("falls back to GB18030 when UTF-8 decoding fails", async () => {
			const path = join(testDirectory, "gb18030.txt");
			writeFileSync(path, Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));

			const result = await createSubject(testDirectory).execute({ path });

			expect(textOutput(result)).toMatch(/^1:[0-9a-z]{4}→中文$/);
		});

		it("preserves empty-file output and missing-file failures", async () => {
			const emptyPath = join(testDirectory, "empty.txt");
			writeFileSync(emptyPath, "");
			const subject = createSubject(testDirectory);

			expect(textOutput(await subject.execute({ path: emptyPath }))).toMatch(/^1:[0-9a-z]{4}→$/);
			await expect(subject.execute({ path: join(testDirectory, "missing.txt") })).rejects.toThrow();
		});

		it("preserves relative, absolute, home, Unicode-space, and fuzzy CJK path resolution", async () => {
			const exactName = "招标文件-发布稿.txt";
			const exactPath = join(testDirectory, exactName);
			writeFileSync(exactPath, "resolved");
			const subject = createSubject(testDirectory);

			await expect(subject.execute({ path: exactName })).resolves.toMatchObject({
				content: [{ type: "text" }],
			});
			await expect(subject.execute({ path: exactPath })).resolves.toMatchObject({
				content: [{ type: "text" }],
			});
			expect(textOutput(await subject.execute({ path: "招标文件 - 发布稿.txt" }))).toContain("resolved");

			const unicodeSpaceName = "unicode space.txt";
			writeFileSync(join(testDirectory, unicodeSpaceName), "unicode-space");
			expect(textOutput(await subject.execute({ path: "unicode\u00a0space.txt" }))).toContain("unicode-space");

			const observedPaths: string[] = [];
			const homeSubject = createSubject(testDirectory, {
				operations: {
					async access(absolutePath) {
						observedPaths.push(absolutePath);
					},
					async readFile() {
						return Buffer.from("home");
					},
				},
			});
			await homeSubject.execute({ path: "~/runtime-tools-read-contract-home.txt" });
			expect(observedPaths[0]).toBe(`${homedir()}/runtime-tools-read-contract-home.txt`);
			expect(isAbsolute(observedPaths[0])).toBe(true);
		});

		it("preserves macOS narrow-space, NFD, and curly-quote path fallbacks", async () => {
			const fixtures = [
				{
					actual: "Screenshot 10.00.00\u202fAM.txt",
					requested: "Screenshot 10.00.00 AM.txt",
					content: "narrow-space",
				},
				{
					actual: "cafe\u0301.txt",
					requested: "café.txt",
					content: "nfd",
				},
				{
					actual: "Capture d\u2019ecran.txt",
					requested: "Capture d'ecran.txt",
					content: "curly-quote",
				},
				{
					actual: "Capture d\u2019e\u0301cran.txt",
					requested: "Capture d'écran.txt",
					content: "nfd-curly",
				},
			] as const;
			const subject = createSubject(testDirectory);

			for (const fixture of fixtures) {
				writeFileSync(join(testDirectory, fixture.actual), fixture.content);
				expect(textOutput(await subject.execute({ path: fixture.requested }))).toContain(fixture.content);
			}
		});

		it("applies offset and limit without changing anchor line numbers", async () => {
			const path = join(testDirectory, "lines.txt");
			writeFileSync(path, Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join("\n"));
			const subject = createSubject(testDirectory);

			const offsetResult = await subject.execute({ path, offset: 51, limit: 2 });
			expect(textOutput(offsetResult)).toMatch(/^51:[0-9a-z]{4}→line 51\n52:[0-9a-z]{4}→line 52/);
			expect(textOutput(offsetResult)).toContain("[48 more lines in file. Use offset=53 to continue.]");

			const zeroOffsetResult = await subject.execute({ path, offset: 0, limit: 1 });
			expect(textOutput(zeroOffsetResult)).toMatch(/^1:[0-9a-z]{4}→line 1/);
		});

		it("rejects offsets beyond the end of the file with the legacy error", async () => {
			const path = join(testDirectory, "short.txt");
			writeFileSync(path, "one\ntwo");

			await expect(createSubject(testDirectory).execute({ path, offset: 100 })).rejects.toThrow(
				"Offset 100 is beyond end of file (2 lines total)",
			);
		});

		it("preserves line truncation details and continuation notice", async () => {
			const path = join(testDirectory, "many-lines.txt");
			writeFileSync(path, Array.from({ length: 2001 }, (_, index) => `line ${index + 1}`).join("\n"));

			const result = await createSubject(testDirectory).execute({ path });

			expect(textOutput(result)).toContain("[Showing lines 1-2000 of 2001. Use offset=2001 to continue.]");
			expect(result.details).toMatchObject({
				truncation: {
					truncated: true,
					truncatedBy: "lines",
					totalLines: 2001,
					outputLines: 2000,
				},
			});
		});

		it("preserves the oversized first-line notice and truncation details", async () => {
			const path = join(testDirectory, "long-line.txt");
			writeFileSync(path, "x".repeat(60 * 1024));

			const result = await createSubject(testDirectory).execute({ path });

			expect(textOutput(result)).toContain("[Line 1 is 60.0KB, exceeds 50.0KB limit.");
			expect(result.details).toMatchObject({
				truncation: {
					truncated: true,
					truncatedBy: "bytes",
					outputLines: 0,
					firstLineExceedsLimit: true,
				},
			});
		});

		it("detects images by file magic and can return original bytes without resizing", async () => {
			const path = join(testDirectory, "image.txt");
			const imageBuffer = Buffer.from(TINY_PNG_BASE64, "base64");
			writeFileSync(path, imageBuffer);

			const result = await createSubject(testDirectory, { autoResizeImages: false }).execute({ path });
			const image = result.content.find((item) => item.type === "image");

			expect(textOutput(result)).toBe("Read image file [image/png]");
			expect(image).toEqual({
				type: "image",
				data: imageBuffer.toString("base64"),
				mimeType: "image/png",
			});
			expect(result.details).toMatchObject({
				image: {
					originalPath: path,
					originalMimeType: "image/png",
					originalSizeBytes: imageBuffer.length,
					processedMimeType: "image/png",
					processedSizeBytes: imageBuffer.length,
					wasResized: false,
				},
			});
		});

		it("preserves default image processing and dimension details", async () => {
			const path = join(testDirectory, "default-image.png");
			writeFileSync(path, Buffer.from(TINY_PNG_BASE64, "base64"));

			const result = await createSubject(testDirectory).execute({ path });

			expect(result.content.some((item) => item.type === "image")).toBe(true);
			expect(result.details).toMatchObject({
				image: {
					originalPath: path,
					originalMimeType: "image/png",
					originalWidth: 1,
					originalHeight: 1,
					processedWidth: 1,
					processedHeight: 1,
					wasResized: false,
				},
			});
		});

		it("does not trust an image extension when file magic is text", async () => {
			const path = join(testDirectory, "not-an-image.png");
			writeFileSync(path, "definitely not a png");

			const result = await createSubject(testDirectory).execute({ path });

			expect(textOutput(result)).toContain("definitely not a png");
			expect(result.content.some((item) => item.type === "image")).toBe(false);
		});

		it("returns the legacy skill hint instead of raw binary document bytes", async () => {
			const path = join(testDirectory, "spec.docx");
			writeFileSync(path, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]));

			const result = await createSubject(testDirectory).execute({ path });

			expect(textOutput(result)).toBe(
				'Binary file detected (.docx, 8B). Raw bytes are not shown to avoid context pollution.\nLoad the "docx" skill for instructions on how to handle this file.',
			);
			expect(result.details).toBeUndefined();
		});

		it("detects binary content without a known extension", async () => {
			const path = join(testDirectory, "binary-data");
			writeFileSync(path, Buffer.from([0x00, 0x01, 0x02, 0x03]));

			const result = await createSubject(testDirectory).execute({ path });

			expect(textOutput(result)).toBe(
				"Binary file detected ((no extension), 4B). Raw bytes are not shown to avoid context pollution.\nNo matching skill found. Try converting this file with bash before reading.",
			);
		});

		it("uses injected read operations without changing path resolution", async () => {
			const observed: Array<{ operation: string; path: string }> = [];
			const subject = createSubject(testDirectory, {
				operations: {
					async access(absolutePath) {
						observed.push({ operation: "access", path: absolutePath });
					},
					async detectImageMimeType(absolutePath) {
						observed.push({ operation: "detect", path: absolutePath });
						return undefined;
					},
					async readFile(absolutePath) {
						observed.push({ operation: "read", path: absolutePath });
						return Buffer.from("remote text");
					},
				},
			});

			const result = await subject.execute({ path: "remote.txt" });
			const expectedPath = resolve(testDirectory, "remote.txt");

			expect(textOutput(result)).toContain("remote text");
			expect(observed).toEqual([
				{ operation: "access", path: expectedPath },
				{ operation: "detect", path: expectedPath },
				{ operation: "read", path: expectedPath },
			]);
		});

		it("rejects before invoking operations when already aborted", async () => {
			let operationCount = 0;
			const subject = createSubject(testDirectory, {
				operations: {
					async access() {
						operationCount += 1;
					},
					async readFile() {
						operationCount += 1;
						return Buffer.from("unused");
					},
				},
			});
			const controller = new AbortController();
			controller.abort();

			await expect(subject.execute({ path: "unused.txt" }, controller.signal)).rejects.toThrow("Operation aborted");
			expect(operationCount).toBe(0);
		});

		it("rejects an in-flight read and does not continue to readFile after abort", async () => {
			let releaseAccess: (() => void) | undefined;
			let readCount = 0;
			const subject = createSubject(testDirectory, {
				operations: {
					access() {
						return new Promise<void>((resolveAccess) => {
							releaseAccess = resolveAccess;
						});
					},
					async readFile() {
						readCount += 1;
						return Buffer.from("unused");
					},
				},
			});
			const controller = new AbortController();
			const pending = subject.execute({ path: "slow.txt" }, controller.signal);

			await Promise.resolve();
			controller.abort();
			releaseAccess?.();

			await expect(pending).rejects.toThrow("Operation aborted");
			await Promise.resolve();
			expect(readCount).toBe(0);
		});
	});
}

function textOutput(result: RuntimeToolResult): string {
	return result.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

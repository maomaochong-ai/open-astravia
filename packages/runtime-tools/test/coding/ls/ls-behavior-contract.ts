import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolCompatibilityDefinition } from "../compatibility/tool-compatibility-contract.js";

export interface LsBehaviorInput {
	readonly description?: string;
	readonly path?: string;
	readonly limit?: number;
}

export interface LsBehaviorStat {
	isDirectory(): boolean;
}

export interface LsBehaviorOperations {
	exists(absolutePath: string): Promise<boolean> | boolean;
	stat(absolutePath: string): Promise<LsBehaviorStat> | LsBehaviorStat;
	readdir(absolutePath: string): Promise<string[]> | string[];
}

export interface LsBehaviorSubjectOptions {
	readonly operations?: LsBehaviorOperations;
}

export interface LsBehaviorSubject {
	readonly definition: ToolCompatibilityDefinition;
	execute(input: LsBehaviorInput, signal?: AbortSignal): Promise<RuntimeToolResult>;
}

export type CreateLsBehaviorSubject = (cwd: string, options?: LsBehaviorSubjectOptions) => LsBehaviorSubject;

export function defineLsBehaviorContract(subjectName: string, createSubject: CreateLsBehaviorSubject): void {
	describe(`${subjectName} ls behavior contract`, () => {
		let testDirectory: string;

		beforeEach(() => {
			testDirectory = mkdtempSync(join(tmpdir(), "runtime-tools-ls-contract-"));
		});

		afterEach(() => {
			rmSync(testDirectory, { recursive: true, force: true });
		});

		it("preserves the model-visible definition and inactive registration baseline", () => {
			const subject = createSubject(testDirectory);

			expect(subject.definition).toMatchObject({
				name: "ls",
				label: "ls",
				scopeUse: [],
				category: "core",
				schema: {
					type: "object",
					properties: {
						description: {
							type: "string",
							maxLength: 100,
						},
						path: {
							type: "string",
							description: "Directory to list (default: current directory)",
						},
						limit: {
							type: "number",
							description: "Maximum number of entries to return (default: 500)",
						},
					},
				},
			});
			expect(subject.definition.schema).not.toHaveProperty("required");
			expect(subject.definition.schema).not.toHaveProperty("additionalProperties");
			expect(subject.definition.description).toContain("Includes dotfiles");
			expect(subject.definition.description).toContain("NEVER use bash ls");
		});

		it("lists dotfiles, marks directories, and sorts case-insensitively", async () => {
			writeFileSync(join(testDirectory, "zeta.txt"), "z");
			writeFileSync(join(testDirectory, "Beta.txt"), "b");
			writeFileSync(join(testDirectory, "alpha.txt"), "a");
			writeFileSync(join(testDirectory, ".hidden-file"), "hidden");
			mkdirSync(join(testDirectory, ".hidden-dir"));
			mkdirSync(join(testDirectory, "folder"));

			const result = await createSubject(testDirectory).execute({ path: testDirectory });
			const lines = textOutput(result).split("\n");

			expect(lines).toContain(".hidden-file");
			expect(lines).toContain(".hidden-dir/");
			expect(lines).toContain("folder/");
			expect(lines.indexOf("alpha.txt")).toBeLessThan(lines.indexOf("Beta.txt"));
			expect(lines.indexOf("Beta.txt")).toBeLessThan(lines.indexOf("zeta.txt"));
			expect(result.details).toBeUndefined();
		});

		it("uses cwd for an omitted or empty path", async () => {
			const observedPaths: string[] = [];
			const subject = createSubject(testDirectory, {
				operations: emptyDirectoryOperations(observedPaths),
			});

			expect(textOutput(await subject.execute({}))).toBe("(empty directory)");
			expect(textOutput(await subject.execute({ path: "" }))).toBe("(empty directory)");
			expect(observedPaths).toEqual([
				testDirectory,
				testDirectory,
				testDirectory,
				testDirectory,
				testDirectory,
				testDirectory,
			]);
		});

		it("preserves relative, absolute, home, Unicode-space, and fuzzy path resolution", async () => {
			const exactName = "招标目录-发布稿";
			const exactPath = join(testDirectory, exactName);
			mkdirSync(exactPath);
			writeFileSync(join(exactPath, "entry.txt"), "entry");
			const subject = createSubject(testDirectory);

			expect(textOutput(await subject.execute({ path: exactName }))).toBe("entry.txt");
			expect(textOutput(await subject.execute({ path: exactPath }))).toBe("entry.txt");
			expect(textOutput(await subject.execute({ path: "招标目录 - 发布稿" }))).toBe("entry.txt");

			const unicodeSpaceName = "unicode space";
			mkdirSync(join(testDirectory, unicodeSpaceName));
			writeFileSync(join(testDirectory, unicodeSpaceName, "unicode.txt"), "unicode");
			expect(textOutput(await subject.execute({ path: "unicode\u00a0space" }))).toBe("unicode.txt");

			const observedPaths: string[] = [];
			const homeSubject = createSubject(testDirectory, {
				operations: emptyDirectoryOperations(observedPaths),
			});
			await homeSubject.execute({ path: "~/runtime-tools-ls-contract-home" });
			expect(observedPaths[0]).toBe(`${homedir()}/runtime-tools-ls-contract-home`);
			expect(isAbsolute(observedPaths[0])).toBe(true);
		});

		it("preserves macOS narrow-space, NFD, and curly-quote path fallbacks", async () => {
			const fixtures = [
				{
					actual: "Screenshot 10.00.00\u202fAM.dir",
					requested: "Screenshot 10.00.00 AM.dir",
					entry: "narrow-space.txt",
				},
				{
					actual: "cafe\u0301",
					requested: "café",
					entry: "nfd.txt",
				},
				{
					actual: "Capture d\u2019ecran",
					requested: "Capture d'ecran",
					entry: "curly-quote.txt",
				},
				{
					actual: "Capture d\u2019e\u0301cran",
					requested: "Capture d'écran",
					entry: "nfd-curly.txt",
				},
			] as const;
			const subject = createSubject(testDirectory);

			for (const fixture of fixtures) {
				const directory = join(testDirectory, fixture.actual);
				mkdirSync(directory);
				writeFileSync(join(directory, fixture.entry), fixture.entry);
				expect(textOutput(await subject.execute({ path: fixture.requested }))).toBe(fixture.entry);
			}
		});

		it("preserves missing-path and non-directory errors", async () => {
			const subject = createSubject(testDirectory);
			const missingPath = join(testDirectory, "missing");
			const filePath = join(testDirectory, "file.txt");
			writeFileSync(filePath, "file");

			await expect(subject.execute({ path: missingPath })).rejects.toThrow(`Path not found: ${missingPath}`);
			await expect(subject.execute({ path: filePath })).rejects.toThrow(`Not a directory: ${filePath}`);
		});

		it("preserves empty-directory output and readdir error wrapping", async () => {
			expect(textOutput(await createSubject(testDirectory).execute({ path: testDirectory }))).toBe(
				"(empty directory)",
			);

			const subject = createSubject(testDirectory, {
				operations: {
					exists: () => true,
					stat: () => directoryStat,
					readdir: () => {
						throw new Error("permission denied");
					},
				},
			});
			await expect(subject.execute({ path: "remote" })).rejects.toThrow("Cannot read directory: permission denied");
		});

		it("uses the 500-entry default limit and preserves the continuation notice", async () => {
			const entries = Array.from({ length: 501 }, (_, index) => `entry-${String(index).padStart(3, "0")}`);
			const directoryPath = resolve(testDirectory, "remote");
			const subject = createSubject(testDirectory, {
				operations: {
					exists: () => true,
					stat: (absolutePath) => (absolutePath === directoryPath ? directoryStat : fileStat),
					readdir: () => entries,
				},
			});

			const result = await subject.execute({ path: "remote" });
			const lines = textOutput(result).split("\n");

			expect(lines).toHaveLength(502);
			expect(lines[0]).toBe("entry-000");
			expect(lines[499]).toBe("entry-499");
			expect(lines[500]).toBe("");
			expect(lines[501]).toBe("[500 entries limit reached. Use limit=1000 for more]");
			expect(result.details).toEqual({ entryLimitReached: 500 });
		});

		it("does not report an entry limit when the directory contains exactly the limit", async () => {
			const directoryPath = resolve(testDirectory, "remote");
			const subject = createSubject(testDirectory, {
				operations: {
					exists: () => true,
					stat: (absolutePath) => (absolutePath === directoryPath ? directoryStat : fileStat),
					readdir: () => ["c", "a", "b"],
				},
			});

			const result = await subject.execute({ path: "remote", limit: 3 });

			expect(textOutput(result)).toBe("a\nb\nc");
			expect(result.details).toBeUndefined();
		});

		it("preserves zero and fractional limit behavior", async () => {
			const directoryPath = resolve(testDirectory, "remote");
			const operations: LsBehaviorOperations = {
				exists: () => true,
				stat: (absolutePath) => (absolutePath === directoryPath ? directoryStat : fileStat),
				readdir: () => ["a", "b", "c"],
			};
			const subject = createSubject(testDirectory, { operations });

			const zeroResult = await subject.execute({ path: "remote", limit: 0 });
			expect(textOutput(zeroResult)).toBe("(empty directory)");
			expect(zeroResult.details).toBeUndefined();

			const fractionalResult = await subject.execute({ path: "remote", limit: 1.5 });
			expect(textOutput(fractionalResult)).toBe("a\nb\n\n[1.5 entries limit reached. Use limit=3 for more]");
			expect(fractionalResult.details).toEqual({ entryLimitReached: 1.5 });
		});

		it("skips entries whose stats cannot be read", async () => {
			const directoryPath = resolve(testDirectory, "remote");
			const subject = createSubject(testDirectory, {
				operations: {
					exists: () => true,
					stat(absolutePath) {
						if (absolutePath === directoryPath) return directoryStat;
						if (absolutePath.endsWith("unreadable")) throw new Error("stat failed");
						return absolutePath.endsWith("folder") ? directoryStat : fileStat;
					},
					readdir: () => ["unreadable", "folder", "file"],
				},
			});

			expect(textOutput(await subject.execute({ path: "remote" }))).toBe("file\nfolder/");
		});

		it("preserves byte truncation and combined notices", async () => {
			const entries = [`a-${"x".repeat(30 * 1024)}`, `b-${"y".repeat(30 * 1024)}`, "c"];
			const directoryPath = resolve(testDirectory, "remote");
			const subject = createSubject(testDirectory, {
				operations: {
					exists: () => true,
					stat: (absolutePath) => (absolutePath === directoryPath ? directoryStat : fileStat),
					readdir: () => entries,
				},
			});

			const result = await subject.execute({ path: "remote", limit: 2 });

			expect(textOutput(result)).toBe(
				`${entries[0]}\n\n[2 entries limit reached. Use limit=4 for more. 50.0KB limit reached]`,
			);
			expect(result.details).toMatchObject({
				entryLimitReached: 2,
				truncation: {
					truncated: true,
					truncatedBy: "bytes",
					totalLines: 2,
					outputLines: 1,
					maxLines: Number.MAX_SAFE_INTEGER,
					maxBytes: 50 * 1024,
				},
			});
		});

		it("uses injected operations in the legacy order", async () => {
			const observed: Array<{ operation: string; path: string }> = [];
			const directoryPath = resolve(testDirectory, "remote");
			const subject = createSubject(testDirectory, {
				operations: {
					exists(absolutePath) {
						observed.push({ operation: "exists", path: absolutePath });
						return true;
					},
					stat(absolutePath) {
						observed.push({ operation: "stat", path: absolutePath });
						return absolutePath === directoryPath || absolutePath.endsWith("folder") ? directoryStat : fileStat;
					},
					readdir(absolutePath) {
						observed.push({ operation: "readdir", path: absolutePath });
						return ["folder", "file"];
					},
				},
			});

			expect(textOutput(await subject.execute({ path: "remote" }))).toBe("file\nfolder/");
			expect(observed).toEqual([
				{ operation: "exists", path: directoryPath },
				{ operation: "stat", path: directoryPath },
				{ operation: "readdir", path: directoryPath },
				{ operation: "stat", path: join(directoryPath, "file") },
				{ operation: "stat", path: join(directoryPath, "folder") },
			]);
		});

		it("rejects before invoking operations when already aborted", async () => {
			let operationCount = 0;
			const subject = createSubject(testDirectory, {
				operations: {
					exists() {
						operationCount += 1;
						return true;
					},
					stat() {
						operationCount += 1;
						return directoryStat;
					},
					readdir() {
						operationCount += 1;
						return [];
					},
				},
			});
			const controller = new AbortController();
			controller.abort();

			await expect(subject.execute({ path: "remote" }, controller.signal)).rejects.toThrow("Operation aborted");
			expect(operationCount).toBe(0);
		});

		it("preserves in-flight cancellation and continued operation execution", async () => {
			let releaseExists: ((exists: boolean) => void) | undefined;
			let finishRead: (() => void) | undefined;
			const operationsFinished = new Promise<void>((resolveFinished) => {
				finishRead = resolveFinished;
			});
			const observed: string[] = [];
			const subject = createSubject(testDirectory, {
				operations: {
					exists() {
						observed.push("exists");
						return new Promise<boolean>((resolveExists) => {
							releaseExists = resolveExists;
						});
					},
					stat() {
						observed.push("stat");
						return directoryStat;
					},
					readdir() {
						observed.push("readdir");
						finishRead?.();
						return [];
					},
				},
			});
			const controller = new AbortController();
			const pending = subject.execute({ path: "remote" }, controller.signal);

			await Promise.resolve();
			controller.abort();
			await expect(pending).rejects.toThrow("Operation aborted");
			releaseExists?.(true);
			await operationsFinished;
			expect(observed).toEqual(["exists", "stat", "readdir"]);
		});
	});
}

const directoryStat: LsBehaviorStat = {
	isDirectory: () => true,
};

const fileStat: LsBehaviorStat = {
	isDirectory: () => false,
};

function emptyDirectoryOperations(observedPaths: string[]): LsBehaviorOperations {
	return {
		exists(absolutePath) {
			observedPaths.push(absolutePath);
			return true;
		},
		stat(absolutePath) {
			observedPaths.push(absolutePath);
			return directoryStat;
		},
		readdir(absolutePath) {
			observedPaths.push(absolutePath);
			return [];
		},
	};
}

function textOutput(result: RuntimeToolResult): string {
	return result.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createEditTool, type EditToolDetails, type EditToolInput } from "../../../src/coding/index.js";
import { anchorLineHash } from "../../../src/coding/shared/anchors.js";

describe("edit tool anchor mode", () => {
	let dir: string;
	let file: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "vetta-edit-anchors-"));
		file = join(dir, "sample.ts");
		writeFileSync(file, ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;", "const e = 5;"].join("\n"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	const anchorFor = (content: string, line: number) => `${line}:${anchorLineHash(content)}`;
	const tool = () => {
		const runtimeTool = createEditTool(dir, {
			pathPolicy: { getRejectionReason: () => undefined },
		});
		return {
			execute(toolCallId: string, input: EditToolInput) {
				return runtimeTool.execute({
					sessionId: "test-session",
					turnId: "test-turn",
					toolCallId,
					input,
					signal: new AbortController().signal,
				});
			},
		};
	};

	test("replaces a single anchored line", async () => {
		const result = await tool().execute("t", {
			path: file,
			edits: [{ anchor: anchorFor("const b = 2;", 2), new_text: "const b = 20;" }],
		});
		expect(readFileSync(file, "utf-8").split("\n")[1]).toBe("const b = 20;");
		expect((result.details as EditToolDetails).appliedEdits).toBe(1);
		expect((result.content[0] as { type: "text"; text: string }).text).toContain("Fresh anchors");
	});

	test("replaces an inclusive range and deletes with empty new_text", async () => {
		await tool().execute("t", {
			path: file,
			edits: [
				{
					anchor: anchorFor("const b = 2;", 2),
					end_anchor: anchorFor("const d = 4;", 4),
					new_text: "",
				},
			],
		});
		expect(readFileSync(file, "utf-8")).toBe("const a = 1;\nconst e = 5;");
	});

	test("insert_after inserts below the anchor line", async () => {
		await tool().execute("t", {
			path: file,
			edits: [{ anchor: anchorFor("const a = 1;", 1), new_text: "const a2 = 1.5;", insert_after: true }],
		});
		const lines = readFileSync(file, "utf-8").split("\n");
		expect(lines[0]).toBe("const a = 1;");
		expect(lines[1]).toBe("const a2 = 1.5;");
		expect(lines[2]).toBe("const b = 2;");
	});

	test("multi-edit batch applies with line-number compensation", async () => {
		await tool().execute("t", {
			path: file,
			edits: [
				{ anchor: anchorFor("const a = 1;", 1), new_text: "const a = 1;\nconst a1 = 11;" },
				{ anchor: anchorFor("const e = 5;", 5), new_text: "const e = 50;" },
			],
		});
		const lines = readFileSync(file, "utf-8").split("\n");
		expect(lines).toHaveLength(6);
		expect(lines[1]).toBe("const a1 = 11;");
		expect(lines[5]).toBe("const e = 50;");
	});

	test("shifted anchor is recovered by hash search", async () => {
		// 声称第 1 行，内容实际在第 4 行
		await tool().execute("t", {
			path: file,
			edits: [{ anchor: anchorFor("const d = 4;", 1), new_text: "const d = 40;" }],
		});
		expect(readFileSync(file, "utf-8").split("\n")[3]).toBe("const d = 40;");
	});

	test("stale anchor rejects the WHOLE batch and returns fresh anchors", async () => {
		const goodAnchor = anchorFor("const a = 1;", 1);
		await expect(
			tool().execute("t", {
				path: file,
				edits: [
					{ anchor: goodAnchor, new_text: "const a = 10;" },
					{ anchor: "3:zz", new_text: "const c = 30;" },
				],
			}),
		).rejects.toThrow(/STALE[\s\S]*Fresh anchors[\s\S]*Retry the FULL batch/);
		// 原子性：好锚点也未应用
		expect(readFileSync(file, "utf-8").split("\n")[0]).toBe("const a = 1;");
	});

	test("overlapping edits are rejected", async () => {
		await expect(
			tool().execute("t", {
				path: file,
				edits: [
					{ anchor: anchorFor("const b = 2;", 2), end_anchor: anchorFor("const d = 4;", 4), new_text: "x" },
					{ anchor: anchorFor("const c = 3;", 3), new_text: "y" },
				],
			}),
		).rejects.toThrow(/overlap/);
	});

	test("drifted anchors on duplicate lines reject instead of collapsing to one spot", async () => {
		// 回归：两个 insert_after 目标各自的空行，行号提示漂移。旧实现会因就近取胜
		// 把两段内容挤到同一行 → 重复片段。现应判 STALE，原子拒绝。
		writeFileSync(
			file,
			["function a() {", "  return 1;", "}", "", "function b() {", "  return 2;", "}", ""].join("\n"),
		);
		const blank = anchorLineHash("");
		await expect(
			tool().execute("t", {
				path: file,
				edits: [
					{ anchor: `2:${blank}`, new_text: "// after a", insert_after: true },
					{ anchor: `6:${blank}`, new_text: "// after b", insert_after: true },
				],
			}),
		).rejects.toThrow(/STALE|Fresh anchors/);
		// 原子性：文件未变
		expect(readFileSync(file, "utf-8")).toBe(
			["function a() {", "  return 1;", "}", "", "function b() {", "  return 2;", "}", ""].join("\n"),
		);
	});

	test("two edits resolving to the same line are rejected as conflicting", async () => {
		writeFileSync(file, ["x", "y", "z"].join("\n"));
		await expect(
			tool().execute("t", {
				path: file,
				edits: [
					{ anchor: anchorFor("y", 2), new_text: "A", insert_after: true },
					{ anchor: anchorFor("y", 2), new_text: "B", insert_after: true },
				],
			}),
		).rejects.toThrow(/both target line 2|overlap/);
	});

	test("malformed anchor errors immediately", async () => {
		await expect(
			tool().execute("t", { path: file, edits: [{ anchor: "not-an-anchor", new_text: "x" }] }),
		).rejects.toThrow(/malformed/);
	});

	test("bare hash (missing line prefix) is recovered when unique in file", async () => {
		// 模型常把 `2:1kg2→` 里的 `2:` 当展示前缀丢掉、只传哈希
		await tool().execute("t", {
			path: file,
			edits: [{ anchor: anchorLineHash("const b = 2;"), new_text: "const b = 20;" }],
		});
		expect(readFileSync(file, "utf-8").split("\n")[1]).toBe("const b = 20;");
	});

	test("bare hash matching multiple lines is rejected with a targeted error", async () => {
		writeFileSync(file, ["x", "y", "z", "y"].join("\n"));
		await expect(
			tool().execute("t", { path: file, edits: [{ anchor: anchorLineHash("y"), new_text: "Y" }] }),
		).rejects.toThrow(/bare hash.*matches 2 lines/);
	});

	test("bare hash matching no line is rejected with a targeted error", async () => {
		await expect(tool().execute("t", { path: file, edits: [{ anchor: "zzzz", new_text: "x" }] })).rejects.toThrow(
			/bare hash.*matches no line/,
		);
	});

	test("bare line number (missing hash) is rejected with a targeted error", async () => {
		await expect(tool().execute("t", { path: file, edits: [{ anchor: "2", new_text: "x" }] })).rejects.toThrow(
			/bare line number/,
		);
	});

	test("bare hash works for end_anchor too", async () => {
		await tool().execute("t", {
			path: file,
			edits: [
				{
					anchor: anchorFor("const b = 2;", 2),
					end_anchor: anchorLineHash("const d = 4;"),
					new_text: "",
				},
			],
		});
		expect(readFileSync(file, "utf-8")).toBe("const a = 1;\nconst e = 5;");
	});

	test("mode exclusivity and missing payload", async () => {
		await expect(
			tool().execute("t", { path: file, oldText: "const a = 1;", newText: "x", edits: [] }),
		).rejects.toThrow(/not both/);
		await expect(tool().execute("t", { path: file })).rejects.toThrow(/Missing edit payload/);
	});

	test("exact-text mode still works (backwards compatible)", async () => {
		const result = await tool().execute("t", {
			path: file,
			oldText: "const c = 3;",
			newText: "const c = 33;",
		});
		expect(readFileSync(file, "utf-8").split("\n")[2]).toBe("const c = 33;");
		expect((result.details as EditToolDetails).diff).toContain("const c = 33;");
	});

	test("preserves CRLF line endings", async () => {
		writeFileSync(file, "a\r\nb\r\nc");
		await tool().execute("t", {
			path: file,
			edits: [{ anchor: `2:${anchorLineHash("b")}`, new_text: "B" }],
		});
		expect(readFileSync(file, "utf-8")).toBe("a\r\nB\r\nc");
	});
	test("rejects an anchor replacement that introduces invalid TSX syntax", async () => {
		file = join(dir, "sample.tsx");
		const source = ["export function Card() {", "  return <div>ok</div>;", "}"].join("\n");
		writeFileSync(file, source);

		await expect(
			tool().execute("t", {
				path: file,
				edits: [
					{
						anchor: anchorFor("export function Card() {", 1),
						end_anchor: anchorFor("}", 3),
						new_text: ["export function Card() {", "  return <section>ok</section>;"].join("\n"),
					},
				],
			}),
		).rejects.toThrow(/dropped the range's closing tail/);
		expect(readFileSync(file, "utf-8")).toBe(source);
	});

	test("rejects an anchor replacement that drops a JSX closing tag", async () => {
		file = join(dir, "sample.tsx");
		const source = ["export const Card = () => (", "  <section>", "    <span>ok</span>", "  </section>", ");"].join(
			"\n",
		);
		writeFileSync(file, source);

		await expect(
			tool().execute("t", {
				path: file,
				edits: [
					{
						anchor: anchorFor("  <section>", 2),
						end_anchor: anchorFor("  </section>", 4),
						new_text: ["  <article>", "    <span>updated</span>"].join("\n"),
					},
				],
			}),
		).rejects.toThrow(/dropped the range's closing tail/);
		expect(readFileSync(file, "utf-8")).toBe(source);
	});

	test("allows replacing a closing line when new_text is structurally complete", async () => {
		file = join(dir, "sample.tsx");
		writeFileSync(file, ["export function Card() {", "  return <div>ok</div>;", "}"].join("\n"));

		await tool().execute("t", {
			path: file,
			edits: [
				{
					anchor: anchorFor("export function Card() {", 1),
					end_anchor: anchorFor("}", 3),
					new_text: "export const Card = () => <section>ok</section>;",
				},
			],
		});

		expect(readFileSync(file, "utf-8")).toBe("export const Card = () => <section>ok</section>;");
	});

	test("ignores structural characters inside strings and comments", async () => {
		file = join(dir, "sample.ts");
		writeFileSync(file, ["export function value() {", "  return 1;", "}"].join("\n"));

		await tool().execute("t", {
			path: file,
			edits: [
				{
					anchor: anchorFor("export function value() {", 1),
					end_anchor: anchorFor("}", 3),
					new_text: 'export const value = "{"; // {',
				},
			],
		});

		expect(readFileSync(file, "utf-8")).toBe('export const value = "{"; // {');
	});

	test("rejects dropping a compound closing line", async () => {
		file = join(dir, "sample.ts");
		const source = ["const value = (() => {", "  return 1;", "})();"].join("\n");
		writeFileSync(file, source);

		await expect(
			tool().execute("t", {
				path: file,
				edits: [
					{
						anchor: anchorFor("const value = (() => {", 1),
						end_anchor: anchorFor("})();", 3),
						new_text: ["const value = (() => {", "  return 2;"].join("\n"),
					},
				],
			}),
		).rejects.toThrow(/dropped the range's closing tail/);
		expect(readFileSync(file, "utf-8")).toBe(source);
	});

	test("rejects dropping a JSX fragment closing tag", async () => {
		file = join(dir, "sample.tsx");
		const source = ["const value = (", "  <>", "    <span>ok</span>", "  </>", ");"].join("\n");
		writeFileSync(file, source);

		await expect(
			tool().execute("t", {
				path: file,
				edits: [
					{
						anchor: anchorFor("  <>", 2),
						end_anchor: anchorFor("  </>", 4),
						new_text: ["  <>", "    <span>updated</span>"].join("\n"),
					},
				],
			}),
		).rejects.toThrow(/dropped the range's closing tail/);
		expect(readFileSync(file, "utf-8")).toBe(source);
	});

	test("ignores structural characters inside regular expressions", async () => {
		file = join(dir, "sample.ts");
		writeFileSync(file, ["export function value() {", "  return 1;", "}"].join("\n"));

		await tool().execute("t", {
			path: file,
			edits: [
				{
					anchor: anchorFor("export function value() {", 1),
					end_anchor: anchorFor("}", 3),
					new_text: "export const value = /{/;",
				},
			],
		});

		expect(readFileSync(file, "utf-8")).toBe("export const value = /{/;");
	});

	test("rejects dropping an as-const structural closing line", async () => {
		file = join(dir, "sample.ts");
		const source = ["const value = {", "  a: 1,", "} as const;"].join("\n");
		writeFileSync(file, source);

		await expect(
			tool().execute("t", {
				path: file,
				edits: [
					{
						anchor: anchorFor("const value = {", 1),
						end_anchor: anchorFor("} as const;", 3),
						new_text: ["const value = {", "  a: 2,"].join("\n"),
					},
				],
			}),
		).rejects.toThrow(/dropped the range's closing tail/);
		expect(readFileSync(file, "utf-8")).toBe(source);
	});

	test("rejects replacing a single structural closer without a matching closer", async () => {
		file = join(dir, "sample.ts");
		const source = ["export function value() {", "  return 1;", "}"].join("\n");
		writeFileSync(file, source);

		await expect(
			tool().execute("t", {
				path: file,
				edits: [
					{
						anchor: anchorFor("}", 3),
						new_text: "// missing closer",
					},
				],
			}),
		).rejects.toThrow(/dropped the range's closing tail/);
		expect(readFileSync(file, "utf-8")).toBe(source);
	});

	test("allows deleting a single structural closer with empty new_text", async () => {
		file = join(dir, "sample.ts");
		writeFileSync(file, ["export function value() {", "  return 1;", "}"].join("\n"));

		await tool().execute("t", {
			path: file,
			edits: [
				{
					anchor: anchorFor("}", 3),
					new_text: "",
				},
			],
		});

		expect(readFileSync(file, "utf-8")).toBe(["export function value() {", "  return 1;"].join("\n"));
	});

	test("rejects a batch when one edit drops a structural closing tail", async () => {
		file = join(dir, "sample.ts");
		const source = [
			"export function first() {",
			"  return 1;",
			"}",
			"export function second() {",
			"  return 2;",
			"}",
		].join("\n");
		writeFileSync(file, source);

		await expect(
			tool().execute("t", {
				path: file,
				edits: [
					{
						anchor: anchorFor("export function first() {", 1),
						new_text: "export function firstRenamed() {",
					},
					{
						anchor: anchorFor("export function second() {", 4),
						end_anchor: anchorFor("}", 6),
						new_text: ["export function second() {", "  return 3;"].join("\n"),
					},
				],
			}),
		).rejects.toThrow(/dropped the range's closing tail/);
		expect(readFileSync(file, "utf-8")).toBe(source);
	});
});

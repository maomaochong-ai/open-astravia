import { describe, expect, test } from "vitest";
import { type ThinkingTagSegment, ThinkingTagSplitter } from "../src/providers/thinking-tag-splitter.js";

/** Feeds deltas through the splitter and merges adjacent same-kind segments. */
function run(deltas: string[]): ThinkingTagSegment[] {
	const splitter = new ThinkingTagSplitter();
	const out: ThinkingTagSegment[] = [];
	const collect = (segments: ThinkingTagSegment[]) => {
		for (const segment of segments) {
			const last = out[out.length - 1];
			if (last?.kind === segment.kind) last.text += segment.text;
			else out.push({ ...segment });
		}
	};
	for (const delta of deltas) collect(splitter.push(delta));
	collect(splitter.flush());
	return out;
}

describe("ThinkingTagSplitter", () => {
	test("passes plain text through untouched", () => {
		expect(run(["hello ", "world"])).toEqual([{ kind: "text", text: "hello world" }]);
	});

	test("extracts a leaked reasoning summary (vetta-go GPT gateway shape)", () => {
		expect(run(["<thinking>**Designing the poster visual**</thinking>"])).toEqual([
			{ kind: "thinking", text: "**Designing the poster visual**" },
		]);
	});

	test("handles tags split across deltas", () => {
		expect(run(["<think", "ing>abc</think", "ing>tail"])).toEqual([
			{ kind: "thinking", text: "abc" },
			{ kind: "text", text: "tail" },
		]);
	});

	test("handles multiple leaked summaries", () => {
		expect(run(["<thinking>a</thinking>\n<thinking>b</thinking>"])).toEqual([
			{ kind: "thinking", text: "a" },
			{ kind: "text", text: "\n" },
			{ kind: "thinking", text: "b" },
		]);
	});

	test("keeps the tag verbatim once real text has been emitted", () => {
		expect(run(["用 <thinking> 包裹思考过程"])).toEqual([{ kind: "text", text: "用 <thinking> 包裹思考过程" }]);
	});

	test("keeps later tags verbatim after an extracted one", () => {
		expect(run(["<thinking>a</thinking>docs say <thinking> is a tag"])).toEqual([
			{ kind: "thinking", text: "a" },
			{ kind: "text", text: "docs say <thinking> is a tag" },
		]);
	});

	test("flushes an unterminated thinking block", () => {
		expect(run(["<thinking>abc"])).toEqual([{ kind: "thinking", text: "abc" }]);
	});

	test("flushes a dangling partial tag as text", () => {
		expect(run(["abc<think"])).toEqual([{ kind: "text", text: "abc<think" }]);
	});
});

import { describe, expect, it } from "vitest";
import { matchTrigger } from "./trigger";

describe("matchTrigger", () => {
	it.each([
		["/", { kind: "slash", query: "", length: 1 }],
		["已有描述/", { kind: "slash", query: "", length: 1 }],
		["plain text/my-skill", { kind: "slash", query: "my-skill", length: 9 }],
		["第一行\n/skill", { kind: "slash", query: "skill", length: 6 }],
		["@", { kind: "at", query: "", length: 1 }],
		["请让@research", { kind: "at", query: "research", length: 9 }],
		["plain text@builder", { kind: "at", query: "builder", length: 8 }],
		["附上@src/file.ts", { kind: "at", query: "src/file.ts", length: 12 }],
	])("recognizes a trailing trigger typed or pasted after existing text: %s", (text, expected) => {
		expect(matchTrigger(text)).toEqual(expected);
	});

	it.each(["2026/07/30", "https://example.com", "foo//bar", "a@b.com", "support@example.co.uk", "@@research"])(
		"does not treat a date, URL, email, or repeated symbol as a trigger: %s",
		(text) => {
			expect(matchTrigger(text)).toBeNull();
		},
	);

	it.each(["请让@research 处理", "调用/skill 后继续", "普通文本"])(
		"only matches a trigger immediately before the caret: %s",
		(text) => {
			expect(matchTrigger(text)).toBeNull();
		},
	);

	it("returns the active trigger again after deleting and retyping it", () => {
		expect(matchTrigger("已有描述@research")).toEqual({ kind: "at", query: "research", length: 9 });
		expect(matchTrigger("已有描述")).toBeNull();
		expect(matchTrigger("已有描述@research")).toEqual({ kind: "at", query: "research", length: 9 });
	});
});

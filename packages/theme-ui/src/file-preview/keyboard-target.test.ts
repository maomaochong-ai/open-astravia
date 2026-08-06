import { describe, expect, test } from "vitest";
import { isEditableKeyboardTarget } from "./keyboard-target";

describe("isEditableKeyboardTarget", () => {
	test("null / non-object → false", () => {
		expect(isEditableKeyboardTarget(null)).toBe(false);
		expect(isEditableKeyboardTarget("x" as unknown as EventTarget)).toBe(false);
	});

	test("input and textarea", () => {
		expect(isEditableKeyboardTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
		expect(isEditableKeyboardTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
		expect(isEditableKeyboardTarget({ tagName: "INPUT", readOnly: true } as unknown as EventTarget)).toBe(false);
		expect(isEditableKeyboardTarget({ tagName: "INPUT", disabled: true } as unknown as EventTarget)).toBe(false);
	});

	test("contenteditable and CodeMirror surfaces", () => {
		expect(
			isEditableKeyboardTarget({
				tagName: "DIV",
				isContentEditable: true,
			} as unknown as EventTarget),
		).toBe(true);

		expect(
			isEditableKeyboardTarget({
				tagName: "SPAN",
				isContentEditable: false,
				closest: (sel: string) => (sel.includes(".cm-editor") ? ({} as Element) : null),
			} as unknown as EventTarget),
		).toBe(true);
	});

	test("plain div is not editable", () => {
		expect(
			isEditableKeyboardTarget({
				tagName: "DIV",
				isContentEditable: false,
				closest: () => null,
			} as unknown as EventTarget),
		).toBe(false);
		expect(
			isEditableKeyboardTarget({
				tagName: "BUTTON",
				closest: () => null,
			} as unknown as EventTarget),
		).toBe(false);
	});
});

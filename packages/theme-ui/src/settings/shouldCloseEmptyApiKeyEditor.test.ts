import { describe, expect, it } from "vitest";
import { type FocusContainmentRoot, shouldCloseEmptyApiKeyEditor } from "./shouldCloseEmptyApiKeyEditor";

/** 轻量 contains 替身，不依赖任何 DOM 环境。 */
function makeRoot(contained: object[]): FocusContainmentRoot {
	const set = new Set(contained);
	return {
		contains(node: object | null): boolean {
			return node != null && set.has(node);
		},
	};
}

describe("shouldCloseEmptyApiKeyEditor", () => {
	const outside = { id: "outside" };
	const insideButton = { id: "inside-btn" };
	const inputEl = { id: "input" };

	it("closes when draft is empty and focus left the editor", () => {
		const root = makeRoot([inputEl, insideButton]);
		expect(
			shouldCloseEmptyApiKeyEditor({
				draftKey: "",
				saving: false,
				editorRoot: root,
				relatedTarget: outside,
				activeElement: outside,
			}),
		).toBe(true);
	});

	it("treats whitespace-only draft as empty and closes", () => {
		const root = makeRoot([inputEl]);
		expect(
			shouldCloseEmptyApiKeyEditor({
				draftKey: "  \t  ",
				saving: false,
				editorRoot: root,
				relatedTarget: null,
				activeElement: outside,
			}),
		).toBe(true);
	});

	it("keeps open when draft has content even if focus left", () => {
		const root = makeRoot([inputEl]);
		expect(
			shouldCloseEmptyApiKeyEditor({
				draftKey: "sk-abc",
				saving: false,
				editorRoot: root,
				relatedTarget: null,
				activeElement: outside,
			}),
		).toBe(false);
	});

	it("keeps open while saving", () => {
		const root = makeRoot([inputEl]);
		expect(
			shouldCloseEmptyApiKeyEditor({
				draftKey: "",
				saving: true,
				editorRoot: root,
				relatedTarget: null,
				activeElement: outside,
			}),
		).toBe(false);
	});

	it("keeps open when relatedTarget stays inside the editor actions", () => {
		const root = makeRoot([inputEl, insideButton]);
		expect(
			shouldCloseEmptyApiKeyEditor({
				draftKey: "",
				saving: false,
				editorRoot: root,
				relatedTarget: insideButton,
				activeElement: insideButton,
			}),
		).toBe(false);
	});

	it("keeps open when relatedTarget is null but activeElement is still inside", () => {
		// 常见：点同行取消/复制时 relatedTarget=null，但焦点实际落到了区内按钮。
		const root = makeRoot([inputEl, insideButton]);
		expect(
			shouldCloseEmptyApiKeyEditor({
				draftKey: "",
				saving: false,
				editorRoot: root,
				relatedTarget: null,
				activeElement: insideButton,
			}),
		).toBe(false);
	});

	it("closes when relatedTarget is null and activeElement is outside", () => {
		const root = makeRoot([inputEl, insideButton]);
		expect(
			shouldCloseEmptyApiKeyEditor({
				draftKey: "",
				saving: false,
				editorRoot: root,
				relatedTarget: null,
				activeElement: outside,
			}),
		).toBe(true);
	});

	it("closes when relatedTarget is null and activeElement is null", () => {
		const root = makeRoot([inputEl]);
		expect(
			shouldCloseEmptyApiKeyEditor({
				draftKey: "",
				saving: false,
				editorRoot: root,
				relatedTarget: null,
				activeElement: null,
			}),
		).toBe(true);
	});

	it("closes when editorRoot is missing (unmounted mid-blur)", () => {
		expect(
			shouldCloseEmptyApiKeyEditor({
				draftKey: "",
				saving: false,
				editorRoot: null,
				relatedTarget: null,
				activeElement: null,
			}),
		).toBe(true);
	});
});

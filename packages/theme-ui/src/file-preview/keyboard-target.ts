/**
 * Whether a keydown target is (or is inside) an editable surface.
 * Used so preview/gallery shortcuts do not steal arrow keys from CodeMirror / inputs.
 *
 * Duck-typed so unit tests can run in node without a DOM environment.
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
	if (target == null || typeof target !== "object") return false;

	const node = target as {
		tagName?: string;
		readOnly?: boolean;
		disabled?: boolean;
		isContentEditable?: boolean;
		closest?: (selector: string) => Element | null;
	};

	const tag = typeof node.tagName === "string" ? node.tagName.toUpperCase() : "";
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
		return !node.readOnly && !node.disabled;
	}

	if (node.isContentEditable === true) {
		return true;
	}

	// CodeMirror 6 uses contenteditable .cm-content; also cover role=textbox hosts.
	if (typeof node.closest === "function") {
		return Boolean(node.closest(".cm-editor, .cm-content, [contenteditable='true'], [role='textbox']"));
	}

	return false;
}

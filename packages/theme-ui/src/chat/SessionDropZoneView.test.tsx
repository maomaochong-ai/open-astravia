// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDropZoneView } from "./SessionDropZoneView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


function mount(ui: React.ReactElement): HTMLElement {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => {
		root.render(ui);
	});
	return container;
}

function fireDrop(target: Element): void {
	act(() => {
		target.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
	});
}

describe("SessionDropZoneView", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("hands the drop to the zone before the editor inside sees it", () => {
		const order: string[] = [];
		const container = mount(
			<SessionDropZoneView
				onDrop={() => {
					order.push("zone");
				}}
			>
				<div
					data-testid="editor"
					onDrop={() => {
						order.push("editor");
					}}
				>
					draft
				</div>
			</SessionDropZoneView>,
		);

		fireDrop(container.querySelector('[data-testid="editor"]') as Element);

		expect(order).toEqual(["zone", "editor"]);
	});

	it("keeps the editor from turning a handled drop into text", () => {
		const editorDrop = vi.fn();
		const container = mount(
			<SessionDropZoneView
				onDrop={(event) => {
					event.preventDefault();
					event.stopPropagation();
				}}
			>
				<div data-testid="editor" onDrop={editorDrop}>
					draft
				</div>
			</SessionDropZoneView>,
		);
		const editor = container.querySelector('[data-testid="editor"]') as Element;

		fireDrop(editor);

		expect(editorDrop).not.toHaveBeenCalled();
	});
});

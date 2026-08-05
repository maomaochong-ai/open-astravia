import { type HTMLAttributes, useEffect, useRef } from "react";

const INTERACTIVE_SELECTOR = [
	"input",
	"textarea",
	"select",
	"button",
	"a[href]",
	"[contenteditable]",
	"[role='button']",
	"[role='textbox']",
	"[role='combobox']",
	"[role='listbox']",
	"[role='option']",
	"[role='slider']",
	"[data-node-editor-interactive]",
].join(",");

const TEXT_EDITABLE_SELECTOR = ["input", "textarea", "[contenteditable]", "[role='textbox']"].join(",");
const INTERACTIVE_CLASSES = ["nodrag", "nopan", "nowheel"];

export function NodeEditorPanel({
	className,
	onKeyDown,
	onPointerDown,
	...props
}: HTMLAttributes<HTMLDivElement>) {
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const panel = panelRef.current;
		if (!panel) return;
		markInteractiveDescendants(panel);
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (!(node instanceof HTMLElement)) continue;
					markInteractiveElement(node);
					markInteractiveDescendants(node);
				}
			}
		});
		observer.observe(panel, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, []);

	return (
		<div
			{...props}
			ref={panelRef}
			className={`select-none ${className ?? ""}`}
			data-node-editor-panel=""
			onPointerDown={(event) => {
				onPointerDown?.(event);
				if (event.isPropagationStopped()) return;
				const target = event.target;
				if (!(target instanceof Element)) return;
				const interactive = target.closest<HTMLElement>(INTERACTIVE_SELECTOR);
				if (!interactive || !event.currentTarget.contains(interactive)) return;
				markInteractiveElement(interactive);
				event.stopPropagation();
			}}
			onKeyDown={(event) => {
				onKeyDown?.(event);
				if (!event.isPropagationStopped()) event.stopPropagation();
			}}
		/>
	);
}

function markInteractiveDescendants(root: ParentNode): void {
	for (const element of root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)) {
		markInteractiveElement(element);
	}
}

function markInteractiveElement(element: HTMLElement): void {
	if (!element.matches(INTERACTIVE_SELECTOR)) return;
	element.classList.add(...INTERACTIVE_CLASSES);
	if (element.matches(TEXT_EDITABLE_SELECTOR)) element.classList.add("select-text");
}

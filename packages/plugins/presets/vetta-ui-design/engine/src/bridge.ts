/**
 * Design bridge — runs INSIDE each frame iframe and talks to the canvas
 * (plugin UI) via postMessage. The canvas and the iframe are cross-origin
 * (app shell vs http://127.0.0.1:<port>), so this module owns everything that
 * needs real DOM access: hover highlight, Figma-style drill selection,
 * data-vetd-source extraction and full-frame screenshots.
 *
 * Message contract (both directions carry `{ vetd: true }`):
 *   parent → iframe: set-mode | show-frame | clear-selection | capture
 *   iframe → parent: ready | rendered | selected | exit-inspect | captured | hmr-updated
 */
import { toPng } from "html-to-image";

type InspectMode = "off" | "inspect";

interface BridgeHost {
	getFrameId(): string | null;
	showFrame(id: string): void;
}

export interface SelectedElementPayload {
	tag: string;
	domPath: string;
	classes: string;
	text: string;
	rect: { x: number; y: number; width: number; height: number };
	/** `frames/login.tsx:42` from compile-time instrumentation; null in prod builds. */
	source: string | null;
}

function post(message: Record<string, unknown>): void {
	window.parent.postMessage({ vetd: true, ...message }, "*");
}

function cssPath(element: Element): string {
	const parts: string[] = [];
	let node: Element | null = element;
	while (node && node !== document.body && parts.length < 12) {
		const tag = node.tagName.toLowerCase();
		const parent: Element | null = node.parentElement;
		if (parent) {
			const siblings = [...parent.children].filter((child) => child.tagName === node?.tagName);
			if (siblings.length > 1) {
				parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
			} else {
				parts.unshift(tag);
			}
		} else {
			parts.unshift(tag);
		}
		node = parent;
	}
	return parts.join(" > ");
}

function nearestSource(element: Element): string | null {
	let node: Element | null = element;
	while (node) {
		const source = node.getAttribute("data-vetd-source");
		if (source) return source;
		node = node.parentElement;
	}
	return null;
}

function payloadFor(element: Element): SelectedElementPayload {
	const rect = element.getBoundingClientRect();
	return {
		tag: element.tagName.toLowerCase(),
		domPath: cssPath(element),
		classes: element.getAttribute("class") ?? "",
		text: (element.textContent ?? "").trim().slice(0, 120),
		rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
		source: nearestSource(element),
	};
}

function makeOverlay(color: string, background: string): HTMLDivElement {
	const el = document.createElement("div");
	el.setAttribute("data-vetd-overlay", "true");
	Object.assign(el.style, {
		position: "fixed",
		zIndex: "2147483646",
		pointerEvents: "none",
		border: `1.5px solid ${color}`,
		background,
		display: "none",
	} satisfies Partial<CSSStyleDeclaration>);
	document.documentElement.appendChild(el);
	return el;
}

function moveOverlay(overlay: HTMLDivElement, target: Element | null): void {
	if (!target) {
		overlay.style.display = "none";
		return;
	}
	const rect = target.getBoundingClientRect();
	Object.assign(overlay.style, {
		display: "block",
		left: `${rect.left}px`,
		top: `${rect.top}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
	});
}

export function notifyFrameRendered(frameId: string | null, allFrames: string[]): void {
	post({ type: "rendered", frameId, allFrames });
}

export function installBridge(host: BridgeHost): void {
	let mode: InspectMode = "off";
	/** Figma-style drill container: click selects among its direct children. */
	let drillRoot: Element = document.body;
	let selected: Element | null = null;

	const hoverOverlay = makeOverlay("#3b82f6", "rgba(59,130,246,0.08)");
	const selectedOverlay = makeOverlay("#6366f1", "transparent");

	const isOwnNode = (element: Element | null): boolean =>
		!!element?.closest?.("[data-vetd-overlay]");

	/** The ancestor of `hit` that is a direct child of drillRoot (Figma level rule). */
	const levelTarget = (hit: Element): Element => {
		let node: Element = hit;
		while (node.parentElement && node.parentElement !== drillRoot && node !== drillRoot) {
			if (node.parentElement === document.body && drillRoot === document.body) break;
			node = node.parentElement;
		}
		return node === drillRoot ? hit : node;
	};

	const select = (element: Element | null): void => {
		selected = element;
		moveOverlay(selectedOverlay, element);
		post({ type: "selected", payload: element ? payloadFor(element) : null });
	};

	const reset = (): void => {
		drillRoot = document.body;
		select(null);
		moveOverlay(hoverOverlay, null);
	};

	const setMode = (next: InspectMode): void => {
		mode = next;
		if (mode === "off") reset();
	};

	document.addEventListener(
		"mousemove",
		(event) => {
			if (mode !== "inspect") return;
			const hit = document.elementFromPoint(event.clientX, event.clientY);
			if (!hit || isOwnNode(hit) || hit === document.body || hit === document.documentElement) {
				moveOverlay(hoverOverlay, null);
				return;
			}
			moveOverlay(hoverOverlay, levelTarget(hit));
		},
		true,
	);

	document.addEventListener(
		"click",
		(event) => {
			if (mode !== "inspect") return;
			event.preventDefault();
			event.stopPropagation();
			const hit = document.elementFromPoint(event.clientX, event.clientY);
			if (!hit || isOwnNode(hit) || hit === document.documentElement) return;
			select(levelTarget(hit));
		},
		true,
	);

	document.addEventListener(
		"dblclick",
		(event) => {
			if (mode !== "inspect") return;
			event.preventDefault();
			event.stopPropagation();
			const hit = document.elementFromPoint(event.clientX, event.clientY);
			if (!hit || isOwnNode(hit)) return;
			// Drill: current selection becomes the container, then pick the child under
			// the cursor at the new level.
			if (selected?.contains(hit) && selected !== hit) {
				drillRoot = selected;
				select(levelTarget(hit));
			}
		},
		true,
	);

	document.addEventListener(
		"keydown",
		(event) => {
			if (mode !== "inspect" || event.key !== "Escape") return;
			event.preventDefault();
			// Pop one drill level; at the top, hand control back to frame selection.
			if (drillRoot !== document.body) {
				const popped = drillRoot;
				drillRoot = popped.parentElement ?? document.body;
				select(popped);
				return;
			}
			reset();
			post({ type: "exit-inspect" });
		},
		true,
	);

	window.addEventListener("message", (event: MessageEvent) => {
		const data = event.data as Record<string, unknown> | null;
		if (!data || data.vetd !== true) return;
		switch (data.type) {
			case "set-mode":
				setMode(data.mode === "inspect" ? "inspect" : "off");
				return;
			case "show-frame":
				if (typeof data.id === "string") host.showFrame(data.id);
				return;
			case "clear-selection":
				reset();
				return;
			case "capture": {
				const requestId = typeof data.requestId === "string" ? data.requestId : "";
				moveOverlay(hoverOverlay, null);
				moveOverlay(selectedOverlay, null);
				toPng(document.body, { pixelRatio: 2, cacheBust: true })
					.then((dataUrl) => post({ type: "captured", requestId, dataUrl }))
					.catch((error: unknown) =>
						post({ type: "captured", requestId, error: error instanceof Error ? error.message : String(error) }),
					)
					.finally(() => moveOverlay(selectedOverlay, selected));
				return;
			}
			default:
				return;
		}
	});

	if (import.meta.hot) {
		import.meta.hot.on("vite:afterUpdate", () => {
			// Overlays may point at stale rects after an HMR swap.
			moveOverlay(hoverOverlay, null);
			moveOverlay(selectedOverlay, selected?.isConnected ? selected : null);
			post({ type: "hmr-updated", frameId: host.getFrameId() });
		});
	}

	post({ type: "ready", frameId: host.getFrameId() });
}

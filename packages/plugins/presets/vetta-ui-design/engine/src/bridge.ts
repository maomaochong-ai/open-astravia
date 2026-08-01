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

function makeOverlay(color: string, background: string, withLabel: boolean): HTMLDivElement {
	const el = document.createElement("div");
	el.setAttribute("data-vetd-overlay", "true");
	Object.assign(el.style, {
		position: "fixed",
		zIndex: "2147483646",
		pointerEvents: "none",
		border: `2px solid ${color}`,
		background,
		display: "none",
		boxSizing: "border-box",
	} satisfies Partial<CSSStyleDeclaration>);
	if (withLabel) {
		const label = document.createElement("div");
		label.setAttribute("data-vetd-overlay-label", "true");
		Object.assign(label.style, {
			position: "absolute",
			left: "-2px",
			bottom: "100%",
			marginBottom: "2px",
			padding: "1px 6px",
			borderRadius: "4px",
			background: color,
			color: "#ffffff",
			font: "600 10px/1.6 system-ui, sans-serif",
			whiteSpace: "nowrap",
		} satisfies Partial<CSSStyleDeclaration>);
		el.appendChild(label);
	}
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
	const label = overlay.querySelector<HTMLDivElement>("[data-vetd-overlay-label]");
	if (label) {
		label.textContent = target.tagName.toLowerCase();
		// Flip the label below the box when the element touches the top edge.
		const flip = rect.top < 20;
		label.style.bottom = flip ? "auto" : "100%";
		label.style.top = flip ? "100%" : "auto";
		label.style.marginBottom = flip ? "0" : "2px";
		label.style.marginTop = flip ? "2px" : "0";
	}
}

export function notifyFrameRendered(frameId: string | null, allFrames: string[]): void {
	post({ type: "rendered", frameId, allFrames });
}

/**
 * 画布性能降级：把 frame 内 backdrop-filter 的模糊半径钳到很小，而不是整个去掉。
 *
 * backdrop-filter 每个都要单独建合成层、回读背景、跑模糊核再合成，代价随
 * **半径 × 面积** 增长、层数之间还是乘法关系。一份稿子里十几个这种元素、分散
 * 在多个跨源 iframe、又都套在画布的 scale 变换下时，Chromium 合成器会被压垮，
 * 表现为整窗口撕裂闪烁（Chromium 41471914 / 339841685 也有同类重绘缺陷）。
 *
 * 直接去掉毛玻璃观感损失太大，而半径是主导项：40px 压到 6px 观感还在、代价掉
 * 一大截。CSS 选择器读不到「谁身上有 backdrop-filter」，只能遍历算样式后改内联，
 * 所以要记住原值以便还原；HMR 换过 DOM 后需要重跑。
 *
 * 只碰 backdrop-filter，不碰普通 filter：后者只模糊元素自身像素、不回读背景，
 * 便宜得多，而装饰性光晕块正是靠大半径 filter 出效果的。
 */
const BLUR_CLAMP_PX = 6;

function clampBlurRadii(value: string): string {
	return value.replace(/blur\(\s*([\d.]+)px\s*\)/g, (whole, radius: string) => {
		const px = Number.parseFloat(radius);
		return Number.isFinite(px) && px > BLUR_CLAMP_PX ? `blur(${BLUR_CLAMP_PX}px)` : whole;
	});
}

function makeEffectsSwitch(): { set(enabled: boolean): void; refresh(): void } {
	/** 被改过的元素 → 它原本的内联值（多为空串，还原即恢复样式表里的声明）。 */
	const touched = new Map<HTMLElement, { backdrop: string; filter: string }>();
	let enabled = true;

	const reduce = (): void => {
		for (const element of document.querySelectorAll<HTMLElement>("*")) {
			if (touched.has(element)) continue;
			const computed = window.getComputedStyle(element);
			const backdrop = computed.backdropFilter || computed.webkitBackdropFilter || "none";
			// filter 也要钳：blur-3xl 这类装饰光晕是 filter: blur(64px)，大半径同样
			// 会建大块合成层。早先「整个关掉」能止住闪烁，关的正是这两者。
			const filter = computed.filter || "none";
			const nextBackdrop = backdrop.includes("blur(") ? clampBlurRadii(backdrop) : backdrop;
			const nextFilter = filter.includes("blur(") ? clampBlurRadii(filter) : filter;
			if (nextBackdrop === backdrop && nextFilter === filter) continue;
			touched.set(element, { backdrop: element.style.backdropFilter, filter: element.style.filter });
			if (nextBackdrop !== backdrop) {
				element.style.backdropFilter = nextBackdrop;
				element.style.setProperty("-webkit-backdrop-filter", nextBackdrop);
			}
			if (nextFilter !== filter) element.style.filter = nextFilter;
		}
	};

	const restore = (): void => {
		for (const [element, original] of touched) {
			element.style.backdropFilter = original.backdrop;
			element.style.setProperty("-webkit-backdrop-filter", original.backdrop);
			element.style.filter = original.filter;
		}
		touched.clear();
	};

	return {
		set(next: boolean): void {
			if (next === enabled) return;
			enabled = next;
			if (enabled) restore();
			else reduce();
		},
		/** HMR 换过 DOM：新节点身上的 backdrop-filter 还是原半径，补一遍。 */
		refresh(): void {
			if (!enabled) reduce();
		},
	};
}

export function installBridge(host: BridgeHost): void {
	let mode: InspectMode = "off";
	let selected: Element | null = null;
	const effects = makeEffectsSwitch();

	const hoverOverlay = makeOverlay("#3b82f6", "rgba(59,130,246,0.08)", false);
	const selectedOverlay = makeOverlay("#6366f1", "rgba(99,102,241,0.06)", true);

	const isOwnNode = (element: Element | null): boolean =>
		!!element?.closest?.("[data-vetd-overlay]");

	const hitAt = (x: number, y: number): Element | null => {
		const hit = document.elementFromPoint(x, y);
		if (!hit || isOwnNode(hit) || hit === document.body || hit === document.documentElement) return null;
		return hit;
	};

	const select = (element: Element | null): void => {
		selected = element;
		moveOverlay(selectedOverlay, element);
		post({ type: "selected", payload: element ? payloadFor(element) : null });
	};

	const reset = (): void => {
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
			const hit = hitAt(event.clientX, event.clientY);
			moveOverlay(hoverOverlay, hit && hit !== selected ? hit : null);
		},
		true,
	);

	// Click selects the deepest element under the cursor — direct and predictable;
	// Esc walks UP the ancestor chain when a broader container is wanted.
	document.addEventListener(
		"click",
		(event) => {
			if (mode !== "inspect") return;
			event.preventDefault();
			event.stopPropagation();
			const hit = hitAt(event.clientX, event.clientY);
			if (!hit) return;
			moveOverlay(hoverOverlay, null);
			select(hit);
		},
		true,
	);

	document.addEventListener(
		"keydown",
		(event) => {
			if (mode !== "inspect" || event.key !== "Escape") return;
			event.preventDefault();
			// Step up one ancestor; past the top, hand control back to frame selection.
			const parent = selected?.parentElement;
			if (parent && parent !== document.body && parent !== document.documentElement) {
				select(parent);
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
			case "set-effects":
				effects.set(data.enabled !== false);
				return;
			case "capture": {
				const requestId = typeof data.requestId === "string" ? data.requestId : "";
				// keepHighlight: bake the selected-element outline into the shot (used by
				// "让 Vetta 调整" so the model SEES which element the user means).
				const keepHighlight = data.keepHighlight === true && selected !== null;
				// Mockup export asks for a higher ratio so the composed image stays
				// crisp when scaled up; 2 keeps the historical behaviour.
				const pixelRatio =
					typeof data.pixelRatio === "number" && data.pixelRatio > 0 ? Math.min(data.pixelRatio, 4) : 2;
				moveOverlay(hoverOverlay, null);
				if (!keepHighlight) moveOverlay(selectedOverlay, null);
				// Capture documentElement: the overlay divs live on it, so a kept
				// highlight is included; body alone would drop them.
				// cacheBust 会给每张图片/字体的 URL 加随机查询串，强制重新下载整份
				// 素材——图多的 frame 单次截图能拖到几十秒。它本是为绕过跨域缓存的
				// CORS 问题，而素材由同源的引擎 dev server 提供，用不上。
				// 只有交付物（导出渲染图 / 发给 agent）保留它兜底，画布位图化不用。
				const cacheBust = data.cacheBust === true;
				toPng(document.documentElement, { pixelRatio, cacheBust })
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
			// 新换上来的节点还是原始模糊半径，降级态下要补钳一遍。
			effects.refresh();
			post({ type: "hmr-updated", frameId: host.getFrameId() });
		});
	}

	post({ type: "ready", frameId: host.getFrameId() });
}

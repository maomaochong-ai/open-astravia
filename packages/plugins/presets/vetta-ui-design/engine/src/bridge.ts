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
 *                    | frame-error | context-menu
 */
import { toJpeg, toPng } from "html-to-image";

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
 * 编译失败上报（vite 自带的红屏 overlay 已在 vite.config.mjs 里关掉）。
 * `message` 为 null 表示这一帧当前没有错误——每次渲染都会先发一次清空。
 */
export function notifyFrameError(frameId: string | null, message: string | null): void {
	post({ type: "frame-error", frameId, message });
}

interface ViteErrorPayload {
	err?: { message?: string; id?: string; loc?: { file?: string; line?: number } };
}

let lastBuildError: string | null = null;
const buildErrorListeners = new Set<(message: string) => void>();
let reloadArmed = false;

/** 最近一次 vite 编译错误。import 失败时拿它换掉「加载模块失败」这种无用信息。 */
export function latestBuildError(): string | null {
	return lastBuildError;
}

export function onBuildError(listener: (message: string) => void): () => void {
	buildErrorListeners.add(listener);
	return () => buildErrorListeners.delete(listener);
}

/**
 * 编译失败的 frame 模块从没成功执行过，也就不在 HMR 图里：改好之后 vite 推来的
 * 更新落不到它身上，页面会一直停在错误态。既然当前渲染已经废了，收到任何一次
 * 更新就整页重载，代价为零。
 */
export function armReloadOnNextUpdate(): void {
	if (reloadArmed || !import.meta.hot) return;
	reloadArmed = true;
	import.meta.hot.on("vite:beforeUpdate", () => window.location.reload());
}

if (import.meta.hot) {
	import.meta.hot.on("vite:error", (payload: ViteErrorPayload) => {
		const err = payload?.err;
		if (!err) return;
		const where = err.loc?.file ?? err.id;
		const line = err.loc?.line;
		const head = where ? `${where}${line ? `:${line}` : ""}\n` : "";
		lastBuildError = `${head}${err.message ?? "build failed"}`;
		for (const listener of buildErrorListeners) listener(lastBuildError);
	});
}

/**
 * 元素选择期间把光标钉成箭头。
 *
 * 这时候点击的语义是「选中这个元素」，不是「操作这个 UI」——让按钮继续显示手型、
 * 输入框继续显示 I 形光标会让人以为真能点进去。!important 是必须的：要盖过页面
 * 自己的 cursor 声明。
 */
const CURSOR_STYLE_ID = "vetd-inspect-cursor";

function setInspectCursor(on: boolean): void {
	const existing = document.getElementById(CURSOR_STYLE_ID);
	if (!on) {
		existing?.remove();
		return;
	}
	if (existing) return;
	const style = document.createElement("style");
	style.id = CURSOR_STYLE_ID;
	style.textContent = "*, *::before, *::after { cursor: default !important; }";
	document.head.appendChild(style);
}

/**
 * html-to-image 的失败有一半不是 Error，而是 `<img>` 的 error **Event**——直接
 * String() 会得到「[object Event]」，一点线索都没有。把它换成能指认现场的描述：
 * 事件源是哪个元素、它当时想加载什么。
 */
function describeCaptureError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof Event !== "undefined" && error instanceof Event) {
		const target = error.target;
		if (target instanceof HTMLImageElement) {
			const src = target.currentSrc || target.src;
			return `failed to load image while capturing: ${src ? src.slice(0, 200) : "<empty src>"}`;
		}
		const tag = target instanceof Element ? target.tagName.toLowerCase() : "unknown";
		return `capture failed on <${tag}> (${error.type} event)`;
	}
	return String(error);
}

export function installBridge(host: BridgeHost): void {
	let mode: InspectMode = "off";
	let selected: Element | null = null;

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

	/**
	 * 清掉高亮，但不往外报「选中变成了 null」。
	 *
	 * 报了会绕回来：画布收到空的 selected 会把这一帧退回 frame 级选中，而单独选中
	 * 一个 frame 又等于开着元素选择——于是刚关掉的模式立刻被自己打开。取消选中、
	 * 点别的 frame、Esc 三条路都是这么失效的。
	 * 两个调用方各自有更准确的消息：关模式的那次由画布发起，本来就知道结果；
	 * Esc 走 exit-inspect，带着自己的语义。
	 */
	const reset = (): void => {
		selected = null;
		moveOverlay(selectedOverlay, null);
		moveOverlay(hoverOverlay, null);
	};

	const setMode = (next: InspectMode): void => {
		mode = next;
		setInspectCursor(mode === "inspect");
		if (mode === "off") reset();
	};

	// 元素选择开着时右键落在 iframe 里，画布那层的 contextmenu 再也收不到——而
	// 右键菜单是「让 Vetta 调整 / 导出渲染图 / 重命名 / 删除」的唯一入口。这里把
	// 它转发出去，坐标由画布换算回视口坐标（见 bridge-client）。
	document.addEventListener(
		"contextmenu",
		(event) => {
			if (mode !== "inspect") return;
			event.preventDefault();
			post({ type: "context-menu", x: event.clientX, y: event.clientY });
		},
		true,
	);

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
			// 焦点在 iframe 里的时候画布层收不到 keydown，Esc 的每一级都得从这里发出去。
			// hadSelection 就是那个级差：还选着元素就只清元素（frame 仍选中，可以接着
			// 点下一个），已经什么都没选了才是真的要退出这个 frame。
			const hadSelection = selected !== null;
			reset();
			post({ type: "exit-inspect", hadSelection });
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
				// html-to-image 会把每张 <img> 重新 fetch 成 dataURL 再塞回去；fetch 不到
				// （跨域缺 CORS 头、404、离线）时它把 src 换成空串，于是图片报 error，整次
				// 截图连同这个 error Event 一起 reject。而图在页面上显示正常——渲染只要
				// <img> 加载得到，不需要 fetch 得到——所以这个失败看着毫无规律。
				// 一张图挂掉不该毁掉整张截图：跳过它，其余照截。
				const onImageErrorHandler = (): void => {};
				// 画布位图化要 jpeg：同样的像素数，dataUrl 字符串小一个量级，
				// postMessage 传输与常驻内存跟着降下来——这正是能把 pixelRatio 提到
				// 设备像素比、让位图不再糊的前提。jpeg 没有透明通道，必须显式铺白底，
				// 否则透明处会变黑。交付物（导出渲染图 / 发给 agent）继续走 png。
				const encode = (): Promise<string> =>
					data.format === "jpeg"
						? toJpeg(document.documentElement, {
								pixelRatio,
								cacheBust,
								onImageErrorHandler,
								quality: typeof data.quality === "number" ? data.quality : 0.92,
								backgroundColor: "#ffffff",
							})
						: toPng(document.documentElement, { pixelRatio, cacheBust, onImageErrorHandler });
				encode()
					.then((dataUrl) => post({ type: "captured", requestId, dataUrl }))
					.catch((error: unknown) => post({ type: "captured", requestId, error: describeCaptureError(error) }))
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

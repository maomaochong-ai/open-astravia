/**
 * Design bridge — runs INSIDE each frame iframe and talks to the canvas
 * (plugin UI) via postMessage. The canvas and the iframe are cross-origin
 * (app shell vs http://127.0.0.1:<port>), so this module owns everything that
 * needs real DOM access: hover highlight, Figma-style drill selection,
 * data-vetd-source extraction and full-frame screenshots.
 *
 * Message contract (both directions carry `{ vetd: true }`):
 *   parent → iframe: set-mode | show-frame | navigate | reload | clear-selection | capture
 *   iframe → parent: ready | rendered | selected | exit-inspect | captured | hmr-updated
 *                    | frame-error | context-menu | navigated | wheel | space
 */
import { toJpeg, toPng } from "html-to-image";
import { pathOfFrame } from "./routes";

type InspectMode = "off" | "inspect";

interface BridgeHost {
	getFrameId(): string | null;
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

type Navigator = (to: string | number) => void;

let navigator: Navigator | null = null;
/** 路由还没挂上时收到的导航（srcdoc 预览的 show-frame 就赶在这一刻），挂上后补发。 */
let pendingNavigation: string | null = null;
/**
 * 自己维护的历史栈。
 *
 * History API 只让你 go(-1)，从不告诉你还能不能后退——而预览工具条要据此决定
 * 前进/后退按钮的禁用态。所有导航都经过这里，所以这份栈是完整的。
 */
const visited: string[] = [];
let visitedIndex = -1;
/** 刚发出去的是一次 go(delta)：下一条 navigated 该移动指针而不是压栈。 */
let pendingDelta: number | null = null;

/** 路由就绪后由 main.tsx 注入。 */
export function installNavigator(next: Navigator): void {
	navigator = next;
	if (pendingNavigation !== null) {
		const to = pendingNavigation;
		pendingNavigation = null;
		next(to);
	}
}

function go(to: string | number): void {
	if (!navigator) {
		if (typeof to === "string") pendingNavigation = to;
		return;
	}
	if (typeof to === "number") pendingDelta = to;
	navigator(to);
}

function pushVisited(path: string): void {
	visited.splice(visitedIndex + 1);
	visited.push(path);
	visitedIndex = visited.length - 1;
}

/** 每次地址变化后调用（含首次加载）。 */
export function notifyNavigated(path: string, frameId: string | null): void {
	if (pendingDelta !== null) {
		const target = visitedIndex + pendingDelta;
		pendingDelta = null;
		if (visited[target] === path) visitedIndex = target;
		else pushVisited(path);
	} else if (visited[visitedIndex] !== path) {
		pushVisited(path);
	}
	post({
		type: "navigated",
		path,
		frameId,
		canBack: visitedIndex > 0,
		canForward: visitedIndex < visited.length - 1,
	});
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

/**
 * 一张截图的像素上限。超过就压 pixelRatio。
 *
 * html-to-image 的成本随「面积 × pixelRatio²」走：整棵 DOM 序列化进 foreignObject、
 * 内联全部样式与素材、再解码编码一次。落地页按默认尺寸就是 1440x2000+，2 倍下已经
 * 上千万像素，单独跑都能逼近截图超时。而 agent 要看的是版式不是像素，
 * 12M（约 3464²）之上再涨清晰度没有意义。
 */
const MAX_CAPTURE_PIXELS = 12_000_000;

/** 按文档实际大小把请求的 pixelRatio 压到出得来的范围内，不低于 1 倍。 */
function safePixelRatio(requested: number): number {
	const el = document.documentElement;
	const area = Math.max(el.scrollWidth * el.scrollHeight, 1);
	return Math.max(1, Math.min(requested, Math.sqrt(MAX_CAPTURE_PIXELS / area)));
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

	// 画布导航（ctrl/⌘+滚轮缩放、滚轮平移）必须在 frame 内部也生效。元素选择开着时
	// iframe 吃掉了指针事件，画布容器上的 wheel 监听再也收不到东西——表现就是鼠标一进
	// frame 缩放/平移全失灵。frame 是定尺寸的设计稿、内部不需要滚动，所以这里一律拦下
	// 转发给画布，由它按同一套逻辑处理。
	document.addEventListener(
		"wheel",
		(event) => {
			if (mode !== "inspect") return;
			event.preventDefault();
			post({
				type: "wheel",
				x: event.clientX,
				y: event.clientY,
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
			});
		},
		{ capture: true, passive: false },
	);

	// 空格 = 临时托手工具。点进 frame 之后焦点归 iframe，画布容器上的 keydown 收不到，
	// spaceHeld 永远起不来，拖拽平移在 frame 内就失效了。
	//
	// keyup 不能同样只在 inspect 下转发：spaceHeld 一置起来画布就会把这一帧的模式关掉
	// （平移期间不该开元素选择），松手时 mode 已经是 off，keyup 丢掉等于空格卡死。
	// 所以只要按下那次发出去了，抬起就一定补一条。
	let spaceForwarded = false;
	document.addEventListener(
		"keydown",
		(event) => {
			if (mode !== "inspect" || event.code !== "Space" || event.repeat) return;
			event.preventDefault();
			spaceForwarded = true;
			post({ type: "space", down: true });
		},
		true,
	);
	document.addEventListener(
		"keyup",
		(event) => {
			if (!spaceForwarded || event.code !== "Space") return;
			spaceForwarded = false;
			post({ type: "space", down: false });
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
			// 导出快照走 srcdoc（没有 URL 可以拼），选帧只能靠这条消息。
			case "show-frame":
				if (typeof data.id === "string") go(pathOfFrame(data.id));
				return;
			case "navigate":
				if (typeof data.to === "string") go(data.to);
				else if (typeof data.delta === "number") go(data.delta);
				return;
			// 真·整页重载：预览里的「刷新」要连帧内 state 一起清掉，客户端路由做不到。
			case "reload":
				window.location.reload();
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
				const pixelRatio = safePixelRatio(
					typeof data.pixelRatio === "number" && data.pixelRatio > 0 ? Math.min(data.pixelRatio, 4) : 2,
				);
				moveOverlay(hoverOverlay, null);
				if (!keepHighlight) moveOverlay(selectedOverlay, null);
				// Capture documentElement: the overlay divs live on it, so a kept
				// highlight is included; body alone would drop them.
				// 这里没有 cacheBust：它给每张素材 URL 加随机查询串强制重下，图多的 frame
				// 能从百来毫秒拖到两秒以上，却兜不住任何东西——html-to-image 按去掉 query 的
				// URL 缓存内联结果，随机串进不了 key，缓存在它生效前就短路了。详见
				// DesignCanvas 里 captureFaithfully 的注释。
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
								onImageErrorHandler,
								quality: typeof data.quality === "number" ? data.quality : 0.92,
								backgroundColor: "#ffffff",
							})
						: toPng(document.documentElement, { pixelRatio, onImageErrorHandler });
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

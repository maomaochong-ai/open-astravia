/**
 * 「这一帧到底有多高」的探针，以及按滚动位置分块截图时的翻页脚本。
 *
 * 画布上的 frame 是一个固定尺寸的视口：内容比视口高的部分是滚动空间，位图化和
 * 渲染图都只截视口这一屏。下载素材要的是完整内容，所以先得知道内容比视口多出
 * 多少——这个数只有在真实渲染出来的 DOM 里才量得到。
 *
 * 滚动空间有两种来源：文档本身滚（落地页），或者页面里某个 `overflow:auto` 的
 * 容器滚（App 页面「顶栏 + 可滚内容 + 底部 tab」的骨架）。两者都可能同时存在，
 * 这里只报**当前藏得最多的那一个**：调用方按它把视口拉高之后再量一次，另一个
 * 自然会在下一轮浮出来（见 capture-full-frame 的迭代）。
 *
 * 脚本写成字符串：它要跨进程到离屏页面里求值（ctx.capture 的 probeScript /
 * prepareScript），拿不到这边的模块作用域，也不能抛——宿主把探针异常吞成
 * `probe: undefined`，那样就分不清「没有滚动空间」和「探针坏了」。
 */

import {
	FRAME_PAINTED_EXPRESSION,
	NAVIGATE_TO_FRAME_STATEMENTS,
	SHOWING_FRAME_EXPRESSION,
} from "../canvas/offscreen-raster";

/** 被选中的滚动容器打上这个标记，翻页脚本据此找回它（离屏窗口在两次请求之间保留 DOM）。 */
const SCROLLER_ATTR = "data-vetd-scroller";

/**
 * 找出当前视口里藏得最多的滚动容器。
 *
 * 只认 overflow-y 为 auto/scroll 的元素：`overflow:hidden` 裁掉的内容是设计意图
 * （卡片圆角裁剪、跑马灯），不是滚动空间。容器可能比视口还高（自身又被文档滚动
 * 裁掉），可见区按视口夹紧，藏住的高度也按夹紧后的可见高度算。
 */
const FIND_SCROLLER_FN = `(function () {
	var vh = window.innerHeight;
	var root = document.scrollingElement || document.documentElement;
	var best = { el: null, kind: "document", hidden: Math.max(0, root.scrollHeight - vh), top: 0, bottom: vh };
	var all = document.querySelectorAll("*");
	for (var i = 0; i < all.length; i += 1) {
		var el = all[i];
		try {
			var overflow = getComputedStyle(el).overflowY;
			if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") continue;
			var rect = el.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) continue;
			var top = Math.max(0, rect.top + el.clientTop);
			var bottom = Math.min(vh, rect.top + el.clientTop + el.clientHeight);
			if (bottom - top <= 0) continue;
			var hidden = el.scrollHeight - (bottom - top);
			if (hidden > 1 && hidden > best.hidden) best = { el: el, kind: "element", hidden: hidden, top: top, bottom: bottom };
		} catch (e) {}
	}
	return best;
})`;

/**
 * 量当前视口下的滚动空间。结果经 JSON 往返回到 {@link parseScrollProbe}。
 * 顺手把选中的容器打上标记，分块截图的翻页脚本靠它找回同一个元素。
 */
export const SCROLL_PROBE_SCRIPT = `(() => {
	var marked = document.querySelectorAll("[${SCROLLER_ATTR}]");
	for (var i = 0; i < marked.length; i += 1) marked[i].removeAttribute("${SCROLLER_ATTR}");
	var found = ${FIND_SCROLLER_FN}();
	if (found.el) found.el.setAttribute("${SCROLLER_ATTR}", "");
	return {
		viewportWidth: window.innerWidth,
		viewportHeight: window.innerHeight,
		kind: found.kind,
		hidden: Math.round(found.hidden),
		top: Math.round(found.top),
		bottom: Math.round(found.bottom)
	};
})()`;

export interface ScrollProbe {
	viewportWidth: number;
	viewportHeight: number;
	/** 藏得最多的滚动来源：文档本身，还是页面里的某个容器。 */
	kind: "document" | "element";
	/** 视口之外还藏着多少内容（CSS px）。0 表示这一屏就是全部。 */
	hidden: number;
	/** 滚动容器在视口里的可见区（文档滚动时就是整个视口）。 */
	top: number;
	bottom: number;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 宿主返回的探针结果是 unknown：逐字段收窄，缺任何一项都当作探针没跑成。 */
export function parseScrollProbe(probe: unknown): ScrollProbe | null {
	if (typeof probe !== "object" || probe === null) return null;
	const raw = probe as Record<string, unknown>;
	const viewportWidth = finiteNumber(raw.viewportWidth);
	const viewportHeight = finiteNumber(raw.viewportHeight);
	const hidden = finiteNumber(raw.hidden);
	const top = finiteNumber(raw.top);
	const bottom = finiteNumber(raw.bottom);
	const kind = raw.kind === "document" || raw.kind === "element" ? raw.kind : null;
	if (viewportWidth === null || viewportHeight === null || hidden === null || top === null || bottom === null || !kind) {
		return null;
	}
	if (viewportHeight <= 0 || bottom <= top) return null;
	return { viewportWidth, viewportHeight, kind, hidden: Math.max(0, hidden), top, bottom };
}

/**
 * 分块截图的翻页脚本：确保页面停在目标 frame 上，再把滚动容器滚到指定位置。
 *
 * 离屏窗口的「交付物」会话是共享的（vetd_screenshot 也用它），两块之间别的请求
 * 可能把页面切到了别的 frame。所以不能假设 DOM 还是量高度时的那份：先看地址栏
 * 显示的是不是目标 frame，不是就重新切帧、等它画完再滚；标记丢了就按同一套
 * 规则重新找滚动容器。滚动完成的信号是 `__vetdScrollAt`，readyExpression 等它。
 */
export function scrollPrepareScript(frameId: string, scrollTop: number): string {
	const id = JSON.stringify(frameId);
	const top = Math.max(0, Math.round(scrollTop));
	return `(() => {
	var ID = ${id};
	var TOP = ${top};
	window.__vetdScrollAt = null;
	var apply = function () {
		var el = document.querySelector("[${SCROLLER_ATTR}]");
		if (!el) {
			var found = ${FIND_SCROLLER_FN}();
			el = found.el;
			if (el) el.setAttribute("${SCROLLER_ATTR}", "");
		}
		var target = el || document.scrollingElement || document.documentElement;
		document.documentElement.style.scrollBehavior = "auto";
		target.style.scrollBehavior = "auto";
		target.scrollTop = TOP;
		window.__vetdScrollAt = TOP;
	};
	if (${SHOWING_FRAME_EXPRESSION} && typeof window.__vetdPainted === "string") {
		window.__vetdNavFrom = "";
		apply();
		return;
	}
	${NAVIGATE_TO_FRAME_STATEMENTS}
	var timer = setInterval(function () {
		if (!${FRAME_PAINTED_EXPRESSION}) return;
		clearInterval(timer);
		apply();
	}, 50);
})()`;
}

/** 与 {@link scrollPrepareScript} 配对的就绪表达式。 */
export function scrollReadyExpression(scrollTop: number): string {
	// 与截图同一条就绪判据：重定向的帧写回的是跳转后那一帧，只认目标 id 会死等。
	return `${FRAME_PAINTED_EXPRESSION} && window.__vetdScrollAt === ${Math.max(0, Math.round(scrollTop))}`;
}

/**
 * 最后一块截完后把滚动位置归零。
 *
 * 会话窗口接下来会被 vetd_screenshot 复用，而同一帧的重渲染不会重置 DOM 的
 * scrollTop——不归零的话 agent 下一张截图就是滚到底的画面。挂在 probeScript 上：
 * 宿主在出图之后才跑它，正好不多花一次截图。
 */
export const SCROLL_RESET_SCRIPT = `(() => {
	var el = document.querySelector("[${SCROLLER_ATTR}]");
	if (el) { el.scrollTop = 0; el.removeAttribute("${SCROLLER_ATTR}"); }
	var root = document.scrollingElement || document.documentElement;
	root.scrollTop = 0;
	window.__vetdScrollAt = null;
	return true;
})()`;

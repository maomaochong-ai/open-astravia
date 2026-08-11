/**
 * 元素级追问的纯逻辑：谁配有徽标、徽标落在哪、提交去向、以及落成备注时锚在哪。
 */
import { expect, it } from "vitest";
import type { SelectedElementPayload } from "../src/canvas/bridge-client";
import type { CanvasSelection } from "../src/canvas/DesignCanvas";
import {
	ASK_BADGE_CLEARANCE,
	ASK_POPOVER_GAP,
	askBadgePlacement,
	askBadgePoint,
	askNoteAnchor,
	askPopoverPoint,
	askTarget,
	resolveAskMode,
	selectionAfterHmr,
} from "../src/canvas/selection-ask";
import type { VetdFrameEntry } from "../src/vetd/manifest-types";

const frames: VetdFrameEntry[] = [
	{ id: "login", title: "登录页", file: "frames/login.tsx", x: 100, y: 200, width: 390, height: 844 },
	{ id: "home", title: "首页", file: "frames/home.tsx", x: 600, y: 200, width: 390, height: 844 },
] as VetdFrameEntry[];

function element(rect: { x: number; y: number; width: number; height: number }): SelectedElementPayload {
	return {
		tag: "button",
		domPath: "body>div>button",
		classes: "rounded",
		text: "登录",
		rect,
		source: "frames/login.tsx:42",
	};
}

function domSelection(rect: { x: number; y: number; width: number; height: number }): CanvasSelection {
	return { kind: "dom", frameId: "login", payload: element(rect) };
}

it("能发就发，发不了就落备注", () => {
	expect(resolveAskMode(null)).toBe("ask");
	expect(resolveAskMode("Vetta 正在忙")).toBe("note");
	// 空串也是一个被拦下的理由，不能因为 falsy 就当成放行。
	expect(resolveAskMode("")).toBe("note");
});

it("单选画框的目标就是画框本身", () => {
	const target = askTarget({ kind: "frames", ids: ["login"] }, frames);
	expect(target).toEqual({
		kind: "frame",
		frameId: "login",
		x: 100,
		y: 200,
		width: 390,
		height: 844,
		fx: 0,
		fy: 0,
	});
});

it("元素的 rect 是画框局部坐标，世界坐标要叠上画框位置", () => {
	const target = askTarget(domSelection({ x: 20, y: 60, width: 100, height: 40 }), frames);
	expect(target).toMatchObject({ kind: "element", frameId: "login", x: 120, y: 260, fx: 20, fy: 60 });
});

it("多选、空选、画框已不在，都没有徽标", () => {
	expect(askTarget({ kind: "frames", ids: ["login", "home"] }, frames)).toBeNull();
	expect(askTarget({ kind: "frames", ids: [] }, frames)).toBeNull();
	expect(askTarget(null, frames)).toBeNull();
	expect(askTarget({ kind: "frames", ids: ["gone"] }, frames)).toBeNull();
	expect(askTarget({ kind: "dom", frameId: "gone", payload: element({ x: 0, y: 0, width: 1, height: 1 }) }, frames))
		.toBeNull();
});

it("徽标钉在选框右上角，popover 从它右边展开", () => {
	const target = askTarget(domSelection({ x: 20, y: 60, width: 100, height: 40 }), frames);
	if (!target) throw new Error("expected a target");
	expect(askBadgePoint(target)).toEqual({ x: 220, y: 260 });
	expect(askPopoverPoint(target)).toEqual({ x: 220 + ASK_POPOVER_GAP, y: 260 });
});

it("元素离画框顶边够远才放到框外，太近就翻进框内", () => {
	const roomy = askTarget(domSelection({ x: 0, y: ASK_BADGE_CLEARANCE, width: 10, height: 10 }), frames);
	const tight = askTarget(domSelection({ x: 0, y: ASK_BADGE_CLEARANCE - 1, width: 10, height: 10 }), frames);
	if (!roomy || !tight) throw new Error("expected targets");
	expect(askBadgePlacement(roomy)).toBe("above");
	expect(askBadgePlacement(tight)).toBe("inside");
});

it("画框级选中一律放框内——正上方是标题栏和活动徽章", () => {
	const target = askTarget({ kind: "frames", ids: ["login"] }, frames);
	if (!target) throw new Error("expected a target");
	expect(askBadgePlacement(target)).toBe("inside");
});

it("元素备注直接写成 element 锚，锚点就是徽标刚才的位置", () => {
	const selection = domSelection({ x: 20, y: 60, width: 100, height: 40 });
	const target = askTarget(selection, frames);
	if (!target) throw new Error("expected a target");
	expect(askNoteAnchor(selection, target)).toEqual({
		kind: "element",
		frameId: "login",
		// 画框局部坐标下的右上角，与 askBadgePoint 的世界坐标一一对应。
		fx: 120,
		fy: 60,
		element: {
			domPath: "body>div>button",
			tag: "button",
			text: "登录",
			classes: "rounded",
			source: "frames/login.tsx:42",
		},
	});
});

it("热更新把元素选中退回画框选中，别的选中不动", () => {
	const dom = domSelection({ x: 0, y: 0, width: 10, height: 10 });
	expect(selectionAfterHmr(dom, "login", false)).toEqual({ kind: "frames", ids: ["login"] });
	// 更新的是别的画框，与这次选中无关。
	expect(selectionAfterHmr(dom, "home", false)).toBe(dom);
	const framesSelection: CanvasSelection = { kind: "frames", ids: ["login"] };
	expect(selectionAfterHmr(framesSelection, "login", false)).toBe(framesSelection);
	expect(selectionAfterHmr(null, "login", false)).toBeNull();
});

it("popover 开着时热更新不动选中——用户正在里面打字", () => {
	const dom = domSelection({ x: 0, y: 0, width: 10, height: 10 });
	expect(selectionAfterHmr(dom, "login", true)).toBe(dom);
});

it("画框备注锚在画框右上角", () => {
	const selection: CanvasSelection = { kind: "frames", ids: ["login"] };
	const target = askTarget(selection, frames);
	if (!target) throw new Error("expected a target");
	expect(askNoteAnchor(selection, target)).toEqual({ kind: "frame", frameId: "login", fx: 390, fy: 0 });
});

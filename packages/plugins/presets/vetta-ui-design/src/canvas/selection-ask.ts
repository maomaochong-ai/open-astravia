/**
 * 元素级追问的纯逻辑：选中态 → 徽标几何 → 提交去向。
 *
 * 画布选中不再常驻挂到 AI 输入框（那会把用户的操作焦点从画布上拽走）。取而代之
 * 的是选框右上角的一枚徽标：能发消息时点开就问，agent 正忙（或压根没有可用会话）
 * 时同一枚徽标改为落一条备注——备注是被动的，agent 收尾自检时才读到，于是天然
 * 成了「延迟指令」。
 */

import type { NoteAnchor } from "../notes/types";
import type { VetdFrameEntry } from "../vetd/manifest-types";
import type { CanvasSelection } from "./DesignCanvas";

/**
 * 徽标点开后 popover 的身份。
 * - ask：直接发一轮消息，选中作为结构化附件随行。
 * - note：写进 `.notes.json` 等 agent 自己来取。
 */
export type AskMode = "ask" | "note";

/**
 * 能发就发，不能发就留备注。三档闸口（无会话 / 跨 workspace / 正在 streaming）
 * 全部收敛到 useNotesHandoff 的 blockedReason，这里不再各判一遍。
 */
export function resolveAskMode(blockedReason: string | null): AskMode {
	return blockedReason === null ? "ask" : "note";
}

/**
 * 被追问对象在画布上的矩形。
 *
 * 元素的 rect 来自 iframe 内的 getBoundingClientRect，也就是 frame 声明尺寸的
 * 像素系（frame 局部坐标）；fx/fy 保留这份局部坐标，x/y 是换算后的世界坐标。
 * 备注锚点要局部的那一套，徽标定位要世界的那一套，所以两份都留着。
 */
export interface AskTarget {
	kind: "frame" | "element";
	frameId: string;
	/** 世界坐标。 */
	x: number;
	y: number;
	width: number;
	height: number;
	/** frame 局部坐标（frame 级选中恒为 0,0）。 */
	fx: number;
	fy: number;
}

/**
 * 徽标要占掉的上方空间（frame 局部坐标）。元素离 frame 顶边比这还近时，徽标放
 * 到框外就会翻出 frame、压住标题栏。
 */
export const ASK_BADGE_CLEARANCE = 28;

/** 徽标相对选框的落位。above = 框外上方（不遮挡内容），inside = 框内右上角。 */
export type AskBadgePlacement = "above" | "inside";

/** popover 与徽标之间的横向间距（世界坐标，未经反向缩放）。 */
export const ASK_POPOVER_GAP = 8;

/**
 * 哪些选中形态配有徽标：单个 frame，或 frame 里的单个元素。
 *
 * 多选没有徽标——多选下的诉求是排版而不是追问，真要留话可以直接用备注工具；而且
 * 包围盒的右上角在缩放和滚动中很容易压到别的 frame 上。
 */
export function askTarget(selection: CanvasSelection, frames: readonly VetdFrameEntry[]): AskTarget | null {
	if (!selection) return null;
	if (selection.kind === "dom") {
		const frame = frames.find((candidate) => candidate.id === selection.frameId);
		if (!frame) return null;
		const { rect } = selection.payload;
		return {
			kind: "element",
			frameId: frame.id,
			x: frame.x + rect.x,
			y: frame.y + rect.y,
			width: rect.width,
			height: rect.height,
			fx: rect.x,
			fy: rect.y,
		};
	}
	if (selection.ids.length !== 1) return null;
	const frame = frames.find((candidate) => candidate.id === selection.ids[0]);
	if (!frame) return null;
	return {
		kind: "frame",
		frameId: frame.id,
		x: frame.x,
		y: frame.y,
		width: frame.width,
		height: frame.height,
		fx: 0,
		fy: 0,
	};
}

/**
 * 徽标钉点：选框的右上角（世界坐标）。放到框外还是框内由 placement 决定，两种落位
 * 共用这一个点，只是渲染时的 transform 原点不同。
 */
export function askBadgePoint(target: AskTarget): { x: number; y: number } {
	return { x: target.x + target.width, y: target.y };
}

/**
 * frame 级选中一律放框内：frame 的正上方是标题栏，而且 agent 干活时那里还会冒出
 * 「修改中 / 新建中」的活动徽章，徽标挤进去必然打架。元素则尽量放框外，让被追问的
 * 那块内容一点都不被挡住。
 */
export function askBadgePlacement(target: AskTarget): AskBadgePlacement {
	return target.kind === "element" && target.fy >= ASK_BADGE_CLEARANCE ? "above" : "inside";
}

/** popover 从徽标右侧展开：往左开会盖住正在被追问的东西，那正是这个功能要避免的。 */
export function askPopoverPoint(target: AskTarget): { x: number; y: number } {
	return { x: target.x + target.width + ASK_POPOVER_GAP, y: target.y };
}

/**
 * 热更新之后的选中收敛。
 *
 * 元素选中的 rect 是选中那一刻的快照，frame 一热更新它指向的位置就不作数了（引擎
 * 侧的高亮外框同样会指错）；iframe 重载后引擎那边的元素选中本来也没了。所以退回到
 * 「选中这个 frame」——与引擎侧 Esc 到顶的那一级同义，而不是清空。
 *
 * 追问 popover 开着时一概不动：用户正对着它打字，选中被抽走等于连人带字一起清掉。
 * 位置漂一点无所谓，此刻他看的是输入框。
 */
export function selectionAfterHmr(
	current: CanvasSelection,
	frameId: string,
	askOpen: boolean,
): CanvasSelection {
	if (askOpen) return current;
	if (current?.kind !== "dom" || current.frameId !== frameId) return current;
	return { kind: "frames", ids: [frameId] };
}

/**
 * 徽标路径落下的备注锚在选框右上角——也就是徽标刚才所在的位置，提交后气泡原地长
 * 出来，动作是连着的。
 *
 * 元素选中直接写成 element 锚：手里的 payload 就是用户亲自选中的那个元素，比放置
 * 备注时那次按坐标的后台 hit-test 更可靠，不必再走 upgradeAnchor 那一遭。
 */
export function askNoteAnchor(selection: CanvasSelection, target: AskTarget): NoteAnchor {
	const fx = target.fx + target.width;
	const fy = target.fy;
	if (selection?.kind === "dom") {
		const { payload } = selection;
		return {
			kind: "element",
			frameId: target.frameId,
			fx,
			fy,
			element: {
				domPath: payload.domPath,
				tag: payload.tag,
				text: payload.text,
				classes: payload.classes,
				source: payload.source,
			},
		};
	}
	return { kind: "frame", frameId: target.frameId, fx, fy };
}

/**
 * 从画廊点进一个项目。
 *
 * 两件事一起做：把宿主导航到该项目的会话，并预约打开设计画布——从画廊进来是明确的
 * 「我要看这份设计」，不该再让用户自己去活动面板找标签卡。
 */
import { setPendingDesignPath } from "../canvas/design-runtime";
import { getPluginCtx } from "../plugin-context";
import { CANVAS_TAB_ID } from "../tab-ids";
import { pickResumableSession } from "./gallery-model";

export interface OpenProjectTarget {
	cwd: string;
	/** 卡面代表的那份设计，进画布后直接定位到它。 */
	vetdPath: string;
}

/**
 * 跳转并展开画布。
 *
 * 画布的展开是「预约 + 会话切换后由 revealTabForCwd 落实」而不是在这里直接开：此刻
 * 宿主还停在画廊路由上，活动面板属于会话页，开了也没有承载它的地方。
 */
export async function openProjectFromGallery(target: OpenProjectTarget): Promise<void> {
	const ctx = getPluginCtx();
	// 先记下要打开哪份设计：CanvasTab 挂载时会 take 走它（见 takePendingDesignPath）。
	setPendingDesignPath(target.vetdPath);
	requestCanvasReveal(target.cwd);

	const sessions = await ctx.official.sessions.list(target.cwd).catch(() => []);
	const resumable = pickResumableSession(sessions);
	if (resumable) {
		await ctx.official.sessions.open({ cwd: target.cwd, sessionPath: resumable.path });
		return;
	}
	// 一个能续聊的会话都没有：落到该项目的新建会话页，而不是凭空造一个空会话。
	await ctx.official.navigation.open({ target: "new-session", cwd: target.cwd });
}

/** 本插件随包带的 skill 名（`agent/skills/vetta-ui-design`）。 */
const DESIGN_SKILL_NAME = "vetta-ui-design";

/**
 * 输入框的 skill 软引用文本形态：宿主解析后渲染成一枚 badge。
 * 末尾留一个空格，光标落在 badge 之后，用户直接接着敲提示词。
 */
export const DESIGN_SKILL_DRAFT = `@skill:${DESIGN_SKILL_NAME} `;

/**
 * 刚建完项目：进它的新建会话页，并把设计 skill 的 badge 预置进输入框。
 *
 * 不预约画布展开——此刻项目里还没有任何 `.vetd`，铺开的画布只会是一块空白；
 * 设计由用户的第一句提示词驱动 agent 创建，建好后画廊自会扫出来。
 */
export async function startDesignProject(cwd: string): Promise<void> {
	await getPluginCtx().official.navigation.open({
		target: "new-session",
		cwd,
		draft: DESIGN_SKILL_DRAFT,
	});
}

/**
 * 预约「切到这个 cwd 后把画布铺开」。
 *
 * 插件的 revealTabForCwd 只在「纯设计项目」时自动展开，混合项目故意不抢；从画廊点进来
 * 是用户显式表达的意图，所以这里单独记一笔，由会话切换时消费一次。
 */
let pendingRevealCwd: string | null = null;

export function requestCanvasReveal(cwd: string): void {
	pendingRevealCwd = cwd;
}

/**
 * 认领这次会话切换的画布展开。只对预约过的那个 cwd 生效，且只生效一次——用户之后
 * 在同一个项目里自己关掉画布，不该被反复弹开。
 */
export function claimCanvasReveal(cwd: string | null): boolean {
	if (!cwd || pendingRevealCwd !== cwd) return false;
	pendingRevealCwd = null;
	return true;
}

/** 仅供测试：清空进程内的预约。 */
export function resetCanvasReveal(): void {
	pendingRevealCwd = null;
}

/** 立刻把画布标签卡铺开（会话页已经在前台时用）。 */
export function revealCanvasNow(): void {
	getPluginCtx().ui.openActivityTab(CANVAS_TAB_ID, { width: "max" });
}

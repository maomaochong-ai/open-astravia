/**
 * 版本标题的构造规则（ADR-0069）。
 *
 * 标题取用户那句话的首行，不让模型另写摘要：多一次请求不说，assistant 的末尾消息
 * 常常是「已完成，请查看画布」这类没有信息量的话。原话是「再改改」时，历史面板靠
 * 副标题里的变更文件列表把版本认出来。
 */

const MAX_TITLE_CHARS = 60;

/** prompt 缺失或全是空白时的兜底。 */
const FALLBACK_TITLE = "更新设计";

/**
 * 首行、压掉连续空白、超长截断。
 *
 * 截断加省略号是有意的：面板上一眼能看出「这句话还没完」，比在 60 字处生硬断掉更像
 * 一条记录。
 */
export function commitTitleFromPrompt(prompt: string | null | undefined): string {
	const firstLine = (prompt ?? "")
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	if (!firstLine) return FALLBACK_TITLE;
	const collapsed = firstLine.replace(/\s+/g, " ");
	if (collapsed.length <= MAX_TITLE_CHARS) return collapsed;
	return `${collapsed.slice(0, MAX_TITLE_CHARS)}…`;
}

/**
 * 新一轮对话开始前，为上一轮遗留的未提交改动起的标题。
 *
 * 这种改动只有两个来源：上一个回合被用户按停止中断（Stop hook 在 aborted 时不触发，
 * 见 stop-hook-continuation-source.ts），或者用户自己在编辑器里动过文件。两者都必须
 * 先封存——否则用户「中断 → 直接恢复旧版」会真的丢掉还没看过的改动。
 */
export function carryOverTitle(previousPrompt: string | null | undefined): string {
	if (!previousPrompt?.trim()) return "手动修改";
	return `${commitTitleFromPrompt(previousPrompt)}（未完成）`;
}

/** 恢复动作自己产生的版本标题。 */
export function restoreTitle(targetTitle: string): string {
	return `恢复到：${targetTitle}`;
}

/** 恢复前封存现场的版本标题。 */
export const PRE_RESTORE_TITLE = "恢复前的状态";

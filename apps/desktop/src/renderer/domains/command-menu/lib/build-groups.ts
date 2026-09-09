import type { CommandMenuGroupView, CommandMenuItemView } from "@vetta/theme-ui/overlays";
import {
	COMMAND_MENU_GROUP_LIMIT,
	COMMAND_MENU_GROUP_ORDER,
	type CommandMenuEntry,
	type CommandMenuGroupKey,
} from "../types";
import { type CommandMenuMatch, matchCommandMenuEntry } from "./match";

/**
 * 目录 → 渲染分组。三条不变量都在这里落地：
 *  1. 组顺序取自 COMMAND_MENU_GROUP_ORDER 常量，与相关性无关；
 *  2. 每组截断到 COMMAND_MENU_GROUP_LIMIT，DOM 行数恒定在几十量级，不需要虚拟列表；
 *  3. 条目 id 全局唯一，供上层把选中态锚在 id 而不是下标上。
 */

export interface CommandMenuGroupLabels {
	readonly groups: Readonly<Record<CommandMenuGroupKey, string>>;
	/** 例如 (n) => `还有 ${n} 条` */
	readonly overflow: (count: number) => string;
}

export interface BuildCommandMenuGroupsInput {
	readonly entries: readonly CommandMenuEntry[];
	readonly tokens: readonly string[];
	readonly labels: CommandMenuGroupLabels;
	/** 尚未收敛的分组（目前只有会话），即使暂无结果也保留骨架位。 */
	readonly loadingGroups?: readonly CommandMenuGroupKey[];
	readonly limit?: number;
}

export interface BuildCommandMenuGroupsResult {
	readonly groups: readonly CommandMenuGroupView[];
	/** 按渲染顺序拍平的条目 id，供键盘上下移动使用。 */
	readonly orderedIds: readonly string[];
	readonly entryById: ReadonlyMap<string, CommandMenuEntry>;
}

interface ScoredEntry {
	readonly entry: CommandMenuEntry;
	readonly match: CommandMenuMatch;
}

function toItemView(scored: ScoredEntry): CommandMenuItemView {
	const { entry, match } = scored;
	return {
		id: entry.id,
		title: entry.title,
		titleHighlights: match.titleHighlights,
		subtitle: entry.subtitle,
		subtitleHighlights: match.subtitleHighlights,
		icon: entry.icon,
		badge: entry.badge,
		disabled: entry.disabled,
		disabledReason: entry.disabledReason,
	};
}

export function buildCommandMenuGroups({
	entries,
	tokens,
	labels,
	loadingGroups = [],
	limit = COMMAND_MENU_GROUP_LIMIT,
}: BuildCommandMenuGroupsInput): BuildCommandMenuGroupsResult {
	const byGroup = new Map<CommandMenuGroupKey, ScoredEntry[]>();
	const pinnedByGroup = new Map<CommandMenuGroupKey, ScoredEntry[]>();

	for (const entry of entries) {
		// 置底行不参与匹配：它是一个出口，不是一条结果。
		if (entry.pinnedToBottom) {
			const bucket = pinnedByGroup.get(entry.groupKey) ?? [];
			bucket.push({ entry, match: { score: 0, titleHighlights: [], subtitleHighlights: [] } });
			pinnedByGroup.set(entry.groupKey, bucket);
			continue;
		}
		const match = matchCommandMenuEntry(entry, tokens);
		if (!match) continue;
		const bucket = byGroup.get(entry.groupKey) ?? [];
		bucket.push({ entry, match });
		byGroup.set(entry.groupKey, bucket);
	}

	const loading = new Set(loadingGroups);
	const groups: CommandMenuGroupView[] = [];
	const orderedIds: string[] = [];
	const entryById = new Map<string, CommandMenuEntry>();

	for (const key of COMMAND_MENU_GROUP_ORDER) {
		const matched = byGroup.get(key) ?? [];
		// 分数高者在前；同分退回适配器给的组内次序，保证排列稳定可预测。
		matched.sort((a, b) => b.match.score - a.match.score || a.entry.order - b.entry.order);
		const visible = matched.slice(0, limit);
		const hidden = matched.length - visible.length;
		const pinned = pinnedByGroup.get(key) ?? [];
		const isLoading = loading.has(key);

		if (visible.length === 0 && pinned.length === 0 && !isLoading) continue;

		const items = [...visible, ...pinned].map(toItemView);
		for (const scored of [...visible, ...pinned]) {
			if (!scored.entry.disabled) orderedIds.push(scored.entry.id);
			entryById.set(scored.entry.id, scored.entry);
		}

		groups.push({
			key,
			label: labels.groups[key],
			items,
			loading: isLoading || undefined,
			overflowLabel: hidden > 0 ? labels.overflow(hidden) : undefined,
		});
	}

	return { groups, orderedIds, entryById };
}

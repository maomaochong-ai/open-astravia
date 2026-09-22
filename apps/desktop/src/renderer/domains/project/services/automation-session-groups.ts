import type { AutomationSessionLink, PinnedSessionPaths } from "@shared/store/atoms";
import type { SidebarConversationInfo } from "./sidebar-conversation-projection";

/**
 * 自动化会话组（CONTEXT.md「自动化会话组」）：「每次新建会话」产生的会话在侧边栏按自动化
 * 折叠成一行。组的位置由最近一次运行决定：排序前只留下最近那条占位，其余先收起；
 * 投影成行时占位换成组头（点开展开），展开后全部运行缩进列在组头之下。
 * 钉住的会话是用户的明确意图，不参与折叠。
 */
export interface AutomationSessionGroup {
	readonly taskId: string;
	readonly taskName: string;
	/** 全部运行，最近在前；首项即排序占位。 */
	readonly members: readonly SidebarConversationInfo[];
}

export interface CollapsedAutomationSessions {
	readonly sessions: SidebarConversationInfo[];
	/** 组头会话路径 → 会话组；只有一条运行的自动化不成组。 */
	readonly groupsByHeadPath: ReadonlyMap<string, AutomationSessionGroup>;
}

export function collapseAutomationSessions(
	sessions: readonly SidebarConversationInfo[],
	links: ReadonlyMap<string, AutomationSessionLink>,
	pinned: PinnedSessionPaths,
): CollapsedAutomationSessions {
	const byTask = new Map<string, SidebarConversationInfo[]>();
	for (const session of sessions) {
		if (session.kind !== "conversation" || pinned.has(session.path)) continue;
		const link = links.get(session.path);
		if (link?.mode !== "new-session") continue;
		const members = byTask.get(link.taskId) ?? [];
		members.push(session);
		byTask.set(link.taskId, members);
	}
	const hidden = new Set<string>();
	const groupsByHeadPath = new Map<string, AutomationSessionGroup>();
	for (const [taskId, members] of byTask) {
		if (members.length < 2) continue;
		const sorted = [...members].sort((a, b) => b.modifiedAt - a.modifiedAt);
		const [head, ...rest] = sorted;
		for (const member of rest) hidden.add(member.path);
		groupsByHeadPath.set(head.path, {
			taskId,
			taskName: links.get(head.path)?.taskName ?? "",
			members: sorted,
		});
	}
	return {
		sessions: hidden.size === 0 ? [...sessions] : sessions.filter((session) => !hidden.has(session.path)),
		groupsByHeadPath,
	};
}

/** 当前打开的会话若在某个会话组里，返回该组的 taskId，供列表自动展开。 */
export function automationGroupContaining(
	groupsByHeadPath: ReadonlyMap<string, AutomationSessionGroup>,
	sessionPath: string,
): string | undefined {
	if (!sessionPath) return undefined;
	for (const group of groupsByHeadPath.values()) {
		if (group.members.some((member) => member.path === sessionPath)) return group.taskId;
	}
	return undefined;
}

export interface AutomationGroupRowFields {
	/** 组头：本组共有多少次运行。 */
	readonly groupCount?: number;
	readonly groupExpanded?: boolean;
	readonly groupTaskId?: string;
	/** 展开后的组员行，缩进显示在组头之下。 */
	readonly nested?: boolean;
}

interface GroupableRowView {
	readonly key: string;
	readonly path: string;
	readonly label: string;
	readonly titleExtra?: string;
	readonly active: boolean;
	readonly running: boolean;
}

/**
 * 把排序后的占位行投影成最终行：占位换成组头，展开的组把全部运行紧跟其后。
 * 组头不对应任何一个会话（key/path 都带 automation-group 前缀），收起时若组里有
 * 正在看的会话则组头高亮，任一运行在跑则组头显示运行中。
 */
export function expandAutomationGroupRows<View extends GroupableRowView>(
	placeholders: readonly View[],
	groupsByHeadPath: ReadonlyMap<string, AutomationSessionGroup>,
	expandedTaskIds: ReadonlySet<string>,
	toView: (session: SidebarConversationInfo) => View,
): Array<View & AutomationGroupRowFields> {
	const rows: Array<View & AutomationGroupRowFields> = [];
	for (const view of placeholders) {
		const group = groupsByHeadPath.get(view.path);
		if (!group) {
			rows.push(view);
			continue;
		}
		const expanded = expandedTaskIds.has(group.taskId);
		const memberViews = group.members.map((member) => (member.path === view.path ? view : toView(member)));
		rows.push({
			...view,
			key: `automation-group:${group.taskId}`,
			path: `automation-group:${group.taskId}`,
			label: group.taskName || view.label,
			// 悬停提示最近一次运行（会话名自带运行时间）。
			titleExtra: view.label,
			active: !expanded && memberViews.some((member) => member.active),
			running: memberViews.some((member) => member.running),
			groupCount: group.members.length,
			groupExpanded: expanded,
			groupTaskId: group.taskId,
		});
		if (expanded) {
			for (const member of memberViews) rows.push({ ...member, nested: true });
		}
	}
	return rows;
}

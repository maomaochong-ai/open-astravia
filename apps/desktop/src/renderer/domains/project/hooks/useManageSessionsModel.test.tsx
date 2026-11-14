// @vitest-environment jsdom
import type { CommandMenuItemView } from "@astravia-org/theme-ui/project";
import {
	confirmDialogAtom,
	conversationTagsAtom,
	manageSessionsProjectAtom,
	type Project,
} from "@shared/store/atoms";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { type ConversationTagsSnapshot, emptyConversationTags } from "../../../../shared/conversation-tags";
import type { ProjectsPanelModel } from "../components/sidebar/projects/panel/types";
import type { SidebarConversationInfo } from "../services/sidebar-conversation-projection";
import { useManageSessionsModel } from "./useManageSessionsModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh" } }),
}));

// 删除会话要先摘掉它的标签标注。
const forgetConversations = vi.fn();
const assignTag = vi.fn();
vi.stubGlobal(
	"window",
	Object.assign(globalThis.window, {
		astravia: {
			conversationTags: { forgetConversations, assign: assignTag },
			shell: { showInFolder: vi.fn() },
		},
	}),
);

const PROJECT: Project = { cwd: "/work/demo", name: "demo", sessionCount: 3, type: "normal" };

/** 「对话」档项目：只有它有标签页（`canTag = isDefault && !isClaw`）。 */
const CONVERSATION_PROJECT: Project = {
	cwd: "/home/user/.astravia/desktop-app/conversation",
	name: "对话",
	isDefault: true,
} as Project;

function session(path: string, firstMessage: string, modifiedAt: number): SidebarConversationInfo {
	return { kind: "conversation", id: path, path, cwd: PROJECT.cwd, firstMessage, modifiedAt };
}

/**
 * 面板用到的 panel model 只有这几项，显式写出来比整块 `as unknown as` 更能暴露依赖范围的变化。
 *
 * 会话列表按引用共享、删除时就地移除：删除会话之后列表真的会变短，否则
 * 「删完选中项落到相邻一行」这条行为等于在测一份不会变化的数据。
 */
function buildPanel(sessions: SidebarConversationInfo[]) {
	const list = [...sessions];
	const actions = {
		deleteSession: vi.fn((target: SidebarConversationInfo) => {
			const index = list.findIndex((entry) => entry.path === target.path);
			if (index >= 0) list.splice(index, 1);
		}),
		renameSession: vi.fn(),
		selectSession: vi.fn(),
		defaultSelectSession: vi.fn(),
		clearConversation: vi.fn(),
		clearClaw: vi.fn(),
		loadSessions: vi.fn(),
	};
	const model = {
		defaultConversationFilter: "conversation",
		defaultProject: undefined,
		// 「对话」档项目的会话来自 defaultSessions，其它项目来自 projectSessions；两者共享同一份列表。
		defaultSessions: list,
		defaultSessionsCwd: PROJECT.cwd,
		defaultSessionsLoading: false,
		imCwd: "/im",
		projectSessions: () => list,
		projectSessionsLoading: () => false,
		actions,
	} as unknown as ProjectsPanelModel;
	return { model, actions };
}

function renderPanel(
	target: Project,
	model: ProjectsPanelModel,
	tags: ConversationTagsSnapshot = emptyConversationTags(),
) {
	const store = createStore();
	store.set(manageSessionsProjectAtom, target);
	store.set(conversationTagsAtom, tags);
	const wrapper = ({ children }: PropsWithChildren): JSX.Element => <Provider store={store}>{children}</Provider>;
	const view = renderHook(() => useManageSessionsModel(model), { wrapper });
	return { ...view, store };
}

function titles(rows: readonly CommandMenuItemView[]): string[] {
	return rows.map((row) => row.title);
}

function pressKey(init: KeyboardEventInit): void {
	act(() => {
		window.dispatchEvent(new KeyboardEvent("keydown", init));
	});
}

/**
 * 「管理会话」的存在理由是「找到并清掉」：打开面板、搜到某条、删掉、再从更多菜单里改名或
 * 清空全部，是用户会连着做的动作，因此按这条路径整体断言，而不是拆成孤立的函数调用。
 */
describe("管理会话面板模型", () => {
	it("打开面板：按需加载未展开项目的会话，并默认选中第一条", () => {
		const { model, actions } = buildPanel([
			session("/a.jsonl", "修复登录", 2),
			session("/b.jsonl", "写文档", 1),
		]);
		const { result } = renderPanel(PROJECT, model);

		// 项目可能在侧栏里从未展开过：打开面板就补拉一次，否则面板是空的。
		expect(actions.loadSessions).toHaveBeenCalledWith(PROJECT.cwd);
		expect(result.current.open).toBe(true);
		expect(titles(result.current.rows)).toEqual(["修复登录", "写文档"]);
		expect(result.current.selectedId).toBe(result.current.rows[0]?.id);
	});

	it("搜索 → 删除 → 更多菜单 → 改名 → 清空全部，一条用户路径走通", () => {
		const sessions = [
			session("/a.jsonl", "修复登录", 3),
			session("/b.jsonl", "写入 README", 2),
			session("/c.jsonl", "登录页重构", 1),
		];
		const { model, actions } = buildPanel(sessions);
		const { result, store } = renderPanel(PROJECT, model);

		// 搜索：不区分大小写，命中项保持原顺序（置顶 / 时间序）。
		act(() => result.current.onQueryChange("readme"));
		expect(titles(result.current.rows)).toEqual(["写入 README"]);
		act(() => result.current.onQueryChange("登录"));
		expect(titles(result.current.rows)).toEqual(["修复登录", "登录页重构"]);

		// 删除：清空搜索回到全量，从「更多」里删当前行，删完选中项落到相邻一行。
		act(() => result.current.onQueryChange(""));
		const first = result.current.rows[0];
		act(() => result.current.onMoreRow(first!.id));
		expect(result.current.step).toBe("menu");
		act(() => result.current.onSelectMenuItem("delete"));
		expect(actions.deleteSession).toHaveBeenCalledTimes(1);
		expect(actions.deleteSession.mock.calls[0]?.[0]).toMatchObject({ path: "/a.jsonl" });
		expect(result.current.step).toBe("list");
		// 删掉的那条真的从列表里消失，选中项落到相邻一行（下一条），可以接着删。
		expect(titles(result.current.rows)).toEqual(["写入 README", "登录页重构"]);
		expect(result.current.selectedId).toBe(result.current.rows[0]?.id);

		// 改名：菜单里切到输入步骤，提交走侧栏同一个重命名接口。
		const target = result.current.rows[0];
		act(() => result.current.onMoreRow(target!.id));
		act(() => result.current.onSelectMenuItem("rename"));
		expect(result.current.step).toBe("rename");
		expect(result.current.renameValue).toBe(target!.title);
		act(() => result.current.onRenameChange("新名字"));
		act(() => result.current.onRenameSubmit());
		expect(actions.renameSession).toHaveBeenCalledWith(PROJECT.cwd, "/b.jsonl", "新名字");
		expect(result.current.step).toBe("list");

		// 清空全部：项目会话先收起面板并弹确认，确认后才逐条删除。
		act(() => result.current.onClearAll());
		expect(result.current.open).toBe(false);
		const confirmation = store.get(confirmDialogAtom);
		expect(confirmation).toMatchObject({ title: "manageSessions.clearProjectTitle", variant: "danger" });
		act(() => confirmation?.onConfirm(false));
		// 前面删过一条，剩下两条在清空时逐条删除。
		expect(actions.deleteSession).toHaveBeenCalledTimes(1 + 2);
	});

	it("Ctrl/Cmd+K 打开更多操作、Ctrl/Cmd+X 删除选中行、Esc 逐级返回", () => {
		const { model, actions } = buildPanel([session("/a.jsonl", "甲", 2), session("/b.jsonl", "乙", 1)]);
		const { result } = renderPanel(PROJECT, model);

		pressKey({ key: "k", ctrlKey: true });
		expect(result.current.step).toBe("menu");
		expect(result.current.menuItems.map((item) => item.id)).toContain("delete");

		pressKey({ key: "Escape" });
		expect(result.current.step).toBe("list");

		pressKey({ key: "x", ctrlKey: true });
		expect(actions.deleteSession).toHaveBeenCalledTimes(1);
		expect(forgetConversations).toHaveBeenCalledWith(["/a.jsonl"]);

		pressKey({ key: "Escape" });
		expect(result.current.open).toBe(false);
	});

	it("「对话」档项目有标签时列出标签页，Tab 循环切换并过滤列表、行首带标签色点", () => {
		const { model } = buildPanel([session("/a.jsonl", "甲", 2), session("/b.jsonl", "乙", 1)]);
		const { result } = renderPanel(CONVERSATION_PROJECT, model, {
			tags: [
				{ id: "t1", name: "待办", color: "#ff5f57", createdAt: 1 },
				{ id: "t2", name: "已读", color: "#32d74b", createdAt: 2 },
			],
			assignments: { "/a.jsonl": ["t1"] },
		});

		expect(result.current.tabs).toHaveLength(3);
		expect(result.current.activeTabId).toBe("all");

		pressKey({ key: "Tab" });
		expect(result.current.activeTabId).toBe("t1");
		expect(titles(result.current.rows)).toEqual(["甲"]);
		expect(result.current.rows[0]?.tagColors).toEqual(["#ff5f57"]);

		pressKey({ key: "Tab" });
		expect(result.current.activeTabId).toBe("t2");
		expect(result.current.rows).toHaveLength(0);

		pressKey({ key: "Tab", shiftKey: true });
		expect(result.current.activeTabId).toBe("t1");
	});

	it("普通项目不提供标签页：标签只属于「对话」档", () => {
		const { model } = buildPanel([session("/a.jsonl", "甲", 2)]);
		const { result } = renderPanel(PROJECT, model, {
			tags: [{ id: "t1", name: "待办", color: "#ff5f57", createdAt: 1 }],
			assignments: { "/a.jsonl": ["t1"] },
		});

		// 项目内会话没有标签维度：列出标签页只会切出一份空列表。
		expect(result.current.tabs).toEqual([]);
		expect(result.current.rows.map((row) => row.tagColors)).toEqual([undefined]);
	});
});

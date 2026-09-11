// @vitest-environment jsdom
import { defaultConversationFilterAtom, tagConversationFilter } from "@shared/store/atoms";
import { renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 交互合同：标签档下点「新会话」不能把侧栏踢回「对话」。新会话会继承当前标签
 * （applyActiveTagFilterToNewConversation），档位一跳用户反而丢了自己选的视图。
 */

const navigateSpy = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateSpy,
	useMatches: () => [{ pathname: "/", params: {} }],
}));

vi.mock("@domains/batch-tasks/hooks/useBatchTasks", () => ({
	useBatchTasks: () => ({ deleteTask: vi.fn(), deleteProject: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh" } }),
}));

vi.mock("../../../../hooks/useProjects", () => ({
	useProjects: () => ({
		projects: [],
		projectsInitialized: true,
		sessionsMap: new Map(),
		sessionLoadingCwds: new Set<string>(),
		expandedProjects: new Set<string>(),
		expandProject: vi.fn(),
		collapseProject: vi.fn(),
		deleteSession: vi.fn(),
		renameSession: vi.fn(),
		archiveProject: vi.fn(),
		removeProject: vi.fn(),
		deleteProjectFromDisk: vi.fn(),
		loadSessions: vi.fn(),
	}),
}));
vi.mock("../../../../hooks/useTeamSidebarConversations", () => ({
	useTeamSidebarConversations: () => ({ conversations: [], loading: false }),
}));

const { useProjectsPanelModel } = await import("./useProjectsPanelModel.js");

describe("useProjectsPanelModel.defaultNewSession", () => {
	beforeEach(() => {
		navigateSpy.mockClear();
		getDefaultStore().set(defaultConversationFilterAtom, "conversation");
	});

	it("标签档下新建会话保持当前标签筛选", () => {
		const store = getDefaultStore();
		store.set(defaultConversationFilterAtom, tagConversationFilter("t1"));
		const { result } = renderHook(() =>
			useProjectsPanelModel({ filter: "all", onOpenSession: vi.fn() }),
		);

		result.current.actions.defaultNewSession("/repo/a");

		expect(store.get(defaultConversationFilterAtom)).toBe(tagConversationFilter("t1"));
		expect(navigateSpy).toHaveBeenCalledWith({
			to: "/new-session/$cwd",
			params: { cwd: encodeURIComponent("/repo/a") },
		});
	});
});

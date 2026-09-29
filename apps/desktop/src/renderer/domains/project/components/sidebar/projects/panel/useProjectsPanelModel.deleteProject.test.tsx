// @vitest-environment jsdom
import { confirmDialogAtom, type Project } from "@shared/store/atoms";
import { act, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const removeProject = vi.fn(async () => {});

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useMatches: () => [{ pathname: "/", params: {} }],
}));

vi.mock("@domains/batch-tasks/hooks/useBatchTasks", () => ({
	useBatchTasks: () => ({ deleteTask: vi.fn(), deleteProject: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh" } }),
}));

const project: Project = {
	cwd: "C:/work/existing-project",
	name: "existing-project",
	sessionCount: 0,
	type: "normal",
};

vi.mock("../../../../hooks/useProjects", () => ({
	useProjects: () => ({
		projects: [project],
		projectsInitialized: true,
		sessionsMap: new Map(),
		sessionLoadingCwds: new Set<string>(),
		expandedProjects: new Set<string>(),
		expandProject: vi.fn(),
		collapseProject: vi.fn(),
		deleteSession: vi.fn(),
		renameSession: vi.fn(),
		archiveProject: vi.fn(),
		removeProject,
		loadSessions: vi.fn(),
		removePinnedSessions: vi.fn(),
	}),
}));

vi.mock("../../../../hooks/useTeamSidebarConversations", () => ({
	useTeamSidebarConversations: () => ({ conversations: [], loading: false }),
}));

const { useProjectsPanelModel } = await import("./useProjectsPanelModel.js");

describe("useProjectsPanelModel.removeProject", () => {
	beforeEach(() => {
		removeProject.mockClear();
		getDefaultStore().set(confirmDialogAtom, null);
	});

	it("确认删除项目后只从列表移除，不删除磁盘目录", async () => {
		const store = getDefaultStore();
		const { result } = renderHook(() =>
			useProjectsPanelModel({ filter: "all", onOpenSession: vi.fn(async () => {}) }),
		);

		act(() => result.current.actions.removeProject(project.cwd));

		const confirmation = store.get(confirmDialogAtom);
		expect(confirmation).toMatchObject({
			title: "sidebar.dialogs.removeTitle",
			message: "sidebar.dialogs.removeMessage",
			confirmLabel: "sidebar.dialogs.removeConfirm",
		});
		expect(removeProject).not.toHaveBeenCalled();

		await act(async () => {
			await confirmation?.onConfirm(false);
		});

		expect(removeProject).toHaveBeenCalledWith(project.cwd);
	});
});

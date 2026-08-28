// @vitest-environment jsdom
import type { SessionInfo } from "@shared/store/atoms";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 性能合同：selectSession（openSessionByTarget）的身份必须在 sessionsMap 换引用后
 * 保持稳定。它被传进每个 memo 的 ProjectGroup；任何一次 listSessions 回填都会换
 * Map 引用，若回调跟着换身份，所有项目组的 memo 会被整排击穿。
 * 同时点击时必须读到最新的 sessionsMap（不能因为身份稳定而闭包住旧值）。
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

const useProjectsMock = vi.fn();
vi.mock("../../../../hooks/useProjects", () => ({
	useProjects: () => useProjectsMock(),
}));

const { useProjectsPanelModel } = await import("./useProjectsPanelModel.js");

function makeSession(path: string, cwd: string): SessionInfo {
	return {
		id: path,
		path,
		cwd,
		firstMessage: "hi",
		modifiedAt: 1,
		access: { readHistory: true, resume: true, rename: true, delete: true },
	} as SessionInfo;
}

function projectsState(sessionsMap: Map<string, SessionInfo[]>) {
	return {
		projects: [],
		projectsInitialized: true,
		sessionsMap,
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
	};
}

describe("useProjectsPanelModel.selectSession", () => {
	beforeEach(() => {
		navigateSpy.mockClear();
		useProjectsMock.mockReset();
	});

	it("sessionsMap 换引用后 selectSession 身份不变", () => {
		const cwd = "/repo/a";
		useProjectsMock.mockReturnValue(projectsState(new Map([[cwd, [makeSession("s1", cwd)]]])));
		const onOpenSession = vi.fn().mockResolvedValue(undefined);
		const { result, rerender } = renderHook(() =>
			useProjectsPanelModel({ filter: "all", onOpenSession }),
		);
		const first = result.current.actions.selectSession;

		useProjectsMock.mockReturnValue(
			projectsState(new Map([[cwd, [makeSession("s1", cwd), makeSession("s2", cwd)]]])),
		);
		rerender();

		expect(result.current.actions.selectSession).toBe(first);
	});

	it("身份稳定的同时读取的是最新 sessionsMap", () => {
		const cwd = "/repo/a";
		useProjectsMock.mockReturnValue(projectsState(new Map([[cwd, [makeSession("s1", cwd)]]])));
		const onOpenSession = vi.fn().mockResolvedValue(undefined);
		const { result, rerender } = renderHook(() =>
			useProjectsPanelModel({ filter: "all", onOpenSession }),
		);
		const select = result.current.actions.selectSession;

		// 新回填的列表里 s2 只允许只读查看：应走 viewer 而不是交互式打开。
		const readOnly = makeSession("s2", cwd);
		(readOnly as { access: SessionInfo["access"] }).access = {
			readHistory: true,
			resume: false,
			rename: false,
			delete: false,
		};
		useProjectsMock.mockReturnValue(projectsState(new Map([[cwd, [makeSession("s1", cwd), readOnly]]])));
		rerender();

		select(cwd, "s2");
		expect(onOpenSession).not.toHaveBeenCalled();
		expect(navigateSpy).toHaveBeenCalledWith({
			to: "/viewer/$path",
			params: { path: encodeURIComponent("s2") },
		});

		select(cwd, "s1");
		expect(onOpenSession).toHaveBeenCalledWith(cwd, "s1");
	});
});

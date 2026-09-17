// @vitest-environment jsdom
import { activeSessionAtom, pendingSessionOpenAtom, type SessionInfo } from "@shared/store/atoms";
import { act, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 性能合同：selectSession（openSessionByTarget）的身份必须在 sessionsMap 换引用后
 * 保持稳定。它被传进每个 memo 的 ProjectGroup；任何一次 listSessions 回填都会换
 * Map 引用，若回调跟着换身份，所有项目组的 memo 会被整排击穿。
 * 同时点击时必须读到最新的 sessionsMap（不能因为身份稳定而闭包住旧值）。
 */

const navigateSpy = vi.fn();
const waitForCommittedPaintSpy = vi.fn();
let routeMatches: Array<{ pathname: string; params: Record<string, string> }> = [{ pathname: "/", params: {} }];
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateSpy,
	useMatches: () => routeMatches,
}));

vi.mock("@shared/lib/committed-paint", () => ({
	waitForCommittedPaint: (options?: unknown) => waitForCommittedPaintSpy(options),
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
vi.mock("../../../../hooks/useTeamSidebarConversations", () => ({
	useTeamSidebarConversations: () => ({ conversations: [], loading: false }),
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

describe("useProjectsPanelModel.selectSession", () => {
	beforeEach(() => {
		navigateSpy.mockClear();
		navigateSpy.mockResolvedValue(undefined);
		waitForCommittedPaintSpy.mockReset();
		waitForCommittedPaintSpy.mockResolvedValue("painted");
		routeMatches = [{ pathname: "/", params: {} }];
		useProjectsMock.mockReset();
		getDefaultStore().set(activeSessionAtom, null);
		getDefaultStore().set(pendingSessionOpenAtom, null);
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

	it("身份稳定的同时读取的是最新 sessionsMap", async () => {
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

		await act(async () => {
			select(cwd, { ...readOnly, kind: "conversation" });
			await Promise.resolve();
		});
		expect(onOpenSession).not.toHaveBeenCalled();
		expect(navigateSpy).toHaveBeenCalledWith({
			to: "/viewer/$path",
			params: { path: encodeURIComponent("s2") },
		});

		await act(async () => {
			select(cwd, { ...makeSession("s1", cwd), kind: "conversation" });
			await Promise.resolve();
		});
		expect(onOpenSession).toHaveBeenCalledWith(cwd, "s1");
	});

	it("Team 会话直接进入 Team 路由，不走普通会话恢复", async () => {
		const cwd = "/repo/a";
		const paint = deferred<"painted">();
		waitForCommittedPaintSpy.mockReturnValueOnce(paint.promise);
		useProjectsMock.mockReturnValue(projectsState(new Map()));
		const onOpenSession = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() => useProjectsPanelModel({ filter: "all", onOpenSession }));

		act(() => {
			result.current.actions.selectSession(cwd, {
				kind: "agent-team",
				id: "team-session-1",
				path: "/team/session.jsonl",
				cwd: "/team/workspace",
				firstMessage: "Ship it",
				modifiedAt: 1,
				teamId: "team-1",
				teamSessionId: "team-session-1",
				memberAvatarUrls: ["/master.webp", "/executor.webp"],
				sessionTitle: "Ship it",
			});
		});

		expect(result.current.activeTeamSessionId).toBe("team-session-1");
		expect(result.current.activeSessionPath).toBe("");
		expect(onOpenSession).not.toHaveBeenCalled();
		expect(navigateSpy).not.toHaveBeenCalled();

		await act(async () => {
			paint.resolve("painted");
			await paint.promise;
			await Promise.resolve();
		});

		expect(navigateSpy).toHaveBeenCalledWith({
			to: "/agent-teams/$teamId/sessions/$sessionId",
			params: { teamId: "team-1", sessionId: "team-session-1" },
		});
	});

	it("点击普通会话时先切换高亮，首帧绘制后才开始恢复内容", async () => {
		const cwd = "/repo/a";
		const target = makeSession("s1", cwd);
		const paint = deferred<"painted">();
		const opened = deferred<void>();
		waitForCommittedPaintSpy.mockReturnValueOnce(paint.promise);
		routeMatches = [
			{
				pathname: "/agent-teams/team-old/sessions/team-session-old",
				params: { sessionId: "team-session-old" },
			},
		];
		useProjectsMock.mockReturnValue(projectsState(new Map([[cwd, [target]]])));
		const onOpenSession = vi.fn().mockReturnValue(opened.promise);
		const { result } = renderHook(() => useProjectsPanelModel({ filter: "all", onOpenSession }));

		act(() => {
			result.current.actions.selectSession(cwd, { ...target, kind: "conversation" });
		});

		expect(result.current.activeSessionPath).toBe("s1");
		expect(result.current.activeTeamSessionId).toBe("");
		expect(waitForCommittedPaintSpy).toHaveBeenCalledWith({ timeoutMs: null });
		expect(onOpenSession).not.toHaveBeenCalled();

		await act(async () => {
			paint.resolve("painted");
			await paint.promise;
			await Promise.resolve();
		});

		expect(onOpenSession).toHaveBeenCalledWith(cwd, "s1");
		// `openSession` may spend time before its canonical pending/active state reaches
		// this tree. The click-owned selection must not be released in that gap.
		expect(result.current.activeSessionPath).toBe("s1");
		expect(result.current.activeTeamSessionId).toBe("");

		await act(async () => {
			getDefaultStore().set(activeSessionAtom, { cwd, sessionPath: "s1", runtimeId: "runtime-s1" });
			opened.resolve();
			await opened.promise;
		});
		expect(result.current.activeSessionPath).toBe("s1");
	});

	it("点击下方对话区域的会话时同样立即切换高亮", async () => {
		const cwd = "/default/conversations";
		const target = makeSession("default-s1", cwd);
		const paint = deferred<"painted">();
		const opened = deferred<void>();
		waitForCommittedPaintSpy.mockReturnValueOnce(paint.promise);
		useProjectsMock.mockReturnValue(projectsState(new Map([[cwd, [target]]])));
		const onOpenSession = vi.fn().mockReturnValue(opened.promise);
		const { result } = renderHook(() => useProjectsPanelModel({ filter: "all", onOpenSession }));

		act(() => {
			result.current.actions.defaultSelectSession(cwd, { ...target, kind: "conversation" });
		});

		expect(result.current.activeSessionPath).toBe("default-s1");
		expect(onOpenSession).not.toHaveBeenCalled();

		await act(async () => {
			paint.resolve("painted");
			await paint.promise;
			await Promise.resolve();
		});

		expect(onOpenSession).toHaveBeenCalledWith(cwd, "default-s1");
		expect(result.current.activeSessionPath).toBe("default-s1");

		await act(async () => {
			getDefaultStore().set(activeSessionAtom, {
				cwd,
				sessionPath: "default-s1",
				runtimeId: "runtime-default-s1",
			});
			opened.resolve();
			await opened.promise;
		});
		expect(result.current.activeSessionPath).toBe("default-s1");
	});

	it("连续点击多个会话时只打开最后一次选择", async () => {
		const cwd = "/repo/a";
		const first = makeSession("s1", cwd);
		const second = makeSession("s2", cwd);
		const firstPaint = deferred<"painted">();
		const secondPaint = deferred<"painted">();
		waitForCommittedPaintSpy.mockReturnValueOnce(firstPaint.promise).mockReturnValueOnce(secondPaint.promise);
		useProjectsMock.mockReturnValue(projectsState(new Map([[cwd, [first, second]]])));
		const onOpenSession = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() => useProjectsPanelModel({ filter: "all", onOpenSession }));

		act(() => {
			result.current.actions.selectSession(cwd, { ...first, kind: "conversation" });
			result.current.actions.selectSession(cwd, { ...second, kind: "conversation" });
		});

		expect(result.current.activeSessionPath).toBe("s2");
		await act(async () => {
			firstPaint.resolve("painted");
			secondPaint.resolve("painted");
			await Promise.all([firstPaint.promise, secondPaint.promise]);
			await Promise.resolve();
		});

		expect(onOpenSession).toHaveBeenCalledTimes(1);
		expect(onOpenSession).toHaveBeenCalledWith(cwd, "s2");
	});
});

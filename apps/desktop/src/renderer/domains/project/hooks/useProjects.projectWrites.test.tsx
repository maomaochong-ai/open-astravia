// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectActions } from "./useProjects";

/**
 * 项目列表只有一条写路径：主进程的 ProjectService。
 *
 * 渲染进程以前是自己 `config.get()` → 改数组 → `config.set()`，与插件/Action 走的服务
 * 并行。那条路绕开了「必须是绝对路径」「必须是目录」的校验，也不发变更广播，于是同一
 * 个项目从侧边栏加和从插件加会得到不同结果，别的窗口还看不见。这里锁住重构后的不变量：
 * 侧边栏的增删改归档一律经过 `window.vetta.project.*`，且一次都不碰 `config.set`。
 */

const configSet = vi.fn(async () => {});
const project = {
	readMeta: vi.fn(async () => null),
	create: vi.fn(async ({ name }: { name: string }) => ({ path: `/workspace/${name}`, name })),
	open: vi.fn(async () => ({ path: "/picked/repo", name: "repo" })),
	archive: vi.fn(async () => {}),
	unarchive: vi.fn(async () => {}),
	remove: vi.fn(async () => {}),
};
const selectFolder = vi.fn(async () => "/picked/repo");
const fsDelete = vi.fn(async () => {});
const deleteAllForCwd = vi.fn(async () => {});

vi.stubGlobal(
	"window",
	Object.assign(globalThis.window, {
		vetta: {
			config: {
				get: async () => ({ projects: [], archivedProjects: [], defaultConversationCwd: "" }),
				set: configSet,
				onProjectsChanged: () => () => {},
			},
			project,
			dialog: { selectFolder },
			fs: { delete: fsDelete },
			session: {
				listSessions: async () => [],
				onSessionsChanged: () => () => {},
				deleteAllForCwd,
			},
			im: { onSessionChanged: () => () => {} },
		},
	}),
);

describe("侧边栏的项目写入", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("新建、打开、归档、取消归档、移除都走 ProjectService，且从不直写配置", async () => {
		const { result } = renderHook(() => useProjectActions());

		await act(async () => {
			await expect(result.current.createProject("demo")).resolves.toBe("/workspace/demo");
		});
		expect(project.create).toHaveBeenCalledWith({ name: "demo" });

		await act(async () => {
			await expect(result.current.openProject()).resolves.toBe("/picked/repo");
		});
		expect(selectFolder).toHaveBeenCalledOnce();
		expect(project.open).toHaveBeenCalledWith({ path: "/picked/repo" });

		await act(async () => {
			await result.current.archiveProject("/picked/repo");
			await result.current.unarchiveProject("/picked/repo");
			await result.current.removeProject("/picked/repo");
		});
		expect(project.archive).toHaveBeenCalledWith("/picked/repo");
		expect(project.unarchive).toHaveBeenCalledWith("/picked/repo");
		expect(project.remove).toHaveBeenCalledWith("/picked/repo");

		await waitFor(() => expect(configSet).not.toHaveBeenCalled());
	});

	it("取消选择目录时不登记任何项目", async () => {
		selectFolder.mockResolvedValueOnce("");
		const { result } = renderHook(() => useProjectActions());

		await act(async () => {
			await expect(result.current.openProject()).resolves.toBeNull();
		});

		expect(project.open).not.toHaveBeenCalled();
		expect(configSet).not.toHaveBeenCalled();
	});

	it("删除项目目录时，先清会话再摘登记，最后才动磁盘", async () => {
		const { result } = renderHook(() => useProjectActions());
		const order: string[] = [];
		deleteAllForCwd.mockImplementationOnce(async () => {
			order.push("sessions");
		});
		project.remove.mockImplementationOnce(async () => {
			order.push("unregister");
		});
		fsDelete.mockImplementationOnce(async () => {
			order.push("disk");
		});

		await act(async () => {
			await result.current.deleteProjectFromDisk("/picked/repo");
		});

		// 会话分片目录由 config.projects 推导，摘登记之后就找不到了，顺序不能反。
		expect(order).toEqual(["sessions", "unregister", "disk"]);
		expect(configSet).not.toHaveBeenCalled();
	});
});

import { describe, expect, it, vi } from "vitest";
import { prepareProjectCwd } from "./prepare-project-cwd";

function harness(overrides: Partial<Parameters<typeof prepareProjectCwd>[0]> = {}) {
	const createProject = vi.fn(async (_name: string) => "/w/created");
	const onCreated = vi.fn();
	const onPreparingChange = vi.fn();
	const onError = vi.fn();
	return {
		createProject,
		onCreated,
		onPreparingChange,
		onError,
		input: {
			selection: null,
			contextCwd: "/w/context",
			createProject,
			onCreated,
			onPreparingChange,
			onError,
			...overrides,
		} as Parameters<typeof prepareProjectCwd>[0],
	};
}

describe("prepareProjectCwd", () => {
	it("没有待创建项目时直接用当前上下文，不碰磁盘", async () => {
		const h = harness({ selection: { kind: "project", cwd: "/w/alpha", name: "Alpha" } });
		// contextCwd 已经由 resolveContextCwd 换算成选中项目的 cwd，这里原样透出即可。
		await expect(prepareProjectCwd(h.input)).resolves.toBe("/w/context");
		expect(h.createProject).not.toHaveBeenCalled();
		expect(h.onPreparingChange).not.toHaveBeenCalled();
	});

	it("待创建项目：先落盘再返回真实 cwd，并把选择换成已创建的项目", async () => {
		const h = harness({ selection: { kind: "pending-create", name: "新项目" } });

		await expect(prepareProjectCwd(h.input)).resolves.toBe("/w/created");

		expect(h.createProject).toHaveBeenCalledWith("新项目");
		expect(h.onCreated).toHaveBeenCalledWith("/w/created", "新项目");
		// 准备态先开后关，发送按钮才能在这段时间里展示「正在准备项目」。
		expect(h.onPreparingChange.mock.calls).toEqual([[true], [false]]);
		expect(h.onError).not.toHaveBeenCalled();
	});

	it("创建失败时返回 null 中止发送，把错误交给宿主展示，并释放准备态", async () => {
		const failure = new Error("disk full");
		const createProject = vi.fn(async () => {
			throw failure;
		});
		const h = harness({ selection: { kind: "pending-create", name: "新项目" }, createProject });

		await expect(prepareProjectCwd(h.input)).resolves.toBeNull();

		expect(h.onError).toHaveBeenCalledWith(failure);
		expect(h.onCreated).not.toHaveBeenCalled();
		expect(h.onPreparingChange.mock.calls).toEqual([[true], [false]]);
	});
});

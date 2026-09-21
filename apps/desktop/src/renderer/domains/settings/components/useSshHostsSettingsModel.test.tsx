// @vitest-environment jsdom
import { confirmDialogAtom } from "@shared/store/atoms";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyProbe, useSshHostsSettingsModel } from "./useSshHostsSettingsModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const ssh = {
	listHosts: vi.fn(async () => [] as unknown[]),
	createHost: vi.fn(async () => ({})),
	updateHost: vi.fn(async () => ({})),
	removeHost: vi.fn(async () => {}),
	listConfigAliases: vi.fn(async () => [] as string[]),
	importFromConfig: vi.fn(async () => [] as unknown[]),
	testHost: vi.fn(async () => ({})),
	onHostsChanged: vi.fn(() => () => {}),
	onHostStatusChanged: vi.fn(() => () => {}),
};

vi.stubGlobal("window", Object.assign(globalThis.window, { vetta: { ssh } }));

const host = { id: "h1", label: "构建机", target: "build-01", source: "manual" as const, status: "disconnected" as const };

function renderModel(store = createStore()) {
	const wrapper = ({ children }: PropsWithChildren): JSX.Element => <Provider store={store}>{children}</Provider>;
	return { store, ...renderHook(() => useSshHostsSettingsModel(), { wrapper }) };
}

describe("SSH 主机设置", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ssh.listHosts.mockResolvedValue([]);
	});

	it("新增主机：填目标即可保存，名称留空时沿用目标", async () => {
		const { result } = renderModel();
		await waitFor(() => expect(result.current.loading).toBe(false));

		act(() => result.current.actions.startAdd());
		act(() => result.current.actions.setForm({ target: "build-01" }));
		await act(async () => {
			await result.current.actions.submit();
		});

		expect(ssh.createHost).toHaveBeenCalledWith({ label: "build-01", target: "build-01" });
		// 保存成功后表单收起。
		expect(result.current.editingId).toBeNull();
	});

	it("保存失败时表单保持打开并保留已填内容，错误就地显示", async () => {
		// 让用户在原地改，而不是把输入清掉让他重填一遍。
		ssh.createHost.mockRejectedValueOnce(new Error("An SSH host for \"build-01\" already exists."));
		const { result } = renderModel();
		await waitFor(() => expect(result.current.loading).toBe(false));

		act(() => result.current.actions.startAdd());
		act(() => result.current.actions.setForm({ target: "build-01", label: "我的构建机" }));
		await act(async () => {
			await result.current.actions.submit();
		});

		expect(result.current.editingId).toBe("new");
		expect(result.current.form.label).toBe("我的构建机");
		expect(result.current.formError).toContain("already exists");
	});

	it("用户重新输入时清掉上一次的错误", async () => {
		ssh.createHost.mockRejectedValueOnce(new Error("boom"));
		const { result } = renderModel();
		await waitFor(() => expect(result.current.loading).toBe(false));

		act(() => result.current.actions.startAdd());
		act(() => result.current.actions.setForm({ target: "x" }));
		await act(async () => {
			await result.current.actions.submit();
		});
		expect(result.current.formError).not.toBeNull();

		act(() => result.current.actions.setForm({ target: "y" }));
		expect(result.current.formError).toBeNull();
	});

	it("测试连接按行记录进行中状态，结果留在该行", async () => {
		ssh.listHosts.mockResolvedValue([host]);
		ssh.testHost.mockResolvedValueOnce({
			ok: true,
			os: "Linux",
			arch: "x86_64",
			shell: "/bin/bash",
			homeDirectory: "/root",
			hasGit: true,
			hasRipgrep: true,
			error: "",
		});
		const { result } = renderModel();
		await waitFor(() => expect(result.current.hosts).toHaveLength(1));

		await act(async () => {
			await result.current.actions.test(host);
		});

		expect(result.current.testingId).toBeNull();
		expect(result.current.rowMessage.h1?.tone).toBe("success");
	});

	it("删除主机先弹确认，用户确认后才真的删", async () => {
		ssh.listHosts.mockResolvedValue([host]);
		const { result, store } = renderModel();
		await waitFor(() => expect(result.current.hosts).toHaveLength(1));

		act(() => result.current.actions.remove(host));

		const confirmation = store.get(confirmDialogAtom);
		expect(ssh.removeHost).not.toHaveBeenCalled();
		expect(confirmation).toMatchObject({ variant: "danger" });

		await act(async () => {
			confirmation?.onConfirm(false);
		});
		expect(ssh.removeHost).toHaveBeenCalledWith("h1");
	});

	it("主机仍被项目引用而删不掉时，把原因显示在该行", async () => {
		// 静默失败会让用户以为删掉了，实际列表没变。
		ssh.listHosts.mockResolvedValue([host]);
		ssh.removeHost.mockRejectedValueOnce(new Error("SSH host h1 still has 2 project(s)."));
		const { result, store } = renderModel();
		await waitFor(() => expect(result.current.hosts).toHaveLength(1));

		act(() => result.current.actions.remove(host));
		await act(async () => {
			store.get(confirmDialogAtom)?.onConfirm(false);
		});

		await waitFor(() => expect(result.current.rowMessage.h1?.text).toContain("still has 2 project"));
	});
});

describe("连接探测结果分类", () => {
	const base = { ok: true, os: "Linux", arch: "x86_64", shell: "/bin/bash", homeDirectory: "/root", error: "" };

	it("失败时带回原始报错，供二级披露展示", () => {
		expect(classifyProbe({ ...base, ok: false, hasGit: false, hasRipgrep: false, error: "Connection refused" })).toEqual(
			{ kind: "failed", details: "Connection refused" },
		);
	});

	it("连上且工具齐全", () => {
		expect(classifyProbe({ ...base, hasGit: true, hasRipgrep: true })).toEqual({
			kind: "ok",
			platform: "Linux x86_64",
		});
	});

	it("连上但缺工具，单独成一类而不是报成失败", () => {
		// 远端没有 git 时项目照样能建、文件照样能读写；报成失败会让用户去查一台好机器。
		expect(classifyProbe({ ...base, hasGit: false, hasRipgrep: true })).toEqual({
			kind: "ok-missing-tools",
			platform: "Linux x86_64",
			tools: "git",
		});
	});
});

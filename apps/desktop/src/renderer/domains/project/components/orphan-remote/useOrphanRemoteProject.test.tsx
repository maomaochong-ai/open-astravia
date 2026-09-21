// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOrphanRemoteProject } from "./useOrphanRemoteProject";

let hostsChanged: (() => void) | undefined;
const ssh = {
	listHosts: vi.fn(async () => [] as unknown[]),
	rebindHost: vi.fn(async (): Promise<unknown> => ({ ok: true })),
	onHostsChanged: vi.fn((listener: () => void) => {
		hostsChanged = listener;
		return () => {};
	}),
};
vi.stubGlobal("window", Object.assign(globalThis.window, { vetta: { ssh } }));

const ORPHAN = "0ba4cedd-406f-43d2-addf-422e5b38f125";
const CWD = `ssh://${ORPHAN}/home/deploy/backups`;
const relay = { id: "f0aaee6d-dd22-48ad-82c1-983566140878", label: "relay", target: "relay", source: "ssh-config" };
const ubuntu = { id: "a1f4b467-d2a4-48ad-bec7-efb8e47d960f", label: "ubuntu", target: "admin@x", source: "manual" };

describe("孤儿远程项目判定", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hostsChanged = undefined;
	});

	it("本地项目不判定，也不去问主机列表", () => {
		const { result } = renderHook(() => useOrphanRemoteProject("/Users/me/app"));
		expect(result.current).toBeNull();
		expect(ssh.listHosts).not.toHaveBeenCalled();
	});

	it("主机列表还没读到时不判定为孤儿，否则每个远程项目打开瞬间都会闪一下", () => {
		ssh.listHosts.mockReturnValueOnce(new Promise(() => {}));
		const { result } = renderHook(() => useOrphanRemoteProject(CWD));
		expect(result.current).toBeNull();
	});

	it("主机还在就不是孤儿", async () => {
		ssh.listHosts.mockResolvedValue([{ ...relay, id: ORPHAN }]);
		const { result } = renderHook(() => useOrphanRemoteProject(CWD));
		await waitFor(() => expect(ssh.listHosts).toHaveBeenCalled());
		await act(async () => {});
		expect(result.current).toBeNull();
	});

	it("主机不在列表里：给出远端路径与候选主机，重新绑定后随主机变更事件消失", async () => {
		ssh.listHosts.mockResolvedValue([relay, ubuntu]);
		const { result } = renderHook(() => useOrphanRemoteProject(CWD));
		await waitFor(() => expect(result.current).not.toBeNull());
		expect(result.current).toMatchObject({ orphanId: ORPHAN, remotePath: "/home/deploy/backups", selectedHostId: null });

		act(() => result.current?.select(relay.id));
		await act(async () => {
			await result.current?.rebind();
		});
		expect(ssh.rebindHost).toHaveBeenCalledWith({ hostId: relay.id, orphanId: ORPHAN });

		ssh.listHosts.mockResolvedValue([{ ...relay, id: ORPHAN }, ubuntu]);
		await act(async () => hostsChanged?.());
		await waitFor(() => expect(result.current).toBeNull());
	});

	it("只有一台主机时替用户选好", async () => {
		ssh.listHosts.mockResolvedValue([relay]);
		const { result } = renderHook(() => useOrphanRemoteProject(CWD));
		await waitFor(() => expect(result.current?.selectedHostId).toBe(relay.id));
	});

	it("选中的主机自己有项目时，把拒绝原因带回来而不是笼统报错", async () => {
		ssh.listHosts.mockResolvedValue([relay, ubuntu]);
		ssh.rebindHost.mockResolvedValueOnce({ ok: false, reason: "host-in-use", projectCount: 2 });
		const { result } = renderHook(() => useOrphanRemoteProject(CWD));
		await waitFor(() => expect(result.current).not.toBeNull());

		act(() => result.current?.select(ubuntu.id));
		await act(async () => {
			await result.current?.rebind();
		});
		expect(result.current?.error).toEqual({ kind: "host-in-use", projectCount: 2 });

		// 换一台就清掉旧错误，别让上一台的拒绝原因挂在新选择下面。
		act(() => result.current?.select(relay.id));
		expect(result.current?.error).toBeNull();
	});
});

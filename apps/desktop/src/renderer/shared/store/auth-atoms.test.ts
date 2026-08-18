// @vitest-environment jsdom

import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	logoutOnServer: vi.fn(async (_refresh?: string) => undefined),
}));

const sse = vi.hoisted(() => ({
	disconnect: vi.fn(),
	connect: vi.fn(),
	onStateChange: vi.fn(() => () => undefined),
}));

vi.mock("@shared/lib/api", () => ({
	logoutOnServer: api.logoutOnServer,
}));

vi.mock("@shared/lib/sse-client", () => ({
	createSSEClient: () => sse,
}));

import { authTokenAtom, authUserAtom, cloudLogoutAtom, remoteProvidersAtom } from "./auth-atoms";

describe("cloudLogoutAtom", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				settings: {
					getServerRefreshToken: vi.fn(async () => "stored-refresh"),
					setServerRefreshToken: vi.fn(async () => undefined),
					setServerToken: vi.fn(async () => undefined),
				},
			},
		});
	});

	it("清空登录态、通知服务端并断开 SSE，但不触碰与本地会话相关的状态", async () => {
		const store = createStore();
		store.set(authTokenAtom, "access-token");
		store.set(authUserAtom, {
			id: 1,
			username: "u",
			nickname: "n",
			avatar: "",
		});
		store.set(remoteProvidersAtom, { vetta: {} });

		store.set(cloudLogoutAtom);

		expect(store.get(authTokenAtom)).toBeNull();
		expect(store.get(authUserAtom)).toBeNull();
		expect(store.get(remoteProvidersAtom)).toEqual({});
		expect(sse.disconnect).toHaveBeenCalledOnce();
		expect(window.vetta.settings.setServerToken).toHaveBeenCalledWith(undefined);

		// 服务端登出走"读出存量 refresh → 上报 → 清除"的异步链
		await vi.waitFor(() => {
			expect(api.logoutOnServer).toHaveBeenCalledWith("stored-refresh");
			expect(window.vetta.settings.setServerRefreshToken).toHaveBeenCalledWith(undefined);
		});
	});

	it("服务端登出失败时仍然清除本地 refresh token", async () => {
		api.logoutOnServer.mockRejectedValueOnce(new Error("network down"));
		const store = createStore();
		store.set(authTokenAtom, "access-token");

		store.set(cloudLogoutAtom);

		await vi.waitFor(() => {
			expect(window.vetta.settings.setServerRefreshToken).toHaveBeenCalledWith(undefined);
		});
		expect(store.get(authTokenAtom)).toBeNull();
	});
});

// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAbility } from "../types";
import { useMcpSetupLoginModel } from "./useMcpSetupLoginModel";

const QR = "data:image/png;base64,iVBORw0KGgo=";

function ability(): McpAbility {
	return {
		type: "mcp",
		id: "github:official:mcp:demo-mcp",
		slug: "demo-mcp",
		serverName: "demo-mcp",
		title: "Demo",
		catalogSource: { kind: "github", id: "official", name: "official" },
		postInstallSetup: { kind: "agent-tool", tool: "get_login_qrcode" },
	} as unknown as McpAbility;
}

function stubVetta(overrides?: {
	start?: () => Promise<{ image: string; expiresInSeconds: number }>;
	status?: () => Promise<Record<string, boolean>>;
}) {
	const cancelSetupLogin = vi.fn(async () => undefined);
	const startSetupLogin = vi.fn(overrides?.start ?? (async () => ({ image: QR, expiresInSeconds: 60 })));
	const getOpenMcpSetupStatus = vi.fn(overrides?.status ?? (async () => ({})));
	(window as unknown as { vetta: unknown }).vetta = {
		mcp: { startSetupLogin, cancelSetupLogin },
		abilities: { getOpenMcpSetupStatus },
	};
	return { startSetupLogin, cancelSetupLogin, getOpenMcpSetupStatus };
}

describe("useMcpSetupLoginModel", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("显示二维码，并在完成标志出现后收尾", async () => {
		let completed = false;
		const stub = stubVetta({
			status: async (): Promise<Record<string, boolean>> => (completed ? { "official:demo-mcp": true } : {}),
		});
		const onCompleted = vi.fn();
		const { result } = renderHook(() => useMcpSetupLoginModel({ item: ability(), onCompleted }));

		await waitFor(() => expect(result.current.phase).toBe("scanning"));
		expect(result.current.image).toBe(QR);
		expect(stub.startSetupLogin).toHaveBeenCalledWith("demo-mcp", "get_login_qrcode");

		completed = true;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		await waitFor(() => expect(result.current.phase).toBe("completed"));
		expect(onCompleted).toHaveBeenCalledTimes(1);
	});

	it("二维码到期后停止轮询并可重新获取", async () => {
		const stub = stubVetta();
		const { result } = renderHook(() => useMcpSetupLoginModel({ item: ability(), onCompleted: () => {} }));
		await waitFor(() => expect(result.current.phase).toBe("scanning"));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(60_000);
		});
		expect(result.current.phase).toBe("expired");
		const pollsAtExpiry = stub.getOpenMcpSetupStatus.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(stub.getOpenMcpSetupStatus.mock.calls.length).toBe(pollsAtExpiry);

		act(() => result.current.retry());
		await waitFor(() => expect(result.current.phase).toBe("scanning"));
		expect(stub.startSetupLogin).toHaveBeenCalledTimes(2);
	});

	it("取码失败时给出原因，卸载时收掉连接", async () => {
		const stub = stubVetta({
			start: async () => {
				throw new Error("spawn failed");
			},
		});
		const { result, unmount } = renderHook(() => useMcpSetupLoginModel({ item: ability(), onCompleted: () => {} }));

		await waitFor(() => expect(result.current.phase).toBe("failed"));
		expect(result.current.error).toMatch(/spawn failed/);

		unmount();
		expect(stub.cancelSetupLogin).toHaveBeenCalled();
	});
});

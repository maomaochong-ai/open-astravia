// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { McpAbility } from "../types";
import { useMcpSetupStatusModel } from "./useMcpSetupStatusModel";

const item = {
	type: "mcp",
	installed: true,
	serverName: "xiaohongshu-mcp",
	postInstallSetup: { kind: "http-qrcode" },
} as McpAbility;

describe("useMcpSetupStatusModel", () => {
	it("shows checking first and refreshes the ability after the upstream answer", async () => {
		let resolveStatus: ((value: { state: "authenticated"; username: string }) => void) | undefined;
		const getSetupLoginStatus = vi.fn(
			() =>
				new Promise<{ state: "authenticated"; username: string }>((resolve) => {
					resolveStatus = resolve;
				}),
		);
		(window as unknown as { vetta: unknown }).vetta = { mcp: { getSetupLoginStatus } };
		const refresh = vi.fn();
		const { result } = renderHook(() => useMcpSetupStatusModel(item, refresh));

		expect(result.current?.phase).toBe("checking");
		resolveStatus?.({ state: "authenticated", username: "小明" });
		await waitFor(() => expect(result.current).toMatchObject({ phase: "authenticated", username: "小明" }));
		expect(refresh).toHaveBeenCalledOnce();
	});

	it("keeps a recoverable failed state", async () => {
		const getSetupLoginStatus = vi.fn(async () => {
			throw new Error("browser unavailable");
		});
		(window as unknown as { vetta: unknown }).vetta = { mcp: { getSetupLoginStatus } };
		const { result } = renderHook(() => useMcpSetupStatusModel(item, vi.fn()));

		await waitFor(() => expect(result.current).toMatchObject({ phase: "failed", error: "browser unavailable" }));
	});
});

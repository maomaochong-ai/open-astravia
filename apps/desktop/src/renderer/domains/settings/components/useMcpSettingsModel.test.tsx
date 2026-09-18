// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BuiltinMcpPreset } from "../mcp/builtin-mcp-presets";
import { useMcpSettingsModel } from "./useMcpSettingsModel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function installMcpWindow(get = vi.fn(async () => ({ mcpServers: {} }))) {
	const set = vi.fn(async () => undefined);
	(window as unknown as { vetta: unknown }).vetta = {
		mcp: {
			get,
			set,
			authStatus: vi.fn(async () => ({})),
		},
	};
	return { get, set };
}

describe("useMcpSettingsModel managed runtime parameters", () => {
	it("preserves the managed connection identity and writes parameters to runtime env", async () => {
		const set = vi.fn(async () => undefined);
		(window as unknown as { vetta: unknown }).vetta = {
			mcp: {
				get: vi.fn(async () => ({
					mcpServers: {
						xiaohongshu: {
							type: "http",
							url: "http://127.0.0.1/mcp",
							managedRuntimeId: "xhs-runtime",
							disabled: false,
						},
					},
				})),
				set,
				authStatus: vi.fn(async () => ({})),
			},
		};
		const preset: BuiltinMcpPreset = {
			id: "xiaohongshu",
			name: "xiaohongshu",
			displayName: "Xiaohongshu",
			description: "",
			config: { type: "http", url: "${VETTA_MCP_URL}" },
			secrets: [{ envKey: "XHS_PROXY", required: false, secret: false }],
		};
		const { result } = renderHook(() => useMcpSettingsModel());
		await waitFor(() => expect(result.current.config).not.toBeNull());

		await act(async () => {
			await result.current.onSaveBuiltinParameters("xiaohongshu", preset, {
				XHS_PROXY: "socks5://127.0.0.1:7890",
			});
		});

		expect(set).toHaveBeenCalledWith({
			mcpServers: {
				xiaohongshu: {
					type: "http",
					url: "http://127.0.0.1/mcp",
					managedRuntimeId: "xhs-runtime",
					managedRuntimeEnv: { XHS_PROXY: "socks5://127.0.0.1:7890" },
					disabled: false,
				},
			},
		});
	});
});

describe("useMcpSettingsModel keep-alive reveal", () => {
	it("does not call mcp.get again when Activity restores an already loaded config", async () => {
		const { get } = installMcpWindow();
		const hidden = { current: false };
		const { result, rerender } = renderHook(() => useMcpSettingsModel(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<Activity mode={hidden.current ? "hidden" : "visible"}>{children}</Activity>
			),
		});
		await waitFor(() => expect(result.current.config).not.toBeNull());
		expect(get).toHaveBeenCalledTimes(1);

		act(() => {
			hidden.current = true;
			rerender();
		});
		act(() => {
			hidden.current = false;
			rerender();
		});

		expect(get).toHaveBeenCalledTimes(1);
		expect(result.current.config).toEqual({ mcpServers: {} });
	});
});

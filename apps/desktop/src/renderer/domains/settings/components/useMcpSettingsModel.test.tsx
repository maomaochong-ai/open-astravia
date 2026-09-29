// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BuiltinMcpPreset } from "../mcp/builtin-mcp-presets";
import { useMcpSettingsModel } from "./useMcpSettingsModel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("useMcpSettingsModel", () => {
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

	it("merges servers pasted as standard MCP JSON without removing existing connectors", async () => {
		const set = vi.fn(async () => undefined);
		(window as unknown as { vetta: unknown }).vetta = {
			mcp: {
				get: vi.fn(async () => ({
					mcpServers: {
						existing: { command: "existing-command" },
					},
				})),
				set,
				authStatus: vi.fn(async () => ({})),
			},
		};
		const { result } = renderHook(() => useMcpSettingsModel());
		await waitFor(() => expect(result.current.config).not.toBeNull());

		act(() => {
			result.current.onStartAddServer();
			result.current.onModeSwitch("json");
			result.current.setJsonText(
				JSON.stringify({
					mcpServers: {
						playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
					},
				}),
			);
		});

		let added = false;
		await act(async () => {
			added = await result.current.onAddServersFromJson();
		});

		expect(added).toBe(true);
		expect(set).toHaveBeenCalledWith({
			mcpServers: {
				existing: { command: "existing-command" },
				playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
			},
		});
		expect(result.current.addingServer).toBe(false);
	});

	it("keeps the add dialog open and reports invalid MCP JSON", async () => {
		const set = vi.fn(async () => undefined);
		(window as unknown as { vetta: unknown }).vetta = {
			mcp: {
				get: vi.fn(async () => ({ mcpServers: {} })),
				set,
				authStatus: vi.fn(async () => ({})),
			},
		};
		const { result } = renderHook(() => useMcpSettingsModel());
		await waitFor(() => expect(result.current.config).not.toBeNull());

		act(() => {
			result.current.onStartAddServer();
			result.current.onModeSwitch("json");
			result.current.setJsonText('{ "mcpServers": { "broken": { "args": [] } } }');
		});

		let added = true;
		await act(async () => {
			added = await result.current.onAddServersFromJson();
		});

		expect(added).toBe(false);
		expect(result.current.jsonError).toBe("jsonMissingCommand");
		expect(result.current.addingServer).toBe(true);
		expect(set).not.toHaveBeenCalled();
	});
});

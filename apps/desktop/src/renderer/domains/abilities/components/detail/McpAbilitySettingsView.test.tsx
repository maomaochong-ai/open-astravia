// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BuiltinMcpPreset } from "../../../settings/mcp/builtin-mcp-presets";
import type { AbilitiesModel, McpAbility } from "../../types";
import { McpAbilitySettingsView } from "./McpAbilitySettingsView";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		i18n: { language: "zh" },
		t: (key: string, values?: Record<string, string>) => {
			const labels: Record<string, string> = {
				"mcp.settings.save": "保存连接设置",
				"mcp.settings.clearLogin": "清除登录状态",
				"mcp.settings.confirmClearLogin": "确认清除登录状态",
				"mcp.loginAuthenticatedAs": `已登录：${values?.username ?? ""}`,
			};
			return labels[key] ?? key;
		},
	}),
}));

const preset: BuiltinMcpPreset = {
	id: "xiaohongshu-mcp",
	name: "xiaohongshu-mcp",
	displayName: "小红书",
	description: "",
	config: { type: "http", url: "http://127.0.0.1/mcp", managedRuntimeId: "xhs-runtime" },
	secrets: [
		{
			envKey: "XHS_PROXY",
			label: "Proxy URL",
			required: false,
			secret: false,
			placeholder: "http://127.0.0.1:7890",
		},
	],
};

const item = {
	type: "mcp",
	id: "github:official:mcp:xiaohongshu-mcp",
	title: "小红书",
	installed: true,
	serverName: "xiaohongshu-mcp",
	postInstallSetup: { kind: "http-qrcode" },
	preset,
} as McpAbility;

describe("McpAbilitySettingsView", () => {
	it("edits managed runtime parameters and clears login through the upstream contract", async () => {
		const onSaveBuiltinParameters = vi.fn(async () => undefined);
		const getSetupLoginStatus = vi.fn(async () => ({ state: "authenticated" as const, username: "小明" }));
		const clearSetupLogin = vi.fn(async () => ({ state: "unauthenticated" as const }));
		(window as unknown as { vetta: unknown }).vetta = { mcp: { getSetupLoginStatus, clearSetupLogin } };
		const model = {
			mcp: {
				config: {
					mcpServers: {
						"xiaohongshu-mcp": {
							type: "http",
							url: "http://127.0.0.1/mcp",
							managedRuntimeId: "xhs-runtime",
							managedRuntimeEnv: { XHS_PROXY: "http://127.0.0.1:1080" },
						},
					},
				},
				onSaveBuiltinParameters,
			},
			setupPromptId: null,
			refresh: vi.fn(),
			setup: vi.fn(),
		} as unknown as AbilitiesModel;

		render(<McpAbilitySettingsView item={item} model={model} onBack={vi.fn()} />);
		const proxy = screen.getByPlaceholderText("http://127.0.0.1:7890");
		expect((proxy as HTMLInputElement).value).toBe("http://127.0.0.1:1080");
		fireEvent.change(proxy, { target: { value: "socks5://127.0.0.1:7890" } });
		fireEvent.click(screen.getByRole("button", { name: /保存连接设置|Save connection settings/ }));
		await waitFor(() =>
			expect(onSaveBuiltinParameters).toHaveBeenCalledWith("xiaohongshu-mcp", preset, {
				XHS_PROXY: "socks5://127.0.0.1:7890",
			}),
		);

		await waitFor(() => expect(screen.getByText(/已登录：小明|Signed in as 小明/)).toBeTruthy());
		const clear = screen.getByRole("button", { name: /清除登录状态|Clear sign-in state/ });
		fireEvent.click(clear);
		fireEvent.click(screen.getByRole("button", { name: /确认清除登录状态|Confirm clearing sign-in state/ }));
		await waitFor(() => expect(clearSetupLogin).toHaveBeenCalledWith("xiaohongshu-mcp"));
	});
});

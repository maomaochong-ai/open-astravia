// @vitest-environment jsdom
import type { ImBridgeConfig, ImSetConfigPayload } from "@preload/api";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const { useImBridgeSettingsModel } = await import("./useImBridgeSettingsModel.js");

function baseConfig(): ImBridgeConfig {
	return {
		enabled: false,
		transport: "feishu",
		feishu: { appId: "cli_a", appSecret: "sec", verificationToken: "", encryptKey: "" },
		wechat: { bound: false },
		telegram: { botToken: "" },
		slack: { botToken: "", appToken: "" },
		discord: { botToken: "" },
		signal: { bound: false, cliInstallHint: "brew install signal-cli" },
		whatsapp: { bound: false },
		imessage: {},
		transportMode: "long-connection",
		encryptionAvailable: true,
	};
}

/** 主进程 im 配置的最小内存替身：setConfig 落盘后 getConfig 必须返回新值。 */
function installImStub(): { current: ImBridgeConfig; payloads: ImSetConfigPayload[] } {
	const store: { current: ImBridgeConfig; payloads: ImSetConfigPayload[] } = {
		current: baseConfig(),
		payloads: [],
	};
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			im: {
				getConfig: async () => structuredClone(store.current),
				setConfig: async (payload: ImSetConfigPayload) => {
					store.payloads.push(payload);
					store.current = {
						...store.current,
						enabled: payload.enabled,
						transport: payload.transport ?? store.current.transport,
						...(payload.agentModel === undefined
							? {}
							: { agentModel: payload.agentModel ?? undefined }),
					};
					return { ok: true as const, mode: "plaintext" as const };
				},
				subscribeStatus: async () => () => {},
				detectLegacy: async () => ({ hasLegacyData: false }),
			},
		},
	});
	return store;
}

describe("useImBridgeSettingsModel", () => {
	beforeEach(() => {
		installImStub();
	});

	it("切换渠道后 config 立即反映新 transport（无需重新加载页面）", async () => {
		const { result } = renderHook(() => useImBridgeSettingsModel());
		await waitFor(() => expect(result.current.config).not.toBeNull());

		await act(async () => {
			await result.current.onSwitchTransport("telegram");
		});

		expect(result.current.config?.transport).toBe("telegram");
	});

	it("选择模型后 config 立即反映新 agentModel", async () => {
		const { result } = renderHook(() => useImBridgeSettingsModel());
		await waitFor(() => expect(result.current.config).not.toBeNull());

		await act(async () => {
			await result.current.onPickModel({ provider: "anthropic", model: "claude-opus-5" });
		});

		expect(result.current.config?.agentModel).toEqual({ provider: "anthropic", model: "claude-opus-5" });
	});

	it("清空模型后 config 立即变为未设置", async () => {
		const store = installImStub();
		store.current = { ...store.current, agentModel: { provider: "anthropic", model: "claude-opus-5" } };
		const { result } = renderHook(() => useImBridgeSettingsModel());
		await waitFor(() => expect(result.current.config?.agentModel).toBeDefined());

		await act(async () => {
			await result.current.onPickModel(null);
		});

		expect(result.current.config?.agentModel).toBeUndefined();
	});
});

describe("渠道配置对话框的允许列表", () => {
	it("保存 Discord 配置时不把服务器允许列表挪进用户允许列表", async () => {
		const store = installImStub();
		store.current = {
			...store.current,
			discord: { botToken: "tok", allowedUserIds: ["user-1"], allowedGuildIds: ["guild-9"] },
		};
		const { result } = renderHook(() => useImBridgeSettingsModel());
		await waitFor(() => expect(result.current.config).not.toBeNull());

		act(() => result.current.onOpenChannelDialog("discord"));
		// 输入框只呈现用户允许列表，服务器 ID 不会混进来。
		expect(result.current.channelDialog.form.allowlist).toBe("user-1");

		await act(async () => {
			await result.current.channelDialog.onSave();
		});

		const saved = store.payloads.at(-1);
		expect(saved?.discord?.allowedUserIds).toEqual(["user-1"]);
		expect(saved?.discord?.allowedGuildIds).toEqual(["guild-9"]);
	});

	it("清空 Discord 用户允许列表不会连带清掉服务器允许列表", async () => {
		const store = installImStub();
		store.current = {
			...store.current,
			discord: { botToken: "tok", allowedUserIds: ["user-1"], allowedGuildIds: ["guild-9"] },
		};
		const { result } = renderHook(() => useImBridgeSettingsModel());
		await waitFor(() => expect(result.current.config).not.toBeNull());

		act(() => result.current.onOpenChannelDialog("discord"));
		act(() => result.current.channelDialog.updateField("allowlist", ""));
		await act(async () => {
			await result.current.channelDialog.onSave();
		});

		const saved = store.payloads.at(-1);
		expect(saved?.discord?.allowedUserIds).toBeUndefined();
		expect(saved?.discord?.allowedGuildIds).toEqual(["guild-9"]);
	});

	it("Slack 同样保留频道允许列表", async () => {
		const store = installImStub();
		store.current = {
			...store.current,
			slack: { botToken: "xoxb", appToken: "xapp", allowedUserIds: ["u1"], allowedChannelIds: ["C1"] },
		};
		const { result } = renderHook(() => useImBridgeSettingsModel());
		await waitFor(() => expect(result.current.config).not.toBeNull());

		act(() => result.current.onOpenChannelDialog("slack"));
		expect(result.current.channelDialog.form.allowlist).toBe("u1");
		await act(async () => {
			await result.current.channelDialog.onSave();
		});

		const saved = store.payloads.at(-1);
		expect(saved?.slack?.allowedUserIds).toEqual(["u1"]);
		expect(saved?.slack?.allowedChannelIds).toEqual(["C1"]);
	});
});

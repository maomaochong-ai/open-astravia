// @vitest-environment jsdom
/**
 * Magpie（本机代理）启用时的密钥取值回归测试。
 *
 * 根因（见 ADR-0172）：`adoptPreset` 的草稿 key 取值漏了 `?? row.defaultApiKey`，
 * 于是 `autoKey` 只决定了「行内不给密钥按钮」，但启用时 `apiKey` 仍落成空串，
 * 实际使用时被要求重新填密钥——与上游「不需要填密钥」的承诺相悖。
 *
 * 这个用例从 hook 的 `onAdopt` 进入，断言 saveConfig 收到的 `apiKey` 是 `"magpie"`
 * 而不是空串。改回旧实现（去掉 fallback）会立刻变红。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelsConfigData } from "@preload/api-types/models.js";
import { usePresetProvidersSectionModel } from "./usePresetProvidersSectionModel";

// t 必须是模块级稳定引用：hook 的 load 依赖 t，若 useTranslation 每次返回新函数会导致无限重渲。
const { stableT } = vi.hoisted(() => ({ stableT: (key: string) => key }));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: stableT, i18n: { language: "zh" } }),
}));

vi.mock("@shared/store/toast-atoms", () => ({ showToast: vi.fn() }));

const refreshPresetModels = vi.fn(async () => ({ models: [{ id: "magpie-model", name: "Magpie Model" }] }));
const listPresets = vi.fn(async () => ({
	providers: [
		{
			id: "magpie",
			displayName: "Magpie",
			api: "openai-completions",
			baseUrl: "http://127.0.0.1:3425/v1",
			icon: "magpie",
			defaultApiKey: "magpie",
			catalogModels: [],
		},
	],
	catalogSource: "snapshot" as const,
}));

beforeEach(() => {
	refreshPresetModels.mockClear();
	listPresets.mockClear();
	(window as unknown as { astravia: unknown }).astravia = {
		models: {
			listPresets,
			refreshPresetModels,
			onPresetsUpdated: vi.fn(() => () => undefined),
		},
	};
});

describe("usePresetProvidersSectionModel 启用 Magpie", () => {
	it("用 defaultApiKey 作为 apiKey，而不是落成空串", async () => {
		const saveConfig = vi.fn(async () => undefined);
		const config: ModelsConfigData = { providers: {} };

		const { result } = renderHook(() => usePresetProvidersSectionModel({ config, saveConfig }));
		await waitFor(() => expect(result.current.rows.some((row) => row.id === "magpie")).toBe(true));

		const magpie = result.current.rows.find((row) => row.id === "magpie");
		expect(magpie?.autoKey).toBe(true);

		await act(async () => {
			await result.current.onAdopt(magpie!);
		});

		expect(saveConfig).toHaveBeenCalledTimes(1);
		const saved = saveConfig.mock.calls[0]?.[0] as ModelsConfigData;
		expect(saved.providers.magpie?.apiKey).toBe("magpie");
		// 拉模型用的也是默认密钥，而不是空串。
		expect(refreshPresetModels).toHaveBeenCalledWith("magpie", "magpie");
	});
});

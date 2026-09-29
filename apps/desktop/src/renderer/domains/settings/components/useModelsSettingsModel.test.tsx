// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useModelsSettingsModel } from "./useModelsSettingsModel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./recordSettingsUsage", () => ({ recordSettingsUsage: vi.fn() }));
vi.mock("@shared/store/toast-atoms", () => ({ showToast: vi.fn() }));
vi.mock("@shared/store/model-catalog", async () => {
	const { atom } = await import("jotai");
	return {
		localModelsConfigAtom: atom({
			providers: { local: { baseUrl: "http://localhost:11434/v1", models: [{ id: "qwen3" }] } },
		}),
		modelCatalog: { revalidate: vi.fn(async () => undefined) },
	};
});

describe("useModelsSettingsModel fetched models", () => {
	it("starts with nothing selected and supports select all / deselect all", async () => {
		const set = vi.fn(async () => undefined);
		(window as unknown as { vetta: unknown }).vetta = {
			models: {
				set,
				fetchProviderModels: vi.fn(async () => ({ models: ["qwen3", "llama3", "gemma3"] })),
			},
		};

		const { result } = renderHook(() => useModelsSettingsModel());
		await act(() => result.current.onFetchProviderModels("local"));
		expect(result.current.fetchedModels?.selected).toEqual([]);

		act(() => result.current.onSelectAllFetchedModels());
		// 已添加的 qwen3 不计入全选，避免计数虚高。
		expect(result.current.fetchedModels?.selected).toEqual(["llama3", "gemma3"]);

		act(() => result.current.onDeselectAllFetchedModels());
		expect(result.current.fetchedModels?.selected).toEqual([]);

		act(() => result.current.onToggleFetchedModel("gemma3"));
		await act(() => result.current.onApplyFetchedModels("local"));
		expect(set).toHaveBeenCalledWith({
			providers: {
				local: { baseUrl: "http://localhost:11434/v1", models: [{ id: "qwen3" }, { id: "gemma3" }] },
			},
		});
	});
});

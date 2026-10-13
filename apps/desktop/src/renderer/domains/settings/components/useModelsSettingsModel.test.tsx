// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
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

const FETCHED = [
	{ id: "qwen3", contextWindow: 32768 },
	{ id: "llama3", reasoning: true, reasoningLevels: ["low", "high", "max"] },
	{ id: "gemma3", vision: true, contextWindow: 65536, maxTokens: 4096 },
];

function mockModelsApi(overrides: { fetchProviderModels?: unknown; probe?: unknown } = {}): { set: ReturnType<typeof vi.fn> } {
	const set = vi.fn(async () => undefined);
	(window as unknown as { vetta: unknown }).vetta = {
		models: {
			set,
			fetchProviderModels: overrides.fetchProviderModels ?? vi.fn(async () => ({ models: FETCHED })),
			probe: overrides.probe ?? vi.fn(async () => ({ ok: true, message: "provider 可达（本地）" })),
		},
	};
	return { set };
}

describe("useModelsSettingsModel fetched models", () => {
	it("opens the drawer while loading, then fills the candidates", async () => {
		let resolveFetch: ((value: { models: typeof FETCHED }) => void) | undefined;
		const fetchProviderModels = vi.fn(
			() =>
				new Promise<{ models: typeof FETCHED }>((resolve) => {
					resolveFetch = resolve;
				}),
		);
		mockModelsApi({ fetchProviderModels });

		const { result } = renderHook(() => useModelsSettingsModel());
		act(() => result.current.onStartFetchProviderModels("local"));

		// 先出现抽屉与加载态，接口返回后才填候选。
		expect(result.current.fetchedModels).toMatchObject({ provider: "local", status: "loading", models: [] });
		expect(result.current.fetchingModelsFor).toBe("local");

		// 抽屉挂上加载态后，请求要等一次绘制屏障才真正发出。
		await waitFor(() => expect(fetchProviderModels).toHaveBeenCalledTimes(1));
		await act(async () => resolveFetch?.({ models: FETCHED }));

		expect(result.current.fetchedModels?.status).toBe("ready");
		expect(result.current.fetchedModels?.models.map((model) => model.id)).toEqual(["qwen3", "llama3", "gemma3"]);
		expect(result.current.fetchingModelsFor).toBeNull();
	});

	it("surfaces a fetch failure and can retry", async () => {
		const fetchProviderModels = vi
			.fn()
			.mockResolvedValueOnce({ models: [], error: "接口返回 500" })
			.mockResolvedValueOnce({ models: FETCHED });
		mockModelsApi({ fetchProviderModels });

		const { result } = renderHook(() => useModelsSettingsModel());
		act(() => result.current.onStartFetchProviderModels("local"));
		await waitFor(() => expect(result.current.fetchedModels?.status).toBe("error"));
		expect(result.current.fetchedModels?.error).toBe("接口返回 500");

		act(() => result.current.onRetryFetchProviderModels());
		expect(result.current.fetchedModels?.status).toBe("loading");
		await waitFor(() => expect(result.current.fetchedModels?.status).toBe("ready"));
		expect(result.current.fetchedModels?.error).toBeUndefined();
	});

	it("starts with nothing selected, and scopes select all / deselect all to the search results", async () => {
		mockModelsApi();

		const { result } = renderHook(() => useModelsSettingsModel());
		act(() => result.current.onStartFetchProviderModels("local"));
		await waitFor(() => expect(result.current.fetchedModels?.status).toBe("ready"));
		expect(result.current.fetchedModels?.selected).toEqual([]);

		act(() => result.current.onFetchedModelsSearchChange("llama"));
		act(() => result.current.onSelectAllFetchedModels());
		// 已添加的 qwen3 不计入，全选只作用于当前筛选可见的模型。
		expect(result.current.fetchedModels?.selected).toEqual(["llama3"]);

		// 清空搜索后被筛掉的勾选保留下来。
		act(() => result.current.onToggleFetchedModel("gemma3"));
		act(() => result.current.onFetchedModelsSearchChange("llama"));
		act(() => result.current.onDeselectAllFetchedModels());
		expect(result.current.fetchedModels?.selected).toEqual(["gemma3"]);

		act(() => result.current.onSelectAllFetchedModels());
		expect(result.current.fetchedModels?.selected).toEqual(["gemma3", "llama3"]);
	});

	it("tests one candidate's connectivity", async () => {
		const probe = vi.fn(async () => ({ ok: false, error: "provider 不可达：目标地址" }));
		mockModelsApi({ probe });

		const { result } = renderHook(() => useModelsSettingsModel());
		act(() => result.current.onStartFetchProviderModels("local"));
		await waitFor(() => expect(result.current.fetchedModels?.status).toBe("ready"));

		act(() => result.current.onTestFetchedModel("llama3"));
		await waitFor(() => expect(result.current.fetchedModels?.tests.llama3?.status).toBe("fail"));
		expect(probe).toHaveBeenCalledWith({ provider: "local", model: "llama3" });
		expect(result.current.fetchedModels?.tests.gemma3).toBeUndefined();
	});

	it("adds the selected candidates to the provider", async () => {
		const { set } = mockModelsApi();

		const { result } = renderHook(() => useModelsSettingsModel());
		act(() => result.current.onStartFetchProviderModels("local"));
		await waitFor(() => expect(result.current.fetchedModels?.status).toBe("ready"));

		act(() => result.current.onToggleFetchedModel("llama3"));
		act(() => result.current.onToggleFetchedModel("gemma3"));
		await act(() => result.current.onApplyFetchedModels("local"));

		// 接口给的参数随模型一起落盘；已添加的 qwen3 不被重写。
		expect(set).toHaveBeenCalledWith({
			providers: {
				local: {
					baseUrl: "http://localhost:11434/v1",
					models: [
						{ id: "qwen3" },
						{ id: "llama3", reasoning: true, reasoningLevels: ["low", "high", "max"], input: ["text"] },
						{ id: "gemma3", input: ["text", "image"], contextWindow: 65536, maxTokens: 4096 },
					],
				},
			},
		});
		expect(result.current.fetchedModels).toBeNull();
	});
});

describe("useModelsSettingsModel clear provider models", () => {
	it("clears the provider's models and drops its default model", async () => {
		const { set } = mockModelsApi();

		const { result } = renderHook(() => useModelsSettingsModel());
		act(() => result.current.onClearProviderModels("local"));

		await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
		expect(set).toHaveBeenCalledWith({
			providers: { local: { baseUrl: "http://localhost:11434/v1", models: [] } },
		});
	});

	it("does nothing when the provider has no models", () => {
		mockModelsApi();

		const { result } = renderHook(() => useModelsSettingsModel());
		act(() => result.current.onClearProviderModels("empty"));

		// 没有模型可清时不应发起保存。
		expect(window.vetta.models.set).not.toHaveBeenCalled();
	});
});

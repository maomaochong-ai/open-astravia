// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModelOptions } from "../components/ModelSelect/useModelOptions";
import { useModelCatalogSync } from "../hooks/useModelCatalogSync";
import { authTokenAtom, remoteProvidersAtom } from "./auth-atoms";
import { localModelsConfigAtom, modelCatalog } from "./model-catalog";

const LOCAL_CONFIG = { providers: {}, defaultModel: undefined };

type RemoteCatalog = Record<string, { api: string; models: { id: string; name: string }[] }>;

function remoteCatalog(...modelIds: string[]): RemoteCatalog {
	return { "vetta-go": { api: "openai-completions", models: modelIds.map((id) => ({ id, name: id })) } };
}

const models = {
	get: vi.fn(async () => LOCAL_CONFIG),
	fetchRemote: vi.fn(async (): Promise<{ providers: RemoteCatalog }> => ({ providers: remoteCatalog("gpt-old") })),
};

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(new Date("2026-08-20T00:00:00Z"));
	models.get.mockClear();
	models.fetchRemote.mockClear();
	models.fetchRemote.mockResolvedValue({ providers: remoteCatalog("gpt-old") });
	Object.defineProperty(window, "vetta", { configurable: true, writable: true, value: { models } });
	const store = getDefaultStore();
	store.set(authTokenAtom, "token-1");
	store.set(remoteProvidersAtom, {});
	store.set(localModelsConfigAtom, null);
	modelCatalog.reset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("模型目录与选择器的同步", () => {
	it("挂载后展示服务端下发的模型", async () => {
		const { result } = renderHook(() => useModelOptions());
		await waitFor(() => expect(result.current.options.map((o) => o.modelId)).toEqual(["gpt-old"]));
	});

	it("服务端增删模型后，已挂载的选择器无需重启即可看到（focus + TTL 过期重拉）", async () => {
		const { result } = renderHook(() => {
			useModelCatalogSync();
			return useModelOptions();
		});
		await waitFor(() => expect(result.current.options.map((o) => o.modelId)).toEqual(["gpt-old"]));

		// 后台改了模型：删掉 gpt-old，新增 gpt-new
		models.fetchRemote.mockResolvedValue({ providers: remoteCatalog("gpt-new") });

		vi.setSystemTime(new Date("2026-08-20T00:02:00Z"));
		await act(async () => {
			window.dispatchEvent(new Event("focus"));
			await Promise.resolve();
		});

		await waitFor(() => expect(result.current.options.map((o) => o.modelId)).toEqual(["gpt-new"]));
	});

	it("TTL 内重复 focus 不会反复打接口", async () => {
		renderHook(() => {
			useModelCatalogSync();
			return useModelOptions();
		});
		await waitFor(() => expect(models.fetchRemote).toHaveBeenCalledTimes(1));

		await act(async () => {
			window.dispatchEvent(new Event("focus"));
			window.dispatchEvent(new Event("focus"));
			await Promise.resolve();
		});
		expect(models.fetchRemote).toHaveBeenCalledTimes(1);
	});

	it("多个选择器同时挂载只触发一次拉取", async () => {
		renderHook(() => {
			useModelOptions();
			useModelOptions();
			return useModelOptions();
		});
		await waitFor(() => expect(models.fetchRemote).toHaveBeenCalledTimes(1));
		expect(models.get).toHaveBeenCalledTimes(1);
	});

	it("未登录（主进程返回空目录）时清掉远程模型", async () => {
		getDefaultStore().set(authTokenAtom, null);
		models.fetchRemote.mockResolvedValue({ providers: {} });
		const { result } = renderHook(() => useModelOptions());
		await waitFor(() => expect(models.fetchRemote).toHaveBeenCalled());
		expect(result.current.options).toEqual([]);
	});
});

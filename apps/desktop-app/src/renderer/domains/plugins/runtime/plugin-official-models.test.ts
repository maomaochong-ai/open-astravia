import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialModelsApi } from "./plugin-official-models.js";

// atoms 桶文件（连同 auth-atoms）在模块求值期就要 window/localStorage；被测模块只用到
// remoteProvidersAtom，这里替成一个独立 atom——实现和测试拿到的是同一个实例。
vi.mock("@shared/store/atoms", async () => {
	const { atom } = await import("jotai");
	return { remoteProvidersAtom: atom<Record<string, unknown>>({}) };
});

async function setRemoteProviders(value: Record<string, unknown>): Promise<void> {
	const { remoteProvidersAtom } = await import("@shared/store/atoms");
	getDefaultStore().set(remoteProvidersAtom, value);
}

afterEach(async () => {
	await setRemoteProviders({});
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialModelsApi", () => {
	it("routes model operations through the capability session", async () => {
		const listResult = {
			defaultModel: "openai/gpt-5",
			providers: [
				{
					id: "openai",
					displayName: "OpenAI",
					hasApiKey: true,
					modelCount: 1,
					models: [{ id: "gpt-5" }],
				},
			],
		};
		const models = {
			list: vi.fn().mockResolvedValue(listResult),
			getConfig: vi.fn().mockResolvedValue({ defaultModel: "openai/gpt-5", providers: {} }),
			getProvider: vi.fn().mockResolvedValue({ provider: "openai", apiKey: "***" }),
			probe: vi.fn().mockResolvedValue({ ok: true }),
			validateModelKey: vi.fn().mockResolvedValue(undefined),
			setDefault: vi.fn().mockResolvedValue({ defaultModel: "openai/gpt-5" }),
			upsertProvider: vi.fn().mockResolvedValue({ apiKey: "***" }),
			removeProvider: vi.fn().mockResolvedValue(undefined),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { models } } } },
		});
		const assertOfficial = vi.fn();
		const api = createOfficialModelsApi(assertOfficial, "capability-session");

		await expect(api.list()).resolves.toEqual(listResult);
		await expect(api.get()).resolves.toEqual({ defaultModel: "openai/gpt-5", providers: {} });
		await expect(api.get("openai")).resolves.toEqual({ provider: "openai", apiKey: "***" });
		await expect(api.probe("openai", "gpt-5")).resolves.toEqual({ ok: true });
		await expect(api.listProviderIds()).resolves.toEqual(["openai"]);
		await expect(api.assertModelKeyExists("openai/gpt-5", "test")).resolves.toBeUndefined();
		await expect(api.setDefault("openai/gpt-5")).resolves.toEqual({ defaultModel: "openai/gpt-5" });
		await expect(api.upsertProvider("openai", { displayName: "OpenAI" })).resolves.toEqual({ apiKey: "***" });
		await expect(api.removeProvider("openai")).resolves.toBeUndefined();

		expect(assertOfficial).toHaveBeenCalledTimes(9);
		expect(models.getConfig).toHaveBeenCalledWith("capability-session");
		expect(models.getProvider).toHaveBeenCalledWith("capability-session", "openai");
		expect(models.validateModelKey).toHaveBeenCalledWith("capability-session", "openai/gpt-5", "test");
		expect(models.upsertProvider).toHaveBeenCalledWith("capability-session", "openai", {
			displayName: "OpenAI",
		});
	});
});

const LOCAL = {
	defaultModel: "openai/gpt-5",
	providers: [
		{
			id: "openai",
			displayName: "OpenAI",
			hasApiKey: true,
			modelCount: 1,
			models: [{ id: "gpt-5" }],
		},
	],
};

function stubInternalModels(): { list: ReturnType<typeof vi.fn>; validateModelKey: ReturnType<typeof vi.fn> } {
	const api = {
		list: vi.fn(async () => structuredClone(LOCAL)),
		validateModelKey: vi.fn(async () => undefined),
	};
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { vetta: { plugins: { internalCapabilities: { models: api } } } },
	});
	return api;
}

describe("official.models 合并远程目录", () => {
	it("列出登录后下发的远程 provider（Vetta Go），并标记 remote", async () => {
		stubInternalModels();
		await setRemoteProviders({ "vetta-go": { models: [{ id: "opus-5", name: "Opus 5" }] } });

		const result = await createOfficialModelsApi(() => undefined, "s").list();
		const go = result.providers.find((provider) => provider.id === "vetta-go");
		expect(go).toMatchObject({ displayName: "Vetta Go", remote: true, modelCount: 1 });
		expect(go?.models[0]).toMatchObject({ id: "opus-5", name: "Opus 5" });
		// 本地 provider 原样保留
		expect(result.providers.find((provider) => provider.id === "openai")?.models).toHaveLength(1);
	});

	it("provider 同名时本地优先，远程只补本地没有的模型", async () => {
		stubInternalModels();
		await setRemoteProviders({
			openai: { displayName: "远程 OpenAI", models: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] },
		});

		const providers = (await createOfficialModelsApi(() => undefined, "s").list()).providers;
		expect(providers).toHaveLength(1);
		expect(providers[0].displayName).toBe("OpenAI");
		expect(providers[0].models.map((model) => model.id)).toEqual(["gpt-5", "gpt-5-mini"]);
	});

	it("远程模型的 key 校验不落到主进程（主进程不认识它们）", async () => {
		const internal = stubInternalModels();
		await setRemoteProviders({ "vetta-go": { models: [{ id: "opus-5" }] } });
		const api = createOfficialModelsApi(() => undefined, "s");

		await api.assertModelKeyExists("vetta-go/opus-5");
		expect(internal.validateModelKey).not.toHaveBeenCalled();

		await api.assertModelKeyExists("openai/gpt-5");
		expect(internal.validateModelKey).toHaveBeenCalledWith("s", "openai/gpt-5", undefined);
	});
});

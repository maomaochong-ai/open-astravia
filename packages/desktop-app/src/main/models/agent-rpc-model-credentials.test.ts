import type { CodingAgentAuthRuntime } from "@vetta/coding-agent/host-services";
import { describe, expect, it, vi } from "vitest";
import {
	type CredentialRefProviders,
	extractCredentialRefProviders,
	syncAgentRpcModelCredentials,
} from "./agent-rpc-model-credentials.js";

/** 只记录注入结果的 AuthStorage 替身；被测代码只用 setRuntimeApiKey。 */
function createAuthStorageSpy() {
	const injected = new Map<string, string>();
	const authStorage = {
		setRuntimeApiKey: (provider: string, apiKey: string) => void injected.set(provider, apiKey),
		removeRuntimeApiKey: (provider: string) => void injected.delete(provider),
	} as unknown as CodingAgentAuthRuntime;
	return { authStorage, injected };
}

/** 保险库替身：credentialRef -> 明文 key。 */
function createCredentialSource(vault: Record<string, string>) {
	return {
		syncToAuthStorage(authStorage: CodingAgentAuthRuntime, providers: CredentialRefProviders) {
			for (const [providerId, provider] of Object.entries(providers)) {
				const key = provider.credentialRef ? vault[provider.credentialRef] : undefined;
				if (key) authStorage.setRuntimeApiKey(providerId, key);
			}
		},
	};
}

const MODELS_JSON = JSON.stringify({
	providers: {
		// Desktop 落盘形态：明文 key 已移入保险库，只留 credentialRef。
		deepseek: { api: "openai-completions", baseUrl: "https://api.deepseek.com", credentialRef: "ref-deepseek" },
		// 本地 provider 内联 apiKey，无 credentialRef，不需要注入。
		"qwen-local": { api: "openai-completions", baseUrl: "http://127.0.0.1:1234", apiKey: "EMPTY" },
	},
});

describe("syncAgentRpcModelCredentials", () => {
	it("把保险库里的 key 注入 agent-rpc 子进程的 AuthStorage", async () => {
		const { authStorage, injected } = createAuthStorageSpy();
		await syncAgentRpcModelCredentials({
			authStorage,
			credentials: createCredentialSource({ "ref-deepseek": "sk-real-deepseek-key" }),
			modelsJsonPath: "/models.json",
			readModelsJson: async () => MODELS_JSON,
		});
		// 回归点：没有这一步，ModelRuntime 会把 "no-auth-needed-for-local-provider"
		// 当作 deepseek 的 Bearer 发出去，远端返回 401 ****ider。
		expect(injected.get("deepseek")).toBe("sk-real-deepseek-key");
		expect(injected.has("qwen-local")).toBe(false);
	});

	it("models.json 不存在时静默跳过，不阻断子进程启动", async () => {
		const { authStorage, injected } = createAuthStorageSpy();
		const onError = vi.fn();
		await syncAgentRpcModelCredentials({
			authStorage,
			credentials: createCredentialSource({}),
			modelsJsonPath: "/missing.json",
			readModelsJson: async () => {
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			},
			onError,
		});
		expect(injected.size).toBe(0);
		expect(onError).toHaveBeenCalledOnce();
	});

	it("models.json 损坏时上报错误但不抛出", async () => {
		const { authStorage } = createAuthStorageSpy();
		const onError = vi.fn();
		await syncAgentRpcModelCredentials({
			authStorage,
			credentials: createCredentialSource({}),
			modelsJsonPath: "/broken.json",
			readModelsJson: async () => "{not json",
			onError,
		});
		expect(onError).toHaveBeenCalledOnce();
	});

	it("没有任何 credentialRef 时不触碰保险库（避免无谓的 safeStorage 解密）", async () => {
		const { authStorage } = createAuthStorageSpy();
		const syncToAuthStorage = vi.fn();
		await syncAgentRpcModelCredentials({
			authStorage,
			credentials: { syncToAuthStorage },
			modelsJsonPath: "/models.json",
			readModelsJson: async () => JSON.stringify({ providers: { "qwen-local": { apiKey: "EMPTY" } } }),
		});
		expect(syncToAuthStorage).not.toHaveBeenCalled();
	});
});

describe("extractCredentialRefProviders", () => {
	it("只保留带非空 credentialRef 的 provider", () => {
		expect(
			extractCredentialRefProviders({
				providers: {
					a: { credentialRef: "ref-a" },
					b: { credentialRef: "" },
					c: { apiKey: "inline" },
					d: { credentialRef: 42 },
					e: null,
				},
			}),
		).toEqual({ a: { credentialRef: "ref-a" } });
	});

	it("对非法输入返回空对象", () => {
		expect(extractCredentialRefProviders(null)).toEqual({});
		expect(extractCredentialRefProviders("nope")).toEqual({});
		expect(extractCredentialRefProviders({})).toEqual({});
		expect(extractCredentialRefProviders({ providers: "nope" })).toEqual({});
	});
});

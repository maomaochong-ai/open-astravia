import { describe, expect, it } from "vitest";
import { getPresetProvider } from "./catalog.js";
import { type FetchImpl, fetchPresetModels } from "./fetch.js";

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
	return {
		ok: init?.ok ?? true,
		status: init?.status ?? 200,
		statusText: "OK",
		json: async () => body,
	} as Response;
}

function stubFetch(handler: (url: string) => unknown, init?: { ok?: boolean; status?: number }): FetchImpl {
	return async (url) => jsonResponse(handler(url), init);
}

function def(id: string) {
	const provider = getPresetProvider(id);
	if (!provider) throw new Error(`missing preset ${id}`);
	return provider;
}

describe("fetchPresetModels", () => {
	it("解析 Anthropic 的 capabilities 与分页", async () => {
		const calls: string[] = [];
		const fetchImpl: FetchImpl = async (url) => {
			calls.push(url);
			if (calls.length === 1) {
				return jsonResponse({
					data: [
						{
							id: "claude-opus-4-6",
							display_name: "Claude Opus 4.6",
							max_input_tokens: 200000,
							max_tokens: 64000,
							capabilities: {
								image_input: { supported: true },
								thinking: { supported: true },
								effort: { supported: true, low: { supported: true }, max: { supported: false } },
							},
						},
					],
					has_more: true,
					last_id: "claude-opus-4-6",
				});
			}
			return jsonResponse({ data: [{ id: "claude-haiku-4-5" }], has_more: false });
		};

		const result = await fetchPresetModels(def("claude"), "sk-test", fetchImpl);

		expect(result.error).toBeUndefined();
		expect(result.models.map((model) => model.id)).toEqual(["claude-haiku-4-5", "claude-opus-4-6"]);
		expect(calls[1]).toContain("after_id=claude-opus-4-6");
		const opus = result.models.find((model) => model.id === "claude-opus-4-6");
		expect(opus).toMatchObject({
			name: "Claude Opus 4.6",
			reasoning: true,
			reasoningLevels: ["low"],
			input: ["text", "image"],
			contextWindow: 200000,
			maxTokens: 64000,
		});
		// 接口不给价格,fetch 层也不猜——由 models.dev 目录在 sync 层补。
		expect(opus?.cost).toBeUndefined();
	});

	it("过滤 OpenAI 的非对话模型", async () => {
		const fetchImpl = stubFetch(() => ({
			data: [
				{ id: "gpt-5.1" },
				{ id: "gpt-4.1-mini" },
				{ id: "text-embedding-3-large" },
				{ id: "whisper-1" },
				{ id: "dall-e-3" },
			],
		}));

		const result = await fetchPresetModels(def("openai"), "sk-test", fetchImpl);

		expect(result.models.map((model) => model.id)).toEqual(["gpt-4.1-mini", "gpt-5.1"]);
	});

	it("解析 Kimi 返回的能力位", async () => {
		const fetchImpl = stubFetch(() => ({
			data: [
				{ id: "kimi-k2-turbo-preview", context_length: 262144, supports_reasoning: true, supports_image_in: false },
			],
		}));

		const result = await fetchPresetModels(def("kimi"), "sk-test", fetchImpl);

		expect(result.models[0]).toMatchObject({
			id: "kimi-k2-turbo-preview",
			contextWindow: 262144,
			reasoning: true,
			input: ["text"],
		});
	});

	it("Gemini 只保留支持 generateContent 的模型,并剥掉 models/ 前缀", async () => {
		const fetchImpl = stubFetch((url) => {
			expect(url).toContain("key=sk-test");
			return {
				models: [
					{
						name: "models/gemini-2.5-pro",
						displayName: "Gemini 2.5 Pro",
						inputTokenLimit: 1048576,
						outputTokenLimit: 65536,
						thinking: true,
						supportedGenerationMethods: ["generateContent"],
					},
					{
						name: "models/text-embedding-004",
						supportedGenerationMethods: ["embedContent"],
					},
				],
			};
		});

		const result = await fetchPresetModels(def("gemini"), "sk-test", fetchImpl);

		expect(result.models).toHaveLength(1);
		expect(result.models[0]).toMatchObject({
			id: "gemini-2.5-pro",
			name: "Gemini 2.5 Pro",
			contextWindow: 1048576,
			maxTokens: 65536,
			reasoning: true,
		});
	});

	it("认证失败归为 invalid-key,调用方据此拒绝启用", async () => {
		const fetchImpl = stubFetch(() => ({}), { ok: false, status: 401 });

		const result = await fetchPresetModels(def("deepseek"), "bad-key", fetchImpl);

		expect(result.models).toEqual([]);
		// 结构化错误码 + 参数,文案由渲染层查 i18n(主进程不产出中文)。
		expect(result.error).toEqual({ code: "invalid-key", params: { host: "api.deepseek.com", status: 401 } });
	});

	it("Gemini 的无效 key 是 400,同样算 invalid-key", async () => {
		const fetchImpl = stubFetch(() => ({}), { ok: false, status: 400 });

		const result = await fetchPresetModels(def("gemini"), "bad-key", fetchImpl);

		expect(result.error).toEqual({
			code: "invalid-key",
			params: { host: "generativelanguage.googleapis.com", status: 400 },
		});
	});

	it("Bearer 系的 400 不是认证问题,仍报 http-status", async () => {
		const fetchImpl = stubFetch(() => ({}), { ok: false, status: 400 });

		const result = await fetchPresetModels(def("openai"), "sk-test", fetchImpl);

		expect(result.error).toMatchObject({ code: "http-status", params: { status: 400 } });
	});

	it("5xx 不是认证问题,不该拦下用户的 key", async () => {
		const fetchImpl = stubFetch(() => ({}), { ok: false, status: 503 });

		const result = await fetchPresetModels(def("claude"), "sk-test", fetchImpl);

		expect(result.error).toMatchObject({ code: "http-status", params: { status: 503 } });
	});

	it("空列表算作错误,调用方据此保留旧快照", async () => {
		const fetchImpl = stubFetch(() => ({ data: [] }));

		const result = await fetchPresetModels(def("zai"), "sk-test", fetchImpl);

		expect(result.models).toEqual([]);
		expect(result.error).toEqual({ code: "empty-models" });
	});
});

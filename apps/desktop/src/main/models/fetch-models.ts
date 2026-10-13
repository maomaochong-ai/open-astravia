import { resolveNodeConfigurationHeaders, resolveNodeConfigurationValue } from "@vetta/runtime-node/host";
import { net } from "electron";
import type { FetchedProviderModel } from "../../preload/api-types/models.js";
import { enrichFetchedModels } from "./enrich-fetched-models.js";
import { getDesktopModelSettingsService } from "./model-settings-host.js";
import { parseProviderModels } from "./parse-provider-models.js";
import { getCachedModelsDevCatalog } from "./presets/models-dev.js";

/**
 * 拉取本地自定义 provider 的 `GET {baseUrl}/models`（OpenAI 兼容接口），
 * 返回上游模型列表及其参数，供设置页「从接口拉取」挑选并批量填写模型配置。
 *
 * 仅面向本地 models.json 里的 provider（Ollama / vLLM / LM Studio / 任意
 * openai-compatible 网关）。apiKey / headers 沿用 coding-agent 的解析规则
 * （`!command` 执行、环境变量名、字面量）。
 *
 * 与 probeModelProvider 一样走 electron.net.fetch，以复用 GUI session 的
 * 网络栈，绕开 macOS 15 本地网络权限限制。
 */
export async function fetchProviderModels(
	providerName: string,
): Promise<{ models: FetchedProviderModel[]; error?: string }> {
	const config = await getDesktopModelSettingsService().getConfig();
	const provider = config.providers[providerName];
	if (!provider) return { models: [], error: `provider "${providerName}" 不在本地 models.json` };
	if (!provider.baseUrl) return { models: [], error: `provider "${providerName}" 缺 baseUrl` };

	let url: string;
	try {
		url = `${new URL(provider.baseUrl).toString().replace(/\/$/, "")}/models`;
	} catch {
		return { models: [], error: `baseUrl 解析失败：${provider.baseUrl}` };
	}

	const headers: Record<string, string> = { ...resolveNodeConfigurationHeaders(provider.headers) };
	if (provider.apiKey) {
		const key = resolveNodeConfigurationValue(provider.apiKey);
		if (key) headers.Authorization = `Bearer ${key}`;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const res = await net.fetch(url, { method: "GET", headers, signal: controller.signal });
		if (!res.ok) return { models: [], error: `接口返回 ${res.status} ${res.statusText}` };
		const parsed = parseProviderModels(await res.json());
		if (parsed.length === 0) return { models: [], error: "接口未返回可识别的模型列表" };
		// 网关没报的上下文/思考档位等参数用 models.dev 目录补上。
		return { models: enrichFetchedModels(await getCachedModelsDevCatalog(), parsed) };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { models: [], error: `拉取失败：${msg}` };
	} finally {
		clearTimeout(timer);
	}
}

import { resolveConfigHeaders, resolveConfigValue } from "@vetta/coding-agent/configuration";
import { net } from "electron";
import { getDesktopModelSettingsService } from "./model-settings-host.js";

/**
 * 拉取本地自定义 provider 的 `GET {baseUrl}/models`（OpenAI 兼容接口），
 * 返回上游模型 id 列表，供设置页「从接口拉取」批量填写模型配置。
 *
 * 仅面向本地 models.json 里的 provider（Ollama / vLLM / LM Studio / 任意
 * openai-compatible 网关）。apiKey / headers 沿用 coding-agent 的解析规则
 * （`!command` 执行、环境变量名、字面量）。
 *
 * 与 probeModelProvider 一样走 electron.net.fetch，以复用 GUI session 的
 * 网络栈，绕开 macOS 15 本地网络权限限制。
 */
export async function fetchProviderModels(providerName: string): Promise<{ models: string[]; error?: string }> {
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

	const headers: Record<string, string> = { ...resolveConfigHeaders(provider.headers) };
	if (provider.apiKey) {
		const key = resolveConfigValue(provider.apiKey);
		if (key) headers.Authorization = `Bearer ${key}`;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const res = await net.fetch(url, { method: "GET", headers, signal: controller.signal });
		if (!res.ok) return { models: [], error: `接口返回 ${res.status} ${res.statusText}` };
		const body = (await res.json()) as { data?: unknown; models?: unknown };
		const models = parseModelIds(body);
		if (models.length === 0) return { models: [], error: "接口未返回可识别的模型列表" };
		return { models };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { models: [], error: `拉取失败：${msg}` };
	} finally {
		clearTimeout(timer);
	}
}

/** 兼容 OpenAI `{data:[{id}]}` 与 Ollama `/v1/models` 之外的 `{models:[{name}]}`。 */
function parseModelIds(body: { data?: unknown; models?: unknown }): string[] {
	const list = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
	const ids = list
		.map((item) => {
			if (typeof item === "string") return item;
			if (item && typeof item === "object") {
				const record = item as { id?: unknown; name?: unknown };
				if (typeof record.id === "string") return record.id;
				if (typeof record.name === "string") return record.name;
			}
			return "";
		})
		.filter(Boolean);
	return [...new Set(ids)].sort();
}

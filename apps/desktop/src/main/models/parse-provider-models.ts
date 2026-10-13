import type { FetchedProviderModel } from "../../preload/api-types/models.js";

/**
 * 解析 OpenAI 兼容 `GET {baseUrl}/models` 的响应体。
 *
 * 接口只保证 `data[].id`，各家网关（Ollama / vLLM / LM Studio / OpenRouter 等）会
 * 额外带上上下文窗口、输入能力、模型归属方等字段，但键名并不统一。这里只识别
 * 已知的几种写法，识别不出的一律忽略——设置页宁可少显示，也不猜一个可能错的参数。
 */

const CONTEXT_WINDOW_KEYS = [
	"context_length",
	"context_window",
	"max_context_length",
	"max_model_len",
	"max_input_tokens",
	"context_size",
	"n_ctx",
] as const;

const MAX_TOKENS_KEYS = ["max_output_tokens", "max_completion_tokens", "max_tokens", "n_predict"] as const;

const VISION_KEYS = ["vision", "supports_vision"] as const;
const VISION_CAPABILITIES = ["vision", "image", "image-input", "multimodal"] as const;

const REASONING_KEYS = ["reasoning", "supports_reasoning", "thinking"] as const;
/** effort/level 等级条目里的等级名字段。 */
const REASONING_LEVEL_KEYS = ["effort", "level", "name", "value"] as const;
const REASONING_CAPABILITIES = ["reasoning", "thinking"] as const;

export function parseProviderModels(body: unknown): FetchedProviderModel[] {
	const record = asRecord(body);
	const list = Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : [];

	const byId = new Map<string, FetchedProviderModel>();
	for (const entry of list) {
		const parsed = parseProviderModel(entry);
		// 同名模型以先出现的为准，保持顺序稳定。
		if (parsed && !byId.has(parsed.id)) byId.set(parsed.id, parsed);
	}

	return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function parseProviderModel(entry: unknown): FetchedProviderModel | undefined {
	if (typeof entry === "string") return { id: entry };
	const record = asRecord(entry);
	if (!record) return undefined;

	const id = readString(record.id) ?? readString(record.name) ?? readString(record.model);
	if (!id) return undefined;

	const rawName = readString(record.name);
	const displayName = readString(record.display_name) ?? (rawName === id ? undefined : rawName);
	const model: FetchedProviderModel = { id };
	if (displayName) model.name = displayName;

	const contextWindow = readPositiveNumber(record, CONTEXT_WINDOW_KEYS);
	if (contextWindow !== undefined) model.contextWindow = contextWindow;

	const maxTokens = readPositiveNumber(record, MAX_TOKENS_KEYS);
	if (maxTokens !== undefined) model.maxTokens = maxTokens;

	if (readCapability(record, VISION_KEYS, VISION_CAPABILITIES)) model.vision = true;
	if (readCapability(record, REASONING_KEYS, REASONING_CAPABILITIES)) model.reasoning = true;

	// 思考档位：有的网关给 `supported_reasoning_levels: [{effort}]`（migpie 等聚合网关），
	// 有的直接搬 models.dev 的 `reasoning_options[type=effort].values`。有档位就是推理模型。
	const reasoningLevels = readReasoningLevels(record);
	if (reasoningLevels.length > 0) {
		model.reasoningLevels = reasoningLevels;
		model.reasoning = true;
	}
	if (readCapability(record, REASONING_KEYS, REASONING_CAPABILITIES)) model.reasoning = true;

	const ownedBy = readString(record.owned_by) ?? readString(record.owned_by_name);
	if (ownedBy) model.ownedBy = ownedBy;

	return model;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function readString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function readPositiveNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
	for (const key of keys) {
		const value = record[key];
		const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return undefined;
}

/**
 * 能力标记有三种常见写法：顶层布尔（`vision: true`）、`capabilities` 对象或数组，
 * 以及少数网关用的输入模态列表。任一命中即视为具备该能力。
 */
function readCapability(
	record: Record<string, unknown>,
	flagKeys: readonly string[],
	capabilityAliases: readonly string[],
): boolean {
	if (flagKeys.some((key) => record[key] === true)) return true;

	const hits = (value: string): boolean => capabilityAliases.includes(value.trim().toLowerCase());
	const capabilities = record.capabilities;
	if (Array.isArray(capabilities) && capabilities.some((item) => typeof item === "string" && hits(item))) {
		return true;
	}
	const capabilityRecord = asRecord(capabilities);
	if (capabilityRecord && capabilityAliases.some((alias) => capabilityRecord[alias] === true)) return true;

	const architecture = asRecord(record.architecture);
	const modalities = asRecord(record.modalities);
	const inputs = record.input_modalities ?? architecture?.input_modalities ?? modalities?.input;
	return Array.isArray(inputs) && inputs.some((item) => typeof item === "string" && hits(item));
}

/** 思考档位：支持 `supported_reasoning_levels: [{effort}]` 与 models.dev 的 effort 选项两种写法。 */
function readReasoningLevels(record: Record<string, unknown>): string[] {
	const supported = Array.isArray(record.supported_reasoning_levels)
		? record.supported_reasoning_levels
		: Array.isArray(record.reasoning_levels)
			? record.reasoning_levels
			: Array.isArray(record.reasoning_options)
				? record.reasoning_options.filter((option) => asRecord(option)?.type === "effort")
				: [];

	const levels: string[] = [];
	const push = (name: string | undefined): void => {
		if (name && !levels.includes(name)) levels.push(name);
	};
	for (const entry of supported) {
		if (typeof entry === "string") {
			push(readString(entry));
			continue;
		}
		const item = asRecord(entry);
		if (!item) continue;
		push(readLevelFromRecord(item));
		// models.dev 的 effort 选项把等级放在 `values` 数组里。
		for (const value of Array.isArray(item.values) ? item.values : []) push(readString(value));
	}
	return levels;
}

function readLevelFromRecord(entry: Record<string, unknown>): string | undefined {
	for (const key of REASONING_LEVEL_KEYS) {
		const value = readString(entry[key]);
		if (value) return value;
	}
	return undefined;
}

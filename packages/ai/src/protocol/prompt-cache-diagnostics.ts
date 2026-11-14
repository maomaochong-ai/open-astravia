import type { Context, PromptCacheSystemPromptBlockSpan } from "./context.js";
import type { ImageContent, Message, TextContent, ThinkingContent } from "./message.js";
import type { Tool, ToolCall } from "./tool.js";
import type {
	PromptCacheChangedSegment,
	PromptCacheDefinitionChange,
	PromptCacheDiagnostics,
	PromptCachePrefixStatus,
	PromptCacheSystemPromptBlockFingerprint,
	PromptCacheToolFingerprint,
} from "./usage.js";

const HASH_VERSION = "pc1";

/**
 * Computes privacy-safe, provider-neutral prefix fingerprints.
 *
 * Provider adapters may omit timestamps, usage, details, and other local
 * bookkeeping fields. The canonical projection mirrors that contract so the
 * diagnostic answers "did the provider-facing prefix change?", not merely
 * "did an internal message object change?".
 */
export function createPromptCacheDiagnostics(context: Context): PromptCacheDiagnostics {
	const systemPrompt = context.systemPrompt ?? "";
	const stableLength = normalizeStableLength(context.systemPromptStableLength, systemPrompt.length);
	const stableSystemPrompt = systemPrompt.slice(0, stableLength);
	const volatileSystemPrompt = systemPrompt.slice(stableLength);
	// 每条消息只序列化一次；历史、整段请求与上次请求前缀的哈希都是同一个数组序列化的前缀，
	// 一遍流式哈希即可得到，不必把整段上下文反复拼成字符串再逐字符哈希三次。
	const serializedMessages = context.messages.map((message) => stableSerialize(canonicalizeMessage(message)));
	const previous = findPreviousDiagnostics(context.messages);
	const messageCount = serializedMessages.length;
	const historyCount = Math.max(0, messageCount - 1);
	const previousCount = previous?.requestMessageCount;
	const prefixHashes = fingerprintArrayPrefixes(serializedMessages, [
		historyCount,
		messageCount,
		...(previousCount !== undefined && previousCount <= messageCount ? [previousCount] : []),
	]);
	const tools = (context.tools ?? []).map(canonicalizeTool);
	const systemPromptBlocks = fingerprintSystemPromptBlocks(systemPrompt, context.promptCacheSystemPromptBlocks);
	const toolDefinitions = (context.tools ?? []).map<PromptCacheToolFingerprint>((tool) => ({
		name: tool.name,
		hash: fingerprint(canonicalizeTool(tool)),
	}));

	const stableSystemPromptHash = fingerprint(stableSystemPrompt);
	const volatileSystemPromptHash = fingerprint(volatileSystemPrompt);
	const toolsHash = fingerprint(tools);
	const historyPrefixHash = prefixHashes.get(historyCount) as string;
	const requestMessagesHash = prefixHashes.get(messageCount) as string;
	const cachePrefixHash = fingerprint({
		stableSystemPromptHash,
		toolsHash,
		historyPrefixHash,
	});
	const comparison = compareWithPrevious({
		previous,
		stableSystemPromptHash,
		stableSystemPromptLength: stableSystemPrompt.length,
		volatileSystemPromptHash,
		volatileSystemPromptLength: volatileSystemPrompt.length,
		toolsHash,
		systemPromptBlocks,
		toolDefinitions,
		previousPrefixHash: previousCount === undefined ? undefined : prefixHashes.get(previousCount),
	});

	return {
		cachePrefixHash,
		stableSystemPromptHash,
		volatileSystemPromptHash,
		toolsHash,
		historyPrefixHash,
		requestMessagesHash,
		requestMessageCount: messageCount,
		prefixStatus: comparison.status,
		changedSegments: comparison.changedSegments,
		...(systemPromptBlocks ? { systemPromptBlocks } : {}),
		toolDefinitions,
		changedSystemPromptBlocks: comparison.changedSystemPromptBlocks,
		changedTools: comparison.changedTools,
		stableSystemPromptLength: stableSystemPrompt.length,
		volatileSystemPromptLength: volatileSystemPrompt.length,
		historyPrefixMessages: historyCount,
		toolCount: tools.length,
	};
}

interface PreviousComparisonInput {
	readonly previous: PromptCacheDiagnostics | undefined;
	readonly stableSystemPromptHash: string;
	readonly stableSystemPromptLength: number;
	readonly volatileSystemPromptHash: string;
	readonly volatileSystemPromptLength: number;
	readonly toolsHash: string;
	readonly systemPromptBlocks: readonly PromptCacheSystemPromptBlockFingerprint[] | undefined;
	readonly toolDefinitions: readonly PromptCacheToolFingerprint[];
	/** 本次请求前 previous.requestMessageCount 条消息的哈希；条数超出本次请求时为 undefined。 */
	readonly previousPrefixHash: string | undefined;
}

function compareWithPrevious(input: PreviousComparisonInput): {
	status: PromptCachePrefixStatus;
	changedSegments: PromptCacheChangedSegment[];
	changedSystemPromptBlocks: PromptCacheDefinitionChange[];
	changedTools: PromptCacheDefinitionChange[];
} {
	if (!input.previous) {
		return { status: "initial", changedSegments: [], changedSystemPromptBlocks: [], changedTools: [] };
	}
	const previous = input.previous;
	if (previous.requestMessagesHash === undefined || previous.requestMessageCount === undefined) {
		return { status: "unknown", changedSegments: [], changedSystemPromptBlocks: [], changedTools: [] };
	}

	const changedSegments: PromptCacheChangedSegment[] = [];
	if (
		previous.stableSystemPromptHash !== input.stableSystemPromptHash ||
		previous.stableSystemPromptLength !== input.stableSystemPromptLength
	) {
		changedSegments.push("stable-system");
	}
	if (
		previous.volatileSystemPromptHash !== input.volatileSystemPromptHash ||
		previous.volatileSystemPromptLength !== input.volatileSystemPromptLength
	) {
		changedSegments.push("volatile-system");
	}
	if (previous.toolsHash !== input.toolsHash) changedSegments.push("tools");

	const previousMessagesRemainPrefix =
		input.previousPrefixHash !== undefined && input.previousPrefixHash === previous.requestMessagesHash;
	if (!previousMessagesRemainPrefix) changedSegments.push("messages");

	const stablePrefixChanged = changedSegments.some((segment) => segment !== "volatile-system");
	return {
		status: stablePrefixChanged ? "changed" : "extended",
		changedSegments,
		changedSystemPromptBlocks:
			previous.systemPromptBlocks && input.systemPromptBlocks
				? compareNamedFingerprints(previous.systemPromptBlocks, input.systemPromptBlocks, (item) => item.id)
				: [],
		changedTools: previous.toolDefinitions
			? compareNamedFingerprints(previous.toolDefinitions, input.toolDefinitions, (item) => item.name)
			: [],
	};
}

function fingerprintSystemPromptBlocks(
	systemPrompt: string,
	spans: readonly PromptCacheSystemPromptBlockSpan[] | undefined,
): PromptCacheSystemPromptBlockFingerprint[] | undefined {
	if (!spans) return undefined;
	const ids = new Set<string>();
	let previousEnd = 0;
	const result: PromptCacheSystemPromptBlockFingerprint[] = [];
	for (const span of spans) {
		const end = span.start + span.length;
		if (
			!span.id ||
			ids.has(span.id) ||
			!Number.isInteger(span.start) ||
			!Number.isInteger(span.length) ||
			span.start < previousEnd ||
			span.length < 0 ||
			end > systemPrompt.length
		) {
			return undefined;
		}
		ids.add(span.id);
		previousEnd = end;
		result.push({
			id: span.id,
			hash: fingerprint(systemPrompt.slice(span.start, end)),
			charCount: span.length,
			cacheability: span.cacheability,
		});
	}
	return result;
}

function compareNamedFingerprints<T extends object>(
	previous: readonly T[],
	current: readonly T[],
	readId: (item: T) => string,
): PromptCacheDefinitionChange[] {
	const previousById = new Map(previous.map((item, index) => [readId(item), { item, index }]));
	const currentIds = new Set(current.map(readId));
	const changes: PromptCacheDefinitionChange[] = [];
	for (const [index, item] of current.entries()) {
		const id = readId(item);
		const prior = previousById.get(id);
		if (!prior) {
			changes.push({ id, change: "added" });
			continue;
		}
		if (stableSerialize(prior.item) !== stableSerialize(item)) {
			changes.push({ id, change: "changed" });
		} else if (prior.index !== index) {
			changes.push({ id, change: "reordered" });
		}
	}
	for (const item of previous) {
		const id = readId(item);
		if (!currentIds.has(id)) changes.push({ id, change: "removed" });
	}
	return changes;
}

function findPreviousDiagnostics(messages: readonly Message[]): PromptCacheDiagnostics | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === "assistant" && message.usage.promptCache) return message.usage.promptCache;
	}
	return undefined;
}

function normalizeStableLength(value: number | undefined, promptLength: number): number {
	if (value === undefined) return promptLength;
	if (!Number.isFinite(value)) return 0;
	return Math.min(promptLength, Math.max(0, Math.trunc(value)));
}

function canonicalizeMessage(message: Message): unknown {
	switch (message.role) {
		case "user":
			return { role: message.role, content: canonicalizeContent(message.content) };
		case "assistant":
			return { role: message.role, content: canonicalizeContent(message.content) };
		case "toolResult":
			return {
				role: message.role,
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				content: canonicalizeContent(message.content),
				isError: message.isError,
			};
	}
}

function canonicalizeContent(
	content: string | readonly (TextContent | ThinkingContent | ImageContent | ToolCall)[],
): unknown {
	if (typeof content === "string") return content;
	return content.map((item) =>
		item.type === "image"
			? {
					type: item.type,
					mimeType: item.mimeType,
					dataLength: item.data.length,
					dataHash: fingerprintImageData(item.data),
				}
			: item,
	);
}

function canonicalizeTool(tool: Tool): unknown {
	return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

function fingerprint(value: unknown): string {
	return `${HASH_VERSION}:${fnv1a(stableSerialize(value))}`;
}

function stableSerialize(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`);
	return `{${entries.join(",")}}`;
}

function fnv1a(value: string): string {
	return new Fnv1aStream().update(value).digest();
}

/**
 * 与 stableSerialize(items 数组前 count 项) 再 fingerprint 的结果逐位一致，
 * 但只对已序列化的元素做一遍流式哈希，在各个 count 处取快照。
 */
function fingerprintArrayPrefixes(serializedItems: readonly string[], counts: readonly number[]): Map<number, string> {
	const wanted = new Set(counts);
	const result = new Map<number, string>();
	const stream = new Fnv1aStream().update("[");
	const snapshot = (count: number) => {
		if (wanted.has(count)) result.set(count, `${HASH_VERSION}:${stream.clone().update("]").digest()}`);
	};
	snapshot(0);
	for (let index = 0; index < serializedItems.length; index++) {
		if (index > 0) stream.update(",");
		stream.update(serializedItems[index] as string);
		snapshot(index + 1);
	}
	return result;
}

/** 两个种子并行的 FNV-1a，可分段喂入；分段结果与对拼接后的整串一次计算相同。 */
class Fnv1aStream {
	constructor(
		private first = 0x811c9dc5,
		private second = 0x9e3779b9,
	) {}

	update(value: string): this {
		let first = this.first;
		let second = this.second;
		for (let index = 0; index < value.length; index++) {
			const code = value.charCodeAt(index);
			first = Math.imul(first ^ code, 0x01000193);
			second = Math.imul(second ^ code, 0x01000193);
		}
		this.first = first;
		this.second = second;
		return this;
	}

	clone(): Fnv1aStream {
		return new Fnv1aStream(this.first, this.second);
	}

	digest(): string {
		return `${toHex32(this.first)}${toHex32(this.second)}`;
	}
}

function toHex32(hash: number): string {
	return (hash >>> 0).toString(16).padStart(8, "0");
}

const MAX_REMEMBERED_IMAGE_HASHES = 64;
const imageHashes = new Map<string, string>();

/** 图片 base64 动辄数 MB，同一张图在一轮的每次模型调用里都会出现；按内容记住它的指纹。 */
function fingerprintImageData(data: string): string {
	const known = imageHashes.get(data);
	if (known !== undefined) return known;
	const hash = fingerprint(data);
	imageHashes.set(data, hash);
	if (imageHashes.size > MAX_REMEMBERED_IMAGE_HASHES) {
		imageHashes.delete(imageHashes.keys().next().value as string);
	}
	return hash;
}

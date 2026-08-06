import type { AssistantMessage, Tool } from "@vetta/ai";

/**
 * 把「被模型写成正文的工具调用参数」还原成真实 tool call。
 *
 * 背景：gpt-5.x 一类模型在同一轮里既要叙述又要干活时，会把叙述型工具（progress）的
 * 参数当作 tool call 前的 preamble 正文吐出来，真正的工具调用只留给另一个工具。
 * 线上抓包确认参数是逐 token 从 `delta.content` 出来的，流里根本没有对应的
 * `tool_calls`，所以这不是协议解析问题，只能在这一层兜底。
 *
 * 兜底范围由调用方给定的白名单限定（只放无副作用的叙述/状态类工具），并要求参数键
 * 精确命中唯一一个候选工具，避免把模型正常的 JSON 回复误执行成工具调用。
 */

/** 从 index 处扫描一个平衡的 JSON 对象，返回其结束位置（不含）；扫不到返回 -1。 */
function scanJsonObject(text: string, start: number): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return i + 1;
		}
	}
	return -1;
}

/** 解析正文开头的完整 JSON 对象，返回对象与剩余正文。 */
function parseLeadingJsonObject(text: string): { value: Record<string, unknown>; rest: string } | null {
	const start = text.search(/\S/);
	if (start < 0 || text[start] !== "{") return null;
	const end = scanJsonObject(text, start);
	if (end < 0) return null;
	let value: unknown;
	try {
		value = JSON.parse(text.slice(start, end));
	} catch {
		return null;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return { value: value as Record<string, unknown>, rest: text.slice(end) };
}

function toolPropertyNames(tool: Tool): Set<string> {
	const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties;
	return new Set(properties ? Object.keys(properties) : []);
}

/** 参数键必须是某个候选工具属性的子集，且候选唯一，才认定为泄漏的调用。 */
function matchTool(args: Record<string, unknown>, candidates: Tool[]): Tool | null {
	const keys = Object.keys(args);
	if (keys.length === 0) return null;
	const matched = candidates.filter((tool) => {
		const properties = toolPropertyNames(tool);
		return keys.every((key) => properties.has(key));
	});
	return matched.length === 1 ? matched[0] : null;
}

/**
 * 就地改写 message：把命中白名单的正文 JSON 换成 toolCall block。
 * @returns 是否发生了还原。
 */
export function salvageTextToolCalls(
	message: AssistantMessage,
	tools: Tool[] | undefined,
	allowedToolNames: readonly string[],
): boolean {
	if (!tools?.length || allowedToolNames.length === 0) return false;
	const allowed = new Set(allowedToolNames);
	const candidates = tools.filter((tool) => allowed.has(tool.name));
	if (candidates.length === 0) return false;

	const content: AssistantMessage["content"] = [];
	let salvaged = 0;

	for (const block of message.content) {
		if (block.type !== "text") {
			content.push(block);
			continue;
		}
		const parsed = parseLeadingJsonObject(block.text);
		const tool = parsed && matchTool(parsed.value, candidates);
		if (!parsed || !tool) {
			content.push(block);
			continue;
		}
		salvaged++;
		content.push({
			type: "toolCall",
			id: `salvaged_${tool.name}_${salvaged}_${message.timestamp}`,
			name: tool.name,
			arguments: parsed.value,
		});
		if (parsed.rest.trim()) {
			content.push({ ...block, text: parsed.rest });
		}
	}

	if (salvaged === 0) return false;
	message.content = content;
	// 模型没走 tool call 通道时 stopReason 会是 "stop"，还原后必须让 loop 继续跑工具。
	if (message.stopReason === "stop") message.stopReason = "toolUse";
	return true;
}

// OpenAI 兼容端点后面可能坐着 Gemini（各类 proxy 会把 tools 翻成 Gemini 的 OpenAPI
// `parameters`）。Gemini 把每个 anyOf/oneOf 分支当独立 Schema 校验，只带约束关键字、
// 没有 type/properties 的分支（如 `{ "required": ["a"] }`）会让整个请求 400 —— 一个
// 工具的 schema 就能废掉整轮对话，且报错里只有工具下标，极难定位。这里在发出前剔掉
// 这类分支：它们对模型只是软提示，丢掉远好过整轮失败。

const warnedTools = new Set<string>();

/** 只有约束关键字、无法表达成 OpenAPI Schema 的分支。 */
function isConstraintOnlyBranch(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const branch = value as Record<string, unknown>;
	return !("type" in branch) && !("properties" in branch) && !("$ref" in branch);
}

function sanitizeNode(node: unknown, dropped: string[]): unknown {
	if (Array.isArray(node)) return node.map((item) => sanitizeNode(item, dropped));
	if (!node || typeof node !== "object") return node;

	const source = node as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(source)) {
		if ((key === "anyOf" || key === "oneOf") && Array.isArray(value)) {
			const kept = value.filter((branch) => !isConstraintOnlyBranch(branch));
			if (kept.length !== value.length) dropped.push(key);
			// 分支全被剔掉时整个关键字也留不得，否则是个空的组合约束。
			if (kept.length === 0) continue;
			result[key] = kept.map((branch) => sanitizeNode(branch, dropped));
			continue;
		}
		result[key] = sanitizeNode(value, dropped);
	}
	return result;
}

/**
 * 剔除工具参数 schema 中只带约束关键字的 anyOf/oneOf 分支。没有这类分支时原样返回，
 * 不做任何拷贝。
 */
export function sanitizeToolParameters(toolName: string, parameters: unknown): unknown {
	if (!parameters || typeof parameters !== "object") return parameters;
	const dropped: string[] = [];
	const sanitized = sanitizeNode(parameters, dropped);
	if (dropped.length === 0) return parameters;
	if (!warnedTools.has(toolName)) {
		warnedTools.add(toolName);
		console.warn(
			`[ai] tool "${toolName}": dropped ${dropped.length} ${[...new Set(dropped)].join("/")} branch(es) that carry only constraints (no type/properties); such branches break Gemini-backed OpenAI-compatible endpoints. Express the constraint in the property descriptions instead.`,
		);
	}
	return sanitized;
}

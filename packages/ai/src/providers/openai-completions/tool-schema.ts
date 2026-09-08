// 部分 OpenAI 兼容网关（包括把请求转发到 Gemini 的网关）会把 tools 翻成另一种
// OpenAPI 方言。它们把每个 anyOf/oneOf 分支当独立 Schema 校验，只带约束关键字、
// 没有结构关键字的分支（如 `{ "required": ["a"] }`）会让整个请求 400 —— 一个工具
// 的 schema 就能废掉整轮对话，且报错里只有工具下标，极难定位。这里在发出前剔掉
// 这类分支：它们对模型只是软提示，丢掉远好过整轮失败。
//
// 同理，Gemini 的 `function_declarations[].parameters` 只接受 OpenAPI 3.0 Schema 的
// 固定字段集，遇到 JSON Schema 才有的校验关键字会直接报
// `Unknown name "uniqueItems" ... Cannot find field`。这些关键字对模型同样只是软提示
// （真正的入参校验在我们自己的 TypeBox 里做），所以一并剔除。

const warnedTools = new Set<string>();

/**
 * JSON Schema 的纯约束关键字：不改变 schema 结构，只表达取值限制。
 * Gemini（以及转发到 Gemini 的 OpenAI 兼容网关）的 OpenAPI 子集里没有这些字段。
 */
const unsupportedConstraintKeywords = new Set([
	"uniqueItems",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"multipleOf",
	"$schema",
	"$id",
]);

/** 子节点是「属性名 -> Schema」映射而非 Schema 本身的关键字。 */
const schemaMapKeywords = new Set(["properties", "patternProperties", "$defs", "definitions"]);

/** 只有约束关键字、无法表达成 OpenAPI Schema 的分支。 */
function isConstraintOnlyBranch(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const branch = value as Record<string, unknown>;
	const structuralKeywords = [
		"type",
		"properties",
		"items",
		"prefixItems",
		"$ref",
		"const",
		"enum",
		"anyOf",
		"oneOf",
		"allOf",
		"not",
		"if",
		"then",
		"else",
	] as const;
	return !structuralKeywords.some((key) => key in branch);
}

/**
 * @param isSchema 当前节点是否是一个 Schema 对象；为 false 时说明它是属性名映射，
 * 键名不能按关键字处理（工具真的可以有个叫 `uniqueItems` 的入参）。
 */
function sanitizeNode(node: unknown, dropped: string[], isSchema: boolean): unknown {
	if (Array.isArray(node)) return node.map((item) => sanitizeNode(item, dropped, isSchema));
	if (!node || typeof node !== "object") return node;

	const source = node as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(source)) {
		if (!isSchema) {
			result[key] = sanitizeNode(value, dropped, true);
			continue;
		}
		if (unsupportedConstraintKeywords.has(key)) {
			dropped.push(key);
			continue;
		}
		if ((key === "anyOf" || key === "oneOf") && Array.isArray(value)) {
			const kept = value.filter((branch) => !isConstraintOnlyBranch(branch));
			if (kept.length !== value.length) dropped.push(key);
			// 分支全被剔掉时整个关键字也留不得，否则是个空的组合约束。
			if (kept.length === 0) continue;
			result[key] = kept.map((branch) => sanitizeNode(branch, dropped, true));
			continue;
		}
		result[key] = sanitizeNode(value, dropped, !schemaMapKeywords.has(key));
	}
	return result;
}

/**
 * 剔除工具参数 schema 中只带约束关键字的 anyOf/oneOf 分支，以及 OpenAPI 子集不认识的
 * 纯约束关键字。没有这类内容时原样返回，不做任何拷贝。
 */
export function sanitizeToolParameters(toolName: string, parameters: unknown): unknown {
	if (!parameters || typeof parameters !== "object") return parameters;
	const dropped: string[] = [];
	const sanitized = sanitizeNode(parameters, dropped, true);
	if (dropped.length === 0) return parameters;
	if (!warnedTools.has(toolName)) {
		warnedTools.add(toolName);
		console.warn(
			`[ai] tool "${toolName}": dropped ${dropped.length} ${[...new Set(dropped)].join("/")} keyword(s)/branch(es) that carry only constraints (no schema structure); this shape is rejected by some OpenAI-compatible gateways, including Gemini-backed gateways. Express the constraint in the property descriptions instead.`,
		);
	}
	return sanitized;
}

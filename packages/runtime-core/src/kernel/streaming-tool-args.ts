/**
 * 流式工具参数的播报节流规则。
 *
 * provider 每来一段 `input_json_delta` 就重新增量解析一次参数对象，一次 write
 * 的正文有几千个 token——照单播报等于把订阅链路淹掉。消费方真正要的只是「这次
 * 调用的目标是谁」，而目标（路径）总是靠前的键，所以按「值已完整的键数增长」
 * 触发即可：一个工具就那么几个参数，天然收敛。
 */

/** 一次值得播报的参数增长。`keyCount` 回写给调用方作为下次比较的基线。 */
export interface SettledToolArgs {
	args: Record<string, unknown>;
	keyCount: number;
}

/**
 * @param args 增量解析出的参数对象（`parseStreamingJson` 的结果），可能是任何东西。
 * @param emittedKeyCount 这次调用已经播报过的键数。
 * @returns 没有新的完整键时返回 null。
 */
export function settledToolArgs(args: unknown, emittedKeyCount: number): SettledToolArgs | null {
	if (args === null || typeof args !== "object" || Array.isArray(args)) return null;
	const record = args as Record<string, unknown>;
	const keys = Object.keys(record);
	// 最后一个键的值还在流式生成中（字符串会一段段变长），只认它之前的那些。
	const settled = keys.slice(0, -1);
	if (settled.length <= emittedKeyCount) return null;
	const partial: Record<string, unknown> = {};
	for (const key of settled) partial[key] = record[key];
	return { args: partial, keyCount: settled.length };
}

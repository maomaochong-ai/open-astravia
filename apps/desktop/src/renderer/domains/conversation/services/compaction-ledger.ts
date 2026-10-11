/**
 * 压缩机械账本的读端窄化。
 *
 * 账本在写端由 `buildMechanicalLedger`（coding-agent）生成，落在 CompactionEntry 的
 * `details.ledger`；经会话文档 → 历史投影 → IPC 原样带到渲染器，但类型是 `unknown`。
 * 这里把它窄成卡片可渲染的定长视图：文件清单有界（账本有界是方案红线），
 * 计数与 token 估算取不到就归零而不是渲染出垃圾。
 */

/** 单张文件清单在卡片里最多列几条（超出即截断，与写端 `LEDGER_MAX_FILES_PER_LIST` 同界）。 */
export const MAX_LEDGER_FILES = 60;

export interface CompactionLedgerView {
	readonly readFiles: readonly string[];
	readonly modifiedFiles: readonly string[];
	/** 被摘要区间的消息总数（按角色求和）。 */
	readonly messageCount: number;
	/** 被摘要区间的 token 估算（逐字口径）。 */
	readonly estimatedTokens: number;
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string");
}

function countMessages(value: unknown): number {
	if (typeof value !== "object" || value === null) return 0;
	let total = 0;
	for (const count of Object.values(value as Record<string, unknown>)) {
		if (typeof count === "number" && Number.isFinite(count) && count > 0) total += count;
	}
	return total;
}

function tokenEstimate(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 窄化 `details` 里的机械账本。没有任何可用事实时返回 undefined——空账本渲染出来
 * 只是一块空壳，不如不显示（与写端 `formatMechanicalLedger` 的空值约定一致）。
 */
export function extractCompactionLedger(details: unknown): CompactionLedgerView | undefined {
	if (typeof details !== "object" || details === null) return undefined;
	const ledger = (details as { ledger?: unknown }).ledger;
	if (typeof ledger !== "object" || ledger === null) return undefined;
	const record = ledger as Record<string, unknown>;

	const readFiles = stringList(record.readFiles).slice(0, MAX_LEDGER_FILES);
	const modifiedFiles = stringList(record.modifiedFiles).slice(0, MAX_LEDGER_FILES);
	const messageCount = countMessages(record.messageCounts);
	const estimatedTokens = tokenEstimate(record.estimatedTokens);

	if (readFiles.length === 0 && modifiedFiles.length === 0 && messageCount === 0 && estimatedTokens === 0) {
		return undefined;
	}
	return { readFiles, modifiedFiles, messageCount, estimatedTokens };
}

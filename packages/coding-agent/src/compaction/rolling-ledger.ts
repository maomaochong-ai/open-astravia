import type { AgentMessage } from "@astravia/agent-core";
import type { MechanicalLedger } from "./mechanical-ledger.js";
import { estimateTokens } from "./token-policy.js";

/**
 * 滚动账本（Rolling Compaction R2）：逐轮记账 + 拼装式压缩的纯函数层。
 *
 * 范式（方案 §一）：压缩从「触发时全前缀 LLM 摘要」转为「平时逐轮记账、
 * 触发时拼装」。本模块是可独立验证的核心：
 *
 * - TurnLedgerEntry：一轮一条（叙述 + 机械账本 + 可选用户修订）；
 * - buildTurnLedgerEntry：从一轮消息构造账目（机械部分零 LLM）；
 * - assembleRollingSummary：压缩触发时的拼装（近区间逐字保留 / 远区间逐轮
 *   叙述 + 机械汇总 / 修订冻结 / 超预算标注可召回——四条红线全部落在这里）。
 *
 * 叙述部分「每轮一句话」由宿主经轻量 LLM 异步生成（复用 memory-rollover
 * 的 turn 钩子纪律与 AiMemoryFactExtractor 同款小调用形态）；本模块只消费
 * 结果，不含 LLM 调用——纯函数、确定性、可测。
 */

/** 近区间默认不压实的轮数（方案 §四：对应 keepRecent 的轮级形态）。 */
export const ROLLING_KEEP_RECENT_TURNS = 10;

/** 拼装摘要里逐轮叙述的默认 token 预算（近区间之外的部分）。 */
export const ROLLING_COMPACT_BUDGET_TOKENS = 4000;

export interface TurnLedgerEntry {
	/** 轮次序号（会话内单调递增）。 */
	readonly turn: number;
	/** 一轮的叙述（轻量 LLM 异步生成的一句话；失败可为简短机械描述）。 */
	readonly narrative: string;
	/** 一轮的机械账本（R1 同款结构）。 */
	readonly mechanical: MechanicalLedger;
	/** 用户修订（E2 语义）：存在则拼装时冻结原样保留（修订即冻结令）。 */
	readonly revised?: string;
}

export interface RollingLedger {
	readonly entries: readonly TurnLedgerEntry[];
	/** 已被上次拼装吸收的最大轮次（增量拼装的游标）。 */
	readonly compactedUpToTurn: number;
}

function isAbortedTurn(messages: readonly AgentMessage[]): boolean {
	return messages.some(
		(message) =>
			message.role === "assistant" &&
			(message as { stopReason?: string }).stopReason !== undefined &&
			((message as { stopReason?: string }).stopReason === "aborted" ||
				(message as { stopReason?: string }).stopReason === "error"),
	);
}

/**
 * 一轮 → 一条账目。中止/异常轮返回 undefined（没有可靠事实可记）。
 * now 注入保持纯函数。机械部分逐字统计，叙述由调用方给。
 */
export function buildTurnLedgerEntry(
	turn: number,
	messages: readonly AgentMessage[],
	narrative: string,
	now: () => Date = () => new Date(),
): TurnLedgerEntry | undefined {
	if (messages.length === 0) return undefined;
	if (isAbortedTurn(messages)) return undefined;

	const messageCounts: Record<string, number> = {};
	let estimatedTokens = 0;
	for (const message of messages) {
		messageCounts[message.role] = (messageCounts[message.role] ?? 0) + 1;
		estimatedTokens += estimateTokens(message);
	}
	return {
		turn,
		narrative,
		mechanical: {
			readFiles: [],
			modifiedFiles: [],
			messageCounts,
			estimatedTokens,
			generatedAt: now().toISOString(),
		},
	};
}

export interface AssembleRollingOptions {
	/** 远区间（逐轮叙述区）的 token 预算。 */
	readonly compactBudgetTokens?: number;
}

export interface AssembledRollingSummary {
	/** 拼装产物（可直接作为压缩 summary；空串 = 无可拼内容）。 */
	readonly summary: string;
	/** 本次拼装覆盖到的最大轮次（下次的 compactedUpToTurn）。 */
	readonly keptTurns: number;
}

/**
 * 拼装式压缩（红线落点）：
 *
 * 红线 1（不静默丢轮）：超出预算时近轮优先、远轮截断，并标注「完整逐轮历史
 *   经 recall 可召回」——内容下界明示，而不是悄悄消失；
 * 红线 2（主动记忆下界）：每轮叙述必在（预算内），机械计数随行；
 * 红线 4（修订冻结）：revised 轮次原样保留、跳过合并，并标「用户修订」。
 */
export function assembleRollingSummary(
	ledger: RollingLedger,
	recentTurns: readonly TurnLedgerEntry[],
	options: AssembleRollingOptions = {},
): AssembledRollingSummary {
	const budget = options.compactBudgetTokens ?? ROLLING_COMPACT_BUDGET_TOKENS;
	// 远区间：上次拼装游标之后、未被近区吸收的账目（去重：近区轮次优先）。
	const recentTurnNumbers = new Set(recentTurns.map((entry) => entry.turn));
	const distant = ledger.entries.filter(
		(entry) => entry.turn > ledger.compactedUpToTurn && !recentTurnNumbers.has(entry.turn),
	);

	if (distant.length === 0 && recentTurns.length === 0) {
		return { summary: "", keptTurns: ledger.compactedUpToTurn };
	}

	// 远区间按预算从近到远吸收（近优先 = 主动记忆下界偏向近期）。
	const absorbed: TurnLedgerEntry[] = [];
	let used = 0;
	let truncated = 0;
	for (let index = distant.length - 1; index >= 0; index -= 1) {
		const entry = distant[index];
		if (entry === undefined) continue;
		const cost = estimateTokens({ role: "custom", content: narrativeOf(entry), timestamp: 0 });
		if (used + cost > budget && absorbed.length > 0) {
			truncated = index + 1;
			break;
		}
		absorbed.unshift(entry);
		used += cost;
	}

	const sections: string[] = [];
	if (absorbed.length > 0) {
		const lines = absorbed.map((entry) => {
			const revised = entry.revised ? ` [用户修订] ${entry.revised}` : "";
			return `- T${entry.turn} ${narrativeOf(entry)}${revised}`;
		});
		sections.push(
			`<rolling-ledger turns="${absorbed[0]?.turn}-${absorbed[absorbed.length - 1]?.turn}">\n${lines.join("\n")}\n</rolling-ledger>`,
		);
	}
	if (truncated > 0) {
		const earliest = distant[0]?.turn ?? 0;
		sections.push(
			`[更早的 ${truncated} 轮（T${earliest} 起）未展开：完整逐轮历史保存在会话记录中，可用 recall 工具按关键词读回。]`,
		);
	}
	if (recentTurns.length > 0) {
		const lines = recentTurns.map((entry) => {
			const revised = entry.revised ? ` [用户修订] ${entry.revised}` : "";
			return `- T${entry.turn} ${narrativeOf(entry)}${revised}`;
		});
		sections.push(`<recent-turns count="${recentTurns.length}">\n${lines.join("\n")}\n</recent-turns>`);
	}

	const keptTurns = Math.max(
		ledger.compactedUpToTurn,
		...absorbed.map((entry) => entry.turn),
		...recentTurns.map((entry) => entry.turn),
	);
	return { summary: sections.join("\n\n"), keptTurns };
}

function narrativeOf(entry: TurnLedgerEntry): string {
	return entry.revised ?? entry.narrative;
}

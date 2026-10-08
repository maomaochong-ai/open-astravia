import type { AgentMessage } from "@astravia/agent-core";
import type { CompactionHistoryEntry } from "./contracts.js";
import { extractFileOpsFromMessage, type FileOperations } from "./summary-support.js";
import { estimateTokens } from "./token-policy.js";

/**
 * 机械账本（Rolling Compaction R1）：压缩区间的确定性事实提取。
 *
 * 设计（滚动压缩方案 §四 Layer 1 的机械部分 / §六 R1）：
 * 账本先行落位——压缩触发的瞬间机械层毫秒级可出，叙述摘要照常异步生成。
 * 账本只含确定性事实（文件、命令、计数、token），零 LLM、零幻觉、可对照
 * 原文逐条验证；它是「完整账本」记录要求的强化，也充当叙述摘要缺失时的
 * 降级内容（失败时账本仍在，压缩不空手而归——PI #688 禁空尾的延伸）。
 */

export interface MechanicalLedger {
	/** 只读文件（被读过、未被改动），排序去重。 */
	readonly readFiles: readonly string[];
	/** 被改动文件（编辑或写入），排序去重。 */
	readonly modifiedFiles: readonly string[];
	/** 被摘要区间的消息数（按角色计数）。 */
	readonly messageCounts: Readonly<Record<string, number>>;
	/** 被摘要区间的 token 估算（逐字口径）。 */
	readonly estimatedTokens: number;
	/** 账本生成时间戳（ISO）。 */
	readonly generatedAt: string;
}

/**
 * 从被压缩区间提取机械账本。纯函数：同输入恒同输出（无时间依赖——now 注入）。
 * 文件清单复用 extractFileOpsFromMessage 的既有提取逻辑（与叙述摘要同源，
 * 保证账本与摘要里的文件列表不会各说各话）。
 */
export function buildMechanicalLedger(
	messages: readonly AgentMessage[],
	pathEntries: readonly CompactionHistoryEntry[],
	previousCompactionIndex: number,
	now: () => Date = () => new Date(),
): MechanicalLedger {
	const fileOps: FileOperations = createEmptyFileOps();
	// 与 compact() 的 extractFileOperations 同序：先吸收历史 compaction 的清单，
	// 再从区间消息逐条提取——保持与叙述摘要输入完全一致。
	for (let index = previousCompactionIndex + 1; index < pathEntries.length; index += 1) {
		const entry = pathEntries[index];
		if (entry?.type !== "compaction") continue;
		const details = entry.details as { readFiles?: unknown; modifiedFiles?: unknown } | undefined;
		if (details && Array.isArray(details.readFiles)) {
			for (const file of details.readFiles) if (typeof file === "string") fileOps.read.add(file);
		}
		if (details && Array.isArray(details.modifiedFiles)) {
			for (const file of details.modifiedFiles) if (typeof file === "string") fileOps.edited.add(file);
		}
	}
	for (const message of messages) extractFileOpsFromMessage(message, fileOps);

	const modified = new Set([...fileOps.edited, ...fileOps.written]);
	const messageCounts: Record<string, number> = {};
	let estimatedTokens = 0;
	for (const message of messages) {
		messageCounts[message.role] = (messageCounts[message.role] ?? 0) + 1;
		estimatedTokens += estimateTokens(message);
	}

	return {
		readFiles: [...fileOps.read].filter((file) => !modified.has(file)).sort(),
		modifiedFiles: [...modified].sort(),
		messageCounts,
		estimatedTokens,
		generatedAt: now().toISOString(),
	};
}

function createEmptyFileOps(): FileOperations {
	return {
		read: new Set<string>(),
		edited: new Set<string>(),
		written: new Set<string>(),
	};
}

/**
 * 账本 → 有界文本块（拼进摘要投影 / 降级内容两用）。
 * 上限约束：文件清单超限截断并标注（账本有界是方案红线——不能无限膨胀）。
 */
export const LEDGER_MAX_FILES_PER_LIST = 60;

export function formatMechanicalLedger(ledger: MechanicalLedger): string {
	const sections: string[] = [];
	const fileList = (files: readonly string[], tag: string): string => {
		if (files.length === 0) return "";
		const shown = files.slice(0, LEDGER_MAX_FILES_PER_LIST);
		const overflow = files.length - shown.length;
		const body = shown.join("\n");
		return `<${tag}>\n${body}${overflow > 0 ? `\n…另有 ${overflow} 个（账本有界截断，完整清单可从原始历史核对）` : ""}\n</${tag}>`;
	};
	const files = fileList(ledger.readFiles, "read-files") + fileList(ledger.modifiedFiles, "modified-files");
	if (files) sections.push(files);
	const roles = Object.entries(ledger.messageCounts)
		.map(([role, count]) => `${role}:${count}`)
		.join(" ");
	if (roles) sections.push(`<counts messages="${roles}" tokens="${ledger.estimatedTokens}" />`);
	return sections.length > 0 ? `<ledger generated-at="${ledger.generatedAt}">\n${sections.join("\n")}\n</ledger>` : "";
}

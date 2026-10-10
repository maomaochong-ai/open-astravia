import type { UserMessage } from "@astravia/ai";
import type { ContextCompactionRecord } from "@astravia/runtime-core/kernel";
import { COMPACTION_SUMMARY_PREFIX, COMPACTION_SUMMARY_SUFFIX } from "../../model-context/index.js";
import type { CodingAgentContextRuntimeOptions } from "../../runtime-contracts/index.js";
import { appendCompactionWorkState, type CompactionResult } from "../index.js";

export interface CodingAgentCompactionRecordFactoryOptions {
	readonly now: () => number;
	readonly readCompactionWorkState: CodingAgentContextRuntimeOptions["readCompactionWorkState"];
}

/** Owns the persisted Coding Agent summary format; Runtime Core treats the record as an opaque domain fact. */
export function createCodingAgentCompactionRecord(
	result: CompactionResult,
	reason: ContextCompactionRecord["reason"],
	fromExtension: boolean,
	options: CodingAgentCompactionRecordFactoryOptions,
): ContextCompactionRecord {
	const timestamp = options.now();
	// `summary` 与 `summaryMessage` 服务两个不同消费者，必须分开：
	//   - `summary` 持久化后供 UI 压缩卡展示，也作为下次压缩的 previousSummary —— 只能是人读的叙述；
	//   - `summaryMessage` 是模型唯一可见的投影（selectConversationDocumentModelMessages 只认它）——
	//     在飞 todo / 后台任务的工作状态只加在这里。
	// 曾经把 work-state 拼进 `summary`，导致压缩卡末尾渲染出 ~6KB 转义 JSON（issue：摘要后缀乱码），
	// 并且下次压缩时这段机器状态被当作「上一次摘要」喂回给模型。
	const summary = result.summary;
	const summaryMessage: UserMessage = {
		role: "user",
		content: [
			{
				type: "text",
				text:
					COMPACTION_SUMMARY_PREFIX +
					appendCompactionWorkState(summary, options.readCompactionWorkState?.()) +
					COMPACTION_SUMMARY_SUFFIX,
			},
		],
		timestamp,
	};
	return {
		summary,
		summaryMessage,
		firstKeptEntryId: result.firstKeptEntryId,
		tokensBefore: result.tokensBefore,
		...(result.details === undefined ? {} : { details: result.details }),
		...(fromExtension ? { fromHook: true } : {}),
		reason,
	};
}

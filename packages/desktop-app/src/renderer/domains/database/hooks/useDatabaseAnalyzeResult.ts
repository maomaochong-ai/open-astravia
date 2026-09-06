import { i18n } from "@shared/i18n";
import {
	activeSessionAtom,
	defaultConversationCwdAtom,
	focusInputRequestAtom,
	inputValueAtom,
	openSessionFnRef,
	pendingAssistSendAtom,
} from "@shared/store/atoms";
import { getDefaultStore, useAtomValue } from "jotai";
import { useCallback } from "react";
import type { DbQueryResult } from "../../../../preload/api-types/database";
import { enqueueSettingsAssistJob } from "../../settings/ai-assist/assistJobQueue";
import { recordSettingsUsage } from "../../settings/components/recordSettingsUsage";
import { ANALYZE_CONTEXT_CHAR_LIMIT, ANALYZE_SQL_CHAR_LIMIT, clipToLimit } from "../lib/analyze-context";
import type { DbConnection } from "../lib/database-api";
import { summarizeQueryResult } from "../lib/result-summary";

export interface AnalyzeResultInput {
	connection: DbConnection;
	sql: string;
	/** 成功时携带结果；失败时为 null（走「解释错误」指令）。 */
	result: DbQueryResult | null;
	error?: string | null;
	errorDetail?: string | null;
}

/**
 * B2.9-W1 反向（v2）：工作台「让 AI 解读此查询」（预填可编辑重设计同款）。
 *
 * 结果网格工具栏按钮 → 打开后台会话（不导航），把自然问句预填进输入框供用户
 * 编辑后发送；SQL 原文 + 结果摘要（列名/行数/前 N 行示例）经 pendingAssistSendAtom
 * 暂存，用户真正发送时随 metadata.settingsAssistInstruction 以 display:false 注入
 * （模型可见、用户不可见），与「让 AI 分析此表」同一套机制。
 */
export function useDatabaseAnalyzeResult(): (input: AnalyzeResultInput) => void {
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);

	return useCallback(
		({ connection, sql, result, error, errorDetail }: AnalyzeResultInput) => {
			const openSession = openSessionFnRef.current;
			const cwd = defaultConversationCwd?.trim() ?? "";
			if (!cwd || !openSession) return;
			// B2.9-W3 埋点：结果网格「让 AI 解读此查询」入口点击；B3.3 失败场景记 analyze-error。
			recordSettingsUsage({
				tab: "database",
				action: "selected",
				target: result ? "analyze-result" : "analyze-error",
			});

			// 预填的可编辑开场白：自然问句，用户可改后回车发送（B2.9 W2 重设计同款）。
			const prefilledText = i18n.t(
				result ? "settings:databaseAnalyzeResult.intent" : "settings:databaseAnalyzeError.intent",
				{
					connection: connection.name,
				},
			);

			// SQL + 结果摘要是同步数据（已执行完），但 openSession 会切换活动订阅，
			// 放进队列与其它 assist 任务串行执行，避免竞争。
			void enqueueSettingsAssistJob(async () => {
				const open = openSessionFnRef.current;
				if (!open) return;
				await open(cwd, undefined, undefined, { navigate: false });
				const store = getDefaultStore();
				// P3:pending 绑定发起时的目标会话,消费端仅在同一会话发送时携带(跨会话丢弃防串上下文)。
				const sessionId = store.get(activeSessionAtom)?.runtimeId;
				// P3-②:token 预算守卫——SQL 主料与摘要各自截断,截断处追加可见提示。
				const clipNotice = (count: number, limit: number) =>
					i18n.t("settings:databaseAnalyzeClipNotice", { count, limit });
				const clippedSql = clipToLimit(sql, ANALYZE_SQL_CHAR_LIMIT);
				const sqlArg = clippedSql.truncated
					? `${clippedSql.text}\n-- ${clipNotice(sql.length, ANALYZE_SQL_CHAR_LIMIT)}`
					: clippedSql.text;
				const rawSummary = result ? summarizeQueryResult(result) : "";
				const clippedSummary = clipToLimit(rawSummary, ANALYZE_CONTEXT_CHAR_LIMIT);
				const summaryArg = clippedSummary.truncated
					? `${clippedSummary.text}\n${clipNotice(rawSummary.length, ANALYZE_CONTEXT_CHAR_LIMIT)}`
					: clippedSummary.text;
				const agentInstruction = i18n.t(
					result ? "settings:databaseAnalyzeResult.instruction" : "settings:databaseAnalyzeError.instruction",
					result
						? {
								connection: connection.name,
								sql: sqlArg,
								summary: summaryArg,
							}
						: {
								connection: connection.name,
								sql: sqlArg,
								error: errorDetail || error || "",
							},
				);
				const current = store.get(inputValueAtom).trim();
				// 输入框已有其它草稿时不覆盖；重复点击同结果则幂等（文本相同直接续用）。
				if (current && current !== prefilledText) return;
				store.set(inputValueAtom, prefilledText);
				// 解读指令暂存，等用户真正发送时随 prompt 带上（不自动直发）。
				store.set(pendingAssistSendAtom, {
					settingsAssistTabId: "database",
					sessionId,
					kind: "analyze-result",
					metadata: {
						settingsAssistInstruction: agentInstruction,
						settingsAssistTabId: "database",
					},
				});
				// 聚焦输入框，让用户可以直接编辑后回车发送（已在会话页时生效）。
				store.set(focusInputRequestAtom, (n) => n + 1);
			});
		},
		[defaultConversationCwd],
	);
}

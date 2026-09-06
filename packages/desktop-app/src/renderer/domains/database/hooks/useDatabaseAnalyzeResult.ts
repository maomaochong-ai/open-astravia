import { i18n } from "@shared/i18n";
import {
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
				const agentInstruction = i18n.t(
					result ? "settings:databaseAnalyzeResult.instruction" : "settings:databaseAnalyzeError.instruction",
					result
						? {
								connection: connection.name,
								sql,
								summary: summarizeQueryResult(result),
							}
						: {
								connection: connection.name,
								sql,
								error: errorDetail || error || "",
							},
				);
				const store = getDefaultStore();
				const current = store.get(inputValueAtom).trim();
				// 输入框已有其它草稿时不覆盖；重复点击同结果则幂等（文本相同直接续用）。
				if (current && current !== prefilledText) return;
				store.set(inputValueAtom, prefilledText);
				// 解读指令暂存，等用户真正发送时随 prompt 带上（不自动直发）。
				store.set(pendingAssistSendAtom, {
					settingsAssistTabId: "database",
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

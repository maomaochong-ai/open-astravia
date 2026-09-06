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
import { enqueueSettingsAssistJob } from "../../settings/ai-assist/assistJobQueue";
import { recordSettingsUsage } from "../../settings/components/recordSettingsUsage";
import { getSchemaContext } from "../lib/database-api";

export type DatabaseSqlAssistSource = "editor" | "history";

const ASSIST_SOURCE_META: Record<
	DatabaseSqlAssistSource,
	{
		kind: "analyze-editor" | "analyze-history";
		target: string;
		intentKey: "settings:databaseAnalyzeEditor.intent" | "settings:databaseAnalyzeHistory.intent";
		instructionKey: "settings:databaseAnalyzeEditor.instruction" | "settings:databaseAnalyzeHistory.instruction";
	}
> = {
	editor: {
		kind: "analyze-editor",
		target: "analyze-editor",
		intentKey: "settings:databaseAnalyzeEditor.intent",
		instructionKey: "settings:databaseAnalyzeEditor.instruction",
	},
	history: {
		kind: "analyze-history",
		target: "analyze-history",
		intentKey: "settings:databaseAnalyzeHistory.intent",
		instructionKey: "settings:databaseAnalyzeHistory.instruction",
	},
};

/**
 * P2 界面→对话：「问 AI」（编辑器当前 SQL）与「AI 分析」（历史 SQL）入口。
 *
 * 复用 B2.9-W2 的「预填可编辑重设计」链路：打开后台会话（不导航）→ 把自然问句预填进
 * 输入框供用户编辑后发送（不自动直发）；连接 schema 摘要异步取到后随
 * metadata.settingsAssistInstruction 注入（display:false：模型可见、用户不可见）。
 * SQL 文本只进指令上下文，不随气泡可见文本携带。
 */
export function useDatabaseAnalyzeSql(source: DatabaseSqlAssistSource): (connectionName: string, sql: string) => void {
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	const meta = ASSIST_SOURCE_META[source];

	return useCallback(
		(connectionName: string, sql: string) => {
			const openSession = openSessionFnRef.current;
			const cwd = defaultConversationCwd?.trim() ?? "";
			if (!cwd || !openSession || !connectionName || !sql.trim()) return;
			// P2 埋点：编辑器/历史 SQL 分析入口点击。
			recordSettingsUsage({ tab: "database", action: "selected", target: meta.target });

			// 预填的可编辑开场白：自然问句，用户可改后回车发送（同 B2.9-W2 重设计）。
			const prefilledText = i18n.t(meta.intentKey, { connection: connectionName });

			// Schema 上下文是异步的（B2.5 getSchemaContext，6KB/连接截断 + 60s TTL 缓存），
			// 放进队列里串行执行，避免与其它 assist 任务竞争 openSession。
			void enqueueSettingsAssistJob(async () => {
				let schema = "";
				try {
					schema = await getSchemaContext(connectionName);
				} catch {
					schema = "";
				}
				const open = openSessionFnRef.current;
				if (!open) return;
				await open(cwd, undefined, undefined, { navigate: false });
				const agentInstruction = i18n.t(meta.instructionKey, {
					connection: connectionName,
					sql,
					schema,
				});
				const store = getDefaultStore();
				const current = store.get(inputValueAtom).trim();
				// 输入框已有其它草稿时不覆盖；重复触发同源则幂等（文本相同直接续用）。
				if (current && current !== prefilledText) return;
				store.set(inputValueAtom, prefilledText);
				// 指令上下文暂存，等用户真正发送时随 prompt 带上（不自动直发）。
				store.set(pendingAssistSendAtom, {
					kind: meta.kind,
					settingsAssistTabId: "database",
					metadata: {
						settingsAssistInstruction: agentInstruction,
						settingsAssistTabId: "database",
					},
				});
				// 聚焦输入框，让用户可以直接编辑后回车发送（已在会话页时生效）。
				store.set(focusInputRequestAtom, (n) => n + 1);
			});
		},
		[defaultConversationCwd, meta],
	);
}

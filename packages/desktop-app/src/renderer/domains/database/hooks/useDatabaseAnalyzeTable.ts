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
import type { DbConnection } from "../lib/database-api";
import { getSchemaContext } from "../lib/database-api";

/**
 * B2.9 W2 界面→对话：「让 AI 分析此表」（预填可编辑重设计）。
 *
 * 表行 hover 的魔法棒按钮 → 打开后台会话（不导航），把自然问句预填进输入框供用户
 * 编辑后发送（不再自动直发）；schema 摘要经 pendingAssistSendAtom 暂存，用户真正
 * 发送时随 metadata.settingsAssistInstruction 以 display:false 注入（模型可见、
 * 用户不可见），databaseTable 随 metadata 持久化，气泡可回跳「在界面打开」。
 */
export function useDatabaseAnalyzeTable(): (connection: DbConnection, table: string) => void {
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);

	return useCallback(
		(connection: DbConnection, table: string) => {
			const openSession = openSessionFnRef.current;
			const cwd = defaultConversationCwd?.trim() ?? "";
			if (!cwd || !openSession) return;
			// B2.9-W3 埋点：表行魔法棒「让 AI 分析此表」入口点击。
			recordSettingsUsage({ tab: "database", action: "selected", target: "analyze-table" });

			// 预填的可编辑开场白：自然问句，用户可改后回车发送（B2.9 W2 重设计）。
			const prefilledText = i18n.t("settings:databaseAnalyzeTable.intent", {
				table,
				connection: connection.name,
			});

			// Schema 上下文是异步的（B2.5 getSchemaContext，6KB/连接截断 + 60s TTL 缓存），
			// 放进队列里串行执行，避免与其它 assist 任务竞争 openSession。
			void enqueueSettingsAssistJob(async () => {
				let schema = "";
				try {
					schema = await getSchemaContext(connection.name);
				} catch {
					schema = "";
				}
				const open = openSessionFnRef.current;
				if (!open) return;
				await open(cwd, undefined, undefined, { navigate: false });
				const agentInstruction = i18n.t("settings:databaseAnalyzeTable.instruction", {
					table,
					connection: connection.name,
					schema: schema || i18n.t("settings:databaseAnalyzeTable.noSchema"),
				});
				const store = getDefaultStore();
				const current = store.get(inputValueAtom).trim();
				// 输入框已有其它草稿时不覆盖；重复点击同表则幂等（文本相同直接续用）。
				if (current && current !== prefilledText) return;
				store.set(inputValueAtom, prefilledText);
				// schema 指令与表目标暂存，等用户真正发送时随 prompt 带上（不自动直发）。
				store.set(pendingAssistSendAtom, {
					kind: "analyze-table",
					settingsAssistTabId: "database",
					databaseTable: { connection: connection.name, table },
					metadata: {
						settingsAssistInstruction: agentInstruction,
						settingsAssistTabId: "database",
						databaseTable: { connection: connection.name, table },
					},
				});
				// 聚焦输入框，让用户可以直接编辑后回车发送（已在会话页时生效）。
				store.set(focusInputRequestAtom, (n) => n + 1);
			});
		},
		[defaultConversationCwd],
	);
}

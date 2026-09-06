import type { TextBlockViewProps } from "@astravia/theme-ui/chat";
import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { isSubPath, pathBasename } from "@shared/lib/utils";
import {
	type DatabaseSqlAction,
	pendingDatabaseSqlActionAtom,
} from "@shared/store/activity-atoms";
import {
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	chatMessagesAtom,
	filePreviewAtom,
	openInlineFilePreviewAtom,
	openUrlInBrowserAtom,
	resolvedThemeAtom,
} from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getFileIcon } from "../../file-explorer/components/fileIcons";
import { resolveChatFilePath } from "../lib/resolve-chat-file-path";
import { resolveSessionAnchorConnection } from "../lib/chat-session-anchor";

/** SQL 方言集合（小写）：命中即为代码块动作插槽的目标语言。 */
const SQL_DIALECTS = new Set([
	"sql",
	"mysql",
	"mariadb",
	"postgres",
	"postgresql",
	"pgsql",
	"plsql",
	"sqlite",
	"mssql",
	"tsql",
	"sqlserver",
	"oracle",
	"db2",
	"duckdb",
	"clickhouse",
	"bigquery",
	"hive",
	"spark",
	"trino",
	"snowflake",
	"redshift",
]);

function isSqlDialect(lang: string): boolean {
	return SQL_DIALECTS.has(lang.trim().toLowerCase());
}
export type TextBlockModel = Omit<TextBlockViewProps, "text" | "isStreamingTail" | "className">;

export function useTextBlockModel(): TextBlockModel {
	const { t } = useTranslation("chat");
	const theme = useAtomValue(resolvedThemeAtom);
	const activeSession = useAtomValue(activeSessionAtom);
	const setFilePreview = useSetAtom(filePreviewAtom);
	const openInlineFilePreview = useSetAtom(openInlineFilePreviewAtom);
	const setActivityPanelOpen = useSetAtom(activityPanelOpenAtom);
	const setActivityTabByProject = useSetAtom(activityPanelTabByProjectAtom);
	const openUrlInBrowser = useSetAtom(openUrlInBrowserAtom);
	const narrow = useNarrowScreen();
	const cwd = activeSession?.cwd ?? null;
	const chatMessages = useAtomValue(chatMessagesAtom);
	const setPendingDatabaseSqlAction = useSetAtom(pendingDatabaseSqlActionAtom);

	// P1：SQL 块动作的会话锚点 —— 取本会话最近一条携带 databaseTable 的 user 消息的连接。
	// 消息块渲染层无「所属消息」信息，用会话级最近锚点近似；无锚点时不显示「执行」，
	// 「在新查询打开」的连接由工作台当前选中决定（action.connection 缺省）。
	const sessionAnchorConnection = useMemo(
		() => resolveSessionAnchorConnection(chatMessages),
		[chatMessages],
	);

	const onOpenFile = useCallback(
		(path: string) => {
			const resolved = resolveChatFilePath(path, cwd);
			const name = pathBasename(resolved);
			if (!narrow && cwd && isSubPath(resolved, cwd)) {
				setActivityPanelOpen(true);
				setActivityTabByProject((prev) => new Map(prev).set(cwd, "file"));
				openInlineFilePreview({ name, path: resolved });
				return;
			}
			setFilePreview({ name, path: resolved });
		},
		[narrow, cwd, setFilePreview, openInlineFilePreview, setActivityPanelOpen, setActivityTabByProject],
	);

	const onOpenUrl = useCallback(
		(url: string) => {
			openUrlInBrowser(url);
		},
		[openUrlInBrowser],
	);

	const getFileIconClass = useCallback((fileName: string) => getFileIcon(fileName, false, false), []);

	/** 打开/切到数据库工作台 tab（activity panel）。有项目 cwd 时按 cwd 定位 tab。 */
	const openDatabaseActivity = useCallback(() => {
		setActivityPanelOpen(true);
		if (cwd) {
			setActivityTabByProject((prev) => new Map(prev).set(cwd, "database"));
		}
	}, [cwd, setActivityPanelOpen, setActivityTabByProject]);

	const queueSqlAction = useCallback(
		(kind: DatabaseSqlAction["kind"], sql: string) => {
			setPendingDatabaseSqlAction({ kind, sql, connection: sessionAnchorConnection });
			openDatabaseActivity();
		},
		[sessionAnchorConnection, setPendingDatabaseSqlAction, openDatabaseActivity],
	);

	/**
	 * SQL 代码块动作插槽：仅 sql 方言渲染「在新查询打开 / 执行」按钮。
	 * 引用由 theme-ui 经 ref 读取，此处 useCallback 依赖变化不会触发 markdown 树 remount。
	 */
	const renderCodeBlockActions = useCallback(
		(lang: string, code: string) => {
			if (!isSqlDialect(lang)) return null;
			const actionClass =
				"inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground";
			return (
				<span className="inline-flex items-center gap-1.5">
					<button
						type="button"
						className={actionClass}
						title={t("sqlAction.openInNewQuery")}
						onClick={() => queueSqlAction("open", code)}
					>
						<span className="icon-[solar--file-download-outline] h-3 w-3" aria-hidden="true" />
						{t("sqlAction.openInNewQuery")}
					</button>
					{sessionAnchorConnection && (
						<button
							type="button"
							className={actionClass}
							title={t("sqlAction.runQuery")}
							onClick={() => queueSqlAction("run", code)}
						>
							<span className="icon-[solar--play-outline] h-3 w-3" aria-hidden="true" />
							{t("sqlAction.runQuery")}
						</button>
					)}
				</span>
			);
		},
		[t, queueSqlAction, sessionAnchorConnection],
	);

	// labels 必须引用稳定：每次 render 新建对象会让 TextBlockView 的 components
	// useMemo 失效，ReactMarkdown 把 p/a/code 等自定义节点当新型别整树 remount，
	// .streaming-chunk 的 fade 动画在每个 delta 重播 → text block 高频闪烁。
	const labels = useMemo(
		() => ({
			copy: t("copyButton.label"),
			copied: t("copyButton.copied"),
		}),
		[t],
	);

	return {
		theme: theme === "dark" ? "dark" : "light",
		labels,
		getFileIconClass,
		onOpenFile,
		onOpenUrl,
		renderCodeBlockActions,
	};
}

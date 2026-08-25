import type { JSX } from "react";
import { useCallback } from "react";
import { Button, cn, Spin } from "@astravia/ui";
import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import {
	activeSessionAtom,
	activityPanelDatabaseWidth,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	defaultConversationCwdAtom,
	openSessionFnRef,
	setActivityPanelWidthAtom,
} from "@shared/store/atoms";
import { SettingsAiAssist } from "../../settings/ai-assist";
import { recordSettingsUsage } from "../../settings/components/recordSettingsUsage";
import { DatabaseConnectionDetails } from "./DatabaseConnectionDetails";
import { DatabaseConnectionForm } from "./DatabaseConnectionForm";
import { DatabaseDetail } from "./DatabaseDetail";
import { DatabaseListHeader } from "./DatabaseListHeader";
import { DatabaseNotice } from "./DatabaseNotice";
import { DatabaseSectionLabel } from "./DatabaseSectionLabel";
import { DatabaseStatusDot } from "./DatabaseStatus";
import { DatabaseTypeBadge } from "./DatabaseTypeBadge";
import { DatabaseWorkspaceHeader } from "./DatabaseWorkspaceHeader";
import { DatabaseLimitsRow, DbxToolAccessRow, SafetyModeRow, SchemaInjectionRow } from "./database-details-shared";
import { SchemaInjectionScopePanel } from "./SchemaInjectionScopePanel";
import { useDatabaseWorkspaceModel } from "./useDatabaseWorkspaceModel";

/**
 * 数据库连接配置管理（B2.6-R 职责分离后 /database 页面与设置页数据库 tab 的视图）：
 * 全局配置区（AI 数据库感知开关 + 引擎说明）+ 连接管理区（列表 / 新增 / 编辑 / 删除 / 测试连接），
 * 不含三栏经典数据库工具界面（后者迁至活动面板「数据库」标签页）。
 *
 * B2.6-U U1/U3：头部收敛为共享 page 头部；连接详情按管理视角独立实现。
 * B2.6-V V1：新增全局配置区（开关上移自连接详情）+ 头部「打开数据库工作台」入口。
 */
export function DatabaseConnectionsWorkspace(): JSX.Element {
	const { t } = useTranslation("settings");
	const model = useDatabaseWorkspaceModel();
	const selected = model.selected;

	const activeSession = useAtomValue(activeSessionAtom);
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	const setPanelOpen = useSetAtom(activityPanelOpenAtom);
	const setTabByProject = useSetAtom(activityPanelTabByProjectAtom);
	const setPanelWidth = useSetAtom(setActivityPanelWidthAtom);
	const navigate = useNavigate();
	const location = useLocation();

	// B2.6-V V1：设置页头部入口 → 激活活动面板「数据库」标签页（数据工作台）。
	// 复用 B2.7 对话→界面的 atom 机制；目标连接/表不传递（仅打开工作台）。
	// B2.6-W 反馈 1：ActivityPanel 仅挂载于聊天/项目/查看器路由，设置页与 /database 路由
	// 无组件消费面板 atom → 先导航到聊天视图再激活，否则视觉无反应。
	// 2026-08 反馈 3 修复：无活动会话时先建默认「对话」会话再导航，避免路由守卫重定向到
	// 新建会话页；目标 tab 键用「会话创建后的生效 cwd」（与 ActivityPanel 读取同源），
	// 不再依赖组件存活期的 pendingOpen 写入（跨路由导航中组件会卸载，写入会丢失）。
	const openWorkbench = useCallback(() => {
		const hasActivityPanel =
			location.pathname === "/" ||
			location.pathname.startsWith("/project/") ||
			location.pathname.startsWith("/viewer/");
		const setDatabaseTab = (cwd: string) => {
			setTabByProject((prev) => {
				const map = new Map(prev);
				map.set(cwd, "database" as ActivityTabKey);
				return map;
			});
		};
		if (activeSession) {
			// 已有会话：导航后 cwd 不变，直接以其 cwd 为目标 tab 键。
			setDatabaseTab(activeSession.cwd);
			if (!hasActivityPanel) void navigate({ to: "/" });
		} else {
			// 无会话：先建默认「对话」会话（navigate 到聊天视图），再以生效 cwd 写入目标 tab。
			const open = openSessionFnRef.current;
			const cwd = defaultConversationCwd?.trim() ?? "";
			if (open && cwd) {
				void (async () => {
					try {
						await open(cwd);
						const effectiveCwd = getDefaultStore().get(activeSessionAtom)?.cwd;
						if (effectiveCwd) setDatabaseTab(effectiveCwd);
					} catch {
						if (!hasActivityPanel) void navigate({ to: "/" });
					}
				})();
			} else if (!hasActivityPanel) {
				void navigate({ to: "/" });
			}
		}
		// 数据库工作台按推荐宽度展开，保留对话面板可见，避免占满全屏。
		setPanelWidth(activityPanelDatabaseWidth(window.innerWidth));
		setPanelOpen(true);
		recordSettingsUsage({ tab: "database", action: "selected", target: "workbench-entry" });
	}, [activeSession, defaultConversationCwd, location.pathname, navigate, setPanelOpen, setPanelWidth, setTabByProject]);

	return (
		<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
			<DatabaseWorkspaceHeader
				variant="page"
				title={t("databaseTitle")}
				subtitle={t("databaseSubtitle")}
				actions={
					<>
						<Button variant="outline" size="sm" onClick={openWorkbench}>
							<span className="icon-[solar--database-linear] h-4 w-4" />
							{t("databaseOpenWorkbench")}
						</Button>
						<SettingsAiAssist tabId="database" triggerLabel={t("databaseConnectionAssistant")} />
						<Button variant="ghost" size="sm" onClick={() => void model.actions.refresh()}>
							<span className="icon-[mdi--refresh] h-4 w-4" />
							{t("databaseRefresh")}
						</Button>
						<Button variant="primary" size="sm" onClick={model.actions.openAdd}>
							<span className="icon-[mdi--plus] h-4 w-4" />
							{t("databaseAddConnection")}
						</Button>
					</>
				}
			/>

			<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-8 pb-6 pt-5">
				<section className="shrink-0">
					<DatabaseSectionLabel icon="icon-[mdi--cog-outline]">{t("databaseSectionGlobal")}</DatabaseSectionLabel>
					<div className="mt-3 flex flex-col gap-3">
						<SchemaInjectionRow model={model} />
						{model.schemaInjection ? <SchemaInjectionScopePanel model={model} /> : null}
						<DbxToolAccessRow model={model} />
						<SafetyModeRow model={model} />
						<DatabaseLimitsRow model={model} />
						<DatabaseNotice tone="info" icon="icon-[mdi--shield-alert-outline]" title={t("databaseCredentialRiskNote")} />
						<DatabaseNotice tone="info" icon="icon-[mdi--shield-lock-outline]" title={t("databaseEngineNote")} />
					</div>
				</section>

				<div className="flex flex-none gap-5">
					<aside className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-xl bg-muted/40">
						<DatabaseListHeader label={t("databaseConnections")} count={model.connections.length} />
						<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
							{model.error ? (
								<div className="px-1 pt-1">
									<DatabaseNotice tone="error" title={model.error}>
										{model.errorDetail ? <DatabaseDetail>{model.errorDetail}</DatabaseDetail> : null}
									</DatabaseNotice>
								</div>
							) : model.loading ? (
								<div className="space-y-1.5 px-1 pt-1">
									{[0, 1, 2].map((i) => (
										<div key={i} className="h-[52px] animate-pulse rounded-lg bg-background/70" />
									))}
								</div>
							) : model.connections.length === 0 ? (
								<div className="flex flex-col items-center gap-2 px-4 pt-8 text-center">
									<span className="icon-[mdi--database-plus-outline] h-7 w-7 text-muted-foreground/50" />
									<p className="text-[12px] leading-relaxed text-muted-foreground">{t("databaseEmpty")}</p>
									<Button variant="outline" size="xs" onClick={model.actions.openAdd}>
										<span className="icon-[mdi--plus] h-3 w-3" />
										{t("databaseAddConnection")}
									</Button>
								</div>
							) : (
								<div className="space-y-0.5">
									{model.connections.map((connection) => {
										const active = connection.name === selected?.name;
										return (
											<button
												key={connection.name}
												type="button"
												onClick={() => model.actions.select(connection.name)}
												className={cn(
													"flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left",
													active ? "bg-background shadow-sm" : "hover:bg-background/60",
												)}
											>
												<DatabaseStatusDot status={model.testSnapshots[connection.name]?.status ?? "untested"} />
												<DatabaseTypeBadge type={connection.type} size="sm" />
												<span className="min-w-0 truncate text-[12.5px] font-semibold text-foreground">
													{connection.name}
												</span>
											</button>
										);
									})}
								</div>
							)}
						</div>
					</aside>

					<main className="min-w-0 flex-1 overflow-y-auto rounded-xl bg-muted/40 px-4 py-4">
						{selected ? (
							<DatabaseConnectionDetails model={model} selected={selected} />
						) : (
							<div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
								<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
									<span className="icon-[solar--database-linear] h-8 w-8" />
								</div>
								<h2 className="text-[17px] font-bold text-foreground">{t("databaseEmptyTitle")}</h2>
								<p className="max-w-[360px] text-[12.5px] leading-relaxed text-muted-foreground">
									{t("databaseEmptyDescription")}
								</p>
								<Button variant="primary" size="sm" onClick={model.actions.openAdd}>
									<span className="icon-[mdi--plus] h-4 w-4" />
									{t("databaseAddConnection")}
								</Button>
							</div>
						)}
					</main>
				</div>
			</div>

			<DatabaseConnectionForm
				open={model.addOpen}
				busy={model.formBusy}
				testing={model.formTesting}
				error={model.formError}
				errorDetail={model.formErrorDetail}
				testResult={model.formTestResult}
				form={model.form}
				onChange={model.actions.changeForm}
				onCancel={model.actions.cancelAdd}
				onPickFile={model.actions.pickFile}
				onSave={() => void model.actions.submitAdd()}
				onTest={() => void model.actions.testDraft()}
			/>
		</div>
	);
}
